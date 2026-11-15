// src/lib/navigation/geo.ts
// Funções geométricas puras (sem React, sem rede) usadas pela navegação.
// Convenção: LngLat = [lng, lat] (igual ao GeoJSON / Mapbox).

export type LngLat = [number, number]
export interface LatLng { lat: number; lng: number }

const R = 6371000
const toRad = (d: number) => (d * Math.PI) / 180
const toDeg = (r: number) => (r * 180) / Math.PI

/** Distância em metros entre dois pontos [lng, lat]. */
export function distM(a: LngLat, b: LngLat): number {
  const dLat = toRad(b[1] - a[1])
  const dLng = toRad(b[0] - a[0])
  const s = Math.sin(dLat / 2) ** 2 + Math.cos(toRad(a[1])) * Math.cos(toRad(b[1])) * Math.sin(dLng / 2) ** 2
  return 2 * R * Math.asin(Math.min(1, Math.sqrt(s)))
}

/** Rumo (0–360°, 0 = norte) de a para b. */
export function bearing(a: LngLat, b: LngLat): number {
  const dLng = toRad(b[0] - a[0])
  const la1 = toRad(a[1]), la2 = toRad(b[1])
  const y = Math.sin(dLng) * Math.cos(la2)
  const x = Math.cos(la1) * Math.sin(la2) - Math.sin(la1) * Math.cos(la2) * Math.cos(dLng)
  return (toDeg(Math.atan2(y, x)) + 360) % 360
}

/** Ponto a `meters` de `p` no rumo `brg`. */
export function destination(p: LngLat, meters: number, brg: number): LngLat {
  const d = meters / R
  const b = toRad(brg)
  const la1 = toRad(p[1]), lo1 = toRad(p[0])
  const la2 = Math.asin(Math.sin(la1) * Math.cos(d) + Math.cos(la1) * Math.sin(d) * Math.cos(b))
  const lo2 = lo1 + Math.atan2(Math.sin(b) * Math.sin(d) * Math.cos(la1), Math.cos(d) - Math.sin(la1) * Math.sin(la2))
  return [((toDeg(lo2) + 540) % 360) - 180, toDeg(la2)]
}

/** Menor diferença angular (0–180). */
export function angleDiff(a: number, b: number): number {
  const d = Math.abs(((a - b) % 360 + 360) % 360)
  return d > 180 ? 360 - d : d
}

/** Interpola ângulos pelo caminho mais curto. */
export function lerpAngle(a: number, b: number, t: number): number {
  let d = ((b - a) % 360 + 540) % 360 - 180
  return (a + d * t + 360) % 360
}

// Projeção local equiretangular (metros) — precisa o suficiente para distâncias < ~50 km
function toXY(p: LngLat, lat0: number): [number, number] {
  return [toRad(p[0]) * R * Math.cos(toRad(lat0)), toRad(p[1]) * R]
}

/** Projeta p no segmento a–b. Retorna t (0–1), o ponto projetado e a distância (m). */
export function projectOnSegment(p: LngLat, a: LngLat, b: LngLat): { t: number; point: LngLat; dist: number } {
  const lat0 = p[1]
  const [px, py] = toXY(p, lat0), [ax, ay] = toXY(a, lat0), [bx, by] = toXY(b, lat0)
  const dx = bx - ax, dy = by - ay
  const len2 = dx * dx + dy * dy
  let t = len2 === 0 ? 0 : ((px - ax) * dx + (py - ay) * dy) / len2
  t = Math.max(0, Math.min(1, t))
  const point: LngLat = [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t]
  return { t, point, dist: Math.hypot(px - (ax + dx * t), py - (ay + dy * t)) }
}

/** Distância (m) entre os segmentos a–b e c–d (0 se cruzam). */
export function segmentSegmentDist(a: LngLat, b: LngLat, c: LngLat, d: LngLat): number {
  if (segmentsIntersect(a, b, c, d)) return 0
  return Math.min(
    projectOnSegment(a, c, d).dist, projectOnSegment(b, c, d).dist,
    projectOnSegment(c, a, b).dist, projectOnSegment(d, a, b).dist,
  )
}

