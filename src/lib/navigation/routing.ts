// src/lib/navigation/routing.ts
// Busca de rotas (Mapbox + Valhalla) e cálculo de ROTA SEGURA que evita as zonas de risco.
// Todas as rotas saem no formato do Mapbox Directions (geometry/legs/steps), para o resto
// do app tratar Mapbox e Valhalla da mesma forma.
import { LngLat, LatLng, distM, bearing, destination, decodePolyline6 } from './geo'
import { AvoidZone, zonesOnRoute, pointInZone, entryExitAlong, zoneExposureM } from './zones'

export type NavRoute = any // formato Mapbox Directions (com campos extras opcionais _source, _vias)

const MAPBOX = 'https://api.mapbox.com/directions/v5/mapbox'
const VALHALLA_URL = (process.env.NEXT_PUBLIC_VALHALLA_URL || 'https://valhalla1.openstreetmap.de').replace(/\/$/, '')
const P = (p: LatLng): LngLat => [p.lng, p.lat]

async function getJSON(url: string, signal?: AbortSignal, timeoutMs = 15000): Promise<any> {
  const ctl = new AbortController()
  const t = setTimeout(() => ctl.abort(), timeoutMs)
  const onAbort = () => ctl.abort()
  signal?.addEventListener('abort', onAbort)
  try {
    const res = await fetch(url, { signal: ctl.signal })
    const data = await res.json().catch(() => null)
    if (!res.ok) {
      const err: any = new Error(data?.message || data?.error || `HTTP ${res.status}`)
      err.status = res.status; err.body = data
      throw err
    }
    return data
  } finally {
    clearTimeout(t)
    signal?.removeEventListener('abort', onAbort)
  }
}

// ─── Mapbox ──────────────────────────────────────────────────────────────────

export interface MapboxOpts {
  alternatives?: boolean; vias?: LatLng[]; signal?: AbortSignal
  /** direção em que o rider já está a andar (graus). No recálculo evita a rota começar com retorno. */
  heading?: number | null
}

/** Direção válida para mandar à API (null quando desconhecida). */
const validHeading = (h?: number | null) => (h != null && isFinite(h) ? Math.round(((h % 360) + 360) % 360) : null)

/**
 * Rotas do Mapbox com instruções em português do Brasil.
 * Com pontos de passagem (vias) usa `waypoints=0;N` → uma única perna, sem "chegou" no meio.
 * O perfil driving-traffic aceita no máximo 3 coordenadas; com mais pontos usa `driving`.
 */
export async function fetchMapboxRoutes(origin: LatLng, dest: LatLng, profile: string, opts: MapboxOpts = {}): Promise<NavRoute[]> {
  const token = process.env.NEXT_PUBLIC_MAPBOX_TOKEN
  const vias = opts.vias ?? []
  const pts = [origin, ...vias, dest]
  const prof = profile === 'driving-traffic' && pts.length > 3 ? 'driving' : profile
  const params = new URLSearchParams({
    steps: 'true', geometries: 'geojson', overview: 'full', language: 'pt-BR',
    voice_instructions: 'true', banner_instructions: 'true', voice_units: 'metric',
    // maxspeed (limite de velocidade) só existe nos perfis de carro
    annotations: prof.startsWith('driving') ? 'congestion,duration,distance,maxspeed' : 'congestion,duration,distance',
    exclude: 'ferry',
    access_token: token ?? '',
  })
  if (opts.alternatives && vias.length === 0) params.set('alternatives', 'true')
  if (vias.length) params.set('waypoints', `0;${pts.length - 1}`)
  if (prof === 'cycling') params.set('continue_straight', 'false')
  const hd = validHeading(opts.heading)
  if (hd != null) params.set('bearings', [`${hd},60`, ...pts.slice(1).map(() => '')].join(';'))
  const coords = pts.map(p => `${p.lng.toFixed(6)},${p.lat.toFixed(6)}`).join(';')
  let data: any
  try {
    data = await getJSON(`${MAPBOX}/${prof}/${coords}?${params}`, opts.signal)
  } catch (e: any) {
    // com direção às vezes não encontra rua compatível (ex.: parado num beco) → tenta sem direção
    if (hd == null || e?.name === 'AbortError') throw e
    return fetchMapboxRoutes(origin, dest, profile, { ...opts, heading: null })
  }
  if (hd != null && data?.code && data.code !== 'Ok') return fetchMapboxRoutes(origin, dest, profile, { ...opts, heading: null })
  if (data?.code && data.code !== 'Ok') {
    const err: any = new Error(data.message || data.code); err.code = data.code; throw err
  }
  return (data?.routes ?? []).map((r: any) => ({ ...r, _source: 'mapbox', _vias: vias }))
}

