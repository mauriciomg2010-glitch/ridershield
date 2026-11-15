// Testes do núcleo de navegação (rodar com: npm run test:nav)
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { distM, destination, decodePolyline6, LngLat, bearing } from '../src/lib/navigation/geo'
import { fromFirestoreZone, zonesOnRoute, pointInZone, AvoidZone } from '../src/lib/navigation/zones'
import { flattenSteps, findSafeRoute, valhallaTripToRoute } from '../src/lib/navigation/routing'
import { RouteTracker } from '../src/lib/navigation/routeTracker'
import { VoiceGuide, formatDistance, spokenDistance, instructionText, buildInstruction, bannerText } from '../src/lib/navigation/instructions'

const DUB: LngLat = [-6.2603, 53.3498]

function enc6(coords: LngLat[]): string {
  let out = '', pl = 0, pg = 0
  for (const [lng, lat] of coords) {
    for (const [v, p] of [[Math.round(lat * 1e6), pl], [Math.round(lng * 1e6), pg]] as const) {
      let d = v - p; d = d < 0 ? ~(d << 1) : d << 1
      while (d >= 0x20) { out += String.fromCharCode((0x20 | (d & 0x1f)) + 63); d >>= 5 }
      out += String.fromCharCode(d + 63)
    }
    pl = Math.round(lat * 1e6); pg = Math.round(lng * 1e6)
  }
  return out
}

/** Linha reta amostrada a cada `step` metros. */
function line(a: LngLat, b: LngLat, step = 20): LngLat[] {
  const n = Math.max(1, Math.round(distM(a, b) / step))
  return Array.from({ length: n + 1 }, (_, i) => [a[0] + (b[0] - a[0]) * i / n, a[1] + (b[1] - a[1]) * i / n] as LngLat)
}

// Rota em "L": 600 m para leste, vira à esquerda, 400 m para norte
const A = DUB, B = destination(DUB, 600, 90), C = destination(B, 400, 0)
function lRoute() {
  const coords = [...line(A, B), ...line(B, C).slice(1)]
  return {
    geometry: { type: 'LineString', coordinates: coords }, distance: 1000, duration: 100,
    legs: [{ steps: [
      { distance: 600, duration: 60, name: 'Rua Leste', maneuver: { type: 'depart', location: A, instruction: 'Siga para leste na Rua Leste' } },
      { distance: 400, duration: 40, name: 'Rua Norte', maneuver: { type: 'turn', modifier: 'left', location: B, instruction: 'Vire à esquerda na Rua Norte' } },
      { distance: 0, duration: 0, name: '', maneuver: { type: 'arrive', location: C, instruction: 'Você chegou ao destino' } },
    ] }],
  }
}

test('geo: distância, destino e polyline6', () => {
  const p = destination(DUB, 1000, 45)
  assert.ok(Math.abs(distM(DUB, p) - 1000) < 1)
  assert.ok(Math.abs(bearing(DUB, p) - 45) < 0.5)
  const pts: LngLat[] = [[-6.26, 53.34], [-6.25123, 53.35001], [-6.24, 53.3612]]
  const dec = decodePolyline6(enc6(pts))
  dec.forEach((q, i) => { assert.ok(Math.abs(q[0] - pts[i][0]) < 1e-6 && Math.abs(q[1] - pts[i][1]) < 1e-6) })
})

test('zonas: polígono, círculo, trecho de rua e zona expirada', () => {
  const poly = fromFirestoreZone({ id: 'p', areaName: 'P', riskLevel: 'high', polygon: [{ lng: -6.27, lat: 53.34 }, { lng: -6.25, lat: 53.34 }, { lng: -6.25, lat: 53.35 }] })!
  assert.equal(poly.kind, 'area'); assert.equal(poly.ring.length, 4)
  const circ = fromFirestoreZone({ id: 'c', lat: 53.3498, lng: -6.2603, radius: 200 })!
  assert.ok(pointInZone(DUB, circ)); assert.ok(!pointInZone(destination(DUB, 260, 0), circ))
  // polígono sem lat/lng NÃO pode virar um círculo em (0,0) — bug do código antigo
  assert.ok(Math.abs(poly.center[1] - 53.343) < 0.01)
  const street = fromFirestoreZone({ id: 's', lat: 0, lng: 0, radius: 50, geometry: { type: 'LineString', coordinates: [{ lng: -6.26, lat: 53.35 }, { lng: -6.25, lat: 53.35 }] } })!
  assert.equal(street.kind, 'street')
  assert.ok(pointInZone([-6.255, 53.3502], street))   // ~22 m da rua
  assert.ok(!pointInZone([-6.255, 53.352], street))   // ~220 m
  assert.equal(fromFirestoreZone({ id: 'e', lat: 53.3, lng: -6.2, radius: 100, autoExpireAt: { seconds: 1 } }), null)
  assert.equal(fromFirestoreZone({ id: 'z', lat: 0, lng: 0, radius: 100 }), null)
})

