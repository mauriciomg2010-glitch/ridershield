// src/lib/navigation/reportAhead.ts
// Reports de outros riders à frente NA ROTA (estilo Waze): avisa antes de chegar e,
// depois de passar, pergunta se ainda está lá.
import { LngLat, projectOnSegment } from './geo'

export interface RouteLike {
  coords: LngLat[]
  cum: number[]
}

/** Projeta um ponto na rota a partir do segmento `fromSeg`, olhando até `fromAlong + lookM`. */
export function projectAhead(route: RouteLike, p: LngLat, fromSeg: number, fromAlong: number, lookM: number): { along: number; dist: number } | null {
  const { coords, cum } = route
  const start = Math.max(0, Math.min(fromSeg, coords.length - 2))
  const limit = Math.max(cum[start], fromAlong) + lookM
  let best: { along: number; dist: number } | null = null
  for (let i = start; i < coords.length - 1 && cum[i] <= limit; i++) {
    const pr = projectOnSegment(p, coords[i], coords[i + 1])
    if (!best || pr.dist < best.dist) best = { along: cum[i] + (cum[i + 1] - cum[i]) * pr.t, dist: pr.dist }
  }
  return best
}

export interface ReportLite { id: string; lat: number; lng: number }

/** Report mais próximo à frente na rota (até `aheadM`), a no máximo `sideM` metros da linha da rota. */
export function nextReportOnRoute<T extends ReportLite>(
  route: RouteLike, along: number, seg: number, reports: T[], aheadM = 300, sideM = 35,
): { report: T; distAhead: number; reportAlong: number } | null {
  let best: { report: T; distAhead: number; reportAlong: number } | null = null
  for (const r of reports) {
    const pr = projectAhead(route, [r.lng, r.lat], seg, along, aheadM + 50)
    if (!pr || pr.dist > sideM) continue
    const ahead = pr.along - along
    if (ahead < -5 || ahead > aheadM) continue
    if (!best || ahead < best.distAhead) best = { report: r, distAhead: Math.max(0, ahead), reportAlong: pr.along }
  }
  return best
}
