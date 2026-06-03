'use client'
import { useState, useRef, useCallback, useEffect } from 'react'
import Map, { Source, Layer, Marker } from 'react-map-gl/mapbox'
import 'mapbox-gl/dist/mapbox-gl.css'
import {
  collection, getDocs, setDoc, deleteDoc, doc,
  serverTimestamp, query, orderBy, onSnapshot,
} from 'firebase/firestore'
import { db, auth } from '@/lib/firebase'

type EditorMode = null | 'point' | 'polygon' | 'segment'
type RiskLevel = 'low' | 'medium' | 'high' | 'critical'

interface PendingZone {
  type: 'point' | 'polygon' | 'segment'
  lat: number; lng: number
  radius: number
  name: string
  riskLevel: RiskLevel
  peakHours: number[]
  notes: string
  coordinates?: number[][]
  geometry?: any
  segmentName?: string
}

interface SavedZone {
  zoneId: string; docRef: any
  areaName: string; riskLevel: RiskLevel
  lat: number; lng: number; radius?: number
  zoneType: string; createdAt?: Date; createdBy?: string
  polygon?: any[] | null
  geometry?: { type: string; coordinates: any[] } | null
}

const LEVEL_COLOR: Record<RiskLevel, string> = {
  low: '#eab308', medium: '#f97316', high: '#ef4444', critical: '#7c3aed',
}

// Firestore does not support nested arrays.
// Converts [[lng, lat], ...] → [{lng, lat}, ...] for storage.
function coordsToObjects(coords: number[][]): { lng: number; lat: number }[] {
  return coords.map(c => ({ lng: c[0], lat: c[1] }))
}

// Converts [{lng, lat}, ...] back to [[lng, lat], ...] for GeoJSON rendering.
function coordsToArrays(coords: any[]): number[][] {
  return coords.map(c => Array.isArray(c) ? c : [c.lng, c.lat])
}

async function reverseGeocode(lat: number, lng: number): Promise<string> {
  const token = process.env.NEXT_PUBLIC_MAPBOX_TOKEN
  try {
    const res = await fetch(`https://api.mapbox.com/geocoding/v5/mapbox.places/${lng},${lat}.json?types=neighborhood,locality,place&access_token=${token}`)
    const data = await res.json()
    return data.features?.[0]?.text ?? `${lat.toFixed(4)}, ${lng.toFixed(4)}`
  } catch { return `${lat.toFixed(4)}, ${lng.toFixed(4)}` }
}

async function snapSegmentToRoad(lng: number, lat: number): Promise<{ geometry: any; name: string } | null> {
  const token = process.env.NEXT_PUBLIC_MAPBOX_TOKEN
  for (const raio of [25, 50, 100, 200]) {
    try {
      const url = `https://api.mapbox.com/matching/v5/mapbox/driving/${lng},${lat}?geometries=geojson&radiuses=${raio}&access_token=${token}`
      const res = await fetch(url)
      const data = await res.json()
      if (data.matchings?.[0]?.geometry) {
        return { geometry: data.matchings[0].geometry, name: data.tracepoints?.[0]?.name ?? 'Segmento' }
      }
    } catch { continue }
  }
  return null
}

function canEditZone(zone: SavedZone, currentUid: string, isSuperAdmin: boolean): boolean {
  if (isSuperAdmin) return true
  if (!zone.createdBy || zone.createdBy !== currentUid) return false
  if (!zone.createdAt) return false
  const ageMs = Date.now() - zone.createdAt.getTime()
  return ageMs <= 48 * 60 * 60 * 1000
}

