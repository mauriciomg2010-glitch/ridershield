'use client'
import { useEffect, useState, useRef } from 'react'
import { ALL_ZONES, getRiskLevelActual } from '@/lib/permanentZones'
import { collection, getDocs } from 'firebase/firestore'
import { db } from '@/lib/firebase'

export const TRANSPORT_MODES = [
  { key: 'car',     label: 'Carro/Moto', icon: '🚗', profile: 'driving-traffic' },
  { key: 'cycling', label: 'Bike',        icon: '🚲', profile: 'cycling' },
  { key: 'walking', label: 'A pé',        icon: '🚶', profile: 'walking' },
] as const

export type ModeKey = typeof TRANSPORT_MODES[number]['key']

export function getModeIcon(key: string): string {
  return TRANSPORT_MODES.find(m => m.key === key)?.icon ?? '🚗'
}
export function getSavedMode(): ModeKey {
  if (typeof window === 'undefined') return 'car'
  const saved = localStorage.getItem('navMode')
  if (saved === 'moto' || saved === 'car') return 'car'
  if (saved === 'cycling' || saved === 'walking') return saved as ModeKey
  return 'car'
}
export function getProfileForMode(key: string): string {
  return TRANSPORT_MODES.find(m => m.key === key)?.profile ?? 'driving-traffic'
}

// ── Geo utils ────────────────────────────────────────────────────────────────

function haversineM(lat1: number, lng1: number, lat2: number, lng2: number): number {
  const R = 6371000
  const dLat = (lat2 - lat1) * Math.PI / 180
  const dLng = (lng2 - lng1) * Math.PI / 180
  const a = Math.sin(dLat / 2) ** 2 + Math.cos(lat1 * Math.PI / 180) * Math.cos(lat2 * Math.PI / 180) * Math.sin(dLng / 2) ** 2
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a))
}

// ── Zone checking ─────────────────────────────────────────────────────────────

export interface ZoneHit {
  id: string; name: string; zone: string; city: string; country: string
  lat: number; lng: number; radius: number
  riskLevel: 'low' | 'medium' | 'high' | 'critical'
  actualLevel: 'low' | 'medium' | 'high' | 'critical'
  isPicoAgora: boolean
}

function pointInPolygon(lat: number, lng: number, rawCoords: any[]): boolean {
  // Normalise — handles [{lng,lat}] objects and [[lng,lat]] arrays
  const pts = rawCoords.map((c: any) => Array.isArray(c) ? { lng: c[0], lat: c[1] } : c)
  let inside = false
  const n = pts.length
  let j = n - 1
  for (let i = 0; i < n; i++) {
    const xi = pts[i].lng, yi = pts[i].lat
    const xj = pts[j].lng, yj = pts[j].lat
    if ((yi > lat) !== (yj > lat) && lng < ((xj - xi) * (lat - yi)) / (yj - yi) + xi) inside = !inside
    j = i
  }
  return inside
}

function checkRouteZones(coords: [number, number][], hour: number): ZoneHit[] {
  const hits: ZoneHit[] = []
  for (let i = 0; i < coords.length; i += 5) {
    const [lng, lat] = coords[i]
    for (const zone of ALL_ZONES) {
      if (zone.riskLevel !== 'high' && zone.riskLevel !== 'critical') continue
      const actualLevel = getRiskLevelActual(zone, hour)
      if (actualLevel !== 'high' && actualLevel !== 'critical') continue
      const dist = haversineM(lat, lng, zone.lat, zone.lng)
      const isPeak = zone.peakHours?.includes(hour) ?? false
      const effectiveRadius = isPeak ? zone.radius * 1.2 : zone.radius
      if (dist < effectiveRadius && !hits.find(h => h.id === zone.id)) {
        hits.push({ ...zone, actualLevel, isPicoAgora: isPeak })
      }
    }
  }
  return hits
}

// Checks Firestore manual zones (polygon + radius) against route coords
async function checkFirestoreZones(coords: [number, number][]): Promise<ZoneHit[]> {
  try {
    const snap = await getDocs(collection(db, 'risk_zones'))
    const zonas = snap.docs.map(d => ({ id: d.id, ...d.data() })) as any[]
    const hits: ZoneHit[] = []
    for (let i = 0; i < coords.length; i += 3) {
      const [lng, lat] = coords[i]
      for (const zona of zonas) {
        if (hits.find(h => h.id === zona.id)) continue
        let inside = false
        if (zona.polygon && zona.polygon.length >= 3) {
          inside = pointInPolygon(lat, lng, zona.polygon)
        } else if (zona.lat && zona.lng && zona.radius) {
          inside = haversineM(lat, lng, zona.lat, zona.lng) < zona.radius
        }
        if (inside) {
          const level: 'low' | 'medium' | 'high' | 'critical' = zona.riskLevel ?? 'medium'
          hits.push({
            id: zona.id,
            name: zona.areaName ?? zona.id,
            zone: zona.areaName ?? '',
            city: zona.city ?? 'dublin',
            country: 'ie',
            lat: zona.lat ?? 0,
            lng: zona.lng ?? 0,
            radius: zona.radius ?? 200,
            riskLevel: level,
            actualLevel: level,
            isPicoAgora: (zona.peakHours ?? []).includes(new Date().getHours()),
          })
        }
      }
    }
    return hits
  } catch {
    return []
  }
}

