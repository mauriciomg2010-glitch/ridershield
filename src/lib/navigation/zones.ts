// src/lib/navigation/zones.ts
// Converte as zonas de risco (Firestore + zonas permanentes) num formato único
// e verifica, segmento a segmento, se uma rota passa por elas.
import {
  LngLat, BBox, distM, circleRing, bboxOf, bboxOverlap, bboxPad,
  pointInRing, segmentsIntersect, segmentSegmentDist, projectOnSegment, destination, bearing,
} from './geo'

export type ZoneLevel = 'low' | 'medium' | 'high' | 'critical'

export interface AvoidZone {
  id: string
  name: string
  level: ZoneLevel
  city: string
  /** 'area' = polígono/círculo; 'street' = trecho de rua com largura `bufferM` */
  kind: 'area' | 'street'
  ring: LngLat[]          // contorno fechado (para 'street', o contorno do buffer)
  line?: LngLat[]         // eixo da rua (só 'street')
  bufferM: number         // meia-largura da rua (só 'street')
  center: LngLat
  radiusM: number         // raio que envolve toda a zona (a partir do centro)
  bbox: BBox
  peak: boolean
  source: 'firestore' | 'permanent'
}

/** [20,21,22,23,0,1] → "20h–2h" (blocos contínuos, inclusive passando da meia-noite). */
export function hoursLabel(hours: number[]): string {
  const set = new Set(hours.map(h => ((Number(h) % 24) + 24) % 24))
  if (set.size === 0) return ''
  if (set.size === 24) return '24h'
  const starts = [...set].filter(h => !set.has((h + 23) % 24)).sort((a, b) => a - b)
  return starts.map(s => {
    let e = s
    while (set.has((e + 1) % 24)) e = (e + 1) % 24
    return `${s}h–${(e + 1) % 24}h`
  }).join(', ')
}

const toPt = (c: any): LngLat | null => {
  if (Array.isArray(c) && c.length >= 2 && isFinite(c[0]) && isFinite(c[1])) return [Number(c[0]), Number(c[1])]
  if (c && isFinite(c.lng) && isFinite(c.lat)) return [Number(c.lng), Number(c.lat)]
  return null
}

function closeRing(pts: LngLat[]): LngLat[] {
  const f = pts[0], l = pts[pts.length - 1]
  return f[0] === l[0] && f[1] === l[1] ? pts : [...pts, f]
}

/** Contorno aproximado de um trecho de rua com meia-largura `w` (m). */
function bufferLine(line: LngLat[], w: number): LngLat[] {
  if (line.length === 1) return circleRing(line[0], w, 16)
  const left: LngLat[] = [], right: LngLat[] = []
  for (let i = 0; i < line.length; i++) {
    const a = line[Math.max(0, i - 1)], b = line[Math.min(line.length - 1, i + 1)]
    const brg = bearing(a, b)
    left.push(destination(line[i], w, brg - 90))
    right.push(destination(line[i], w, brg + 90))
  }
  // tampas nas pontas
  const start = destination(line[0], w, bearing(line[1], line[0]))
  const end = destination(line[line.length - 1], w, bearing(line[line.length - 2], line[line.length - 1]))
  return closeRing([start, ...left, end, ...right.reverse()])
}

function finish(z: Omit<AvoidZone, 'center' | 'radiusM' | 'bbox'> & { center?: LngLat }): AvoidZone {
  const pts = z.ring.slice(0, -1)
  const center: LngLat = z.center ?? [
    pts.reduce((s, p) => s + p[0], 0) / pts.length,
    pts.reduce((s, p) => s + p[1], 0) / pts.length,
  ]
  const radiusM = Math.max(...z.ring.map(p => distM(center, p)))
  return { ...z, center, radiusM, bbox: bboxOf(z.ring) }
}

