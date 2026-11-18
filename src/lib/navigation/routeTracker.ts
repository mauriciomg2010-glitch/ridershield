// src/lib/navigation/routeTracker.ts
// Acompanha o progresso do entregador ao longo da rota, como o Google Maps:
// encaixa o GPS na rota, calcula distância até a próxima manobra, tempo restante,
// direção da rua, chegada e saída da rota (com tolerância a GPS ruim).
import { LngLat, distM, bearing, projectOnSegment, angleDiff } from './geo'
import { flattenSteps, NavRoute } from './routing'

export interface Fix {
  lat: number
  lng: number
  accuracy?: number | null   // metros
  heading?: number | null    // graus (GPS)
  speed?: number | null      // m/s (GPS)
  time?: number              // ms
}

export interface Progress {
  snapped: LngLat            // posição encaixada na rota
  along: number              // metros percorridos na rota
  offRouteM: number          // distância do GPS até a rota
  routeBearing: number       // direção da rua neste ponto
  remainingM: number
  remainingS: number
  stepIdx: number            // índice (em steps) da PRÓXIMA manobra
  distToManeuver: number
  offRoute: boolean          // decisão já filtrada: recalcular
  wrongWay: boolean          // está na rota, mas na contramão do trajeto
  arrived: boolean
}

export class RouteTracker {
  readonly route: NavRoute
  readonly coords: LngLat[]
  readonly steps: any[]
  readonly cum: number[]          // distância acumulada em cada vértice
  readonly cumDur: number[]       // duração acumulada em cada vértice
  readonly maneuverAt: number[]   // distância ao longo da rota de cada manobra
  readonly length: number
  private seg = 0                 // último segmento encaixado
  private offCount = 0
  private divCount = 0          // a afastar-se depressa da rota, noutra direção
  private prevDist: number | null = null
  private wrongCount = 0
  private lastAlong = 0

  constructor(route: NavRoute) {
    this.route = route
    const raw: LngLat[] = route?.geometry?.coordinates ?? []
    // remove vértices repetidos
    this.coords = raw.filter((c, i) => i === 0 || c[0] !== raw[i - 1][0] || c[1] !== raw[i - 1][1])
    if (this.coords.length === 1) this.coords.push(this.coords[0])
    this.steps = flattenSteps(route)

    this.cum = [0]
    for (let i = 1; i < this.coords.length; i++) this.cum.push(this.cum[i - 1] + distM(this.coords[i - 1], this.coords[i]))
    this.length = this.cum[this.cum.length - 1] || 0

    // Tempo por segmento: usa as anotações do Mapbox quando batem com a geometria;
    // senão distribui o tempo total proporcionalmente à distância.
    const segDur: number[] = (route?.legs ?? []).flatMap((l: any) => l.annotation?.duration ?? [])
    const total = route?.duration ?? 0
    this.cumDur = [0]
    const useAnn = segDur.length === this.coords.length - 1
    for (let i = 1; i < this.coords.length; i++) {
      const d = useAnn ? segDur[i - 1] : (this.length ? total * (this.cum[i] - this.cum[i - 1]) / this.length : 0)
      this.cumDur.push(this.cumDur[i - 1] + (isFinite(d) ? d : 0))
    }

    // Posição de cada manobra ao longo da rota (busca sempre para a frente)
    this.maneuverAt = []
    let from = 0
    for (let k = 0; k < this.steps.length; k++) {
      const loc = this.steps[k]?.maneuver?.location as LngLat | undefined
      if (k === 0 || !loc) { this.maneuverAt.push(k === 0 ? 0 : this.maneuverAt[k - 1]); continue }
      let best = Infinity, bestAt = this.maneuverAt[k - 1], bestSeg = from
      for (let i = from; i < this.coords.length - 1; i++) {
        const pr = projectOnSegment(loc, this.coords[i], this.coords[i + 1])
        if (pr.dist < best) {
          best = pr.dist; bestSeg = i
          bestAt = this.cum[i] + (this.cum[i + 1] - this.cum[i]) * pr.t
          if (pr.dist < 0.5) break
        }
      }
      if (k === this.steps.length - 1 && this.steps[k]?.maneuver?.type === 'arrive') bestAt = this.length
      this.maneuverAt.push(bestAt)
      from = bestSeg
    }
  }

  /** Ponto a `m` metros do início da rota. */
  pointAt(m: number): LngLat {
    const c = this.coords
    if (m <= 0) return c[0]
    if (m >= this.length) return c[c.length - 1]
    let lo = 0, hi = this.cum.length - 1
    while (hi - lo > 1) { const mid = (lo + hi) >> 1; if (this.cum[mid] <= m) lo = mid; else hi = mid }
    const t = (m - this.cum[lo]) / Math.max(1e-9, this.cum[hi] - this.cum[lo])
    return [c[lo][0] + (c[hi][0] - c[lo][0]) * t, c[lo][1] + (c[hi][1] - c[lo][1]) * t]
  }

