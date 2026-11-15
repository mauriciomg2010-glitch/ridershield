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
import { zonesOnRoute } from '@/lib/navigation/zones'
import { bearing as geoBearing, distM } from '@/lib/navigation/geo'

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
      }))
      .catch(() => {})
  }, [])

  const applyRoute = useCallback((route: any) => {
    guard('applyRoute', () => {
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
  const beginSession = useCallback((dest: LatLng, profile: string) => {
    navDestRef.current = dest
    profileRef.current = profile
    prevFixRef.current = null
    lastRerouteRef.current = Date.now()
    hasArrivedRef.current = false
    setHasArrived(false)
  }, [])

  /** Limpa tudo ao cancelar a navegação. */
  const resetNav = useCallback(() => {
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
  }, [])

  /** Recalcula SEMPRE pela rota segura. */
  const reroute = useCallback(async (from: LatLng) => {
    const dest = navDestRef.current
    if (!dest || rerouteBusyRef.current) return
    rerouteBusyRef.current = true
    lastRerouteRef.current = Date.now()
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
      const p = tr.update({ ...currentFix, speed: v, heading: headingGps })
      progressRef.current = { ...p, time: Date.now(), speedMps: v, onRoute: p.offRouteM < 40 }

      setCurrentStepIdx(p.stepIdx)
      setDistToNext(Math.round(p.distToManeuver))
      setRemainingDist(p.remainingM)
      setRemainingSec(p.remainingS)
      setNavEta(Math.max(0, Math.round(p.remainingS / 60)))
      setRouteTrim(prevTrim =>
        prevTrim && prevTrim.seg === tr.currentSeg && Math.abs(prevTrim.point[0] - p.snapped[0]) < 1e-6 && Math.abs(prevTrim.point[1] - p.snapped[1]) < 1e-6
          ? prevTrim : { seg: tr.currentSeg, point: p.snapped })
      if (v > 2) cbRef.current.onBearing?.(Math.round(p.offRouteM < 40 ? p.routeBearing : (headingGps ?? p.routeBearing)))

      if (p.arrived && !hasArrivedRef.current) {
        hasArrivedRef.current = true
        setHasArrived(true)
        cbRef.current.onArrived?.()
        return
      }
      if (p.offRoute && !rerouteBusyRef.current && Date.now() - lastRerouteRef.current > REROUTE_COOLDOWN_MS) {
        reroute({ lat: currentFix.lat, lng: currentFix.lng })
      }
    })
  }, [currentFix, isNavigating, reroute])

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
    riskOnRoute, activeRouteZones, isRecalculating, hasArrived, routeTrim, nextGap,
    // refs (leitura pela câmera)
    trackerRef, progressRef,
    // ações
    applyRoute, beginSession, resetNav, updateRiskForRoute, setActiveRouteZones, setHasArrived,
  }
}