/** Zona do Firestore (`risk_zones`) → AvoidZone. Ignora zonas inválidas ou expiradas. */
export function fromFirestoreZone(raw: any, now = new Date()): AvoidZone | null {
  if (!raw) return null
  const exp = raw.autoExpireAt
  const expMs = exp?.toMillis ? exp.toMillis() : exp?.seconds ? exp.seconds * 1000 : typeof exp === 'number' ? exp : null
  if (expMs && expMs < now.getTime()) return null

  const hour = now.getHours()
  // Zona só por horário (ex.: canal à noite): fora das horas marcadas não é evitada.
  const peaks: number[] = Array.isArray(raw.peakHours) ? raw.peakHours.map(Number) : []
  if (raw.blockOnlyInPeakHours === true && peaks.length > 0 && !peaks.includes(hour)) return null
  // Zonas automáticas (geradas pelos reports) são círculos e apanhavam avenidas e casas à volta:
  // só desviam a rota quando já são de risco alto/crítico (5+ riders/confirmações). Abaixo disso
  // ficam só no mapa e nos avisos de report.
  if (raw.source === 'auto_clustering' && raw.riskLevel !== 'high' && raw.riskLevel !== 'critical') return null
  const base = {
    id: String(raw.id ?? raw.zoneId ?? ''),
    name: String(raw.areaName ?? raw.segmentName ?? raw.name ?? raw.id ?? 'Zona'),
    level: (['low', 'medium', 'high', 'critical'].includes(raw.riskLevel) ? raw.riskLevel : 'medium') as ZoneLevel,
    city: String(raw.city ?? 'dublin'),
    peak: peaks.includes(hour),
    source: 'firestore' as const,
  }

  // 1) polígono
  if (Array.isArray(raw.polygon) && raw.polygon.length >= 3) {
    const pts = raw.polygon.map(toPt).filter(Boolean) as LngLat[]
    if (pts.length >= 3) return finish({ ...base, kind: 'area', ring: closeRing(pts), bufferM: 0 })
  }
  // 2) trecho de rua (LineString encaixada na rua)
  const g = raw.geometry
  if (g && g.type === 'LineString' && Array.isArray(g.coordinates) && g.coordinates.length >= 2) {
    const line = g.coordinates.map(toPt).filter(Boolean) as LngLat[]
    if (line.length >= 2) {
      const w = Math.max(15, Math.min(60, Number(raw.radius) || 30))
      return finish({ ...base, kind: 'street', line, bufferM: w, ring: bufferLine(line, w) })
    }
  }
  // 3) círculo
  if (isFinite(raw.lat) && isFinite(raw.lng) && Number(raw.radius) > 0 && !(raw.lat === 0 && raw.lng === 0)) {
    const c: LngLat = [Number(raw.lng), Number(raw.lat)]
    return finish({ ...base, kind: 'area', ring: circleRing(c, Number(raw.radius)), bufferM: 0, center: c })
  }
  return null
}

/** Zona permanente (lista estática) — só conta se o nível atual for alto/crítico. */
export function fromPermanentZone(z: {
  id: string; name: string; city: string; lat: number; lng: number; radius: number
  peakHours?: number[]; riskLevel: ZoneLevel
}, actualLevel: ZoneLevel, hour: number): AvoidZone | null {
  if (actualLevel !== 'high' && actualLevel !== 'critical') return null
  const peak = z.peakHours?.includes(hour) ?? false
  const c: LngLat = [z.lng, z.lat]
  const r = peak ? z.radius * 1.2 : z.radius
  return finish({ id: z.id, name: z.name, level: actualLevel, city: z.city, kind: 'area', ring: circleRing(c, r), bufferM: 0, center: c, peak, source: 'permanent' })
}

/**
 * Margem da borda (m): as zonas desenhadas à mão encostam nas avenidas, e o GPS erra 5–15 m.
 * Só conta como "dentro" quem está pelo menos EDGE_TOL_M para dentro da borda — assim a avenida
 * que passa entre duas zonas, ou a rua de casa colada a uma zona, deixa de ser marcada.
 */
export const EDGE_TOL_M = 15

function distToRing(p: LngLat, ring: LngLat[]): number {
  let best = Infinity
  for (let i = 1; i < ring.length; i++) best = Math.min(best, projectOnSegment(p, ring[i - 1], ring[i]).dist)
  return best
}

export function pointInZone(p: LngLat, z: AvoidZone, margin = EDGE_TOL_M): boolean {
  if (p[0] < z.bbox[0] || p[0] > z.bbox[2] || p[1] < z.bbox[1] || p[1] > z.bbox[3]) return false
  if (z.kind === 'street' && z.line) {
    for (let i = 1; i < z.line.length; i++) if (projectOnSegment(p, z.line[i - 1], z.line[i]).dist <= z.bufferM) return true
    return false
  }
  if (!pointInRing(p, z.ring)) return false
  return margin <= 0 || distToRing(p, z.ring) >= margin
}

function segmentHitsZone(a: LngLat, b: LngLat, z: AvoidZone): boolean {
  if (z.kind === 'street' && z.line) {
    for (let i = 1; i < z.line.length; i++) if (segmentSegmentDist(a, b, z.line[i - 1], z.line[i]) <= z.bufferM) return true
    return false
  }
  // percorre o segmento a cada ~8 m: só conta se algum ponto entra EDGE_TOL_M para dentro da zona
  const len = distM(a, b)
  const n = Math.max(1, Math.ceil(len / 8))
  for (let k = 0; k <= n; k++) {
    const t = k / n
    if (pointInZone([a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t], z)) return true
  }
  return false
}