export default function ZoneEditor({ onToast, isSuperAdmin = false, currentUid = '' }: { onToast: (msg: string) => void; isSuperAdmin?: boolean; currentUid?: string }) {
  const mapRef = useRef<any>(null)
  const [mode, setMode] = useState<EditorMode>(null)
  const [polyPoints, setPolyPoints] = useState<number[][]>([])
  const polyPointsRef = useRef<number[][]>([])   // ref avoids stale closure in fecharPoligono
  const [pending, setPending] = useState<PendingZone | null>(null)
  const [pendingState, setPendingState] = useState<PendingZone | null>(null)
  const [savedZones, setSavedZones] = useState<SavedZone[]>([])
  const [loadingSave, setLoadingSave] = useState(false)
  const [fullscreen, setFullscreen] = useState(false)
  const mapKey = fullscreen ? 'fullscreen' : 'normal'

  // Load saved zones
  useEffect(() => {
    const unsub = onSnapshot(
      query(collection(db, 'risk_zones'), orderBy('createdAt', 'desc')),
      snap => setSavedZones(snap.docs.map(d => ({
        zoneId: d.id, docRef: d.ref,
        areaName: d.data().areaName ?? d.id,
        riskLevel: d.data().riskLevel ?? 'medium',
        lat: d.data().lat ?? 0, lng: d.data().lng ?? 0,
        radius: d.data().radius ?? 200,
        zoneType: d.data().zoneType ?? 'manual',
        createdAt: d.data().createdAt?.toDate(),
        createdBy: d.data().createdBy ?? '',
        polygon: d.data().polygon ?? null,
        geometry: d.data().geometry ?? null,
      })))
    )
    return unsub
  }, [])

  const handleMapClick = useCallback(async (e: any) => {
    const { lng, lat } = e.lngLat
    if (mode === 'point') {
      const name = await reverseGeocode(lat, lng)
      setPending({ type: 'point', lat, lng, radius: 200, name, riskLevel: 'medium', peakHours: [20,21,22,23,0,1], notes: '' })
      setPendingState({ type: 'point', lat, lng, radius: 200, name, riskLevel: 'medium', peakHours: [20,21,22,23,0,1], notes: '' })
    } else if (mode === 'polygon') {
      const newPts = [...polyPointsRef.current, [lng, lat]]
      polyPointsRef.current = newPts
      setPolyPoints([...newPts])
    } else if (mode === 'segment') {
      const result = await snapSegmentToRoad(lng, lat)
      if (result) {
        const coords: number[][] = result.geometry.coordinates
        const centLat = coords.reduce((s, c) => s + c[1], 0) / coords.length
        const centLng = coords.reduce((s, c) => s + c[0], 0) / coords.length
        setPending({ type: 'segment', lat: centLat, lng: centLng, radius: 50, name: result.name, riskLevel: 'high', peakHours: [20,21,22,23,0,1], notes: '', geometry: result.geometry, segmentName: result.name })
        setPendingState({ type: 'segment', lat: centLat, lng: centLng, radius: 50, name: result.name, riskLevel: 'high', peakHours: [20,21,22,23,0,1], notes: '', geometry: result.geometry, segmentName: result.name })
      } else {
        onToast('Faz mais zoom e toca diretamente em cima de uma rua.')
      }
    }
  }, [mode, onToast])

  const fecharPoligono = () => {
    const pts = polyPointsRef.current
    if (pts.length < 3) { onToast('Precisa de pelo menos 3 pontos para criar uma área'); return }
    const closed = [...pts, pts[0]]
    const centLat = pts.reduce((s, c) => s + c[1], 0) / pts.length
    const centLng = pts.reduce((s, c) => s + c[0], 0) / pts.length
    const zone: PendingZone = { type: 'polygon', lat: centLat, lng: centLng, radius: 0, name: '', riskLevel: 'medium', peakHours: [20,21,22,23,0,1], notes: '', coordinates: closed }
    setPending(zone)
    setPendingState(zone)
    polyPointsRef.current = []
    setPolyPoints([])
    setMode(null)
    if (mapRef.current) {
      mapRef.current.getMap().doubleClickZoom.enable()
      mapRef.current.getMap().getCanvas().style.cursor = ''
    }
  }

  const undoUltimoPonto = () => {
    const newPts = polyPointsRef.current.slice(0, -1)
    polyPointsRef.current = newPts
    setPolyPoints([...newPts])
  }

  const activateMode = (m: EditorMode) => {
    setMode(m)
    setPolyPoints([])
    polyPointsRef.current = []
    setPending(null)
    setPendingState(null)
    if (mapRef.current) {
      const map = mapRef.current.getMap()
      map.getCanvas().style.cursor = m ? 'crosshair' : ''
      if (m === 'polygon') map.doubleClickZoom.disable()
      else map.doubleClickZoom.enable()
    }
  }

  const togglePeakHour = (h: number) => {
    if (!pendingState) return
    const peaks = pendingState.peakHours
    setPendingState({ ...pendingState, peakHours: peaks.includes(h) ? peaks.filter(x => x !== h) : [...peaks, h] })
  }

  const saveZone = async () => {
    if (!pendingState) return
    setLoadingSave(true)
    try {
      const { latLngToCell } = await import('h3-js')
      const h3Index = latLngToCell(pendingState.lat, pendingState.lng, 9)
      const zoneId = `MANUAL-${Date.now()}-${Math.random().toString(36).substr(2, 6)}`
      // Convert nested arrays to objects — Firestore does not support nested arrays
      const polygonForFirestore = pendingState.coordinates
        ? coordsToObjects(pendingState.coordinates)
        : null
      const geometryForFirestore = pendingState.geometry?.coordinates
        ? { type: pendingState.geometry.type, coordinates: coordsToObjects(pendingState.geometry.coordinates) }
        : null

      await setDoc(doc(db, 'risk_zones', zoneId), {
        zoneId, h3Index,
        zoneType: 'manual',
        lat: pendingState.lat, lng: pendingState.lng,
        radius: pendingState.radius ?? null,
        polygon: polygonForFirestore,
        geometry: geometryForFirestore,
        areaName: pendingState.name,
        segmentName: pendingState.segmentName ?? null,
        riskLevel: pendingState.riskLevel,
        riskScore: pendingState.riskLevel === 'critical' ? 90 : pendingState.riskLevel === 'high' ? 70 : pendingState.riskLevel === 'medium' ? 45 : 20,
        peakHours: pendingState.peakHours,
        notes: pendingState.notes,
        isPermanent: true,
        canBeRemovedByReports: false,
        source: 'admin_manual',
        createdBy: auth.currentUser?.uid ?? 'admin',
        createdAt: serverTimestamp(),
        updatedAt: serverTimestamp(),
        autoExpireAt: null,
        incidentCount: 0,
      })
      onToast('✅ Zona guardada!')
      setPending(null); setPendingState(null); setPolyPoints([])
    } catch (e: any) {
      onToast(`❌ Erro: ${e.message}`)
    }
    setLoadingSave(false)
  }

  const deleteZone = async (z: SavedZone) => {
    if (!confirm(`APAGAR "${z.areaName}"?`)) return
    try {
      console.log('Deletando zona:', z.zoneId)
      await deleteDoc(doc(db, 'risk_zones', z.zoneId))
      onToast('✅ Zona apagada')
      setSavedZones(savedZones.filter(zone => zone.zoneId !== z.zoneId))
    } catch (e: any) {
      console.error('ERRO COMPLETO:', e)
      onToast('❌ ' + e.message)
    }
  }

  // GeoJSON for preview — polygon points being drawn + completed polygon fill
  const previewGeoJSON: any = {
    type: 'FeatureCollection',
    features: [
      // Line while drawing (connects points in order)
      ...(polyPoints.length >= 2 ? [{
        type: 'Feature', properties: { kind: 'line' },
        geometry: { type: 'LineString', coordinates: polyPoints },
      }] : []),
      // Closed polygon fill after fecharPoligono (shown while filling the form)
      ...(pendingState?.type === 'polygon' && pendingState.coordinates ? [{
        type: 'Feature', properties: { kind: 'polygon', level: pendingState.riskLevel },
        geometry: { type: 'Polygon', coordinates: [pendingState.coordinates] },
      }] : []),
      // Saved zones — polygons, segments, or point circles
      ...savedZones.flatMap(z => {
        const features: any[] = []
        if (z.polygon && Array.isArray(z.polygon) && z.polygon.length > 0) {
          features.push({
            type: 'Feature',
            properties: { kind: 'saved-polygon', level: z.riskLevel, name: z.areaName },
            geometry: { type: 'Polygon', coordinates: [coordsToArrays(z.polygon)] },
          })
        } else if (z.geometry?.type === 'LineString' && z.geometry.coordinates?.length > 0) {
          features.push({
            type: 'Feature',
            properties: { kind: 'saved-segment', level: z.riskLevel, name: z.areaName },
            geometry: { type: 'LineString', coordinates: coordsToArrays(z.geometry.coordinates) },
          })
        } else {
          features.push({
            type: 'Feature',
            properties: { kind: 'saved-point', level: z.riskLevel, name: z.areaName },
            geometry: { type: 'Point', coordinates: [z.lng, z.lat] },
          })
        }
        return features
      }),
    ],
  }

  const handleFullscreen = () => {
    setFullscreen(true)
    setTimeout(() => {
      try {
        if (mapRef.current?.getMap) mapRef.current.getMap().resize()
      } catch (e) {
        console.error('Erro ao expandir:', e)
      }
    }, 100)
  }

  const handleCloseFullscreen = () => {
    setFullscreen(false)
    setTimeout(() => {
      try {
        if (mapRef.current?.getMap) mapRef.current.getMap().resize()
      } catch (e) {
        console.error('Erro ao fechar fullscreen:', e)
      }
    }, 100)
  }

  const cellBg = (m: EditorMode) => mode === m ? '#4f46e5' : '#1a1035'

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%', gap: 0 }}>

      {/* Mode buttons */}
      <div style={{ display: 'flex', gap: 8, padding: '12px 0', flexShrink: 0, flexWrap: 'wrap' }}>
        {[
          { m: 'point' as EditorMode, label: '📍 Ponto', desc: 'Círculo' },
          { m: 'polygon' as EditorMode, label: '⬡ Polígono', desc: 'Área livre' },
          { m: 'segment' as EditorMode, label: '🛣️ Segmento', desc: 'Snap to road' },
        ].map(({ m, label, desc }) => (
          <button key={m!} onClick={() => activateMode(mode === m ? null : m)}
            style={{ padding: '8px 14px', borderRadius: 10, border: mode === m ? '2px solid #818cf8' : '1px solid rgba(124,58,237,0.3)', background: cellBg(m), color: mode === m ? '#c7d2fe' : '#9ca3af', fontSize: 12, fontWeight: 700, cursor: 'pointer' }}>
            {label}
            <div style={{ fontSize: 10, opacity: 0.7, fontWeight: 400 }}>{desc}</div>
          </button>
        ))}
        {mode && (
          <button onClick={() => activateMode(null)} style={{ padding: '8px 12px', borderRadius: 10, border: '1px solid rgba(239,68,68,0.4)', background: 'rgba(239,68,68,0.1)', color: '#f87171', fontSize: 12, cursor: 'pointer' }}>
            ✕ Sair
          </button>
        )}
      </div>

      {mode && (
        <p style={{ fontSize: 12, color: '#9ca3af', marginBottom: 8, padding: '6px 10px', background: 'rgba(79,70,229,0.1)', borderRadius: 8 }}>
          {mode === 'point' && '📍 Toca no mapa para criar uma zona circular'}
          {mode === 'polygon' && (
            polyPoints.length === 0 ? '👆 Toca no mapa para adicionar o primeiro ponto' :
            polyPoints.length < 3  ? `👆 Adiciona mais ${3 - polyPoints.length} ponto(s) — mínimo 3` :
            `✅ ${polyPoints.length} pontos — toca "Fechar área" para guardar`
          )}
          {mode === 'segment' && '🛣️ Toca numa rua para encaixar automaticamente num segmento'}
        </p>
      )}
      {mode === 'polygon' && (
        <div style={{ display: 'flex', gap: 8, marginBottom: 8 }}>
          {polyPoints.length >= 3 && (
            <button onClick={fecharPoligono}
              style={{ flex: 1, background: '#1a56db', color: 'white', border: 'none', borderRadius: 10, padding: '10px 14px', fontSize: 13, fontWeight: 700, cursor: 'pointer' }}>
              ✅ Fechar área ({polyPoints.length} pontos)
            </button>
          )}
          {polyPoints.length > 0 && (
            <button onClick={undoUltimoPonto}
              style={{ background: 'rgba(255,255,255,0.07)', color: '#9ca3af', border: '1px solid rgba(255,255,255,0.12)', borderRadius: 10, padding: '10px 14px', fontSize: 13, cursor: 'pointer' }}>
              ↩ Desfazer
            </button>
          )}
        </div>
      )}

      {/* Map — tap to expand on mobile */}
      <div style={{
        position: fullscreen ? 'fixed' : 'relative',
        inset: fullscreen ? 0 : undefined,
        zIndex: fullscreen ? 9999 : undefined,
        height: fullscreen ? '100vh' : 340,
        width: fullscreen ? '100vw' : undefined,
        borderRadius: fullscreen ? 0 : 12,
        overflow: 'hidden',
        border: fullscreen ? 'none' : '1px solid rgba(124,58,237,0.3)',
        flexShrink: 0,
      }}>
        {/* Fullscreen controls overlay */}
        {fullscreen && (
          <div style={{ position: 'absolute', top: 12, right: 12, zIndex: 10, display: 'flex', gap: 8 }}>
            {polyPoints.length >= 3 && (
              <button onClick={fecharPoligono}
                style={{ background: '#f59e0b', color: '#0a0e1a', border: 'none', borderRadius: 20, padding: '10px 18px', fontSize: 13, fontWeight: 800, cursor: 'pointer', boxShadow: '0 2px 8px rgba(0,0,0,0.4)' }}>
                ✅ Fechar área ({polyPoints.length} pts)
              </button>
            )}
            <button onClick={handleCloseFullscreen}
              style={{ background: 'rgba(0,0,0,0.7)', color: 'white', border: '1px solid rgba(255,255,255,0.2)', borderRadius: 20, padding: '10px 16px', fontSize: 13, fontWeight: 700, cursor: 'pointer', backdropFilter: 'blur(4px)' }}>
              ✕ Fechar
            </button>
          </div>
        )}
        {/* Expand hint — mobile only, shown when not fullscreen */}
        {!fullscreen && (
          <button
            onClick={handleFullscreen}
            style={{ position: 'absolute', bottom: 10, left: '50%', transform: 'translateX(-50%)', background: 'rgba(0,0,0,0.6)', color: 'white', border: 'none', borderRadius: 20, padding: '6px 14px', fontSize: 11, cursor: 'pointer', zIndex: 5, backdropFilter: 'blur(4px)', pointerEvents: 'auto' }}>
            ⛶ Expandir mapa
          </button>
        )}
        <Map
          key={mapKey}
          ref={mapRef}
          mapboxAccessToken={process.env.NEXT_PUBLIC_MAPBOX_TOKEN}
          initialViewState={{ longitude: -6.26, latitude: 53.35, zoom: 11 }}
          mapStyle="mapbox://styles/mapbox/streets-v12"
          style={{ width: '100%', height: '100%' }}
          onClick={handleMapClick}
        >
          {/* Preview: line while drawing + polygon fill after closing */}
          <Source id="preview" type="geojson" data={previewGeoJSON}>
            <Layer id="preview-poly-fill" type="fill" filter={['==', ['geometry-type'], 'Polygon']}
              paint={{ 'fill-color': ['match', ['get', 'level'], 'critical', '#7c3aed', 'high', '#ef4444', 'medium', '#f97316', '#eab308'], 'fill-opacity': 0.18 }} />
            <Layer id="preview-poly-line" type="line" filter={['==', ['geometry-type'], 'Polygon']}
              paint={{ 'line-color': '#f59e0b', 'line-width': 2 }} />
            <Layer id="preview-line" type="line" filter={['==', ['geometry-type'], 'LineString']}
              paint={{ 'line-color': '#818cf8', 'line-width': 2, 'line-dasharray': [3, 2] }} />
            <Layer id="saved-zones-fill" type="fill" filter={['==', ['get', 'kind'], 'saved-polygon']}
              paint={{ 'fill-color': ['match', ['get', 'level'], 'critical', '#7c3aed', 'high', '#ef4444', 'medium', '#f97316', '#eab308'], 'fill-opacity': 0.12 }} />
            <Layer id="saved-zones-line" type="line" filter={['==', ['get', 'kind'], 'saved-polygon']}
              paint={{ 'line-color': ['match', ['get', 'level'], 'critical', '#7c3aed', 'high', '#ef4444', 'medium', '#f97316', '#eab308'], 'line-width': 1.5, 'line-opacity': 0.6 }} />
            <Layer id="saved-segments-line" type="line" filter={['==', ['get', 'kind'], 'saved-segment']}
              paint={{ 'line-color': '#10b981', 'line-width': 2.5, 'line-dasharray': [5, 3] }} />
            <Layer id="saved-points-circle" type="circle" filter={['==', ['get', 'kind'], 'saved-point']}
              paint={{
                'circle-radius': ['interpolate', ['linear'], ['zoom'], 11, 3, 15, 15],
                'circle-color': ['match', ['get', 'level'], 'critical', '#7c3aed', 'high', '#ef4444', 'medium', '#f97316', '#eab308'],
                'circle-opacity': 0.6,
                'circle-stroke-width': 1,
                'circle-stroke-color': '#fff',
              }} />
          </Source>

          {/* Polygon point markers */}
          {polyPoints.map(([lng, lat], i) => (
            <Marker key={i} longitude={lng} latitude={lat} anchor="center">
              <div style={{ width: 10, height: 10, borderRadius: '50%', background: '#818cf8', border: '2px solid white' }} />
            </Marker>
          ))}

          {/* Pending zone preview */}
          {pendingState && pendingState.type === 'point' && (
            <Marker longitude={pendingState.lng} latitude={pendingState.lat} anchor="center">
              <div style={{ width: 14, height: 14, borderRadius: '50%', background: LEVEL_COLOR[pendingState.riskLevel], border: '2px solid white', boxShadow: '0 0 8px rgba(0,0,0,0.5)' }} />
            </Marker>
          )}

          {/* Saved zone markers */}
          {savedZones.map(z => (
            <Marker key={z.zoneId} longitude={z.lng} latitude={z.lat} anchor="center">
              <div style={{ width: 10, height: 10, borderRadius: '50%', background: LEVEL_COLOR[z.riskLevel], border: '1.5px solid white', opacity: 0.8 }} />
            </Marker>
          ))}
        </Map>
      </div>

      {/* Zone configuration panel */}
      {pendingState && (
        <div style={{ background: '#1a1035', border: '1px solid rgba(124,58,237,0.3)', borderRadius: 12, padding: 16, marginTop: 12, flexShrink: 0 }}>
          <h4 style={{ margin: '0 0 12px', fontSize: 14, color: '#c4b5fd' }}>
            {pendingState.type === 'point' ? '📍' : pendingState.type === 'polygon' ? '⬡' : '🛣️'} Nova zona de atenção
          </h4>

          <label style={{ fontSize: 11, color: '#9ca3af', fontWeight: 700 }}>NOME</label>
          <input
            value={pendingState.name}
            onChange={e => setPendingState({ ...pendingState, name: e.target.value })}
            placeholder="Ex: Belgard Road Sul"
            style={{ width: '100%', padding: '8px 10px', marginTop: 4, marginBottom: 12, background: '#110d2a', border: '1px solid rgba(124,58,237,0.3)', borderRadius: 8, color: 'white', fontSize: 13, boxSizing: 'border-box' }}
          />

          <label style={{ fontSize: 11, color: '#9ca3af', fontWeight: 700 }}>NÍVEL DE RISCO</label>
          <div style={{ display: 'flex', gap: 6, marginTop: 4, marginBottom: 12 }}>
            {(['low', 'medium', 'high', 'critical'] as RiskLevel[]).map(lvl => (
              <button key={lvl} onClick={() => setPendingState({ ...pendingState, riskLevel: lvl })}
                style={{ flex: 1, padding: '7px 4px', border: 'none', borderRadius: 8, fontSize: 11, fontWeight: 700, cursor: 'pointer', background: pendingState.riskLevel === lvl ? LEVEL_COLOR[lvl] : '#110d2a', color: pendingState.riskLevel === lvl ? 'white' : '#6b7280' }}>
                {lvl === 'low' ? '🟡 Baixo' : lvl === 'medium' ? '🟠 Médio' : lvl === 'high' ? '🔴 Alto' : '🟣 Crítico'}
              </button>
            ))}
          </div>

          {pendingState.type === 'point' && (
            <>
              <label style={{ fontSize: 11, color: '#9ca3af', fontWeight: 700 }}>RAIO: {pendingState.radius}m</label>
              <input type="range" min={50} max={1000} step={50} value={pendingState.radius}
                onChange={e => setPendingState({ ...pendingState, radius: parseInt(e.target.value) })}
                style={{ width: '100%', marginTop: 4, marginBottom: 12, accentColor: '#7c3aed' }} />
            </>
          )}

          <label style={{ fontSize: 11, color: '#9ca3af', fontWeight: 700 }}>HORAS DE PICO</label>
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 4, marginTop: 4, marginBottom: 12 }}>
            {Array.from({ length: 24 }, (_, i) => i).map(h => (
              <button key={h} onClick={() => togglePeakHour(h)}
                style={{ width: 32, height: 26, border: 'none', borderRadius: 6, fontSize: 10, cursor: 'pointer', fontWeight: 700, background: pendingState.peakHours.includes(h) ? '#4f46e5' : '#110d2a', color: pendingState.peakHours.includes(h) ? '#c7d2fe' : '#6b7280' }}>
                {h}
              </button>
            ))}
          </div>

          <label style={{ fontSize: 11, color: '#9ca3af', fontWeight: 700 }}>NOTAS (opcional)</label>
          <textarea
            value={pendingState.notes}
            onChange={e => setPendingState({ ...pendingState, notes: e.target.value })}
            placeholder="O que acontece aqui, tipo de incidente…"
            rows={2}
            style={{ width: '100%', padding: '8px 10px', marginTop: 4, marginBottom: 14, background: '#110d2a', border: '1px solid rgba(124,58,237,0.3)', borderRadius: 8, color: 'white', fontSize: 13, resize: 'none', boxSizing: 'border-box' }}
          />

          <div style={{ display: 'flex', gap: 8 }}>
            <button onClick={() => { setPending(null); setPendingState(null) }}
              style={{ flex: 1, padding: 11, background: '#110d2a', border: '1px solid rgba(255,255,255,0.1)', borderRadius: 10, color: '#9ca3af', fontSize: 13, cursor: 'pointer' }}>
              Cancelar
            </button>
            <button onClick={saveZone} disabled={loadingSave || !pendingState.name}
              style={{ flex: 2, padding: 11, background: '#4f46e5', border: 'none', borderRadius: 10, color: 'white', fontSize: 14, fontWeight: 700, cursor: 'pointer', opacity: (!pendingState.name || loadingSave) ? 0.6 : 1 }}>
              {loadingSave ? 'A guardar…' : '✅ Guardar zona'}
            </button>
          </div>
        </div>
      )}

      {/* Saved zones list */}
      <div style={{ marginTop: 16, flex: 1 }}>
        <p style={{ fontSize: 12, fontWeight: 700, color: '#c4b5fd', marginBottom: 8 }}>
          ZONAS GUARDADAS ({savedZones.length})
        </p>
        {savedZones.length === 0 ? (
          <p style={{ fontSize: 13, color: '#6b7280', textAlign: 'center', padding: 20 }}>Nenhuma zona criada ainda</p>
        ) : (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
            {savedZones.map(z => (
              <div key={z.zoneId} style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '8px 12px', background: '#110d2a', borderRadius: 10, border: '1px solid rgba(124,58,237,0.15)' }}>
                <div style={{ width: 8, height: 8, borderRadius: '50%', background: LEVEL_COLOR[z.riskLevel], flexShrink: 0 }} />
                <span style={{ flex: 1, fontSize: 13, color: '#d1d5db' }}>{z.areaName}</span>
                <span style={{ fontSize: 10, color: '#9ca3af', background: '#1a1035', padding: '2px 6px', borderRadius: 6 }}>{z.zoneType}</span>
                <span style={{ fontSize: 10, fontWeight: 700, color: LEVEL_COLOR[z.riskLevel] }}>{z.riskLevel}</span>
                {(isSuperAdmin || canEditZone(z, currentUid, isSuperAdmin)) ? (
                  <button onClick={() => deleteZone(z)}
                    style={{ background: 'rgba(239,68,68,0.1)', border: '1px solid rgba(239,68,68,0.2)', borderRadius: 6, padding: '3px 8px', color: '#f87171', fontSize: 11, cursor: 'pointer' }}>
                    🗑️
                  </button>
                ) : (
                  <span style={{ fontSize: 10, color: '#6b7280', padding: '3px 6px' }} title="Apenas o criador pode apagar nas primeiras 48h">🔒</span>
                )}
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  )
}