function orient(a: LngLat, b: LngLat, c: LngLat): number {
  return (b[0] - a[0]) * (c[1] - a[1]) - (b[1] - a[1]) * (c[0] - a[0])
}
function onSeg(a: LngLat, b: LngLat, c: LngLat): boolean {
  return Math.min(a[0], b[0]) <= c[0] && c[0] <= Math.max(a[0], b[0]) && Math.min(a[1], b[1]) <= c[1] && c[1] <= Math.max(a[1], b[1])
}
export function segmentsIntersect(a: LngLat, b: LngLat, c: LngLat, d: LngLat): boolean {
  const o1 = orient(a, b, c), o2 = orient(a, b, d), o3 = orient(c, d, a), o4 = orient(c, d, b)
  if (((o1 > 0 && o2 < 0) || (o1 < 0 && o2 > 0)) && ((o3 > 0 && o4 < 0) || (o3 < 0 && o4 > 0))) return true
  if (o1 === 0 && onSeg(a, b, c)) return true
  if (o2 === 0 && onSeg(a, b, d)) return true
  if (o3 === 0 && onSeg(c, d, a)) return true
  if (o4 === 0 && onSeg(c, d, b)) return true
  return false
}

/** Ponto dentro do polígono (anel [lng,lat][]; fechado ou não). */
export function pointInRing(p: LngLat, ring: LngLat[]): boolean {
  let inside = false
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const [xi, yi] = ring[i], [xj, yj] = ring[j]
    if ((yi > p[1]) !== (yj > p[1]) && p[0] < ((xj - xi) * (p[1] - yi)) / (yj - yi) + xi) inside = !inside
  }
  return inside
}

/** Círculo aproximado por polígono fechado. */
export function circleRing(center: LngLat, radiusM: number, steps = 32): LngLat[] {
  const ring: LngLat[] = []
  for (let i = 0; i < steps; i++) ring.push(destination(center, radiusM, (i * 360) / steps))
  ring.push(ring[0])
  return ring
}

export type BBox = [number, number, number, number] // minLng, minLat, maxLng, maxLat
export function bboxOf(coords: LngLat[]): BBox {
  let a = Infinity, b = Infinity, c = -Infinity, d = -Infinity
  for (const [x, y] of coords) { if (x < a) a = x; if (y < b) b = y; if (x > c) c = x; if (y > d) d = y }
  return [a, b, c, d]
}
export function bboxOverlap(a: BBox, b: BBox): boolean {
  return !(a[2] < b[0] || b[2] < a[0] || a[3] < b[1] || b[3] < a[1])
}
/** Aumenta a bbox em `m` metros. */
export function bboxPad(b: BBox, m: number): BBox {
  const dLat = m / 111320
  const dLng = m / (111320 * Math.cos(toRad((b[1] + b[3]) / 2)))
  return [b[0] - dLng, b[1] - dLat, b[2] + dLng, b[3] + dLat]
}

/** Comprimento (m) de uma polilinha. */
export function lineLength(coords: LngLat[]): number {
  let s = 0
  for (let i = 1; i < coords.length; i++) s += distM(coords[i - 1], coords[i])
  return s
}

/** Decodifica polyline com precisão 6 (Valhalla) → [lng, lat][]. */
export function decodePolyline6(str: string): LngLat[] {
  const out: LngLat[] = []
  let i = 0, lat = 0, lng = 0
  while (i < str.length) {
    for (let k = 0; k < 2; k++) {
      let res = 0, shift = 0, b: number
      do { b = str.charCodeAt(i++) - 63; res |= (b & 0x1f) << shift; shift += 5 } while (b >= 0x20)
      const d = (res & 1) ? ~(res >> 1) : (res >> 1)
      if (k === 0) lat += d; else lng += d
    }
    out.push([lng / 1e6, lat / 1e6])
  }
  return out
}