test('zonas: detecta zona pequena entre dois vértices distantes (amostragem antiga deixava passar)', () => {
  const a = DUB, b = destination(DUB, 3000, 90)
  const mid = destination(DUB, 1500, 90)
  const z = fromFirestoreZone({ id: 'small', lat: mid[1], lng: mid[0], radius: 60 })!
  assert.equal(zonesOnRoute([a, b], [z]).length, 1)
  const far = fromFirestoreZone({ id: 'far', ...(() => { const q = destination(mid, 150, 0); return { lat: q[1], lng: q[0] } })(), radius: 60 })!
  assert.equal(zonesOnRoute([a, b], [far]).length, 0)
})

test('rota com várias pernas: instruções não acabam no ponto de passagem', () => {
  const r = { legs: [
    { steps: [{ maneuver: { type: 'depart' } }, { maneuver: { type: 'turn', modifier: 'left' } }, { maneuver: { type: 'arrive' } }] },
    { steps: [{ name: 'X', maneuver: { type: 'depart' } }, { maneuver: { type: 'turn', modifier: 'right' } }, { maneuver: { type: 'arrive' } }] },
  ] }
  const s = flattenSteps(r)
  assert.deepEqual(s.map((x: any) => x.maneuver.type), ['depart', 'turn', 'continue', 'turn', 'arrive'])
})

test('rastreador: progresso, próxima manobra, chegada', () => {
  const tr = new RouteTracker(lRoute())
  assert.ok(Math.abs(tr.length - 1000) < 5)
  let p = tr.update({ lng: A[0], lat: A[1], speed: 8, heading: 90 })
  assert.equal(p.stepIdx, 1); assert.ok(Math.abs(p.distToManeuver - 600) < 5)
  const q = destination(A, 300, 90)
  p = tr.update({ lng: q[0], lat: q[1] + 0.0001, speed: 8, heading: 90 }) // ~11 m ao lado da rua
  assert.ok(Math.abs(p.distToManeuver - 300) < 5); assert.ok(p.offRouteM < 15); assert.ok(!p.offRoute)
  assert.ok(Math.abs(p.routeBearing - 90) < 2)
  assert.ok(Math.abs(p.remainingS - 70) < 2)
  const r = destination(B, 100, 0)
  p = tr.update({ lng: r[0], lat: r[1], speed: 8, heading: 0 })
  assert.equal(p.stepIdx, 2); assert.ok(Math.abs(p.distToManeuver - 300) < 5); assert.ok(Math.abs(p.routeBearing) < 2 || Math.abs(p.routeBearing - 360) < 2)
  const end = destination(C, 10, 180)
  p = tr.update({ lng: end[0], lat: end[1], speed: 3, heading: 0 })
  assert.ok(p.arrived)
})

test('rastreador: um ponto de GPS ruim não recalcula; três seguidos sim', () => {
  const tr = new RouteTracker(lRoute())
  tr.update({ lng: A[0], lat: A[1], speed: 8, heading: 90 })
  const off = destination(destination(A, 200, 90), 120, 180)
  let p = tr.update({ lng: off[0], lat: off[1], accuracy: 10, speed: 8, heading: 90 })
  assert.ok(!p.offRoute)
  const back = destination(A, 220, 90)
  p = tr.update({ lng: back[0], lat: back[1], accuracy: 10, speed: 8, heading: 90 })
  assert.ok(!p.offRoute)
  for (let i = 0; i < 3; i++) { const o = destination(destination(A, 240 + i * 10, 90), 120, 180); p = tr.update({ lng: o[0], lat: o[1], accuracy: 10, speed: 8, heading: 90 }) }
  assert.ok(p.offRoute)
})