// ─── Valhalla (exclui polígonos no próprio servidor) ─────────────────────────

const VAL_COSTING: Record<string, string> = { 'driving-traffic': 'auto', driving: 'auto', cycling: 'bicycle', walking: 'pedestrian' }

// tipo Valhalla → [type, modifier] do Mapbox
const VAL_TYPE: Record<number, [string, string | undefined]> = {
  1: ['depart', undefined], 2: ['depart', 'right'], 3: ['depart', 'left'],
  4: ['arrive', undefined], 5: ['arrive', 'right'], 6: ['arrive', 'left'],
  7: ['new name', 'straight'], 8: ['continue', 'straight'],
  9: ['turn', 'slight right'], 10: ['turn', 'right'], 11: ['turn', 'sharp right'],
  12: ['turn', 'uturn'], 13: ['turn', 'uturn'],
  14: ['turn', 'sharp left'], 15: ['turn', 'left'], 16: ['turn', 'slight left'],
  17: ['on ramp', 'straight'], 18: ['on ramp', 'right'], 19: ['on ramp', 'left'],
  20: ['off ramp', 'right'], 21: ['off ramp', 'left'],
  22: ['fork', 'straight'], 23: ['fork', 'right'], 24: ['fork', 'left'],
  25: ['merge', 'straight'], 26: ['roundabout', undefined], 27: ['exit roundabout', undefined],
  28: ['notification', 'straight'], 29: ['notification', 'straight'],
  37: ['merge', 'slight right'], 38: ['merge', 'slight left'],
}

/** Converte a resposta do Valhalla para o formato de rota do Mapbox. */
export function valhallaTripToRoute(trip: any): NavRoute {
  const coords: LngLat[] = []
  const steps: any[] = []
  for (const leg of trip.legs ?? []) {
    const shape = decodePolyline6(leg.shape)
    for (const p of shape) {
      const last = coords[coords.length - 1]
      if (!last || last[0] !== p[0] || last[1] !== p[1]) coords.push(p)
    }
    for (const m of leg.maneuvers ?? []) {
      const [type, modifier] = VAL_TYPE[m.type] ?? ['continue', 'straight']
      const i0 = Math.min(shape.length - 1, m.begin_shape_index ?? 0)
      const i1 = Math.min(shape.length - 1, i0 + 1)
      const loc = shape[i0]
      const stepCoords = shape.slice(i0, Math.max(i0 + 1, (m.end_shape_index ?? i0) + 1))
      steps.push({
        distance: (m.length ?? 0) * 1000,
        duration: m.time ?? 0,
        name: m.street_names?.[0] ?? '',
        geometry: { type: 'LineString', coordinates: stepCoords.length > 1 ? stepCoords : [loc, loc] },
        maneuver: {
          type, modifier,
          location: loc,
          instruction: String(m.instruction ?? '').replace(/\.$/, ''),
          bearing_after: i1 !== i0 ? Math.round(bearing(shape[i0], shape[i1])) : 0,
          exit: m.roundabout_exit_count,
        },
      })
    }
  }
  if (coords.length === 1) coords.push(coords[0])
  const distance = (trip.summary?.length ?? 0) * 1000
  const duration = trip.summary?.time ?? 0
  return {
    geometry: { type: 'LineString', coordinates: coords },
    distance, duration,
    legs: [{ steps, distance, duration, annotation: { congestion: [] } }],
    _source: 'valhalla',
  }
}