// ── Firestore zone helpers ────────────────────────────────────────────────────

async function fetchAllFirestoreZonas(): Promise<any[]> {
  try {
    const snap = await getDocs(collection(db, 'risk_zones'))
    return snap.docs.map(d => ({ id: d.id, ...d.data() }))
  } catch { return [] }
}

function verificarPontoEmZonas(lat: number, lng: number, zonas: any[]): any | null {
  for (const zona of zonas) {
    if (zona.polygon?.length >= 3 && pointInPolygon(lat, lng, zona.polygon)) return zona
    if (zona.lat && zona.lng && zona.radius && haversineM(lat, lng, zona.lat, zona.lng) < zona.radius) return zona
  }
  return null
}

function checkZonasNaRota(coords: [number, number][], zonas: any[], hour: number): ZoneHit[] {
  const hits: ZoneHit[] = []
  // Combine static ALL_ZONES check + Firestore zones
  for (let i = 0; i < coords.length; i += 3) {
    const [lng, lat] = coords[i]
    for (const zona of zonas) {
      if (hits.find(h => h.id === zona.id)) continue
      let inside = false
      if (zona.polygon?.length >= 3) inside = pointInPolygon(lat, lng, zona.polygon)
      else if (zona.lat && zona.lng && zona.radius) inside = haversineM(lat, lng, zona.lat, zona.lng) < zona.radius
      if (inside) {
        const level: ZoneHit['riskLevel'] = zona.riskLevel ?? 'medium'
        hits.push({
          id: zona.id, name: zona.areaName ?? zona.id, zone: zona.areaName ?? '',
          city: zona.city ?? 'dublin', country: 'ie',
          lat: zona.lat ?? 0, lng: zona.lng ?? 0, radius: zona.radius ?? 200,
          riskLevel: level, actualLevel: level,
          isPicoAgora: (zona.peakHours ?? []).includes(hour),
        })
      }
    }
    // Also check static ALL_ZONES
    for (const zone of ALL_ZONES) {
      if (hits.find(h => h.id === zone.id)) continue
      const actualLevel = getRiskLevelActual(zone, hour)
      if (actualLevel !== 'high' && actualLevel !== 'critical') continue
      const isPeak = zone.peakHours?.includes(hour) ?? false
      if (haversineM(lat, lng, zone.lat, zone.lng) < (isPeak ? zone.radius * 1.2 : zone.radius)) {
        hits.push({ ...zone, actualLevel, isPicoAgora: isPeak })
      }
    }
  }
  return hits
}

// ── Safe route calculation ────────────────────────────────────────────────────

async function fetchSafeRoute(
  origin: { lat: number; lng: number },
  dest: { lat: number; lng: number },
  zones: ZoneHit[],
  profile: string
): Promise<any | null> {
  const token = process.env.NEXT_PUBLIC_MAPBOX_TOKEN
  const dLat = dest.lat - origin.lat
  const dLng = dest.lng - origin.lng
  const bearingRota = Math.atan2(dLng, dLat) * 180 / Math.PI

  const waypoints = zones.slice(0, 5).map(zona => {
    const desvioDist = (zona.radius * 1.6) / 111320
    const bearing = ((bearingRota + 90) * Math.PI) / 180
    const wpLat = zona.lat + desvioDist * Math.cos(bearing)
    const wpLng = zona.lng + desvioDist * Math.sin(bearing)
    return `${wpLng},${wpLat}`
  })

  const coordsStr = [
    `${origin.lng},${origin.lat}`,
    ...waypoints,
    `${dest.lng},${dest.lat}`,
  ].join(';')

  try {
    const url =
      `https://api.mapbox.com/directions/v5/mapbox/${profile}/${coordsStr}` +
      `?alternatives=false&steps=true&geometries=geojson&overview=full` +
      `&voice_instructions=true&banner_instructions=true` +
      `&annotations=congestion,duration,distance&access_token=${token}`
    const res = await fetch(url)
    const data = await res.json()
    return data.routes?.[0] ?? null
  } catch {
    return null
  }
}

// ── Route utils ──────────────────────────────────────────────────────────────

async function fetchRoutes(
  origin: { lat: number; lng: number },
  dest: { lat: number; lng: number },
  profile: string
): Promise<any[]> {
  const token = process.env.NEXT_PUBLIC_MAPBOX_TOKEN
  const url =
    `https://api.mapbox.com/directions/v5/mapbox/${profile}` +
    `/${origin.lng},${origin.lat};${dest.lng},${dest.lat}` +
    `?alternatives=true&steps=true&geometries=geojson&overview=full` +
    `&voice_instructions=true&banner_instructions=true&annotations=congestion,duration,distance&access_token=${token}`
  try {
    const res = await fetch(url)
    const data = await res.json()
    return data.routes ?? []
  } catch { return [] }
}