test('rastreador: contramão é detectada', () => {
  const tr = new RouteTracker(lRoute())
  let p: any
  for (let i = 0; i < 6; i++) { const q = destination(A, 300 - i * 15, 90); p = tr.update({ lng: q[0], lat: q[1], speed: 8, heading: 270 }) }
  assert.ok(p.wrongWay && p.offRoute)
})

test('voz: aviso antecipado, aviso na hora e cada um só uma vez', () => {
  const route = lRoute(); const steps = flattenSteps(route)
  const v = new VoiceGuide(); const said: string[] = []
  for (let d = 600; d >= 0; d -= 10) { const s = v.next(steps, 1, d, 10); if (s) said.push(`${d}:${s}`) }
  assert.equal(said.length, 4, said.join(' | '))
  assert.equal(said[0], '600:Siga para leste na Rua Leste')
  assert.match(said[1], /^400:Em 400 metros, vire à esquerda/)
  assert.match(said[2], /^150:Em 150 metros, vire à esquerda/)
  assert.match(said[3], /^40:Vire à esquerda na Rua Norte$/)
  // início com a próxima manobra longe
  const v2 = new VoiceGuide()
  assert.equal(v2.next(steps, 1, 2500, 12), 'Siga para leste na Rua Leste por 2,5 quilômetros')
})

test('textos: distância e instrução em português mesmo se o servidor mandar em inglês', () => {
  assert.equal(formatDistance(47), '45 m'); assert.equal(formatDistance(1234), '1,2 km'); assert.equal(formatDistance(15400), '15 km')
  assert.equal(spokenDistance(1000), '1 quilômetro'); assert.equal(spokenDistance(1500), '1,5 quilômetros'); assert.equal(spokenDistance(320), '300 metros')
  assert.equal(instructionText({ name: 'Main St', maneuver: { type: 'turn', modifier: 'right', instruction: 'Turn right onto Main St' } }), 'Vire à direita na Main St')
  assert.equal(buildInstruction({ maneuver: { type: 'roundabout', exit: 2 }, name: 'R101' }), 'Na rotatória, pegue a 2ª saída para R101')
  assert.equal(bannerText({ maneuver: { type: 'arrive', instruction: 'Você chegou ao destino' } }, 5900), 'Siga até o destino')
  assert.equal(bannerText({ maneuver: { type: 'arrive', instruction: 'Você chegou ao destino' } }, 30), 'Você chegou ao destino')
})

test('Valhalla → formato Mapbox', () => {
  const shape: LngLat[] = [A, B, C]
  const r = valhallaTripToRoute({ summary: { length: 1, time: 100 }, legs: [{ shape: enc6(shape), maneuvers: [
    { type: 1, instruction: 'Dirija para leste.', length: 0.6, time: 60, begin_shape_index: 0, end_shape_index: 1, street_names: ['Rua Leste'] },
    { type: 15, instruction: 'Vire à esquerda para Rua Norte.', length: 0.4, time: 40, begin_shape_index: 1, end_shape_index: 2 },
    { type: 4, instruction: 'Você chegou ao seu destino.', length: 0, time: 0, begin_shape_index: 2, end_shape_index: 2 },
  ] }] })
  const s = flattenSteps(r)
  assert.equal(s[1].maneuver.type, 'turn'); assert.equal(s[1].maneuver.modifier, 'left')
  assert.equal(s[1].maneuver.instruction, 'Vire à esquerda para Rua Norte')
  assert.equal(r.distance, 1000)
  const tr = new RouteTracker(r)
  const p = tr.update({ lng: A[0], lat: A[1] })
  assert.ok(Math.abs(p.distToManeuver - 600) < 5)
})

// ─── Rota segura com servidores simulados ───────────────────────────────────