/** Contorno levemente simplificado para mandar ao Valhalla (limite de tamanho da URL/servidor). */
function exclusionRing(z: AvoidZone): LngLat[] {
  const ring = z.ring
  const maxPts = 24
  if (ring.length <= maxPts) return ring.map(p => [+p[0].toFixed(6), +p[1].toFixed(6)] as LngLat)
  const step = Math.ceil(ring.length / maxPts)
  const out = ring.filter((_, i) => i % step === 0).map(p => [+p[0].toFixed(6), +p[1].toFixed(6)] as LngLat)
  out.push(out[0])
  return out
}

// O servidor público da FOSSGIS permite no máximo 1 consulta por segundo (regra de uso).
// Com servidor próprio (NEXT_PUBLIC_VALHALLA_URL) o limite não se aplica.
const IS_PUBLIC_VALHALLA = /openstreetmap\.de/.test(VALHALLA_URL)
const VALHALLA_MIN_GAP_MS = 1100
let nextValhallaSlot = 0
async function waitValhallaSlot(signal?: AbortSignal) {
  if (!IS_PUBLIC_VALHALLA) return
  const now = Date.now()
  const at = Math.max(now, nextValhallaSlot)
  nextValhallaSlot = at + VALHALLA_MIN_GAP_MS
  const wait = at - now
  if (wait > 0) await new Promise<void>((res, rej) => {
    const t = setTimeout(res, wait)
    signal?.addEventListener('abort', () => { clearTimeout(t); const e = new Error('aborted'); e.name = 'AbortError'; rej(e) })
  })
}

export async function fetchValhallaRoutes(origin: LatLng, dest: LatLng, profile: string, exclude: AvoidZone[], signal?: AbortSignal, heading?: number | null): Promise<NavRoute[]> {
  await waitValhallaSlot(signal)
  const hd = validHeading(heading)
  const body: any = {
    locations: [
      hd != null ? { lat: origin.lat, lon: origin.lng, heading: hd, heading_tolerance: 60 } : { lat: origin.lat, lon: origin.lng },
      { lat: dest.lat, lon: dest.lng },
    ],
    costing: VAL_COSTING[profile] ?? 'auto',
    directions_options: { units: 'kilometers', language: 'pt-BR' },
    alternates: 2,
  }
  if (exclude.length) body.exclude_polygons = exclude.map(exclusionRing)
  const data = await getJSON(`${VALHALLA_URL}/route?json=${encodeURIComponent(JSON.stringify(body))}`, signal, 15000)
  if (!data?.trip) return []
  return [data.trip, ...(data.alternates ?? []).map((a: any) => a.trip)].filter(Boolean).map(valhallaTripToRoute)
}

// ─── Passos: junta todas as pernas numa lista só ─────────────────────────────

/**
 * Junta os passos de TODAS as pernas. (O código antigo usava só legs[0], então numa rota
 * com desvio as instruções acabavam no primeiro ponto de passagem.)
 */
export function flattenSteps(route: NavRoute): any[] {
  const legs: any[] = route?.legs ?? []
  const out: any[] = []
  legs.forEach((leg, li) => {
    for (const st of leg.steps ?? []) {
      const t = st.maneuver?.type
      if (t === 'arrive' && li < legs.length - 1) continue
      if (t === 'depart' && li > 0) {
        out.push({ ...st, maneuver: { ...st.maneuver, type: 'continue', modifier: 'straight', instruction: st.name ? `Continue em ${st.name}` : 'Continue em frente' } })
        continue
      }
      out.push(st)
    }
  })
  return out
}

/** Congestionamento de todas as pernas, alinhado com os segmentos da geometria. */
/** Limite de velocidade (km/h) por segmento da geometria; null quando desconhecido. */
export function flattenMaxspeed(route: NavRoute): (number | null)[] {
  return (route?.legs ?? []).flatMap((l: any) => (l.annotation?.maxspeed ?? []).map((m: any) => {
    if (!m || m.unknown || m.none || typeof m.speed !== 'number') return null
    return m.unit === 'mph' ? Math.round(m.speed * 1.609) : m.speed
  }))
}

