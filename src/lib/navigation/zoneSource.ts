// src/lib/navigation/zoneSource.ts
// Carrega as zonas a evitar (Firestore `risk_zones` + zonas permanentes), com cache curto
// para não repetir a leitura a cada recálculo de rota.
import { collection, getDocs } from 'firebase/firestore'
import { db } from '@/lib/firebase'
import { ALL_ZONES, getRiskLevelActual } from '@/lib/permanentZones'
import { AvoidZone, fromFirestoreZone, fromPermanentZone } from './zones'

let cache: { at: number; raw: any[] } | null = null
const TTL = 2 * 60 * 1000

export async function fetchFirestoreZonesRaw(force = false): Promise<any[]> {
  if (!force && cache && Date.now() - cache.at < TTL) return cache.raw
  try {
    const snap = await getDocs(collection(db, 'risk_zones'))
    const raw = snap.docs.map(d => ({ id: d.id, ...d.data() }))
    cache = { at: Date.now(), raw }
    return raw
  } catch {
    return cache?.raw ?? []
  }
}

/**
 * Atualiza o cache com zonas que o app já recebeu em tempo real (onSnapshot do mapa),
 * evitando uma leitura extra no Firestore a cada cálculo de rota.
 */
export function primeZoneCache(raw: any[]) {
  cache = { at: Date.now(), raw }
}

/** Zonas que a rota segura deve evitar agora (considera horário de pico e validade). */
export async function loadAvoidZones(force = false): Promise<AvoidZone[]> {
  const now = new Date()
  const hour = now.getHours()
  const raw = await fetchFirestoreZonesRaw(force)
  const fs = raw.map(z => fromFirestoreZone(z, now)).filter(Boolean) as AvoidZone[]
  const perm = ALL_ZONES
    .map(z => fromPermanentZone(z as any, getRiskLevelActual(z as any, hour), hour))
    .filter(Boolean) as AvoidZone[]
  return [...fs, ...perm]
}

/** Converte para o formato que a interface já usa (ZoneHit). */
export function toZoneHit(z: AvoidZone) {
  return {
    id: z.id, name: z.name, zone: z.name, city: z.city, country: 'ie',
    lat: z.center[1], lng: z.center[0], radius: Math.round(z.radiusM),
    riskLevel: z.level, actualLevel: z.level, isPicoAgora: z.peak,
  }
}