function mockFetch(handler: (url: string) => any) {
  ;(globalThis as any).fetch = async (url: string) => {
    const body = handler(url)
    if (body === null) return { ok: false, status: 503, json: async () => ({ message: 'down' }) }
    return { ok: true, status: 200, json: async () => body }
  }
}
function mbRouteThrough(points: LngLat[]) {
  const coords = points.flatMap((p, i) => i ? line(points[i - 1], p, 25).slice(1) : [p])
  let d = 0; for (let i = 1; i < coords.length; i++) d += distM(coords[i - 1], coords[i])
  return { geometry: { type: 'LineString', coordinates: coords }, distance: d, duration: d / 10,
    legs: [{ steps: [{ distance: d, duration: d / 10, maneuver: { type: 'depart', location: points[0] } }, { distance: 0, duration: 0, maneuver: { type: 'arrive', location: points[points.length - 1] } }] }] }
}
const O = DUB, D = destination(DUB, 4000, 90)
const Zmid = destination(DUB, 2000, 90)
const zone: AvoidZone = fromFirestoreZone({ id: 'z', areaName: 'Zona teste', lat: Zmid[1], lng: Zmid[0], radius: 400 })!
const coordsFromUrl = (url: string): LngLat[] => decodeURIComponent(url.split('/').pop()!.split('?')[0]).split(';').map(s => s.split(',').map(Number) as LngLat)

test('rota segura: usa o Valhalla quando a rota normal passa pela zona', async () => {
  let valCalls = 0
  mockFetch(url => {
    if (url.includes('api.mapbox.com')) return { code: 'Ok', routes: [mbRouteThrough([O, D])] }
    if (url.includes('/route?json=')) {
      valCalls++
      const q = JSON.parse(decodeURIComponent(url.split('json=')[1]))
      assert.equal(q.exclude_polygons.length, 1); assert.equal(q.directions_options.language, 'pt-BR')
      const around = destination(Zmid, 900, 0)
      const shape: LngLat[] = [O, ...line(O, around, 50).slice(1), ...line(around, D, 50).slice(1)]
      return { trip: { summary: { length: 4.6, time: 500 }, legs: [{ shape: enc6(shape), maneuvers: [
        { type: 1, instruction: 'Siga.', length: 4.6, time: 500, begin_shape_index: 0, end_shape_index: shape.length - 1 },
        { type: 4, instruction: 'Chegou.', length: 0, time: 0, begin_shape_index: shape.length - 1, end_shape_index: shape.length - 1 }] }] } }
    }
    throw new Error('url inesperada ' + url)
  })
  const res = await findSafeRoute({ lat: O[1], lng: O[0] }, { lat: D[1], lng: D[0] }, 'driving-traffic', [zone])
  assert.equal(res.method, 'valhalla'); assert.equal(valCalls, 1)
  assert.ok(res.route); assert.equal(zonesOnRoute(res.route.geometry.coordinates, [zone]).length, 0)
})

test('rota segura: Valhalla fora do ar → contorna a zona com pontos de passagem do Mapbox', async () => {
  const seen: string[] = []
  mockFetch(url => {
    if (url.includes('/route?json=')) return null
    seen.push(url)
    const pts = coordsFromUrl(url)
    if (pts.length > 2) {
      assert.ok(url.includes('/mapbox/driving/'), 'com mais de 3 pontos não pode usar driving-traffic')
      assert.ok(url.includes(`waypoints=0%3B${pts.length - 1}`) || url.includes(`waypoints=0;${pts.length - 1}`))
    }
    return { code: 'Ok', routes: [mbRouteThrough(pts)] }
  })
  const res = await findSafeRoute({ lat: O[1], lng: O[0] }, { lat: D[1], lng: D[0] }, 'driving-traffic', [zone])
  assert.equal(res.method, 'detour')
  assert.ok(res.route); assert.equal(zonesOnRoute(res.route.geometry.coordinates, [zone]).length, 0)
  assert.ok(seen.length <= 15, `consultas demais: ${seen.length}`)
})

test('rota segura: destino dentro da zona → zona inevitável, não tenta desviar', async () => {
  mockFetch(url => ({ code: 'Ok', routes: [mbRouteThrough([O, Zmid])] }))
  const res = await findSafeRoute({ lat: O[1], lng: O[0] }, { lat: Zmid[1], lng: Zmid[0] }, 'cycling', [zone])
  assert.equal(res.unavoidable.length, 1); assert.equal(res.method, 'direct'); assert.ok(res.route)
})