export function flattenCongestion(route: NavRoute): string[] {
  return (route?.legs ?? []).flatMap((l: any) => l.annotation?.congestion ?? [])
}

// ─── Rota segura ─────────────────────────────────────────────────────────────

export interface SafeRouteResult {
  route: NavRoute | null       // melhor rota que não passa por nenhuma zona evitável
  candidates: NavRoute[]       // todas as rotas obtidas (para mostrar alternativas)
  unavoidable: AvoidZone[]     // zonas onde está a origem ou o destino (impossível evitar)
  method: 'direct' | 'valhalla' | 'detour' | 'none' | 'mesma-exposicao'
  /** Rota mais rápida que cruza zona, para mostrar como alternativa (cinzento) quando poupa tempo. */
  fastAlt?: NavRoute | null
}

/**
 * A rota "segura" também atravessa zona (de passagem, ou porque o rider já está dentro dela)?
 * Então uma rota mais rápida que atravessa mais ou menos o mesmo não é mais perigosa — e é o que o
 * Google manda. Caso real (Maurício, nov 2026): dentro da zona, o ZIVO mandava virar à esquerda e
 * dar a volta; pela direita cruzava a mesma zona uns metros e saía logo, bem mais curto.
 * Só troca quando a segura já tem exposição (≥ 40 m): zonas pequenas que dá para evitar de todo
 * continuam a ser evitadas.
 */
export const EXPO_MIN_M = 40
export function escolherPorExposicao(safe: NavRoute | null, candidates: NavRoute[], allZones: AvoidZone[]):
  { route: NavRoute | null; fastAlt: NavRoute | null; trocou: boolean } {
  if (!candidates.length) return { route: safe, fastAlt: null, trocou: false }
  for (const r of candidates) if (r._exposureM == null) r._exposureM = zoneExposureM(r.geometry.coordinates, allZones)
  const fastest = candidates.slice().sort((a, b) => duration(a) - duration(b))[0]
  if (!safe) return { route: null, fastAlt: null, trocou: false }
  if (safe._exposureM == null) safe._exposureM = zoneExposureM(safe.geometry.coordinates, allZones)
  if (fastest === safe) return { route: safe, fastAlt: null, trocou: false }
  const ganho = duration(safe) - duration(fastest)
  const expS = safe._exposureM as number, expF = fastest._exposureM as number
  if (expS >= EXPO_MIN_M && expF <= expS * 1.5 + 80 && ganho >= Math.max(30, 0.1 * duration(fastest))) {
    return { route: fastest, fastAlt: null, trocou: true }
  }
  return { route: safe, fastAlt: ganho >= 60 ? fastest : null, trocou: false }
}

export interface SafeRouteOpts {
  baseRoutes?: NavRoute[]      // rotas já obtidas (evita refazer a consulta)
  signal?: AbortSignal
  maxDetourRequests?: number
  heading?: number | null      // direção atual do rider (recálculo em movimento)
}

const duration = (r: NavRoute) => r?.duration ?? Infinity

/**
 * Encontra a rota mais rápida que não toca nenhuma zona.
 * 1) rotas normais (e alternativas) — se alguma já for segura, usa ela
 * 2) Valhalla com `exclude_polygons` das zonas encontradas no caminho (1 a 4 consultas)
 * 3) reserva: Mapbox contornando cada zona pela borda com pontos de passagem
 * Toda rota é conferida segmento a segmento antes de ser considerada segura.
 */
