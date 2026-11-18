// src/lib/navigation/reportAhead.ts
// Reports de outros riders à frente NA ROTA (estilo Waze): avisa antes de chegar e,
// depois de passar, pergunta se ainda está lá.
import { LngLat, projectOnSegment, distM, bearing } from './geo'

export interface RouteLike {
  coords: LngLat[]
  cum: number[]
}

/** Projeta um ponto na rota a partir do segmento `fromSeg`, olhando até `fromAlong + lookM`. */
export function projectAhead(route: RouteLike, p: LngLat, fromSeg: number, fromAlong: number, lookM: number): { along: number; dist: number; seg: number } | null {
  const { coords, cum } = route
  const start = Math.max(0, Math.min(fromSeg, coords.length - 2))
  const limit = Math.max(cum[start], fromAlong) + lookM
  let best: { along: number; dist: number; seg: number } | null = null
  for (let i = start; i < coords.length - 1 && cum[i] <= limit; i++) {
    const pr = projectOnSegment(p, coords[i], coords[i + 1])
    if (!best || pr.dist < best.dist) best = { along: cum[i] + (cum[i + 1] - cum[i]) * pr.t, dist: pr.dist, seg: i }
  }
  return best
}

export interface ReportLite { id: string; lat: number; lng: number }

/** Filtro de sentido: recebe o report e o rumo com que o rider vai passar por ele. */
export type DirFilter<T> = (r: T, travelHeading: number) => boolean

/** Report mais próximo à frente na rota (até `aheadM`), a no máximo `sideM` metros da linha da rota. */
export function nextReportOnRoute<T extends ReportLite>(
  route: RouteLike, along: number, seg: number, reports: T[], aheadM = 300, sideM = 35, accept?: DirFilter<T>,
): { report: T; distAhead: number; reportAlong: number } | null {
  let best: { report: T; distAhead: number; reportAlong: number } | null = null
  for (const r of reports) {
    const pr = projectAhead(route, [r.lng, r.lat], seg, along, aheadM + 50)
    if (!pr || pr.dist > sideM) continue
    // sentido da rota no ponto do report (polícia do outro lado da avenida não conta)
    if (accept && !accept(r, bearing(route.coords[pr.seg], route.coords[Math.min(pr.seg + 1, route.coords.length - 1)]))) continue
    const ahead = pr.along - along
    if (ahead < -5 || ahead > aheadM) continue
    if (!best || ahead < best.distAhead) best = { report: r, distAhead: Math.max(0, ahead), reportAlong: pr.along }
  }
  return best
}

/**
 * Sem navegação (rider só a conduzir com o mapa aberto): report à frente na direção do movimento.
 * Usa o rumo do GPS (não a bússola) — em cone de ±coneDeg e a no máx. sideM metros para o lado.
 */
export function nextReportAheadFree<T extends ReportLite>(
  pos: LngLat, headingDeg: number, reports: T[], maxM = 250, coneDeg = 30, sideM = 40, accept?: DirFilter<T>,
): { report: T; dist: number } | null {
  let best: { report: T; dist: number } | null = null
  for (const r of reports) {
    if (accept && !accept(r, headingDeg)) continue
    const p: LngLat = [r.lng, r.lat]
    const d = distM(pos, p)
    if (d > maxM) continue
    const diff = Math.abs(((bearing(pos, p) - headingDeg + 540) % 360) - 180)
    if (d > 25 && diff > coneDeg) continue
    if (Math.sin(diff * Math.PI / 180) * d > sideM) continue
    if (!best || d < best.dist) best = { report: r, dist: d }
  }
  return best
}
