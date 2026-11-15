// src/lib/navigation/habits.ts
// O app aprende os caminhos do rider (fica tudo NO APARELHO — nada vai para o servidor).
//  • Cada viagem concluída guarda origem, destino e o trajeto real (simplificado).
//  • Destinos repetidos viram "Frequentes" na pesquisa.
//  • Se o rider fez 2+ vezes o MESMO caminho próprio (diferente do sugerido) entre os
//    mesmos pontos, esse caminho passa a ser a rota padrão para ele — desde que seja
//    seguro (a análise de zonas continua a mandar) e não muito mais lento.
import { LngLat, distM } from './geo'

const KEY = 'zivo_trips_v1'
const MAX_TRIPS = 150
const MAX_TRACE = 200

export interface Trip {
  o: LngLat; d: LngLat
  name?: string
  t: number            // início (ms)
  dur: number          // s
  dist: number         // m
  mode: string         // perfil (driving-traffic, cycling, walking…)
  trace: LngLat[]
  followed: number     // 0..1 — quanto do trajeto real seguiu a rota sugerida no início
}

export type ModeFamily = 'car' | 'bike' | 'walk'
export function modeFamily(profile: string): ModeFamily {
  if (profile.startsWith('driving')) return 'car'
  if (profile === 'walking') return 'walk'
  return 'bike'
}

function read(): Trip[] {
  try {
    const raw = localStorage.getItem(KEY)
    const arr = raw ? JSON.parse(raw) : []
    return Array.isArray(arr) ? arr.filter(t => t && Array.isArray(t.o) && Array.isArray(t.d) && Array.isArray(t.trace)) : []
  } catch { return [] }
}
function write(trips: Trip[]) {
  try { localStorage.setItem(KEY, JSON.stringify(trips.slice(-MAX_TRIPS))) } catch { /* cheio: ignora */ }
}

/** Reduz o trajeto a pontos com ≥ ~40 m entre si e no máximo MAX_TRACE pontos. */
export function simplifyTrace(pts: LngLat[], minGap = 40): LngLat[] {
  const out: LngLat[] = []
  for (const p of pts) {
    if (!out.length || distM(out[out.length - 1], p) >= minGap) out.push([+p[0].toFixed(5), +p[1].toFixed(5)])
  }
  if (pts.length && out.length && distM(out[out.length - 1], pts[pts.length - 1]) > 5) out.push(pts[pts.length - 1])
  if (out.length <= MAX_TRACE) return out
  const step = out.length / MAX_TRACE
  return Array.from({ length: MAX_TRACE }, (_, i) => out[Math.floor(i * step)])
}

/** Distância de um ponto à polilinha (aproximação plana, suficiente para < 1 km). */
function distToLine(p: LngLat, line: LngLat[]): number {
  let best = Infinity
  const kx = 111320 * Math.cos(p[1] * Math.PI / 180), ky = 110540
  for (let i = 0; i < line.length - 1; i++) {
    const ax = (line[i][0] - p[0]) * kx, ay = (line[i][1] - p[1]) * ky
    const bx = (line[i + 1][0] - p[0]) * kx, by = (line[i + 1][1] - p[1]) * ky
    const dx = bx - ax, dy = by - ay
    const L = dx * dx + dy * dy
    const t = L > 0 ? Math.max(0, Math.min(1, -(ax * dx + ay * dy) / L)) : 0
    const x = ax + t * dx, y = ay + t * dy
    best = Math.min(best, Math.hypot(x, y))
  }
  return line.length === 1 ? distM(p, line[0]) : best
}

/** Fração dos pontos de `trace` que ficam a ≤ tol metros de `route`. */
export function overlap(trace: LngLat[], route: LngLat[], tol = 40): number {
  if (!trace.length || route.length < 2) return 0
  let ok = 0
  for (const p of trace) if (distToLine(p, route) <= tol) ok++
  return ok / trace.length
}

export function recordTrip(trip: Trip) {
  if (trip.trace.length < 3 || trip.dist < 300) return
  const trips = read()
  trips.push({ ...trip, trace: simplifyTrace(trip.trace) })
  write(trips)
}

export function allTrips(): Trip[] { return read() }
export function clearTrips() { try { localStorage.removeItem(KEY) } catch {} }

/** Destinos a que o rider vai repetidamente (≥ 2 vezes), mais visitados primeiro. */
export function frequentPlaces(limit = 5, trips: Trip[] = read()): { lng: number; lat: number; name: string; count: number; last: number }[] {
  const groups: { pts: LngLat[]; names: string[]; count: number; last: number }[] = []
  for (const t of trips) {
    const g = groups.find(g => distM(g.pts[0], t.d) < 150)
    if (g) { g.pts.push(t.d); if (t.name) g.names.push(t.name); g.count++; g.last = Math.max(g.last, t.t) }
    else groups.push({ pts: [t.d], names: t.name ? [t.name] : [], count: 1, last: t.t })
  }
  return groups.filter(g => g.count >= 2)
    .sort((a, b) => b.count - a.count || b.last - a.last)
    .slice(0, limit)
    .map(g => {
      const lng = g.pts.reduce((s, p) => s + p[0], 0) / g.pts.length
      const lat = g.pts.reduce((s, p) => s + p[1], 0) / g.pts.length
      const counts: Record<string, number> = {}
      g.names.forEach(n => { counts[n] = (counts[n] ?? 0) + 1 })
      const name = Object.entries(counts).sort((a, b) => b[1] - a[1])[0]?.[0] ?? 'Destino frequente'
      return { lng, lat, name, count: g.count, last: g.last }
    })
}

/**
 * Caminho habitual entre estes dois pontos: precisa de 2+ viagens (mesmo tipo de veículo)
 * em que o rider fez o próprio caminho (seguiu < 70 % da rota sugerida) e esses trajetos
 * são parecidos entre si. Devolve o trajeto mais recente desse grupo.
 */
export function habitualTrace(o: LngLat, d: LngLat, profile: string, trips: Trip[] = read()): LngLat[] | null {
  const fam = modeFamily(profile)
  const cand = trips
    .filter(t => modeFamily(t.mode) === fam && t.followed < 0.7
      && distM(t.o, o) < 400 && distM(t.d, d) < 300 && t.trace.length >= 5)
    .sort((a, b) => b.t - a.t)
  for (let i = 0; i < cand.length; i++) {
    for (let j = i + 1; j < cand.length; j++) {
      // parecidos nos dois sentidos (um não é só um pedaço do outro)
      if (overlap(cand[i].trace, cand[j].trace, 50) >= 0.8 && overlap(cand[j].trace, cand[i].trace, 50) >= 0.8) {
        return cand[i].trace
      }
    }
  }
  return null
}

/** Pontos de passagem (silenciosos) para obrigar o roteador a seguir o trajeto habitual. */
export function viasFromTrace(trace: LngLat[], n = 3): { lat: number; lng: number }[] {
  if (trace.length < 3) return []
  const cum = [0]
  for (let i = 1; i < trace.length; i++) cum.push(cum[i - 1] + distM(trace[i - 1], trace[i]))
  const total = cum[cum.length - 1]
  const vias: { lat: number; lng: number }[] = []
  for (let k = 1; k <= n; k++) {
    const target = total * k / (n + 1)
    const i = cum.findIndex(c => c >= target)
    const p = trace[Math.max(0, i)]
    vias.push({ lng: p[0], lat: p[1] })
  }
  return vias
}