export async function findSafeRoute(origin: LatLng, dest: LatLng, profile: string, allZones: AvoidZone[], opts: SafeRouteOpts = {}): Promise<SafeRouteResult> {
  const o = P(origin), d = P(dest)
  const unavoidable = allZones.filter(z => pointInZone(o, z) || pointInZone(d, z))
  const zones = allZones.filter(z => !unavoidable.includes(z))
  const candidates: NavRoute[] = []
  const add = (rs: NavRoute[]) => { for (const r of rs) { r._hits = zonesOnRoute(r.geometry.coordinates, zones); candidates.push(r) } }
  const best = () => candidates.filter(r => r._hits.length === 0).sort((a, b) => duration(a) - duration(b))[0] ?? null

  let base = opts.baseRoutes
  if (!base || !base.length) {
    try { base = await fetchMapboxRoutes(origin, dest, profile, { alternatives: true, signal: opts.signal, heading: opts.heading }) }
    catch (e: any) { if (e?.name === 'AbortError') throw e; base = [] }
  }
  add(base)
  // a decisão final compara também os metros dentro de zona (ver escolherPorExposicao)
  const finalizar = (r: NavRoute | null, method: SafeRouteResult['method']): SafeRouteResult => {
    const e = escolherPorExposicao(r, candidates, allZones)
    return { route: e.route, candidates, unavoidable, method: e.trocou ? 'mesma-exposicao' : method, fastAlt: e.fastAlt }
  }
  if (!zones.length) return finalizar(best(), 'direct')
  if (best()) return finalizar(best(), 'direct')

  // 2) Valhalla
  let excl = Array.from(new Set(candidates.flatMap(r => r._hits as AvoidZone[])))
  if (!excl.length) excl = zones.slice(0, 12)
  try {
    for (let it = 0; it < 4 && !best(); it++) {
      const rs = await fetchValhallaRoutes(origin, dest, profile, excl, opts.signal, opts.heading)
      if (!rs.length) break
      add(rs)
      if (best()) return finalizar(best(), 'valhalla')
      const novas = Array.from(new Set(rs.flatMap(r => r._hits as AvoidZone[]))).filter(z => !excl.includes(z))
      if (!novas.length) break
      excl = excl.concat(novas)
    }
  } catch (e: any) {
    if (e?.name === 'AbortError') throw e
    // servidor indisponível ou sem caminho → tenta o contorno
  }

  // 3) Contorno pela borda (Mapbox com pontos de passagem)
  try {
    await ringDetour(origin, dest, profile, zones, candidates, add, opts)
  } catch (e: any) {
    if (e?.name === 'AbortError') throw e
  }
  const r = best()
  return finalizar(r, r ? 'detour' : 'none')
}

interface Via extends LatLng { zoneId: string }

function ringPoints(z: AvoidZone, coords: LngLat[], side: 1 | -1, lvl: number): { pts: Via[]; at: number } {
  const ee = entryExitAlong(coords, z)
  const ent = ee ? ee.entryPt : coords[0]
  const ext = ee ? ee.exitPt : coords[coords.length - 1]
  const aIn = bearing(z.center, ent), aOut = bearing(z.center, ext)
  const cw = ((aOut - aIn) % 360 + 360) % 360
  let sweep = side > 0 ? cw : 360 - cw
  sweep = Math.min(340, Math.max(20, sweep))
  const R = z.radiusM * (1.2 + 0.35 * lvl) + 150 + 200 * lvl
  const n = Math.min(7, Math.max(1, Math.ceil(sweep / 60)))
  const pts: Via[] = []
  for (let k = 0; k <= n; k++) {
    const p = destination(z.center, R, aIn + side * sweep * k / n)
    pts.push({ lng: p[0], lat: p[1], zoneId: z.id })
  }
  return { pts, at: ee ? ee.entry : 0 }
}

function alongOf(coords: LngLat[], p: LngLat): number {
  // distância ao longo da rota do ponto mais próximo de p (aproximação por vértices)
  let acc = 0, best = Infinity, bestAt = 0
  for (let i = 0; i < coords.length; i++) {
    if (i) acc += distM(coords[i - 1], coords[i])
    const dd = distM(coords[i], p)
    if (dd < best) { best = dd; bestAt = acc }
  }
  return bestAt
}

