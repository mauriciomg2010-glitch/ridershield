'use client'
import { useEffect, useState, useRef } from 'react'
import { fetchMapboxRoutes, findSafeRoute } from '@/lib/navigation/routing'
import { habitualTrace, viasFromTrace, overlap } from '@/lib/navigation/habits'
import { loadAvoidZones, toZoneHit } from '@/lib/navigation/zoneSource'
import { zonesOnRoute as zonesHitByRoute, pointInZone } from '@/lib/navigation/zones'
import { zoneSpansOnRoute } from '@/lib/navigation/zoneAlert'

export const TRANSPORT_MODES = [
  { key: 'car',     label: 'Carro / Moto', icon: '🏍️', profile: 'driving-traffic' },
  { key: 'cycling', label: 'Bicicleta',    icon: '🚲', profile: 'cycling' },
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

// ── Zone checking ─────────────────────────────────────────────────────────────
// Verificação de zonas e rota segura agora ficam em src/lib/navigation (zones.ts / routing.ts)

export interface ZoneHit {
  id: string; name: string; zone: string; city: string; country: string
  lat: number; lng: number; radius: number
  riskLevel: 'low' | 'medium' | 'high' | 'critical'
  actualLevel: 'low' | 'medium' | 'high' | 'critical'
  isPicoAgora: boolean
}

// ── Route utils ──────────────────────────────────────────────────────────────

async function fetchRoutes(
  origin: { lat: number; lng: number },
  dest: { lat: number; lng: number },
  profile: string
): Promise<any[]> {
  // pt-BR (antes vinha sem idioma → instruções em inglês no painel da navegação)
  let routes: any[] = []
  try { routes = await fetchMapboxRoutes(origin, dest, profile, { alternatives: true }) }
  catch { return [] }
  // Caminho habitual do rider (aprendido no aparelho): vira a 1ª opção se não for muito mais lento
  try {
    const trace = habitualTrace([origin.lng, origin.lat], [dest.lng, dest.lat], profile)
    if (trace && routes.length) {
      const [hab] = await fetchMapboxRoutes(origin, dest, profile, { vias: viasFromTrace(trace) })
      const fastest = Math.min(...routes.map(r => r.duration ?? Infinity))
      if (hab && overlap(trace, hab.geometry.coordinates, 50) >= 0.75 && hab.duration <= fastest * 1.25) {
        routes = [{ ...hab, _habitual: true }, ...routes]
      }
    }
  } catch { /* sem caminho habitual: segue com as rotas normais */ }
  return routes
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
  { key: 'car',     icon: '🏍️', label: 'Carro / Moto', profile: 'driving-traffic' },
  { key: 'cycling', icon: '🚲', label: 'Bicicleta',    profile: 'cycling' },
  { key: 'walking', icon: '🚶', label: 'A pé',         profile: 'walking' },
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
  // o rider já está DENTRO de uma zona (não dá para evitar — a navegação avisa à saída)
  const [origemZona, setOrigemZona] = useState<{ name: string; level: string } | null>(null)
  // metros da rota rápida dentro de zonas de risco (para mostrar ao rider)
  const [fastRiskMeters, setFastRiskMeters] = useState(0)

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

    // descarta o resultado se o usuário trocou de modo enquanto calculava
    const stale = () => zoneCheckedModeRef.current !== modeKey
    loadAvoidZones().then(async zones => {
      if (stale()) return
      const profile = getProfileForMode(selectedMode)
      const destInZone = zones.find(z => pointInZone([dest.lng, dest.lat], z)) ?? null
      const orgZone = zones.find(z => pointInZone([org.lng, org.lat], z)) ?? null
      setOrigemZona(orgZone ? { name: orgZone.name, level: orgZone.level } : null)

      // Zonas que cada rota atravessa (verificação por segmento, inclui trechos de rua e polígonos)
      const avoidable = zones.filter(z => z !== destInZone && !pointInZone([org.lng, org.lat], z))
      const analysed = routes.map((r: any) => ({ route: r, zones: zonesHitByRoute(r.geometry.coordinates, avoidable) }))
      const semZona = analysed.filter((a: any) => a.zones.length === 0)
        .sort((a: any, b: any) => (b.route._habitual ? 1 : 0) - (a.route._habitual ? 1 : 0) || a.route.duration - b.route.duration)
      const comZona = analysed.filter((a: any) => a.zones.length > 0).sort((a: any, b: any) => a.route.duration - b.route.duration)
      const fastZones = (comZona[0]?.zones ?? []).map(toZoneHit) as ZoneHit[]
      setFastRiskMeters(comZona[0]
        ? zoneSpansOnRoute(comZona[0].route.geometry.coordinates, comZona[0].zones).reduce((sum, sp) => sum + Math.max(0, sp.exit - sp.entry), 0)
        : 0)

      let safe: any | null = semZona[0]?.route ?? null
      if (!safe && comZona.length) {
        try {
          // Valhalla (exclui as zonas no servidor) → reserva: contorno pela borda
          const res = await findSafeRoute(org, dest, profile, zones, { baseRoutes: routes })
          safe = res.route
        } catch { safe = null }
      }
      if (stale()) return

      if (destInZone) {
        // ── Caso 1: destino dentro de zona — avisa, mas continua evitando as OUTRAS zonas do caminho
        setDestZonaInfo({ areaName: destInZone.name, riskLevel: destInZone.level })
        setTipoAnalise('destino_em_zona')
        setZonesOnRoute(fastZones)
        setSafeRoute(fastZones.length ? safe : null)
        setRouteChoice('safe')
        onSafeRouteReadyRef.current?.(fastZones.length ? safe : null, fastZones)
      } else if (!comZona.length) {
        // ── Caso 2: nenhuma rota passa por zona
        setTipoAnalise('sem_zonas')
        setZonesOnRoute([])
        setSafeRoute(null)
        onSafeRouteReadyRef.current?.(null, [])
      } else if (safe) {
        // ── Caso 3: existe rota segura
        setZonesOnRoute(fastZones)
        setSafeRoute(safe)
        setRouteChoice('safe')
        setTipoAnalise('tem_rota_segura')
        onSafeRouteReadyRef.current?.(safe, fastZones)
      } else {
        // ── Caso 4: impossível evitar
        setZonesOnRoute(fastZones)
        setSafeRoute(null)
        setTipoAnalise('todas_passam_por_zona')
        onSafeRouteReadyRef.current?.(null, fastZones)
      }
      setSafeRouteLoading(false)
    }).catch(() => {
      if (stale()) return
      setTipoAnalise('sem_zonas')
      setSafeRouteLoading(false)
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
  const extraKm = safeRoute && fastRoute ? (safeRoute.distance - fastRoute.distance) / 1000 : 0
  const zonasTxt = `${zonesOnRoute.length} zona${zonesOnRoute.length !== 1 ? 's' : ''}`

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
              <span style={{ fontSize: 11, fontWeight: 600, color: isSel ? '#1a73e8' : 'var(--muted)' }}>{tab.label}</span>
              <span style={{ fontSize: 12, fontWeight: 700, color: isSel ? '#1a73e8' : 'var(--muted)' }}>{tabLabel}</span>
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
                {(safeRoute ?? fastRoute) && `${fmtEta((safeRoute ?? fastRoute).duration)} min · ${fmtDist((safeRoute ?? fastRoute).distance)}`}
              </div>
              <div style={{ fontSize: 12, color: 'var(--muted)' }}>
                O teu destino está localizado numa zona de atenção{destZonaInfo?.areaName ? ` (${destZonaInfo.areaName})` : ''}. Procede com cuidado.
                {safeRoute && zonesOnRoute.length > 0 && ` 🛡️ A rota evita ${zonesOnRoute.length} zona${zonesOnRoute.length !== 1 ? 's' : ''} no caminho.`}
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
            {/* Comparação direta: quanto custa evitar as zonas */}
            {safeRoute && fastRoute && !safeRouteLoading && (
              <div style={{
                display: 'flex', alignItems: 'center', gap: 10, marginBottom: 12,
                background: 'var(--card)', border: '1px solid var(--border)', borderRadius: 12, padding: '10px 12px',
              }}>
                <span style={{ fontSize: 20 }}>⚖️</span>
                <div style={{ fontSize: 12, color: 'var(--text)', lineHeight: 1.4 }}>
                  A rota segura leva <b>{extraMinutos > 0 ? `+${extraMinutos} min` : 'o mesmo tempo'}</b>
                  {Math.abs(extraKm) >= 0.1 && <> e <b>{extraKm > 0 ? '+' : ''}{extraKm.toFixed(1).replace('.', ',')} km</b></>}
                  {' '}e evita <b>{zonasTxt}</b>
                  {fastRiskMeters >= 50 && <> ({fmtDist(fastRiskMeters)} dentro de zonas na rota rápida)</>}.
                </div>
              </div>
            )}
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
                    {origemZona ? `✓ Sem outras zonas (estás dentro de ${origemZona.name})` : '✓ Sem zonas de atenção no percurso'}
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
            {origemZona && (
              <div style={{ background: 'rgba(217,119,6,0.12)', borderRadius: 10, padding: '8px 12px', fontSize: 12, color: '#b45309', fontWeight: 600, marginBottom: 10 }}>
                📍 Estás dentro de uma zona de risco ({origemZona.name}). A rota leva-te para fora dela — a navegação avisa até saíres.
              </div>
            )}
            <div style={{
              background: 'rgba(26,107,74,0.1)', borderRadius: 10,
              padding: '8px 12px', fontSize: 12, color: '#1a6b4a', fontWeight: 600, marginBottom: 10,
            }}>
              {origemZona ? '✓ Sem outras zonas no percurso' : '✓ Sem zonas de atenção'}
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
                    {route._habitual ? (
                      <span style={{ display: 'inline-block', marginTop: 5, background: 'rgba(245,158,11,0.14)', color: '#d97706', fontSize: 11, fontWeight: 700, padding: '2px 8px', borderRadius: 10 }}>
                        ⭐ O teu caminho habitual
                      </span>
                    ) : route.duration === Math.min(...routes.map((r: any) => r.duration)) && (
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
            {routeChoice === 'fast' && (
              <div style={{ fontSize: 12, color: '#e65100', background: 'rgba(230,81,0,0.1)', borderRadius: 10, padding: '8px 10px', lineHeight: 1.4 }}>
                ⚠️ Esta rota passa por {zonasTxt} de atenção. O app vai ficar em <b>modo alerta</b> (aviso na tela e por voz) até você sair de todas elas — e você pode trocar para a rota segura a qualquer momento.
              </div>
            )}
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