function fmtEta(s: number) { return Math.ceil(s / 60) }
function fmtDist(m: number) { return m >= 1000 ? `${(m / 1000).toFixed(1)} km` : `${Math.round(m)} m` }
function fmtArrival(s: number) {
  return new Date(Date.now() + s * 1000).toLocaleTimeString('pt-PT', { hour: '2-digit', minute: '2-digit' })
}
function getRouteName(route: any): string {
  const steps: any[] = route.legs?.[0]?.steps ?? []
  let best = { name: '', dist: 0 }
  for (const step of steps) {
    if (step.name && step.distance > best.dist) best = { name: step.name, dist: step.distance }
  }
  return best.name
}
function hasCongestion(route: any): boolean {
  const cong: string[] = route.legs?.[0]?.annotation?.congestion ?? []
  if (cong.length === 0) return false
  return cong.filter(c => c === 'heavy' || c === 'severe').length / cong.length > 0.1
}

const ACTIVE_TABS: Array<{ key: ModeKey; icon: string; label: string; profile: string }> = [
  { key: 'car',     icon: '🚗', label: 'Carro/Moto', profile: 'driving-traffic' },
  { key: 'cycling', icon: '🚲', label: 'Bike',        profile: 'cycling' },
  { key: 'walking', icon: '🚶', label: 'A pé',        profile: 'walking' },
]

// ── Props ─────────────────────────────────────────────────────────────────────

interface Props {
  destination: { lat: number; lng: number }
  origin: { lat: number; lng: number }
  onConfirm: (profile: string, modeKey: ModeKey, route?: any) => void
  onClose: () => void
  onRoutesLoaded?: (routes: any[]) => void
  selectedRouteIdx?: number
  onRouteSelected?: (idx: number) => void
  onSafeRouteReady?: (safeRoute: any | null, zones: ZoneHit[]) => void
}

// ── Component ─────────────────────────────────────────────────────────────────