async function ringDetour(
  origin: LatLng, dest: LatLng, profile: string, zones: AvoidZone[],
  candidates: NavRoute[], add: (rs: NavRoute[]) => void, opts: SafeRouteOpts,
) {
  const budget = opts.maxDetourRequests ?? 10
  let used = 0
  const tried = new Set<string>()
  type C = { route: NavRoute; vias: Via[]; levels: Record<string, number> }
  const withHits = candidates.filter(r => r._hits.length).sort((a, b) => a._hits.length - b._hits.length || duration(a) - duration(b))
  let frontier: C[] = withHits.slice(0, 2).map(r => ({ route: r, vias: [], levels: {} }))
  let safeFound = false, extra = 0

  const firstHit = (c: C): AvoidZone | null => {
    let bestZ: AvoidZone | null = null, bestAt = Infinity
    for (const z of c.route._hits as AvoidZone[]) {
      const ee = entryExitAlong(c.route.geometry.coordinates, z)
      const at = ee ? ee.entry : Infinity
      if (at < bestAt) { bestAt = at; bestZ = z }
    }
    return bestZ
  }

  while (frontier.length && used < budget && extra < 2) {
    if (safeFound) extra++
    const next: C[] = []
    for (const c of frontier) {
      const z = firstHit(c); if (!z) continue
      const lvl = c.levels[z.id] ?? 0; if (lvl > 2) continue
      for (const side of [1, -1] as const) {
        if (used >= budget) break
        const coords: LngLat[] = c.route.geometry.coordinates
        const blk = ringPoints(z, coords, side, lvl)
        const pts = blk.pts.filter(p => !zones.some(zz => pointInZone([p.lng, p.lat], zz)))
        if (!pts.length) continue
        const keep = c.vias.filter(v => v.zoneId !== z.id).map(v => ({ v, at: alongOf(coords, [v.lng, v.lat]) }))
        const vias = [...keep.filter(x => x.at <= blk.at).map(x => x.v), ...pts, ...keep.filter(x => x.at > blk.at).map(x => x.v)]
        if (vias.length > 20) continue
        const key = vias.map(v => `${v.lat.toFixed(4)},${v.lng.toFixed(4)}`).join('|')
        if (tried.has(key)) continue
        tried.add(key)
        used++
        let r: NavRoute | undefined
        try { r = (await fetchMapboxRoutes(origin, dest, profile, { vias, signal: opts.signal, heading: opts.heading }))[0] }
        catch (e: any) { if (e?.name === 'AbortError') throw e }
        if (!r) { next.push({ ...c, levels: { ...c.levels, [z.id]: lvl + 1 } }); continue }
        add([r])
        const stillHitsZ = (r._hits as AvoidZone[]).includes(z)
        const nc: C = { route: r, vias, levels: { ...c.levels, [z.id]: lvl + (stillHitsZ ? 1 : 0) } }
        if (!r._hits.length) safeFound = true; else next.push(nc)
      }
    }
    frontier = next.sort((a, b) => a.route._hits.length - b.route._hits.length || duration(a.route) - duration(b.route)).slice(0, 3)
  }

  // Enxuga: tira pontos de passagem desnecessários (evita voltas no quarteirão)
  let cur = candidates.filter(r => r._hits.length === 0 && (r._vias?.length ?? 0) > 1).sort((a, b) => duration(a) - duration(b))[0]
  let pruneBudget = 4
  while (cur && pruneBudget > 0) {
    let improved = false
    const vias: Via[] = cur._vias
    for (let i = 0; i < vias.length && pruneBudget > 0; i++) {
      const test = vias.filter((_, k) => k !== i)
      pruneBudget--
      let r: NavRoute | undefined
      try { r = (await fetchMapboxRoutes(origin, dest, profile, { vias: test, signal: opts.signal, heading: opts.heading }))[0] }
      catch (e: any) { if (e?.name === 'AbortError') throw e }
      if (!r) continue
      add([r])
      if (!r._hits.length && duration(r) < duration(cur) - 5) { cur = r; improved = true; break }
    }
    if (!improved || (cur._vias?.length ?? 0) <= 1) break
  }
}

/** Remove rotas quase iguais (mesma distância e tempo). */
export function dedupeRoutes(routes: NavRoute[]): NavRoute[] {
  const out: NavRoute[] = []
  for (const r of routes) {
    if (!out.some(o => Math.abs(o.distance - r.distance) < 30 && Math.abs(o.duration - r.duration) < 20)) out.push(r)
  }
  return out
}

/** Exposto só para testes. */
export const _internal = { ringPoints, alongOf }
