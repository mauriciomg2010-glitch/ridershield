// src/lib/reportRules.ts
// Quanto tempo cada report fica no mapa e quando sai (estilo Waze).
//
//  • Cada tipo tem uma duração (ex.: polícia 2 h, buraco 30 dias).
//  • Cada "Sim, está" de outro rider renova o prazo a partir desse momento,
//    até no máximo 3× a duração desde que foi criado.
//  • Sai do mapa quando os "Não, já saiu" passam os "Sim, está" por 2
//    (0 confirmações → 2 riders a dizer que saiu; 1 confirmação → 3; …).
//  • Votos repetidos do mesmo rider não contam (cada um vota uma vez).

/** Duração base em minutos por tipo. */
export const REPORT_TTL_MIN: Record<string, number> = {
  assault_robbery: 24 * 60, attempted_robbery: 24 * 60, physical_assault: 24 * 60,
  bike_theft: 24 * 60, suspicious_activity: 6 * 60, no_entry_zone: 24 * 60, confirmed_safe: 12 * 60,
  police: 2 * 60, accident: 2 * 60, traffic_jam: 60, road_closed: 12 * 60,
  construction: 7 * 24 * 60, pothole: 30 * 24 * 60, road_hazard: 4 * 60, flooding: 6 * 60,
  robbery: 24 * 60, aggression: 24 * 60,
}
export const MAX_TTL_MIN = Math.max(...Object.values(REPORT_TTL_MIN))
export const DENY_MARGIN = 2

export interface ReportLike {
  type: string
  timestamp: Date
  lastConfirmedAt?: Date | null
  confirmations?: number
  denials?: number
}

export function reportExpiresAt(r: ReportLike): number {
  const ttl = (REPORT_TTL_MIN[r.type] ?? 24 * 60) * 60000
  const criado = r.timestamp.getTime()
  const base = Math.max(criado, r.lastConfirmedAt?.getTime() ?? 0)
  return Math.min(base + ttl, criado + 3 * ttl)
}

export function reportRemovedByVotes(r: ReportLike): boolean {
  return (r.denials ?? 0) >= (r.confirmations ?? 0) + DENY_MARGIN
}

export function isReportActive(r: ReportLike, now = Date.now()): boolean {
  return now < reportExpiresAt(r) && !reportRemovedByVotes(r)
}
