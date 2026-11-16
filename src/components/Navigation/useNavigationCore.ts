// src/components/Navigation/useNavigationCore.ts
// MOTOR DE NAVEGAÇÃO — isolado do resto do mapa.
//
// Regras deste arquivo (para nada de fora travar a navegação):
//  • não depende de grupos, reports, clima, parceiros ou busca — só de GPS, destino e perfil;
//  • toda lógica roda dentro de `guard()`: um erro é registrado e a navegação continua;
//  • a lógica pura (rastreador, voz, rota segura) fica em src/lib/navigation e tem testes.
import { useCallback, useEffect, useRef, useState } from 'react'
import toast from 'react-hot-toast'
import { useStore, GpsFix } from '@/lib/store'
import { RouteTracker, Progress } from '@/lib/navigation/routeTracker'
import { fetchMapboxRoutes, findSafeRoute, flattenCongestion } from '@/lib/navigation/routing'
import { loadAvoidZones, toZoneHit } from '@/lib/navigation/zoneSource'
import { zonesOnRoute, pointInZone, AvoidZone } from '@/lib/navigation/zones'
import { ZoneAlertGuide, ZoneAlertState, zoneSpansOnRoute } from '@/lib/navigation/zoneAlert'
import { bearing as geoBearing, distM, LngLat } from '@/lib/navigation/geo'
import { recordTrip, overlap, simplifyTrace } from '@/lib/navigation/habits'
import { diag } from '@/lib/diagnostics'

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
const FASTER_ROUTE_EVERY_MS = 120000
const FASTER_ROUTE_MIN_GAIN_S = 120

const byFewestZones = (a: any, b: any) => (a._hits?.length ?? 0) - (b._hits?.length ?? 0) || a.duration - b.duration