  /** Direção da rua a partir de `m` (olha ~25 m à frente para não tremer nas curvas). */
  bearingAt(m: number): number {
    const a = this.pointAt(Math.max(0, Math.min(m, this.length - 1)))
    const b = this.pointAt(Math.min(this.length, m + 25))
    return distM(a, b) < 0.5 ? bearing(this.pointAt(Math.max(0, m - 25)), a) : bearing(a, b)
  }

  /** Coordenadas da rota que faltam percorrer (para desenhar só o trecho restante). */
  remainingCoords(along: number): LngLat[] {
    const p = this.pointAt(along)
    let i = 0
    while (i < this.cum.length && this.cum[i] <= along) i++
    return [p, ...this.coords.slice(i)]
  }

  private match(p: LngLat, heading: number | null, moving: boolean, global: boolean) {
    const n = this.coords.length - 1
    const lo = global ? 0 : Math.max(0, this.seg - 8)
    const hi = global ? n : Math.min(n, this.seg + 120)
    let best = { score: Infinity, dist: Infinity, seg: this.seg, t: 0, point: this.coords[0] as LngLat }
    for (let i = lo; i < hi; i++) {
      const pr = projectOnSegment(p, this.coords[i], this.coords[i + 1])
      let score = pr.dist
      // Rota que passa duas vezes pelo mesmo lugar: prefere o trecho no sentido em que está indo
      if (moving && heading != null) {
        const segBrg = bearing(this.coords[i], this.coords[i + 1])
        if (angleDiff(segBrg, heading) > 100) score += 25
      }
      // Evita "pular para trás" por ruído
      const at = this.cum[i] + (this.cum[i + 1] - this.cum[i]) * pr.t
      if (at < this.lastAlong - 40) score += 20
      if (score < best.score) best = { score, dist: pr.dist, seg: i, t: pr.t, point: pr.point }
    }
    return best
  }

  update(fix: Fix): Progress {
    const p: LngLat = [fix.lng, fix.lat]
    const speed = fix.speed != null && isFinite(fix.speed) ? fix.speed : null
    const moving = (speed ?? 0) > 2
    const heading = fix.heading != null && isFinite(fix.heading) ? fix.heading : null

    let m = this.match(p, heading, moving, false)
    if (m.dist > 60) {
      const g = this.match(p, heading, moving, true)
      if (g.score < m.score) m = g
    }
    this.seg = m.seg
    const along = Math.min(this.length, this.cum[m.seg] + (this.cum[m.seg + 1] - this.cum[m.seg]) * m.t)
    this.lastAlong = Math.max(this.lastAlong - 40, along)

    const routeBearing = this.bearingAt(along)
    const remainingM = Math.max(0, this.length - along)
    const durAt = this.cumDur[m.seg] + (this.cumDur[m.seg + 1] - this.cumDur[m.seg]) * m.t
    const totalDur = this.cumDur[this.cumDur.length - 1]
    const remainingS = Math.max(0, totalDur - durAt)

    // Próxima manobra
    let stepIdx = this.maneuverAt.findIndex((at, k) => k > 0 && at > along + 5)
    if (stepIdx < 0) stepIdx = Math.max(0, this.steps.length - 1)
    const distToManeuver = Math.max(0, (this.maneuverAt[stepIdx] ?? this.length) - along)

    // Saída da rota — tolerância proporcional à precisão do GPS
    const acc = fix.accuracy != null && isFinite(fix.accuracy) ? fix.accuracy : 15
    const limit = Math.max(35, Math.min(80, acc * 1.5))
    if (m.dist > limit) this.offCount++
    else this.offCount = 0
    // Saída clara (ex.: outra saída da rotunda): a andar, GPS bom, já a 20+ m da rota, a afastar-se
    // e noutra direção → recalcula sem esperar pelos 35 m × 3 leituras (o Google reage em ~3 s)
    const diverging = moving && heading != null && acc <= 20 && m.dist >= 20 &&
      this.prevDist != null && m.dist > this.prevDist + 3 && angleDiff(heading, routeBearing) > 50
    if (diverging) this.divCount++
    else if (m.dist < 15) this.divCount = 0
    this.prevDist = m.dist
    const offRoute = this.offCount >= 3 || (m.dist > limit * 2 && this.offCount >= 2) || this.divCount >= 2

    // Contramão: está em cima da rota mas andando no sentido oposto
    if (moving && heading != null && m.dist < limit && angleDiff(heading, routeBearing) > 150) this.wrongCount++
    else this.wrongCount = 0
    const wrongWay = this.wrongCount >= 5

    const dest = this.coords[this.coords.length - 1]
    const arrived = remainingM < 25 || (distM(p, dest) < 25 && along > this.length * 0.5)

    return { snapped: m.point, along, offRouteM: m.dist, routeBearing, remainingM, remainingS, stepIdx, distToManeuver, offRoute: offRoute || wrongWay, wrongWay, arrived }
  }

  /** Segmento da geometria onde o entregador está agora. */
  get currentSeg(): number { return this.seg }

  /** Zera contadores depois de um recálculo. */
  resetOffRoute() { this.offCount = 0; this.wrongCount = 0; this.divCount = 0; this.prevDist = null }
}
