// src/components/Navigation/useNavigationCore.ts
// MOTOR DE NAVEGAÇÃO — isolado do resto do mapa.
//
// Regras deste arquivo (para nada de fora travar a navegação):
//  • não depende de grupos, reports, clima, parceiros ou busca — só de GPS, destino e perfil;
//  • toda lógica roda dentro de `guard()`: um erro é registrado e a navegação continua;
//  • a lógica pura (rastreador, voz, rota segura) fica em src/lib/navigation e tem testes.
import { useCallback, useEffect, useRef, useState } from 'react'
import { viragemRecusada, passaPor, UltimaNaRota } from '@/lib/navigation/skippedTurn'
import toast from 'react-hot-toast'
import { useStore, GpsFix } from '@/lib/store'
import { RouteTracker, Progress } from '@/lib/navigation/routeTracker'
import { fetchMapboxRoutes, findSafeRoute, flattenCongestion, flattenMaxspeed } from '@/lib/navigation/routing'
import { loadAvoidZones, toZoneHit } from '@/lib/navigation/zoneSource'
import { zonesOnRoute, shortCrossingsOnRoute, pointInZone, AvoidZone } from '@/lib/navigation/zones'
import { ZoneAlertGuide, ZoneAlertState, zoneSpansOnRoute } from '@/lib/navigation/zoneAlert'
import { bearing as geoBearing, distM, LngLat } from '@/lib/navigation/geo'
import { recordTrip, overlap, simplifyTrace } from '@/lib/navigation/habits'
import { projectAhead } from '@/lib/navigation/reportAhead'
import { diag } from '@/lib/diagnostics'
import { ChoiceState, newChoiceState, isDetour, registerReroute } from '@/lib/navigation/riderChoice'
import { AltCheckState, newAltState, shouldCheckAlt, slipS } from '@/lib/navigation/altCheck'

type LatLng = { lat: number; lng: number }
export type LiveProgress = Progress & { time: number; speedMps: number; onRoute: boolean }

/** Executa `fn`; se der erro, registra e devolve `fallback` em vez de derrubar a navegação. */
export function guard<T>(where: string, fn: () => T, fallback?: T): T | undefined {
  try { return fn() } catch (e) {
    console.error(`[nav] erro em ${where}:`, e)
    return fallback
  }
}

interface Options {
  isNavigating: boolean
  currentFix: GpsFix | null
  navDest: LatLng | null
  routeProfile: string
  /** direção da rua/rumo para a câmera */
  onBearing?: (deg: number) => void
  /** chegou ao destino */
  onArrived?: () => void
  /** uma rota nova foi aplicada (início, recálculo, troca) */
  onRouteApplied?: () => void
}

const REROUTE_COOLDOWN_MS = 8000
const FASTER_ROUTE_EVERY_MS = 15000   // só avalia; o pedido à API depende de altCheck.ts
const FASTER_ROUTE_MIN_GAIN_S = 120

const byFewestZones = (a: any, b: any) => (a._hits?.length ?? 0) - (b._hits?.length ?? 0) || a.duration - b.duration