export function useNavigationCore({ isNavigating, currentFix, navDest, routeProfile, onBearing, onArrived, onRouteApplied }: Options) {
  // ── estado exibido na tela ──
  const [routeGeoJSON, setRouteGeoJSON] = useState<any>(null)
  const [routeCongestion, setRouteCongestion] = useState<string[]>([])
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
  const rerouteBusyRef = useRef(false)
  const riskReqRef = useRef(0)
  const navDestRef = useRef<LatLng | null>(navDest)
  const profileRef = useRef(routeProfile)
  const hasArrivedRef = useRef(false)
  const navigatingRef = useRef(isNavigating)
  const cbRef = useRef({ onBearing, onArrived, onRouteApplied })
  const alertGuideRef = useRef<ZoneAlertGuide | null>(null)
  const allZonesRef = useRef<AvoidZone[]>([])
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
        setRiskOnRoute(hits.length > 0)
        setActiveRouteZones(hits.map(toZoneHit))
        allZonesRef.current = zs
        // modo alerta: trechos da rota dentro de cada zona (usa a mesma geometria do rastreador)
        const trCoords = trackerRef.current?.coords ?? coords
        alertGuideRef.current = new ZoneAlertGuide(zoneSpansOnRoute(trCoords, hits)).adoptFrom(navigatingRef.current ? alertGuideRef.current : null)
        zoneAlertRef.current = null
        setZoneAlert(null)
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
    guard('applyRoute', () => {
      if (tripRef.current && !tripRef.current.firstRoute && Array.isArray(route?.geometry?.coordinates)) {
        tripRef.current.firstRoute = route.geometry.coordinates as LngLat[]
      }
      const tr = new RouteTracker(route)
      trackerRef.current = tr
      progressRef.current = null
      setRouteGeoJSON(route.geometry)
      setRouteCongestion(flattenCongestion(route))
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
    diag('nav-inicio', { destino: [+dest.lat.toFixed(5), +dest.lng.toFixed(5)], perfil: profile, nome: destName ?? null })
    navDestRef.current = dest
    profileRef.current = profile
    prevFixRef.current = null
    lastRerouteRef.current = Date.now()
    hasArrivedRef.current = false
    setHasArrived(false)
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
    setRouteTrim(null)
    setRouteGeoJSON(null)
    setRouteCongestion([])
    setNavSteps([])
    setCurrentStepIdx(0)
    setRiskOnRoute(false)
    setIsRecalculating(false)
    alertGuideRef.current = null
    zoneAlertRef.current = null
    setZoneAlert(null)
    setZoneSpeech(null)
  }, [finishTrip])

  /** Recalcula SEMPRE pela rota segura. */
  const reroute = useCallback(async (from: LatLng) => {
    const dest = navDestRef.current
    // depois de chegar não recalcula (antes recalculava e seguia a falar das zonas)
    if (!dest || rerouteBusyRef.current || hasArrivedRef.current) return
    rerouteBusyRef.current = true
    lastRerouteRef.current = Date.now()
    diag('recalculo', { de: [+from.lat.toFixed(5), +from.lng.toFixed(5)], fora: Math.round(progressRef.current?.offRouteM ?? -1), contramao: !!progressRef.current?.wrongWay })
    setIsRecalculating(true)
    try {
      const zones = await loadAvoidZones()
      const res = await findSafeRoute(from, dest, profileRef.current || 'driving-traffic', zones)
      const route = res.route ?? res.candidates.slice().sort(byFewestZones)[0]
      if (route && navigatingRef.current) {
        applyRoute(route)
        if (!res.route && zones.length) toast('⚠️ Nova rota passa por zona de risco — atenção', { duration: 5000 })
      }
    } catch (e) {
      console.warn('[nav] recálculo falhou (sem rede?) — mantendo rota atual', e)
    } finally {
      rerouteBusyRef.current = false
      trackerRef.current?.resetOffRoute()
      setIsRecalculating(false)
    }
  }, [applyRoute])

  /** Botão "mudar para rota segura" do modo alerta. */
  const switchToSafeRoute = useCallback(() => {
    const fix = useStore.getState().currentFix
    if (fix) reroute({ lat: fix.lat, lng: fix.lng })
  }, [reroute])

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
      diag('rota', { passo: p.stepIdx, ate: Math.round(p.distToManeuver), fora: Math.round(p.offRouteM), contramao: p.wrongWay, falta: Math.round(p.remainingM) }, 1000)

      setCurrentStepIdx(p.stepIdx)
      setDistToNext(Math.round(p.distToManeuver))
      setRemainingDist(p.remainingM)
      setRemainingSec(p.remainingS)
      setNavEta(Math.max(0, Math.round(p.remainingS / 60)))
      setRouteTrim(prevTrim =>
        prevTrim && prevTrim.seg === tr.currentSeg && Math.abs(prevTrim.point[0] - p.snapped[0]) < 1e-6 && Math.abs(prevTrim.point[1] - p.snapped[1]) < 1e-6
          ? prevTrim : { seg: tr.currentSeg, point: p.snapped })
      if (v > 2) cbRef.current.onBearing?.(Math.round(p.offRouteM < 40 ? p.routeBearing : (headingGps ?? p.routeBearing)))

      // modo alerta nas zonas (separado: um erro aqui não afeta as instruções da rota)
      guard('zoneAlert', () => {
        const guide = alertGuideRef.current
        if (!guide || hasArrivedRef.current) return
        const here: [number, number] = [currentFix.lng, currentFix.lat]
        const inside = new Set(allZonesRef.current.filter(z => pointInZone(here, z)).map(z => z.id))
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

  // ── a cada 2 min: procura rota SEGURA mais rápida (trânsito mudou) ──
  useEffect(() => {
    if (!isNavigating) return
    const interval = setInterval(async () => {
      const dest = navDestRef.current
      const fix = useStore.getState().currentFix
      const pr = progressRef.current
      if (!dest || !fix || !pr || !pr.onRoute || rerouteBusyRef.current || pr.remainingM < 1500) return
      try {
        const [routes, zones] = await Promise.all([
          fetchMapboxRoutes(fix, dest, profileRef.current, { alternatives: true }),
          loadAvoidZones(),
        ])
        const best = routes
          .filter((r: any) => zonesOnRoute(r.geometry.coordinates, zones).length === 0)
          .sort((a: any, b: any) => a.duration - b.duration)[0]
        const cur = progressRef.current
        if (best && cur && navigatingRef.current && !rerouteBusyRef.current && best.duration < cur.remainingS - FASTER_ROUTE_MIN_GAIN_S) {
          applyRoute(best)
          toast('🛡️ Rota segura mais rápida encontrada', { duration: 4000 })
        }
      } catch { /* sem rede: tenta no próximo ciclo */ }
    }, FASTER_ROUTE_EVERY_MS)
    return () => clearInterval(interval)
  }, [isNavigating, applyRoute])

  /** Distância entre a próxima manobra e a seguinte (para "Depois, …" na voz). */
  const nextGap = trackerRef.current
    ? Math.max(0, (trackerRef.current.maneuverAt[currentStepIdx + 1] ?? Infinity) - (trackerRef.current.maneuverAt[currentStepIdx] ?? 0))
    : undefined

  return {
    // estado
    routeGeoJSON, routeCongestion, navSteps, currentStepIdx, distToNext, remainingDist, remainingSec, navEta,
    riskOnRoute, activeRouteZones, isRecalculating, hasArrived, routeTrim, nextGap, zoneAlert, zoneSpeech,
    // refs (leitura pela câmera)
    trackerRef, progressRef,
    // ações
    applyRoute, beginSession, resetNav, updateRiskForRoute, setActiveRouteZones, setHasArrived, switchToSafeRoute,
  }
}