/**
 * Travessia curta: a rota só CORTA a zona (ex.: avenida que atravessa o canal por uma ponte).
 * Se cada pedaço da rota dentro da zona tem no máximo isto, não conta como "passar pela zona":
 * não há aviso e não se procura desvio.
 */
export const CROSSING_MAX_M = 120

/** Pedaços contínuos da rota dentro da zona: [início, fim] em metros ao longo da rota. */
export function insideRuns(coords: LngLat[], z: AvoidZone): { entry: number; exit: number }[] {
  const runs: { entry: number; exit: number }[] = []
  let acc = 0, cur: { entry: number; exit: number } | null = null
  const zb = bboxPad(z.bbox, 5)
  for (let i = 1; i < coords.length; i++) {
    const a = coords[i - 1], b = coords[i]
    const len = distM(a, b)
    const far = Math.max(a[0], b[0]) < zb[0] || Math.min(a[0], b[0]) > zb[2] || Math.max(a[1], b[1]) < zb[1] || Math.min(a[1], b[1]) > zb[3]
    const n = far ? 1 : Math.max(1, Math.ceil(len / 8))
    for (let k = i === 1 ? 0 : 1; k <= n; k++) {
      const t = k / n
      const at = acc + len * t
      const inside = !far && pointInZone([a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t], z)
      if (inside) { if (!cur) cur = { entry: at, exit: at }; else cur.exit = at }
      else if (cur) { runs.push(cur); cur = null }
    }
    acc += len
  }
  if (cur) runs.push(cur)
  return runs
}

/**
 * A rota só atravessa a zona de passagem? Cada pedaço dentro tem de ser curto (≤ 120 m) E pequeno
 * perto do tamanho da zona (≤ 35% do diâmetro). Assim cortar o canal (2 km de comprido) por uma
 * avenida é passagem, mas atravessar uma zona pequena marcada num cruzamento continua a contar.
 */
export function isShortCrossing(coords: LngLat[], z: AvoidZone, maxM = CROSSING_MAX_M): boolean {
  const lim = Math.min(maxM, 0.35 * 2 * z.radiusM)
  const runs = insideRuns(coords, z)
  return runs.length > 0 && runs.every(r => r.exit - r.entry <= lim)
}

/**
 * Zonas atravessadas pela rota (verificação por segmento — não deixa passar zonas pequenas).
 * Por defeito ignora as travessias curtas (só cortar a zona por uma rua).
 */
export function zonesOnRoute(coords: LngLat[], zones: AvoidZone[], opts: { includeShortCrossings?: boolean } = {}): AvoidZone[] {
  const all = zonesTouchedByRoute(coords, zones)
  return opts.includeShortCrossings ? all : all.filter(z => !isShortCrossing(coords, z))
}

/** Zonas que a rota apenas corta de passagem (para não avisar quando o GPS entra nelas). */
export function shortCrossingsOnRoute(coords: LngLat[], zones: AvoidZone[]): AvoidZone[] {
  return zonesTouchedByRoute(coords, zones).filter(z => isShortCrossing(coords, z))
}

function zonesTouchedByRoute(coords: LngLat[], zones: AvoidZone[]): AvoidZone[] {
  if (coords.length < 2 || zones.length === 0) return []
  const rb = bboxPad(bboxOf(coords), 50)
  const cand = zones.filter(z => bboxOverlap(rb, z.bbox))
  if (!cand.length) return []
  const hits: AvoidZone[] = []
  for (const z of cand) {
    const zb = bboxPad(z.bbox, 5)
    for (let i = 1; i < coords.length; i++) {
      const a = coords[i - 1], b = coords[i]
      // filtro rápido pela bbox do segmento
      if (Math.max(a[0], b[0]) < zb[0] || Math.min(a[0], b[0]) > zb[2] || Math.max(a[1], b[1]) < zb[1] || Math.min(a[1], b[1]) > zb[3]) continue
      if (segmentHitsZone(a, b, z)) { hits.push(z); break }
    }
  }
  return hits
}

/** Posição (m ao longo da rota) onde a rota entra e sai da zona; null se não toca. */
export function entryExitAlong(coords: LngLat[], z: AvoidZone): { entry: number; exit: number; entryPt: LngLat; exitPt: LngLat } | null {
  let acc = 0, entry = -1, exit = -1
  let entryPt: LngLat = coords[0], exitPt: LngLat = coords[0]
  for (let i = 1; i < coords.length; i++) {
    const a = coords[i - 1], b = coords[i]
    const len = distM(a, b)
    if (segmentHitsZone(a, b, z)) {
      if (entry < 0) { entry = acc; entryPt = a }
      exit = acc + len; exitPt = b
    }
    acc += len
  }
  return entry < 0 ? null : { entry, exit, entryPt, exitPt }
}