// ─── Modo alerta nas zonas ──────────────────────────────────────────────────
import { zoneSpansOnRoute, ZoneAlertGuide } from '../src/lib/navigation/zoneAlert'

test('modo alerta: avisa antes, ao entrar, ao sair e quando a rota fica livre', () => {
  const end = destination(DUB, 3000, 90)
  const coords = line(DUB, end, 20)
  const c1 = destination(DUB, 1000, 90), c2 = destination(DUB, 2000, 90)
  const z1 = fromFirestoreZone({ id: 'z1', areaName: 'Zona Norte', lat: c1[1], lng: c1[0], radius: 150 })!
  const z2 = fromFirestoreZone({ id: 'z2', areaName: 'Zona Sul', lat: c2[1], lng: c2[0], radius: 150 })!
  const spans = zoneSpansOnRoute(coords, [z2, z1])
  assert.deepEqual(spans.map(s => s.zone.id), ['z1', 'z2'])
  assert.ok(Math.abs(spans[0].entry - 850) < 25 && Math.abs(spans[0].exit - 1150) < 25)
  const g = new ZoneAlertGuide(spans)
  const said: string[] = []; let t = 0; let phases = new Set<string>()
  for (let a = 0; a <= 3000; a += 10) {
    t += 1000
    const r = g.update(a, new Set(), 10, t)
    phases.add(r.state.phase)
    if (r.speak) said.push(`${a}:${r.speak}`)
  }
  assert.equal(said.length, 6, said.join(' | '))
  assert.match(said[0], /^5[4-6]0:Atenção: zona de risco em 300 metros, Zona Norte/)
  assert.match(said[1], /entrou em zona de risco, Zona Norte/)
  assert.match(said[2], /saiu da zona de risco\. Falta 1 zona na rota/)
  assert.match(said[3], /zona de risco em 300 metros, Zona Sul/)
  assert.match(said[4], /entrou em zona de risco, Zona Sul/)
  assert.match(said[5], /Rota livre de zonas de risco/)
  assert.ok(['ahead', 'approaching', 'inside', 'clear'].every(p => phases.has(p)))
  assert.equal(g.update(3000, new Set(), 10, t + 1000).state.phase, 'clear')
})

test('modo alerta: lembrete a cada minuto dentro da zona e alerta mesmo fora da rota (GPS)', () => {
  const end = destination(DUB, 2000, 90)
  const coords = line(DUB, end, 20)
  const c = destination(DUB, 1000, 90)
  const z = fromFirestoreZone({ id: 'z', areaName: 'Z', lat: c[1], lng: c[0], radius: 300 })!
  const g = new ZoneAlertGuide(zoneSpansOnRoute(coords, [z]))
  const said: string[] = []
  let t = 0
  for (let a = 600; a <= 1400; a += 2) { t += 1000; const r = g.update(a, new Set(), 2, t); if (r.speak) said.push(r.speak) }
  assert.ok(said.filter(s => s.startsWith('Ainda em zona de risco')).length >= 4, said.join(' | '))
  // fora da rota, mas o GPS está dentro da zona → continua em alerta
  const g2 = new ZoneAlertGuide(zoneSpansOnRoute(coords, [z]))
  const r = g2.update(100, new Set(['z']), 5, 1000)
  assert.equal(r.state.phase, 'inside'); assert.match(r.speak ?? '', /entrou em zona de risco/)
  const out = g2.update(100, new Set(), 5, 2000)
  assert.match(out.speak ?? '', /saiu da zona de risco/)
})

test('servidor público do Valhalla: no máximo 1 consulta por segundo', async () => {
  const times: number[] = []
  mockFetch(url => {
    if (url.includes('/route?json=')) { times.push(Date.now()); return { trip: null } }
    return { code: 'Ok', routes: [] }
  })
  const { fetchValhallaRoutes } = await import('../src/lib/navigation/routing')
  const o = { lat: O[1], lng: O[0] }, d = { lat: D[1], lng: D[0] }
  await Promise.all([fetchValhallaRoutes(o, d, 'driving', []), fetchValhallaRoutes(o, d, 'driving', []), fetchValhallaRoutes(o, d, 'driving', [])])
  assert.equal(times.length, 3)
  assert.ok(times[1] - times[0] >= 1000 && times[2] - times[1] >= 1000, JSON.stringify(times))
})