export default function TransportModeSelector({
  destination, origin, onConfirm, onClose,
  onRoutesLoaded, onRouteSelected, onSafeRouteReady,
}: Props) {
  const [selectedMode, setSelectedMode] = useState<ModeKey>(getSavedMode)
  const [routesByMode, setRoutesByMode] = useState<Partial<Record<ModeKey, any[]>>>({})
  const [loadingModes, setLoadingModes] = useState<string[]>(['car', 'cycling', 'walking'])
  const [localIdx, setLocalIdx] = useState(0)

  // Route zone analysis state
  const [zonesOnRoute, setZonesOnRoute] = useState<ZoneHit[]>([])
  const [safeRoute, setSafeRoute] = useState<any | null>(null)
  const [safeRouteLoading, setSafeRouteLoading] = useState(false)
  const [routeChoice, setRouteChoice] = useState<'safe' | 'fast'>('safe')
  type TipoAnalise = 'loading' | 'sem_zonas' | 'destino_em_zona' | 'tem_rota_segura' | 'todas_passam_por_zona'
  const [tipoAnalise, setTipoAnalise] = useState<TipoAnalise>('loading')
  const [destZonaInfo, setDestZonaInfo] = useState<any | null>(null)

  // Panel height: 3 states — normal (45vh default), expanded (80vh), minimized (72px)
  const [heightState, setHeightState] = useState<'normal' | 'expanded' | 'minimized'>('normal')
  const dragStartYRef = useRef<number | null>(null)
  const dragDeltaRef = useRef(0)

  const originRef = useRef(origin)
  const destinationRef = useRef(destination)
  const onRoutesLoadedRef = useRef(onRoutesLoaded)
  const onRouteSelectedRef = useRef(onRouteSelected)
  const onSafeRouteReadyRef = useRef(onSafeRouteReady)
  onRoutesLoadedRef.current = onRoutesLoaded
  onRouteSelectedRef.current = onRouteSelected
  onSafeRouteReadyRef.current = onSafeRouteReady

  const prevNotifiedMode = useRef<ModeKey | null>(null)
  // Tracks which mode's zone check we've run to avoid double-running
  const zoneCheckedModeRef = useRef<string | null>(null)

  // Fetch all modes in parallel on mount
  useEffect(() => {
    const org = originRef.current
    const dest = destinationRef.current
    ACTIVE_TABS.forEach(async ({ key, profile }) => {
      try {
        const routes = await fetchRoutes(org, dest, profile)
        setRoutesByMode(prev => ({ ...prev, [key]: routes }))
      } catch {
        setRoutesByMode(prev => ({ ...prev, [key]: [] }))
      } finally {
        setLoadingModes(prev => prev.filter(k => k !== key))
      }
    })
  }, [])

  // Notify MapView when selected mode routes change
  useEffect(() => {
    const routes = routesByMode[selectedMode]
    if (!routes) return
    if (prevNotifiedMode.current === selectedMode) return
    prevNotifiedMode.current = selectedMode
    setLocalIdx(0)
    onRoutesLoadedRef.current?.(routes)
    if (routes.length > 0) onRouteSelectedRef.current?.(0)
  }, [routesByMode, selectedMode])

  // Zone analysis — correct 4-case logic using ALL routes, not just routes[0]
  useEffect(() => {
    const routes = routesByMode[selectedMode]
    if (!routes || routes.length === 0) return
    const modeKey = `${selectedMode}`
    if (zoneCheckedModeRef.current === modeKey) return
    zoneCheckedModeRef.current = modeKey

    const hour = new Date().getHours()
    const dest = destinationRef.current
    const org = originRef.current

    setTipoAnalise('loading')
    setSafeRouteLoading(true)

    fetchAllFirestoreZonas().then(async fsZonas => {
      // ── Case 1: Is the destination itself inside a zone?
      const zonaDestino = verificarPontoEmZonas(dest.lat, dest.lng, fsZonas)
      if (zonaDestino) {
        setDestZonaInfo(zonaDestino)
        setTipoAnalise('destino_em_zona')
        setZonesOnRoute([])
        setSafeRoute(null)
        setSafeRouteLoading(false)
        onSafeRouteReadyRef.current?.(null, [])
        return
      }

      // ── Check zones in EVERY returned route
      const routesAnalysed = routes.map((r: any) => ({
        route: r,
        zones: checkZonasNaRota(r.geometry.coordinates, fsZonas, hour),
      }))

      const routesSemZona = routesAnalysed.filter((r: any) => r.zones.length === 0)
      const routesComZona = routesAnalysed.filter((r: any) => r.zones.length > 0)

      // ── Case 3: No route has zones
      if (routesComZona.length === 0) {
        setTipoAnalise('sem_zonas')
        setZonesOnRoute([])
        setSafeRoute(null)
        setSafeRouteLoading(false)
        onSafeRouteReadyRef.current?.(null, [])
        return
      }

      // ── Case 2: At least one returned route is already zone-free
      if (routesSemZona.length > 0) {
        // Sort safe routes by duration — pick fastest
        const bestSafe = routesSemZona.sort((a: any, b: any) => a.route.duration - b.route.duration)[0].route
        // Pick fastest route with zones as the "fast" option
        const fastWithZone = routesComZona.sort((a: any, b: any) => a.route.duration - b.route.duration)[0]
        const allZones = fastWithZone.zones as ZoneHit[]
        setZonesOnRoute(allZones)
        setSafeRoute(bestSafe)
        setRouteChoice('safe')
        setTipoAnalise('tem_rota_segura')
        setSafeRouteLoading(false)
        onSafeRouteReadyRef.current?.(bestSafe, allZones)
        return
      }

      // ── All returned routes have zones — try fetchSafeRoute with waypoints
      const allZones = routesComZona[0].zones as ZoneHit[]
      setZonesOnRoute(allZones)

      try {
        const safe = await fetchSafeRoute(org, dest, allZones, getProfileForMode(selectedMode))
        if (safe) {
          // Verify that the waypoint-detoured route is ACTUALLY zone-free
          const safeZones = checkZonasNaRota(safe.geometry.coordinates, fsZonas, hour)
          if (safeZones.length === 0) {
            setSafeRoute(safe)
            setRouteChoice('safe')
            setTipoAnalise('tem_rota_segura')
            onSafeRouteReadyRef.current?.(safe, allZones)
          } else {
            // Even the detour has zones → Case 4
            setSafeRoute(null)
            setTipoAnalise('todas_passam_por_zona')
            onSafeRouteReadyRef.current?.(null, allZones)
          }
        } else {
          setSafeRoute(null)
          setTipoAnalise('todas_passam_por_zona')
          onSafeRouteReadyRef.current?.(null, allZones)
        }
      } catch {
        setSafeRoute(null)
        setTipoAnalise('todas_passam_por_zona')
        onSafeRouteReadyRef.current?.(null, allZones)
      } finally {
        setSafeRouteLoading(false)
      }
    })
  }, [routesByMode, selectedMode])

  const switchMode = (mode: ModeKey) => {
    if (mode === selectedMode) return
    prevNotifiedMode.current = null
    zoneCheckedModeRef.current = null
    setSelectedMode(mode)
    setLocalIdx(0)
    setZonesOnRoute([])
    setSafeRoute(null)
    setSafeRouteLoading(false)
    setRouteChoice('safe')
  }

  const pickRoute = (i: number) => {
    setLocalIdx(i)
    onRouteSelectedRef.current?.(i)
  }

  const confirm = () => {
    const routes = routesByMode[selectedMode] ?? []
    const usesSafe = zonesOnRoute.length > 0 && routeChoice === 'safe' && safeRoute
    const route = usesSafe ? safeRoute : routes[localIdx]
    if (!route) return
    localStorage.setItem('navMode', selectedMode)
    onConfirm(getProfileForMode(selectedMode), selectedMode, route)
  }

  const routes = routesByMode[selectedMode] ?? []
  const isLoading = loadingModes.includes(selectedMode)
  const fastRoute = routes[0]
  const hasZones = zonesOnRoute.length > 0

  const extraMinutos = safeRoute && fastRoute
    ? Math.max(0, Math.round((safeRoute.duration - fastRoute.duration) / 60))
    : 0

  const levelColor = (level: string) =>
    level === 'critical' ? '#7c3aed' : level === 'high' ? '#dc2626' : '#f97316'

  const handleDragStart = (e: React.TouchEvent) => {
    dragStartYRef.current = e.touches[0].clientY
    dragDeltaRef.current = 0
  }
  const handleDragMove = (e: React.TouchEvent) => {
    if (dragStartYRef.current === null) return
    dragDeltaRef.current = e.touches[0].clientY - dragStartYRef.current
  }
  const handleDragEnd = () => {
    const delta = dragDeltaRef.current
    if (delta > 100) {
      // Drag down → minimize
      setHeightState('minimized')
    } else if (delta < -80) {
      // Drag up → expand
      setHeightState('expanded')
    } else if (delta > 40 && heightState === 'expanded') {
      // Drag down from expanded → normal
      setHeightState('normal')
    }
    dragStartYRef.current = null
    dragDeltaRef.current = 0
  }

  const isMinimized = heightState === 'minimized'
  const currentMaxHeight =
    heightState === 'minimized' ? '72px' :
    heightState === 'expanded' ? '85vh' :
    '65vh'

  return (
    <div
      onClick={e => e.stopPropagation()}
      onTouchStart={handleDragStart}
      onTouchMove={handleDragMove}
      onTouchEnd={handleDragEnd}
      style={{
        position: 'fixed', bottom: 0, left: 0, right: 0, zIndex: 9999,
        background: 'var(--surface)',
        borderRadius: '16px 16px 0 0',
        boxShadow: '0 -4px 24px rgba(0,0,0,0.4)',
        display: 'flex', flexDirection: 'column',
        overflow: 'hidden',
        maxHeight: currentMaxHeight,
        transition: 'max-height 0.28s ease',
        animation: 'slideUp 0.22s ease-out',
      }}
    >
      {/* Drag handle + isMinimized hint */}
      <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', padding: '10px 16px 6px', cursor: 'grab', flexShrink: 0 }}
        onClick={() => isMinimized && setHeightState('normal')}>
        <div style={{ width: 36, height: 4, background: 'var(--border)', borderRadius: 2 }} />
        {isMinimized && (
          <span style={{ fontSize: 11, color: 'var(--muted)', marginTop: 6 }}>↑ Desliza para ver opções</span>
        )}
      </div>

      {/* Collapsible content — hidden when isMinimized */}
      {!isMinimized && (<>

      {/* Origin / Destination */}
      <div style={{ padding: '12px 16px 10px', borderBottom: '1px solid var(--border)', flexShrink: 0 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
          <div style={{ width: 10, height: 10, borderRadius: '50%', flexShrink: 0, background: '#4285f4', boxShadow: '0 0 0 2px rgba(66,133,244,0.25)' }} />
          <span style={{ fontSize: 14, color: 'var(--muted)', flex: 1 }}>A tua localização</span>
          <button onClick={onClose} style={{ background: 'none', border: 'none', color: 'var(--muted)', cursor: 'pointer', fontSize: 18, padding: '0 6px', lineHeight: 1 }}>✕</button>
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginTop: 8 }}>
          <div style={{ width: 10, height: 10, borderRadius: 2, flexShrink: 0, background: 'var(--accent)' }} />
          <span style={{ fontSize: 14, fontWeight: 600, color: 'var(--text)' }}>Destino selecionado</span>
        </div>
      </div>

      {/* Mode tabs */}
      <div style={{ display: 'flex', flexShrink: 0, borderBottom: '1px solid var(--border)' }}>
        {ACTIVE_TABS.map(tab => {
          const isSel = tab.key === selectedMode
          const tabRoutes = routesByMode[tab.key]
          const tabLoading = loadingModes.includes(tab.key)
          const tabLabel = tabLoading ? '…' : tabRoutes?.[0] ? `${fmtEta(tabRoutes[0].duration)} min` : '--'
          return (
            <button key={tab.key} onClick={() => switchMode(tab.key)} style={{
              flex: 1, padding: '12px 4px 8px', border: 'none', background: 'none',
              borderBottom: isSel ? '2px solid #4285f4' : '2px solid transparent',
              cursor: 'pointer', display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 4,
            }}>
              <span style={{ fontSize: 22 }}>{tab.icon}</span>
              <span style={{ fontSize: 11, fontWeight: 700, color: isSel ? '#4285f4' : 'var(--muted)' }}>{tabLabel}</span>
            </button>
          )
        })}
      </div>

      {/* Scrollable content */}
      <div style={{ flex: 1, overflowY: 'auto', WebkitOverflowScrolling: 'touch', padding: '12px 16px' } as React.CSSProperties}>

        {isLoading ? (
          <div style={{ padding: '28px 0', textAlign: 'center', color: 'var(--muted)', fontSize: 14 }}>
            A calcular rotas...
          </div>
        ) : routes.length === 0 ? (
          <div style={{ padding: '24px 0', textAlign: 'center', color: '#f87171', fontSize: 14 }}>
            Rota não disponível
          </div>

        ) : tipoAnalise === 'destino_em_zona' ? (
          // ── CASO 1: Destino está dentro de zona de risco ──────────────────────
          <>
            <div style={{
              background: 'rgba(230,81,0,0.15)', borderRadius: 12,
              padding: '14px 16px', fontSize: 13, color: '#e65100', fontWeight: 600, marginBottom: 14,
              border: '1px solid rgba(230,81,0,0.3)',
            }}>
              ⚠️ Destino em zona de atenção
            </div>
            <div style={{
              borderRadius: 14, padding: '14px 16px',
              border: '1px solid var(--border)',
              background: 'var(--card)',
            }}>
              <div style={{ fontSize: 14, fontWeight: 800, color: 'var(--text)', marginBottom: 8 }}>
                {fastRoute && `${fmtEta(fastRoute.duration)} min · ${fmtDist(fastRoute.distance)}`}
              </div>
              <div style={{ fontSize: 12, color: 'var(--muted)' }}>
                O teu destino está localizado numa zona de atenção. Procede com cuidado.
              </div>
            </div>
          </>

        ) : tipoAnalise === 'todas_passam_por_zona' ? (
          // ── CASO 3: Todas as rotas passam por zonas ───────────────────────────
          <>
            <div style={{
              background: 'rgba(230,81,0,0.15)', borderRadius: 12,
              padding: '14px 16px', fontSize: 13, color: '#e65100', fontWeight: 600, marginBottom: 14,
              border: '1px solid rgba(230,81,0,0.3)',
            }}>
              ⚠️ Todas as rotas passam por zona de atenção
            </div>
            <div style={{
              borderRadius: 14, padding: '14px 16px', marginBottom: 12,
              border: '1px solid var(--border)',
              background: 'var(--card)',
            }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 8 }}>
                <span style={{ fontSize: 17 }}>⚡</span>
                <span style={{ fontSize: 14, fontWeight: 800, color: 'var(--text)' }}>Rota mais curta</span>
              </div>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-end', marginBottom: 6 }}>
                <span style={{ fontSize: 26, fontWeight: 800, color: 'var(--text)', lineHeight: 1 }}>
                  {fastRoute && fmtEta(fastRoute.duration)} <span style={{ fontSize: 14, fontWeight: 500 }}>min</span>
                </span>
                <span style={{ fontSize: 13, color: 'var(--muted)' }}>{fastRoute && fmtDist(fastRoute.distance)}</span>
              </div>
              <div style={{ fontSize: 12, color: 'var(--muted)', marginBottom: 10 }}>
                {fastRoute && `Chega às ${fmtArrival(fastRoute.duration)}`}
              </div>
              <div style={{ background: 'rgba(230,81,0,0.1)', borderRadius: 8, padding: '8px 10px' }}>
                <div style={{ fontSize: 11, fontWeight: 700, color: '#e65100', marginBottom: 5 }}>
                  ⚠️ Passa por {zonesOnRoute.length} zona{zonesOnRoute.length !== 1 ? 's' : ''} de atenção
                </div>
                {zonesOnRoute.map((zona, i) => (
                  <div key={zona.id} style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 12, color: 'var(--text)', marginTop: i > 0 ? 4 : 0 }}>
                    <span style={{ width: 8, height: 8, borderRadius: '50%', background: levelColor(zona.actualLevel), flexShrink: 0, display: 'inline-block' }} />
                    <span style={{ flex: 1 }}>{zona.name}</span>
                    {zona.isPicoAgora && <span style={{ fontSize: 10, color: levelColor(zona.actualLevel), fontWeight: 700 }}>hora de pico</span>}
                  </div>
                ))}
              </div>
            </div>
          </>

        ) : hasZones && tipoAnalise === 'tem_rota_segura' ? (
          // ── CASO 2: Tem rota segura e rota com zonas ──────────────────────────
          <>
            {/* SAFE ROUTE CARD */}
            <div
              onClick={() => !safeRouteLoading && safeRoute && setRouteChoice('safe')}
              style={{
                borderRadius: 14, padding: '14px 16px', marginBottom: 12,
                border: routeChoice === 'safe' ? '2px solid #1a6b4a' : '1px solid var(--border)',
                background: routeChoice === 'safe' ? 'rgba(26,107,74,0.08)' : 'var(--card)',
                cursor: safeRoute && !safeRouteLoading ? 'pointer' : 'default',
                position: 'relative',
              }}
            >
              {/* RECOMENDADA badge */}
              <div style={{
                position: 'absolute', top: 0, right: 14,
                background: '#1a6b4a', color: 'white', fontSize: 9, fontWeight: 800,
                padding: '3px 10px', borderRadius: '0 0 8px 8px', letterSpacing: 0.7,
              }}>
                RECOMENDADA
              </div>

              <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 8 }}>
                <span style={{ fontSize: 17 }}>🛡️</span>
                <span style={{ fontSize: 14, fontWeight: 800, color: '#1a6b4a' }}>Rota segura</span>
                {routeChoice === 'safe' && <span style={{ marginLeft: 'auto', fontSize: 14, color: '#1a6b4a' }}>✓</span>}
              </div>

              {safeRouteLoading ? (
                <div style={{ display: 'flex', alignItems: 'center', gap: 8, color: 'var(--muted)', fontSize: 13 }}>
                  <div style={{ width: 14, height: 14, borderRadius: '50%', border: '2px solid #1a6b4a', borderTopColor: 'transparent', animation: 'spin 0.7s linear infinite' }} />
                  A calcular rota segura...
                </div>
              ) : safeRoute ? (
                <>
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-end', marginBottom: 6 }}>
                    <span style={{ fontSize: 26, fontWeight: 800, color: '#1a6b4a', lineHeight: 1 }}>
                      {fmtEta(safeRoute.duration)} <span style={{ fontSize: 14, fontWeight: 500 }}>min</span>
                    </span>
                    <span style={{ fontSize: 13, color: 'var(--muted)' }}>{fmtDist(safeRoute.distance)}</span>
                  </div>
                  <div style={{ fontSize: 12, color: 'var(--muted)', marginBottom: 8 }}>
                    Chega às {fmtArrival(safeRoute.duration)}
                    {extraMinutos > 0 && <span style={{ color: '#1a6b4a', fontWeight: 600 }}> · +{extraMinutos} min</span>}
                  </div>
                  <div style={{ background: 'rgba(26,107,74,0.12)', borderRadius: 8, padding: '7px 10px', fontSize: 12, color: '#1a6b4a', fontWeight: 600 }}>
                    ✓ Sem zonas de atenção no percurso
                  </div>
                </>
              ) : (
                <div style={{ fontSize: 12, color: 'var(--muted)' }}>Não foi possível calcular rota segura</div>
              )}
            </div>

            {/* FAST ROUTE CARD */}
            {fastRoute && (
              <div
                onClick={() => setRouteChoice('fast')}
                style={{
                  borderRadius: 14, padding: '14px 16px', marginBottom: 12,
                  border: routeChoice === 'fast' ? '2px solid #e65100' : '1px solid var(--border)',
                  background: routeChoice === 'fast' ? 'rgba(230,81,0,0.07)' : 'var(--card)',
                  cursor: 'pointer',
                }}
              >
                <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 8 }}>
                  <span style={{ fontSize: 17 }}>⚡</span>
                  <span style={{ fontSize: 14, fontWeight: 800, color: '#e65100' }}>Rota rápida</span>
                  {routeChoice === 'fast' && <span style={{ marginLeft: 'auto', fontSize: 14, color: '#e65100' }}>✓</span>}
                </div>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-end', marginBottom: 6 }}>
                  <span style={{ fontSize: 26, fontWeight: 800, color: '#e65100', lineHeight: 1 }}>
                    {fmtEta(fastRoute.duration)} <span style={{ fontSize: 14, fontWeight: 500 }}>min</span>
                  </span>
                  <span style={{ fontSize: 13, color: 'var(--muted)' }}>{fmtDist(fastRoute.distance)}</span>
                </div>
                <div style={{ fontSize: 12, color: 'var(--muted)', marginBottom: 8 }}>
                  Chega às {fmtArrival(fastRoute.duration)}
                </div>
                {/* Zones list */}
                <div style={{ background: 'rgba(230,81,0,0.1)', borderRadius: 8, padding: '8px 10px' }}>
                  <div style={{ fontSize: 11, fontWeight: 700, color: '#e65100', marginBottom: 5 }}>
                    ⚠️ Passa por {zonesOnRoute.length} zona{zonesOnRoute.length !== 1 ? 's' : ''} de atenção
                  </div>
                  {zonesOnRoute.map((zona, i) => (
                    <div key={zona.id} style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 12, color: 'var(--text)', marginTop: i > 0 ? 4 : 0 }}>
                      <span style={{ width: 8, height: 8, borderRadius: '50%', background: levelColor(zona.actualLevel), flexShrink: 0, display: 'inline-block' }} />
                      <span style={{ flex: 1 }}>{zona.name}</span>
                      {zona.isPicoAgora && <span style={{ fontSize: 10, color: levelColor(zona.actualLevel), fontWeight: 700 }}>hora de pico</span>}
                    </div>
                  ))}
                </div>
              </div>
            )}
          </>

        ) : tipoAnalise === 'sem_zonas' || !hasZones ? (
          // ── CASO 4: Sem zonas no percurso ─────────────────────────────────────
          <>
            <div style={{
              background: 'rgba(26,107,74,0.1)', borderRadius: 10,
              padding: '8px 12px', fontSize: 12, color: '#1a6b4a', fontWeight: 600, marginBottom: 10,
            }}>
              ✓ Sem zonas de atenção
            </div>
            {routes.map((route, i) => {
              const isSel = i === localIdx
              const heavy = hasCongestion(route)
              const name = getRouteName(route)
              const timeColor = heavy ? '#e65100' : '#1a73e8'
              return (
                <div key={i} onClick={() => pickRoute(i)} style={{
                  padding: '14px 0', borderBottom: i < routes.length - 1 ? '1px solid var(--border)' : 'none',
                  cursor: 'pointer', display: 'flex', gap: 14, alignItems: 'flex-start',
                  background: isSel ? 'rgba(66,133,244,0.07)' : 'transparent',
                  borderRadius: isSel ? 8 : 0,
                }}>
                  <div style={{ minWidth: 54, flexShrink: 0, paddingTop: 2 }}>
                    <span style={{ fontSize: 28, fontWeight: 800, lineHeight: 1, color: isSel ? timeColor : 'var(--muted)' }}>{fmtEta(route.duration)}</span>
                    <span style={{ fontSize: 12, color: 'var(--muted)', marginLeft: 2 }}>min</span>
                  </div>
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ fontSize: 13, color: isSel ? 'var(--text)' : 'var(--muted)', fontWeight: isSel ? 500 : 400, marginBottom: 3 }}>
                      Chega às {fmtArrival(route.duration)}{heavy ? ' · ⚠️ Trânsito' : ''}
                    </div>
                    <div style={{ fontSize: 13, color: 'var(--muted)' }}>
                      {fmtDist(route.distance)}{name ? ` · Via ${name}` : ''}
                    </div>
                    {i === 0 && (
                      <span style={{ display: 'inline-block', marginTop: 5, background: 'rgba(66,133,244,0.12)', color: '#4285f4', fontSize: 11, fontWeight: 700, padding: '2px 8px', borderRadius: 10 }}>
                        Mais rápido
                      </span>
                    )}
                  </div>
                </div>
              )
            })}
          </>
        ) : (
          // Fallback — loading state
          <div style={{ padding: '28px 0', textAlign: 'center', color: 'var(--muted)', fontSize: 14 }}>
            A preparar rotas...
          </div>
        )}
      </div>

      </>)} {/* end !isMinimized */}

      {/* Footer — always visible */}
      <div style={{
        flexShrink: 0, padding: '12px 16px',
        paddingBottom: 'calc(12px + env(safe-area-inset-bottom, 0px))',
        borderTop: '1px solid var(--border)',
        display: 'flex', flexDirection: 'column', gap: 8,
        background: 'var(--surface)',
      }}>
        {tipoAnalise === 'tem_rota_segura' && hasZones ? (
          // Buttons for CASO 2: safe route available
          <>
            <button
              onClick={confirm}
              disabled={routeChoice === 'safe' ? (!safeRoute || safeRouteLoading) : !fastRoute}
              style={{
                width: '100%', padding: '14px 0',
                background: routeChoice === 'safe'
                  ? (safeRoute && !safeRouteLoading ? '#1a6b4a' : '#374151')
                  : '#e65100',
                border: 'none', borderRadius: 12, color: 'white',
                fontWeight: 800, fontSize: 16, cursor: 'pointer',
                display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 8, minHeight: 50,
              }}
            >
              {routeChoice === 'safe' ? (
                safeRouteLoading ? 'A calcular…' : '🛡️ Usar rota segura'
              ) : (
                '⚡ Usar rota rápida'
              )}
            </button>
            <button
              onClick={() => setRouteChoice(c => c === 'safe' ? 'fast' : 'safe')}
              disabled={safeRouteLoading || !safeRoute}
              style={{
                width: '100%', padding: '10px 0',
                background: 'none', border: '1px solid var(--border)',
                borderRadius: 10, fontSize: 13, color: 'var(--muted)', cursor: 'pointer',
              }}
            >
              {routeChoice === 'safe'
                ? `⚡ Ver rota rápida${extraMinutos > 0 ? ` (−${extraMinutos} min)` : ''}`
                : `🛡️ Ver rota segura${extraMinutos > 0 ? ` (+${extraMinutos} min)` : ''}`}
            </button>
          </>
        ) : (
          // Single button for other cases (CASO 1, 3, 4)
          // CASO 1: Destino em zona
          // CASO 3: Todas as rotas passam por zona
          // CASO 4: Sem zonas
          <button
            onClick={confirm}
            disabled={routes.length === 0 || isLoading}
            style={{
              flex: 1, padding: '13px 0',
              background: (routes.length > 0 && !isLoading) ? '#1a6b4a' : '#374151',
              border: 'none', borderRadius: 10, color: 'white',
              fontWeight: 800, fontSize: 16,
              cursor: (routes.length > 0 && !isLoading) ? 'pointer' : 'not-allowed',
              display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 8, minHeight: 48,
            }}
          >
            <span style={{ fontSize: 14 }}>▲</span> Iniciar
          </button>
        )}
        <button style={{ background: 'none', border: 'none', fontSize: 12, color: 'var(--muted)', cursor: 'pointer', padding: '2px 0' }}>
          Sair mais tarde
        </button>
      </div>
    </div>
  )
}
