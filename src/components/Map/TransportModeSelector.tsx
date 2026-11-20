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
  const [detalhes, setDetalhes] = useState(false)

  // ── Estilo Google Maps: painel branco e baixo; o mapa é que mostra as rotas ──
  const C = { text: '#202124', muted: '#5f6368', line: '#e8eaed', blue: '#1a73e8', safe: '#188038', fast: '#e37400', warn: '#b06000' }
  const temEscolha = tipoAnalise === 'tem_rota_segura' && hasZones && !!safeRoute
  const usandoSegura = temEscolha ? routeChoice === 'safe' : !!(safeRoute && tipoAnalise === 'destino_em_zona')
  const rotaAtual = temEscolha ? (routeChoice === 'safe' ? safeRoute : fastRoute) : (tipoAnalise === 'destino_em_zona' ? (safeRoute ?? fastRoute) : routes[localIdx])
  const corTempo = temEscolha ? (routeChoice === 'safe' ? C.safe : C.fast) : (rotaAtual && hasCongestion(rotaAtual) ? '#d93025' : C.safe)
  const nomeVia = rotaAtual ? getRouteName(rotaAtual) : ''

  let linhaInfo: { txt: string; cor: string } | null = null
  if (tipoAnalise === 'loading' || safeRouteLoading) linhaInfo = { txt: 'A verificar zonas de risco…', cor: C.muted }
  else if (tipoAnalise === 'destino_em_zona') linhaInfo = { txt: `⚠️ Destino em zona de atenção${destZonaInfo?.areaName ? ` · ${destZonaInfo.areaName}` : ''}`, cor: C.warn }
  else if (tipoAnalise === 'todas_passam_por_zona') linhaInfo = { txt: `⚠️ Todas as rotas passam por zona de atenção (${zonasTxt})`, cor: C.warn }
  else if (temEscolha && routeChoice === 'safe') linhaInfo = { txt: `🛡️ Evita ${zonasTxt}${extraMinutos > 0 ? ` · +${extraMinutos} min` : ' · mesmo tempo'}`, cor: C.safe }
  else if (temEscolha) linhaInfo = { txt: `⚠️ Passa por ${zonasTxt}${fastRiskMeters >= 50 ? ` (${fmtDist(fastRiskMeters)} dentro)` : ''}`, cor: C.fast }
  else if (origemZona) linhaInfo = { txt: `📍 Estás dentro de ${origemZona.name} — a navegação avisa até saíres`, cor: C.warn }
  else if (tipoAnalise === 'sem_zonas') linhaInfo = { txt: '✓ Sem zonas de atenção', cor: C.safe }

  const podeIniciar = !isLoading && routes.length > 0 && !(temEscolha && routeChoice === 'safe' && safeRouteLoading)
  const corBotao = !podeIniciar ? '#9aa0a6' : temEscolha && routeChoice === 'fast' ? C.fast : '#0b6e63'

  return (
    <div
      onClick={e => e.stopPropagation()}
      onTouchStart={handleDragStart}
      onTouchMove={handleDragMove}
      onTouchEnd={handleDragEnd}
      style={{
        position: 'fixed', bottom: 0, left: 0, right: 0, zIndex: 9999,
        background: '#ffffff', color: C.text,
        borderRadius: '18px 18px 0 0',
        boxShadow: '0 -2px 14px rgba(0,0,0,0.22)',
        display: 'flex', flexDirection: 'column', overflow: 'hidden',
        maxHeight: isMinimized ? 64 : detalhes ? '70vh' : '46vh',
        transition: 'max-height 0.25s ease',
        animation: 'slideUp 0.22s ease-out',
      }}
    >
      {/* pega */}
      <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', padding: '8px 16px 2px', flexShrink: 0 }}
        onClick={() => isMinimized && setHeightState('normal')}>
        <div style={{ width: 36, height: 4, background: '#dadce0', borderRadius: 2 }} />
        {isMinimized && <span style={{ fontSize: 11, color: C.muted, marginTop: 6 }}>↑ Desliza para ver a rota</span>}
      </div>

      {!isMinimized && (<>
      {/* modos pequenos numa linha + fechar (como o Google: 🚗 11 min  🚲 16 min …) */}
      <div style={{ display: 'flex', alignItems: 'center', padding: '2px 8px 0 12px', borderBottom: `1px solid ${C.line}`, flexShrink: 0 }}>
        {ACTIVE_TABS.map(tab => {
          const sel = tab.key === selectedMode
          const tr = routesByMode[tab.key]
          const lbl = loadingModes.includes(tab.key) ? '…' : tr?.[0] ? `${fmtEta(tr[0].duration)} min` : '--'
          return (
            <button key={tab.key} onClick={() => switchMode(tab.key)} aria-label={tab.label} style={{
              display: 'flex', alignItems: 'center', gap: 5, padding: '9px 10px 8px', marginRight: 2,
              background: 'none', border: 'none', cursor: 'pointer',
              borderBottom: sel ? `3px solid ${C.blue}` : '3px solid transparent',
              color: sel ? C.blue : C.muted, fontWeight: sel ? 700 : 500, fontSize: 14,
            }}>
              <span style={{ fontSize: 16, filter: sel ? 'none' : 'grayscale(0.6)' }}>{tab.icon}</span>{lbl}
            </button>
          )
        })}
        <button onClick={onClose} aria-label="Fechar" style={{ marginLeft: 'auto', width: 34, height: 34, borderRadius: 17, border: 'none', background: '#f1f3f4', color: C.muted, fontSize: 16, cursor: 'pointer' }}>✕</button>
      </div>

      {/* resumo da rota */}
      <div style={{ flex: 1, overflowY: 'auto', WebkitOverflowScrolling: 'touch', padding: '10px 16px 4px' } as React.CSSProperties}>
        {isLoading ? (
          <div style={{ padding: '14px 0', color: C.muted, fontSize: 14 }}>A calcular rotas…</div>
        ) : routes.length === 0 ? (
          <div style={{ padding: '14px 0', color: '#d93025', fontSize: 14 }}>Rota não disponível</div>
        ) : (<>
          <div style={{ display: 'flex', alignItems: 'baseline', gap: 8 }}>
            <span style={{ fontSize: 24, fontWeight: 600, color: corTempo }}>{rotaAtual ? `${fmtEta(rotaAtual.duration)} min` : '--'}</span>
            <span style={{ fontSize: 16, color: C.muted }}>{rotaAtual ? `(${fmtDist(rotaAtual.distance)})` : ''}</span>
            <span style={{ marginLeft: 'auto', fontSize: 13, color: C.muted }}>{rotaAtual ? `Chega às ${fmtArrival(rotaAtual.duration)}` : ''}</span>
          </div>
          <div style={{ fontSize: 13, color: C.muted, marginTop: 2 }}>
            {usandoSegura ? 'Rota segura' : temEscolha ? 'Rota mais rápida' : rotaAtual?._habitual ? '⭐ O teu caminho habitual' : 'Rota mais rápida'}
            {nomeVia ? ` · via ${nomeVia}` : ''}
          </div>
          {linhaInfo && <div style={{ fontSize: 13, fontWeight: 600, color: linhaInfo.cor, marginTop: 5 }}>{linhaInfo.txt}</div>}

          {/* escolha segura / rápida em pastilhas pequenas */}
          {temEscolha && (
            <div style={{ display: 'flex', gap: 8, marginTop: 10 }}>
              {([['safe', '🛡️ Segura', safeRoute, C.safe], ['fast', '⚡ Rápida', fastRoute, C.fast]] as const).map(([k, lbl, r, cor]) => {
                const sel = routeChoice === k
                return (
                  <button key={k} onClick={() => setRouteChoice(k)} style={{
                    flex: 1, padding: '7px 0', borderRadius: 18, cursor: 'pointer', fontSize: 13, fontWeight: 700,
                    border: sel ? `2px solid ${cor}` : `1px solid ${C.line}`,
                    background: sel ? (k === 'safe' ? '#e6f4ea' : '#fef3e8') : '#fff', color: sel ? cor : C.muted,
                  }}>{lbl} · {r ? `${fmtEta(r.duration)} min` : '--'}</button>
                )
              })}
            </div>
          )}

          {/* sem zonas: alternativas em pastilhas (o mapa mostra-as) */}
          {!temEscolha && tipoAnalise !== 'destino_em_zona' && routes.length > 1 && (
            <div style={{ display: 'flex', gap: 8, marginTop: 10, overflowX: 'auto' }}>
              {routes.map((r: any, i: number) => (
                <button key={i} onClick={() => pickRoute(i)} style={{
                  padding: '6px 12px', borderRadius: 16, whiteSpace: 'nowrap', cursor: 'pointer', fontSize: 13, fontWeight: 600,
                  border: i === localIdx ? `2px solid ${C.blue}` : `1px solid ${C.line}`,
                  background: i === localIdx ? '#e8f0fe' : '#fff', color: i === localIdx ? C.blue : C.muted,
                }}>{fmtEta(r.duration)} min{r._habitual ? ' ⭐' : ''}</button>
              ))}
            </div>
          )}

          {/* detalhes só quando o rider quer */}
          {detalhes && (
            <div style={{ marginTop: 12, paddingTop: 10, borderTop: `1px solid ${C.line}`, fontSize: 13, color: C.text, lineHeight: 1.45 }}>
              {temEscolha && fastRoute && (
                <p style={{ margin: '0 0 8px' }}>
                  A rota segura leva <b>{extraMinutos > 0 ? `+${extraMinutos} min` : 'o mesmo tempo'}</b>
                  {Math.abs(extraKm) >= 0.1 && <> e <b>{extraKm > 0 ? '+' : ''}{extraKm.toFixed(1).replace('.', ',')} km</b></>} e evita <b>{zonasTxt}</b>
                  {fastRiskMeters >= 50 && <> ({fmtDist(fastRiskMeters)} dentro de zonas na rota rápida)</>}.
                </p>
              )}
              {zonesOnRoute.length > 0 && zonesOnRoute.map(z => (
                <div key={z.id} style={{ display: 'flex', alignItems: 'center', gap: 6, marginTop: 4 }}>
                  <span style={{ width: 8, height: 8, borderRadius: '50%', background: levelColor(z.actualLevel), display: 'inline-block' }} />
                  <span style={{ flex: 1 }}>{z.name}</span>
                  {z.isPicoAgora && <span style={{ fontSize: 11, color: levelColor(z.actualLevel), fontWeight: 700 }}>hora de pico</span>}
                </div>
              ))}
              {temEscolha && routeChoice === 'fast' && (
                <p style={{ margin: '8px 0 0', color: C.fast }}>Na rota rápida o ZIVO fica em modo alerta (ecrã e voz) até saíres das zonas, e podes trocar para a segura a qualquer momento.</p>
              )}
              {tipoAnalise === 'destino_em_zona' && (
                <p style={{ margin: '8px 0 0', color: C.warn }}>O destino fica numa zona de atenção. Procede com cuidado.</p>
              )}
            </div>
          )}
        </>)}
      </div>
      </>)}

      {/* botões, como no Google: [Iniciar] [Detalhes] */}
      <div style={{ flexShrink: 0, display: 'flex', gap: 10, padding: '8px 16px', paddingBottom: 'calc(10px + env(safe-area-inset-bottom, 0px))' }}>
        <button onClick={confirm} disabled={!podeIniciar} style={{
          display: 'flex', alignItems: 'center', gap: 8, padding: '11px 22px', borderRadius: 24, border: 'none',
          background: corBotao, color: '#fff', fontWeight: 700, fontSize: 16, cursor: podeIniciar ? 'pointer' : 'not-allowed',
        }}>
          <span style={{ fontSize: 13 }}>▲</span> Iniciar
        </button>
        {!isMinimized && routes.length > 0 && (hasZones || tipoAnalise === 'destino_em_zona' || tipoAnalise === 'todas_passam_por_zona') && (
          <button onClick={() => setDetalhes(d => !d)} style={{
            padding: '11px 18px', borderRadius: 24, border: 'none', background: '#e8f0fe', color: '#0b57d0', fontWeight: 600, fontSize: 15, cursor: 'pointer',
          }}>
            {detalhes ? 'Menos' : 'Detalhes'}
          </button>
        )}
      </div>
    </div>
  )
}
