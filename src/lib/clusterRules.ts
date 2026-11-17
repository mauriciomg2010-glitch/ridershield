// src/lib/clusterRules.ts
// Regra pura (sem Firebase) que decide se reports viram zona automática — ver clustering.ts.

const RAIO_CLUSTER_M = 250
const DIAS = 7

function distM(aLat: number, aLng: number, bLat: number, bLng: number): number {
  const R = 6371000, toR = Math.PI / 180
  const dLat = (bLat - aLat) * toR, dLng = (bLng - aLng) * toR
  const s = Math.sin(dLat / 2) ** 2 + Math.cos(aLat * toR) * Math.cos(bLat * toR) * Math.sin(dLng / 2) ** 2
  return 2 * R * Math.asin(Math.sqrt(s))
}

export interface ClusterReport {
  lat: number; lng: number
  userId: string
  type: string
  hour?: number | null
  confirmations?: number
  denials?: number
  timestampMs: number
  roadSegment?: string | null
}

export interface ClusterResult {
  riders: number
  confirmations: number
  reports: number
  center: { lat: number; lng: number }
  riskLevel: 'low' | 'medium' | 'high' | 'critical'
  radius: number
  peakHours: number[]
  dominantType: string
  dominantSegment: string | null
}

/** Decide (função pura, testável) se os reports à volta de um ponto justificam uma zona. */
const SEGURANCA = new Set(['assault_robbery', 'attempted_robbery', 'physical_assault', 'bike_theft', 'suspicious_activity', 'robbery', 'aggression'])

export function avaliarCluster(lat: number, lng: number, all: ClusterReport[], now = Date.now()): ClusterResult | null {
  const desde = now - DIAS * 24 * 3600 * 1000
  const reports = all.filter(r =>
    Number.isFinite(r.lat) && Number.isFinite(r.lng)
    && r.timestampMs >= desde
    // só reports de SEGURANÇA viram zona (polícia, buraco, trânsito… não são zona de risco)
    && SEGURANCA.has(r.type)
    && (r.denials ?? 0) < (r.confirmations ?? 0) + 2
    && distM(lat, lng, r.lat, r.lng) <= RAIO_CLUSTER_M)
  if (!reports.length) return null

  const riders = new Set(reports.map(r => r.userId).filter(Boolean)).size
  const confirmations = reports.reduce((s, r) => s + Math.max(0, r.confirmations ?? 0), 0)
  // prova de mais de uma pessoa
  if (riders < 2 && confirmations < 1) return null

  const evidencia = riders + confirmations
  const riskLevel: ClusterResult['riskLevel'] =
    evidencia >= 8 ? 'critical' : evidencia >= 5 ? 'high' : evidencia >= 3 ? 'medium' : 'low'
  const radius = evidencia >= 5 ? 150 : evidencia >= 3 ? 110 : 80

  const center = {
    lat: reports.reduce((s, r) => s + r.lat, 0) / reports.length,
    lng: reports.reduce((s, r) => s + r.lng, 0) / reports.length,
  }

  const tipoCount: Record<string, number> = {}
  reports.forEach(r => { tipoCount[r.type] = (tipoCount[r.type] ?? 0) + 1 })
  const dominantType = Object.entries(tipoCount).sort((a, b) => b[1] - a[1])[0]?.[0] ?? 'suspicious_activity'

  const horaCount: Record<number, number> = {}
  reports.forEach(r => { if (r.hour != null) horaCount[r.hour] = (horaCount[r.hour] ?? 0) + 1 })
  const peakHours = Object.entries(horaCount).filter(([, c]) => c >= 2).map(([h]) => parseInt(h))

  const segCount: Record<string, number> = {}
  reports.forEach(r => { if (r.roadSegment) segCount[r.roadSegment] = (segCount[r.roadSegment] ?? 0) + 1 })
  const dominantSegment = Object.entries(segCount).sort((a, b) => b[1] - a[1])[0]?.[0] ?? null

  return { riders, confirmations, reports: reports.length, center, riskLevel, radius, peakHours, dominantType, dominantSegment }
}

