// src/lib/clustering.ts
// Zonas automáticas a partir dos reports (estilo Waze).
//
// Regras (para um único report não desviar a rota de toda a gente):
//  • só conta reports dos últimos 7 dias, a até 250 m uns dos outros;
//  • precisa de PROVA DE MAIS DE UMA PESSOA: 2+ riders diferentes a reportar,
//    ou 1 report confirmado ("ainda está") por outro rider;
//  • reports desmentidos (3+ "já saiu") ou "zona segura" não contam;
//  • nível e raio crescem com o número de riders e de confirmações.
// Faz 1 consulta (sem índice composto) + até 7 leituras de documento — antes eram até 37
// consultas por report, e a consulta exigia um índice que o projeto não tinha.
import {
  collection, getDocs, getDoc, query, where, setDoc, doc,
  Timestamp, serverTimestamp,
} from 'firebase/firestore'
import { db } from './firebase'
import { avaliarCluster, ClusterReport } from './clusterRules'
export { avaliarCluster } from './clusterRules'

const DIAS = 7

const cityCache = new Map<string, string>()
async function detectarCidade(lat: number, lng: number): Promise<string> {
  const key = `${lat.toFixed(1)},${lng.toFixed(1)}`
  if (cityCache.has(key)) return cityCache.get(key)!
  try {
    const token = process.env.NEXT_PUBLIC_MAPBOX_TOKEN
    const res = await fetch(`https://api.mapbox.com/geocoding/v5/mapbox.places/${lng},${lat}.json?types=place&access_token=${token}`)
    const data = await res.json()
    const city = String(data.features?.[0]?.text ?? 'unknown').toLowerCase().replace(/\s+/g, '-').replace(/[^a-z0-9-]/g, '')
    cityCache.set(key, city)
    return city
  } catch {
    return 'unknown'
  }
}

export async function processarClustering(lat: number, lng: number): Promise<void> {
  const { latLngToCell, gridDisk, cellToLatLng } = await import('h3-js')
  const disco = gridDisk(latLngToCell(lat, lng, 9), 1)   // o hexágono e os 6 vizinhos (~250 m)

  const snap = await getDocs(query(collection(db, 'incidents'), where('h3Index', 'in', disco)))
  const all: ClusterReport[] = snap.docs.map(d => {
    const x = d.data()
    const loc = x.location ?? {}
    return {
      lat: Number(loc.lat), lng: Number(loc.lng),
      userId: String(x.userId ?? ''),
      type: String(x.type ?? ''),
      hour: x.hour ?? null,
      confirmations: x.confirmations ?? 0,
      denials: x.denials ?? 0,
      timestampMs: x.timestamp?.toMillis?.() ?? 0,
      roadSegment: x.roadSegment ?? null,
    }
  })

  const r = avaliarCluster(lat, lng, all)
  if (!r) return

  // Reaproveita uma zona automática que já exista ali perto (evita zonas duplicadas lado a lado)
  let h3Index = latLngToCell(r.center.lat, r.center.lng, 9)
  for (const h of disco) {
    try {
      const ex = await getDoc(doc(db, 'risk_zones', `AUTO-${h}`))
      if (ex.exists()) { h3Index = h; break }
    } catch { /* segue */ }
  }
  const [hLat, hLng] = cellToLatLng(h3Index)
  const zoneId = `AUTO-${h3Index}`
  const city = await detectarCidade(hLat, hLng)

  await setDoc(doc(db, 'risk_zones', zoneId), {
    zoneId, h3Index,
    zoneType: 'auto',
    areaName: r.dominantSegment ? `Reports: ${r.dominantSegment}` : 'Zona reportada por riders',
    city,
    lat: r.center.lat, lng: r.center.lng,
    radius: r.radius,
    riskLevel: r.riskLevel,
    riskScore: r.riskLevel === 'critical' ? 90 : r.riskLevel === 'high' ? 70 : r.riskLevel === 'medium' ? 45 : 25,
    incidentCount: r.reports,
    riderCount: r.riders,
    confirmationCount: r.confirmations,
    dominantType: r.dominantType,
    dominantSegment: r.dominantSegment,
    peakHours: r.peakHours,
    source: 'auto_clustering',
    isPermanent: false,
    canBeRemovedByReports: true,
    autoExpireAt: Timestamp.fromDate(new Date(Date.now() + DIAS * 24 * 3600 * 1000)),
    lastIncidentAt: serverTimestamp(),
    createdAt: serverTimestamp(),
    updatedAt: serverTimestamp(),
  }, { merge: true })
}