export function useNavigationCore({ isNavigating, currentFix, navDest, routeProfile, onBearing, onArrived, onRouteApplied }: Options) {
  // ── estado exibido na tela ──
  const [routeGeoJSON, setRouteGeoJSON] = useState<any>(null)
  const [routeCongestion, setRouteCongestion] = useState<string[]>([])
  // limite de velocidade da rua onde o rider está (do Mapbox; null = desconhecido)
  const [speedLimit, setSpeedLimit] = useState<number | null>(null)
  const maxspeedRef = useRef<(number | null)[]>([])
  const [navSteps, setNavSteps] = useState<any[]>([])
  const [currentStepIdx, setCurrentStepIdx] = useState(0)
  const [distToNext, setDistToNext] = useState(0)
  const [remainingDist, setRemainingDist] = useState(0)
  const [remainingSec, setRemainingSec] = useState(0)
  const [navEta, setNavEta] = useState(0)
  const [riskOnRoute, setRiskOnRoute] = useState(false)
  const [activeRouteZones, setActiveRouteZones] = useState<any[]>([])
  const [isRecalculating, setIsRecalculating] = useState(false)
  const [hasArrived, setHasArrived] = useState(false)
  const [routeTrim, setRouteTrim] = useState<{ seg: number; point: [number, number] } | null>(null)
  // modo alerta: estado da faixa + último aviso de voz
  const [zoneAlert, setZoneAlert] = useState<ZoneAlertState | null>(null)
  const [zoneSpeech, setZoneSpeech] = useState<{ id: number; text: string } | null>(null)

  // ── referências (valores vivos para callbacks, sem re-render) ──
  const trackerRef = useRef<RouteTracker | null>(null)
  const progressRef = useRef<LiveProgress | null>(null)
  const prevFixRef = useRef<{ lat: number; lng: number; time: number } | null>(null)
  const lastRerouteRef = useRef(0)
  const bloqueadosRef = useRef<LngLat[]>([])            // entradas/viragens recusadas nesta viagem
  const ultimaNaRotaRef = useRef<UltimaNaRota | null>(null)
  const rerouteBusyRef = useRef(false)
  const passIdsRef = useRef<Set<string>>(new Set())   // zonas que a rota só corta de passagem
  const altStateRef = useRef<AltCheckState | null>(null)   // quando procurar alternativas (poupa pedidos)
  const choiceRef = useRef<ChoiceState>(newChoiceState())   // rider recusou a rota segura?
  const onDetourRef = useRef(true)   // rota atual é um desvio de segurança (a inicial costuma ser)
  const moveHeadingRef = useRef<{ deg: number; time: number } | null>(null)   // direção real do rider (GPS)
  const riskReqRef = useRef(0)
  const navDestRef = useRef<LatLng | null>(navDest)
  const profileRef = useRef(routeProfile)
  const hasArrivedRef = useRef(false)
  // Rota alternativa mostrada a cinzento durante a navegação (como o Google Maps)
  const [altRoute, setAltRoute] = useState<{ route: any; deltaS: number; divAlong: number; label: [number, number]; zoneM?: number } | null>(null)
  const altRouteRef = useRef(altRoute)
  altRouteRef.current = altRoute
  const navigatingRef = useRef(isNavigating)
  const cbRef = useRef({ onBearing, onArrived, onRouteApplied })
  const alertGuideRef = useRef<ZoneAlertGuide | null>(null)
  const allZonesRef = useRef<AvoidZone[]>([])
  // há rota que evita as zonas à frente? ('none-needed' = só a zona do destino ou nenhuma)
  const [safeAlt, setSafeAlt] = useState<'checking' | 'yes' | 'no' | 'none-needed' | null>(null)
  const safeAltRef = useRef<any>(null)
  const [destZone, setDestZone] = useState<{ id: string; name: string } | null>(null)
  const zoneAlertRef = useRef<ZoneAlertState | null>(null)
  const speechIdRef = useRef(0)
  navDestRef.current = navDest
  profileRef.current = routeProfile
  navigatingRef.current = isNavigating
  hasArrivedRef.current = hasArrived
  cbRef.current = { onBearing, onArrived, onRouteApplied }

  /** Zonas que a rota realmente atravessa → aviso "zona de risco à frente" e alertas. */
  const updateRiskForRoute = useCallback((coords: [number, number][]) => {
    const id = ++riskReqRef.current
    loadAvoidZones()
      .then(zs => guard('updateRiskForRoute', () => {
        if (id !== riskReqRef.current) return
        const hits = zonesOnRoute(coords, zs)
        const passagem = shortCrossingsOnRoute(coords, zs)
        passIdsRef.current = new Set(passagem.map(z => z.id))
        if (passagem.length) diag('zona-so-passagem', { zonas: passagem.map(z => z.name) })
        setRiskOnRoute(hits.length > 0)
        setActiveRouteZones(hits.map(toZoneHit))
        allZonesRef.current = zs
        // modo alerta: trechos da rota dentro de cada zona (usa a mesma geometria do rastreador)
        const trCoords = trackerRef.current?.coords ?? coords
        alertGuideRef.current = new ZoneAlertGuide(zoneSpansOnRoute(trCoords, hits)).adoptFrom(navigatingRef.current ? alertGuideRef.current : null)
        zoneAlertRef.current = null
        setZoneAlert(null)
        // destino dentro de uma zona (entrega em zona de risco) — aviso diferente, sem "rota segura"
        const dest = navDestRef.current
        const dz = dest ? zs.find(z => pointInZone([dest.lng, dest.lat], z)) ?? null : null
        setDestZone(dz ? { id: dz.id, name: dz.name } : null)
        // existe rota que evita as OUTRAS zonas? (calcula em segundo plano; o botão só aparece se sim)
        const evitaveis = hits.filter(z => z.id !== dz?.id)
        safeAltRef.current = null
        if (!evitaveis.length) { setSafeAlt('none-needed'); return }
        setSafeAlt('checking')
        const fix = useStore.getState().currentFix
        if (!fix || !dest) { setSafeAlt('no'); return }
        const reqId = riskReqRef.current
        findSafeRoute({ lat: fix.lat, lng: fix.lng }, dest, profileRef.current || 'driving-traffic', zs)
          .then(res => {
            if (reqId !== riskReqRef.current) return
            const r = res?.route
            const restantes = r ? zonesOnRoute(r.geometry.coordinates, zs).filter(z => z.id !== dz?.id && !pointInZone([fix.lng, fix.lat], z)) : []
            if (r && restantes.length === 0) { safeAltRef.current = r; setSafeAlt('yes') }
            else setSafeAlt('no')
            diag('rota-segura-disponivel', { ok: !!(r && restantes.length === 0) })
          })
          .catch(() => { if (reqId === riskReqRef.current) setSafeAlt('no') })
      }))
      .catch(() => {})
  }, [])

  // ── aprendizagem de caminhos (fica no aparelho) ──
  const tripRef = useRef<{ start: number; origin: LngLat | null; trace: LngLat[]; firstRoute: LngLat[] | null; name?: string; recorded: boolean } | null>(null)

  const finishTrip = useCallback((arrived: boolean) => {
    guard('recordTrip', () => {
      const t = tripRef.current
      const dest = navDestRef.current
      if (!t || t.recorded || !t.origin || !dest || t.trace.length < 3) return
      const last = t.trace[t.trace.length - 1]
      const d: LngLat = [dest.lng, dest.lat]
      // só conta viagem concluída (chegou, ou cancelou já a < 200 m do destino)
      if (!arrived && distM(last, d) > 200) return
      t.recorded = true
      const trace = simplifyTrace(t.trace, 25)
      let dist = 0
      for (let i = 1; i < trace.length; i++) dist += distM(trace[i - 1], trace[i])
      recordTrip({
        o: t.origin, d, name: t.name,
        t: t.start, dur: Math.round((Date.now() - t.start) / 1000), dist: Math.round(dist),
        mode: profileRef.current || 'driving-traffic',
        trace,
        followed: t.firstRoute ? overlap(trace, t.firstRoute, 40) : 1,
      })
    })
  }, [])

  const applyRoute = useCallback((route: any) => {
    setAltRoute(null)
    ultimaNaRotaRef.current = null   // a "última posição na rota" passa a ser desta rota nova
    altStateRef.current = newAltState(Date.now(), Number(route?.duration) || 0)
    guard('applyRoute', () => {
      if (tripRef.current && !tripRef.current.firstRoute && Array.isArray(route?.geometry?.coordinates)) {
        tripRef.current.firstRoute = route.geometry.coordinates as LngLat[]
      }
      const tr = new RouteTracker(route)
      trackerRef.current = tr
      progressRef.current = null
      setRouteGeoJSON(route.geometry)
      setRouteCongestion(flattenCongestion(route))
      maxspeedRef.current = flattenMaxspeed(route)
      setNavSteps(tr.steps)
      setCurrentStepIdx(tr.steps.length > 1 ? 1 : 0)
      setDistToNext(Math.round(tr.maneuverAt[1] ?? route.distance ?? 0))
      setRemainingDist(route.distance)
      setRemainingSec(route.duration ?? 0)
      setNavEta(Math.round((route.duration ?? 0) / 60))
      setRouteTrim(null)
      updateRiskForRoute(route.geometry.coordinates)
      cbRef.current.onRouteApplied?.()
    })
  }, [updateRiskForRoute])

  /** Prepara uma sessão nova (chamar antes de applyRoute no início da navegação). */
  const beginSession = useCallback((dest: LatLng, profile: string, destName?: string) => {
    tripRef.current = { start: Date.now(), origin: null, trace: [], firstRoute: null, name: destName, recorded: false }
    choiceRef.current = newChoiceState(); onDetourRef.current = true
    diag('nav-inicio', { destino: [+dest.lat.toFixed(5), +dest.lng.toFixed(5)], perfil: profile, nome: destName ?? null })
    navDestRef.current = dest
    profileRef.current = profile
    prevFixRef.current = null
    lastRerouteRef.current = Date.now()
    hasArrivedRef.current = false
    setHasArrived(false)
    bloqueadosRef.current = []
    ultimaNaRotaRef.current = null
  }, [])

  /** Limpa tudo ao cancelar a navegação. */
  const resetNav = useCallback(() => {
    if (tripRef.current) diag('nav-fim', { chegou: hasArrivedRef.current })
    finishTrip(false)
    tripRef.current = null
    trackerRef.current = null
    progressRef.current = null
    prevFixRef.current = null
    riskReqRef.current++
    passIdsRef.current = new Set()
    setRouteTrim(null)
    setRouteGeoJSON(null)
    setRouteCongestion([])
    maxspeedRef.current = []
    setSpeedLimit(null)
    setNavSteps([])
    setCurrentStepIdx(0)
    setRiskOnRoute(false)
    setIsRecalculating(false)
    alertGuideRef.current = null
    zoneAlertRef.current = null
    setZoneAlert(null)
    setZoneSpeech(null)
  }, [finishTrip])

  /** Mostra a cinzento a 1.ª rota da lista que segue por outro caminho (com a diferença de tempo). */
  const mostrarAlternativa = useCallback((lista: any[], zoneM?: number): boolean => {
    const tr = trackerRef.current
    const cur = progressRef.current
    if (!tr || !cur || !navigatingRef.current) return false
    const restante = tr.remainingCoords(cur.along) as [number, number][]
    let escolhida: any = null
    for (const r of lista) {
      const g = r.geometry.coordinates as [number, number][]
      if (overlap(simplifyTrace(g, 40), restante, 40) < 0.65) { escolhida = r; break }
    }
    if (!escolhida) return false
    const g = escolhida.geometry.coordinates as [number, number][]
    // onde se separa da rota atual (para sumir depois de passar esse ponto) e onde pôr a etiqueta
    let divIdx = g.findIndex(p => overlap([p], restante, 40) === 0)
    if (divIdx < 0) divIdx = 0
    const divPt = g[divIdx]
    const proj = projectAhead({ coords: tr.coords as any, cum: tr.cum }, divPt, tr.currentSeg, cur.along, 5000)
    const label = g[Math.min(g.length - 1, divIdx + Math.floor((g.length - divIdx) / 3))]
    const restS = cur.remainingS ?? tr.length
    setAltRoute({ route: escolhida, deltaS: Math.round(escolhida.duration - restS), divAlong: proj?.along ?? cur.along, label, zoneM })
    diag('alternativa', { delta: Math.round(escolhida.duration - restS), zonaM: zoneM ?? 0 })
    return true
  }, [])

  /** Recalcula SEMPRE pela rota segura. */
  const reroute = useCallback(async (from: LatLng) => {
    const dest = navDestRef.current
    // depois de chegar não recalcula (antes recalculava e seguia a falar das zonas)
    if (!dest || rerouteBusyRef.current || hasArrivedRef.current) return
    rerouteBusyRef.current = true
    lastRerouteRef.current = Date.now()
    diag('recalculo', { direcao: moveHeadingRef.current ? Math.round(moveHeadingRef.current.deg) : null, de: [+from.lat.toFixed(5), +from.lng.toFixed(5)], fora: Math.round(progressRef.current?.offRouteM ?? -1), contramao: !!progressRef.current?.wrongWay })
    setIsRecalculating(true)
    try {
      const zones = await loadAvoidZones()
      // manda a direção em que o rider já vai: assim a rota nova segue pelo caminho que ele escolheu
      // (antes saía da rotunda por outra saída e a rota nova mandava voltar)
      const mh = moveHeadingRef.current
      const heading = mh && Date.now() - mh.time < 15000 ? mh.deg : null
      // passou uma viragem sem a fazer (ex.: entrada fechada)? não mandar voltar a ela
      const trAntigo = trackerRef.current
      const recusada = trAntigo ? viragemRecusada(trAntigo as any, ultimaNaRotaRef.current, [from.lng, from.lat]) : null
      const perfil = profileRef.current || 'driving-traffic'
      const bloq = bloqueadosRef.current
      let res = await findSafeRoute(from, dest, perfil, zones, { heading, excludePoints: bloq.length ? bloq : undefined })
      if (bloq.length && !res.route && !res.candidates.length) res = await findSafeRoute(from, dest, perfil, zones, { heading })
      const escolhidaAntes = res.route ?? res.candidates.slice().sort(byFewestZones)[0]
      if (recusada && escolhidaAntes && passaPor(escolhidaAntes.geometry.coordinates, [recusada])) {
        try {
          const res2 = await findSafeRoute(from, dest, perfil, zones, { heading, excludePoints: [...bloq, recusada] })
          const r2 = res2.route ?? res2.candidates.slice().sort(byFewestZones)[0]
          // usa o outro acesso se existir e não for uma volta enorme (até +10 min)
          if (r2 && !passaPor(r2.geometry.coordinates, [recusada]) && (r2.duration ?? Infinity) <= (escolhidaAntes.duration ?? 0) + 600) {
            bloqueadosRef.current = [...bloq, recusada]
            diag('entrada-evitada', { ponto: [+recusada[1].toFixed(5), +recusada[0].toFixed(5)], extraS: Math.round((r2.duration ?? 0) - (escolhidaAntes.duration ?? 0)) })
            res = res2
            toast('Outro caminho: evitando a entrada que não fizeste', { duration: 4000 })
          } else diag('entrada-sem-alternativa', { ponto: [+recusada[1].toFixed(5), +recusada[0].toFixed(5)] })
        } catch { /* fica com a rota normal */ }
      }
      let route = res.route ?? res.candidates.slice().sort(byFewestZones)[0]
      // o rider saiu de novo de uma rota segura com desvio? à 2.ª vez segue o caminho dele
      const moving = !!mh && Date.now() - mh.time < 5000
      const antes = choiceRef.current
      choiceRef.current = registerReroute(antes, { leftDetour: onDetourRef.current, moving, now: Date.now() })
      const fastest = res.candidates.slice().sort((a: any, b: any) => (a.duration ?? Infinity) - (b.duration ?? Infinity))[0]
      const desvio = isDetour(res.route, fastest)
      let seguiuRider = false
      if (res.route && desvio && choiceRef.current.following) { route = fastest; seguiuRider = true }
      onDetourRef.current = !!res.route && route === res.route && desvio
      if (route && navigatingRef.current) {
        applyRoute(route)
        if (seguiuRider) {
          diag('segue-rider', { recusas: choiceRef.current.rejects, extraS: Math.round((res.route.duration ?? 0) - (fastest.duration ?? 0)) })
          if (!antes.following) toast('A seguir o teu caminho. Atenção: passa por zona de risco', { duration: 6000 })
        } else if (!res.route && zones.length) toast('⚠️ Nova rota passa por zona de risco — atenção', { duration: 5000 })
        if (res.method === 'mesma-exposicao') diag('rota-mesma-exposicao', { zonaM: route._exposureM ?? 0 })
        // a rota segura dá uma volta grande? mostra também a mais rápida (cruza zona) para o rider escolher
        else if (!seguiuRider && res.fastAlt && res.fastAlt !== route) {
          // espera o tracker da rota nova ter a 1.ª posição
          const fa = res.fastAlt
          setTimeout(() => { if (navigatingRef.current) mostrarAlternativa([fa], fa._exposureM ?? undefined) }, 1500)
        }
      }
    } catch (e) {
      console.warn('[nav] recálculo falhou (sem rede?) — mantendo rota atual', e)
    } finally {
      rerouteBusyRef.current = false
      trackerRef.current?.resetOffRoute()
      setIsRecalculating(false)
    }
  }, [applyRoute, mostrarAlternativa])

  /** Botão "mudar para rota segura" do modo alerta. */
  const switchToSafeRoute = useCallback(() => {
    // usa a rota segura já calculada; senão recalcula pela rota segura
    // pediu a rota segura: volta a protegê-lo (esquece as recusas)
    choiceRef.current = newChoiceState(); onDetourRef.current = true
    if (safeAltRef.current) { const r = safeAltRef.current; safeAltRef.current = null; applyRoute(r); return }
    const fix = useStore.getState().currentFix
    if (fix) reroute({ lat: fix.lat, lng: fix.lng })
  }, [reroute, applyRoute])

  // ── a cada leitura do GPS ──
  useEffect(() => {
    const tr = trackerRef.current
    if (!isNavigating || !tr || !currentFix) return
    guard('onFix', () => {
      const prev = prevFixRef.current
      let speedMps = currentFix.speed
      let headingGps = currentFix.heading
      if (prev) {
        const dt = (currentFix.time - prev.time) / 1000
        const d = distM([prev.lng, prev.lat], [currentFix.lng, currentFix.lat])
        if (speedMps == null && dt > 0.5 && dt < 30) speedMps = d / dt
        if ((headingGps == null || (speedMps ?? 0) < 1) && d > 5) headingGps = geoBearing([prev.lng, prev.lat], [currentFix.lng, currentFix.lat])
      }
      if (!prev || distM([prev.lng, prev.lat], [currentFix.lng, currentFix.lat]) > 3 || currentFix.time - prev.time > 3000) {
        prevFixRef.current = { lat: currentFix.lat, lng: currentFix.lng, time: currentFix.time }
      }
      const v = speedMps ?? 0
      if (headingGps != null && isFinite(headingGps) && v > 2) moveHeadingRef.current = { deg: headingGps, time: Date.now() }
      // trajeto real (para aprender os caminhos do rider) — só leituras com boa precisão
      const trip = tripRef.current
      if (trip && (currentFix.accuracy == null || currentFix.accuracy <= 40)) {
        const here: LngLat = [currentFix.lng, currentFix.lat]
        if (!trip.origin) trip.origin = here
        const lastPt = trip.trace[trip.trace.length - 1]
        if (!lastPt || distM(lastPt, here) >= 25) { if (trip.trace.length < 2000) trip.trace.push(here) }
      }
      const p = tr.update({ ...currentFix, speed: v, heading: headingGps })
      progressRef.current = { ...p, time: Date.now(), speedMps: v, onRoute: p.offRouteM < 40 }
      if (p.offRouteM < 20) ultimaNaRotaRef.current = { stepIdx: p.stepIdx, distToManeuver: p.distToManeuver, along: p.along }
      if (altRouteRef.current && p.along > altRouteRef.current.divAlong + 40) setAltRoute(null)
      {
        const lim = p.offRoute ? null : (maxspeedRef.current[tr.currentSeg] ?? null)
        setSpeedLimit(prev => (prev === lim ? prev : lim))
      }
      diag('rota', { passo: p.stepIdx, ate: Math.round(p.distToManeuver), fora: Math.round(p.offRouteM), contramao: p.wrongWay, falta: Math.round(p.remainingM) }, 1000)

      setCurrentStepIdx(p.stepIdx)
      setDistToNext(Math.round(p.distToManeuver))
      setRemainingDist(p.remainingM)
      setRemainingSec(p.remainingS)
      setNavEta(Math.max(0, Math.round(p.remainingS / 60)))
      // A linha azul começa À FRENTE do último GPS (ideia do Maurício): entre dois GPS (≈1 s) a seta
      // anda sozinha para a frente e deixava um "rabo" de linha atrás dela. O corte vai ~1,1 s à
      // frente (máx. 40 m): a seta vai "comendo" a ponta da linha e nunca fica linha atrás dela.
      // Só 1 corte por GPS — nada por quadro, para a seta continuar suave.
      const lead = p.offRouteM < 40 && v > 1.5 ? Math.min(40, v * 1.1) : 0
      const cutAlong = Math.min(Math.max(0, tr.length - 1), p.along + lead)
      const cutSeg = lead > 0 ? tr.segAt(cutAlong) : tr.currentSeg
      const cutPt = (lead > 0 ? tr.pointAt(cutAlong) : p.snapped) as [number, number]
      setRouteTrim(prevTrim =>
        prevTrim && prevTrim.seg === cutSeg && Math.abs(prevTrim.point[0] - cutPt[0]) < 1e-6 && Math.abs(prevTrim.point[1] - cutPt[1]) < 1e-6
          ? prevTrim : { seg: cutSeg, point: cutPt })
      if (v > 2) cbRef.current.onBearing?.(Math.round(p.offRouteM < 40 ? p.routeBearing : (headingGps ?? p.routeBearing)))

      // modo alerta nas zonas (separado: um erro aqui não afeta as instruções da rota)
      guard('zoneAlert', () => {
        const guide = alertGuideRef.current
        if (!guide || hasArrivedRef.current) return
        const here: [number, number] = [currentFix.lng, currentFix.lat]
        // zona que a rota só corta de passagem (ex.: ponte sobre o canal): enquanto segue a rota, não avisa
        const naRota = p.offRouteM < 40
        const inside = new Set(allZonesRef.current
          .filter(z => !(naRota && passIdsRef.current.has(z.id)) && pointInZone(here, z)).map(z => z.id))
        const r = guide.update(p.along, inside, v, Date.now(), allZonesRef.current)
        const prevA = zoneAlertRef.current
        const st = r.state
        const changed = !prevA || prevA.phase !== st.phase || prevA.zoneId !== st.zoneId || prevA.remaining !== st.remaining
          || Math.abs((prevA.distToEntry ?? 0) - (st.distToEntry ?? 0)) >= 10
          || Math.abs((prevA.distToExit ?? 0) - (st.distToExit ?? 0)) >= 10
        if (changed) { zoneAlertRef.current = st; setZoneAlert(st) }
        if (r.speak) setZoneSpeech({ id: ++speechIdRef.current, text: r.speak })
      })

      if (p.arrived && !hasArrivedRef.current) {
        hasArrivedRef.current = true
        diag('chegada', {})
        finishTrip(true)
        setHasArrived(true)
        cbRef.current.onArrived?.()
        return
      }
      if (p.offRoute && !rerouteBusyRef.current && Date.now() - lastRerouteRef.current > REROUTE_COOLDOWN_MS) {
        reroute({ lat: currentFix.lat, lng: currentFix.lng })
      }
    })
  }, [currentFix, isNavigating, reroute, finishTrip])

  useEffect(() => {
    if (!isNavigating) { setHasArrived(false); hasArrivedRef.current = false }
  }, [isNavigating])

  // ── procura rota SEGURA mais rápida quando o rider atrasa (trânsito) — ver altCheck.ts ──
  useEffect(() => {
    if (!isNavigating) return
    const check = async () => {
      const dest = navDestRef.current
      const fix = useStore.getState().currentFix
      const pr = progressRef.current
      if (!dest || !fix || !pr || !pr.onRoute || rerouteBusyRef.current) return
      const st = altStateRef.current
      const agora = Date.now()
      const motivo = st ? shouldCheckAlt(st, agora, pr.remainingS, pr.remainingM) : null
      if (!st || !motivo) return
      st.lastCheck = agora; st.checks++
      diag('alt-verificar', { motivo, atrasoS: Math.round(slipS(st, agora, pr.remainingS)), n: st.checks, faltaS: Math.round(pr.remainingS) })
      try {
        const [routes, zones] = await Promise.all([
          fetchMapboxRoutes(fix, dest, profileRef.current, { alternatives: true }),
          loadAvoidZones(),
        ])
        const seguras = routes
          .filter((r: any) => zonesOnRoute(r.geometry.coordinates, zones).length === 0)
          .sort((a: any, b: any) => a.duration - b.duration)
        const best = seguras[0]
        const cur = progressRef.current
        if (best && cur && navigatingRef.current && !rerouteBusyRef.current && best.duration < cur.remainingS - FASTER_ROUTE_MIN_GAIN_S) {
          setAltRoute(null)
          applyRoute(best)
          toast('🛡️ Rota segura mais rápida encontrada', { duration: 4000 })
          return
        }
        // alternativa segura que segue por outro caminho → mostrada a cinzento com a diferença de tempo
        if (!mostrarAlternativa(seguras)) setAltRoute(null)
      } catch { /* sem rede: tenta no próximo ciclo */ }
    }
    // avalia a cada 15 s (sem custo); só pede rotas quando shouldCheckAlt diz que vale a pena
    const interval = setInterval(check, FASTER_ROUTE_EVERY_MS)
    return () => { clearInterval(interval); setAltRoute(null) }
  }, [isNavigating, applyRoute, mostrarAlternativa])

  /** Rider tocou na alternativa cinzenta: passa a navegar por ela. */
  const switchToAlt = useCallback(() => {
    const a = altRouteRef.current
    if (!a) return
    diag('alternativa-escolhida', { delta: a.deltaS })
    setAltRoute(null)
    applyRoute(a.route)
  }, [applyRoute])

  /** Distância entre a próxima manobra e a seguinte (para "Depois, …" na voz). */
  const nextGap = trackerRef.current
    ? Math.max(0, (trackerRef.current.maneuverAt[currentStepIdx + 1] ?? Infinity) - (trackerRef.current.maneuverAt[currentStepIdx] ?? 0))
    : undefined

  return {
    // estado
    routeGeoJSON, routeCongestion, navSteps, currentStepIdx, distToNext, remainingDist, remainingSec, navEta,
    riskOnRoute, activeRouteZones, isRecalculating, hasArrived, routeTrim, nextGap, zoneAlert, zoneSpeech, altRoute, speedLimit, safeAlt, destZone,
    // refs (leitura pela câmera)
    trackerRef, progressRef,
    // ações
    applyRoute, beginSession, resetNav, updateRiskForRoute, setActiveRouteZones, setHasArrived, switchToSafeRoute, switchToAlt,
  }
}
