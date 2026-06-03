// src/components/Map/MapSearchBar.tsx
'use client'
import { useState, useRef, useCallback, useEffect } from 'react'

interface HistoryItem {
  id: string
  name: string
  address: string
  lat: number
  lng: number
}

function loadHistory(): HistoryItem[] {
  if (typeof window === 'undefined') return []
  try { return JSON.parse(localStorage.getItem('searchHistory') || '[]') } catch { return [] }
}

function saveToHistory(item: HistoryItem) {
  const hist = loadHistory()
  const filtered = hist.filter(h => h.id !== item.id)
  localStorage.setItem('searchHistory', JSON.stringify([item, ...filtered].slice(0, 8)))
}

function haversineDist(a: { lat: number; lng: number }, b: { lat: number; lng: number }): number {
  const R = 6371000
  const dLat = (b.lat - a.lat) * Math.PI / 180
  const dLng = (b.lng - a.lng) * Math.PI / 180
  const aa = Math.sin(dLat / 2) ** 2 + Math.cos(a.lat * Math.PI / 180) * Math.cos(b.lat * Math.PI / 180) * Math.sin(dLng / 2) ** 2
  return R * 2 * Math.atan2(Math.sqrt(aa), Math.sqrt(1 - aa))
}

function fmtDist(m: number): string {
  return m >= 1000 ? `${(m / 1000).toFixed(1)} km` : `${Math.round(m)} m`
}

function getSearchIcon(featureType: string): string {
  if (featureType === 'poi') return '🏢'
  if (featureType === 'address') return '📍'
  if (featureType === 'street') return '🛣️'
  if (featureType === 'neighborhood' || featureType === 'place') return '🏙️'
  return '📍'
}

interface Props {
  onPlaceSelected: (lat: number, lng: number, name?: string) => void
  userLocation?: { lat: number; lng: number }
}

export default function MapSearchBar({ onPlaceSelected, userLocation }: Props) {
  const [open, setOpen] = useState(false)
  const [text, setText] = useState('')
  const [suggestions, setSuggestions] = useState<any[]>([])
  const [loading, setLoading] = useState(false)
  const [history, setHistory] = useState<HistoryItem[]>([])
  const sessionTokenRef = useRef('')

  // Load history when overlay opens
  useEffect(() => {
    if (open) setHistory(loadHistory())
  }, [open])

  const suggestPlaces = useCallback(async (q: string) => {
    if (q.length < 2) { setSuggestions([]); return }
    const token = process.env.NEXT_PUBLIC_MAPBOX_TOKEN
    const prox = userLocation ? `&proximity=${userLocation.lng},${userLocation.lat}` : ''
    const url = `https://api.mapbox.com/search/searchbox/v1/suggest?q=${encodeURIComponent(q)}&language=pt&country=ie${prox}&types=poi,address,place,neighborhood,street&limit=6&session_token=${sessionTokenRef.current}&access_token=${token}`
    try {
      const res = await fetch(url)
      const data = await res.json()
      setSuggestions(data.suggestions ?? [])
    } catch { setSuggestions([]) }
  }, [userLocation])

  const retrievePlace = useCallback(async (mapboxId: string) => {
    const token = process.env.NEXT_PUBLIC_MAPBOX_TOKEN
    const url = `https://api.mapbox.com/search/searchbox/v1/retrieve/${mapboxId}?session_token=${sessionTokenRef.current}&access_token=${token}`
    const res = await fetch(url)
    const data = await res.json()
    return data.features?.[0] ?? null
  }, [])

  const selectSuggestion = useCallback(async (s: any) => {
    setLoading(true)
    setSuggestions([])
    try {
      const feat = await retrievePlace(s.mapbox_id)
      if (!feat) { setLoading(false); return }
      const [lng, lat] = feat.geometry.coordinates
      const address = feat.properties?.full_address || feat.properties?.place_formatted || s.full_address || ''
      saveToHistory({ id: s.mapbox_id, name: s.name, address, lat, lng })
      setOpen(false)
      setText('')
      setLoading(false)
      onPlaceSelected(lat, lng, s.name)
    } catch {
      setLoading(false)
    }
  }, [retrievePlace, onPlaceSelected])

  const selectHistory = useCallback((item: HistoryItem) => {
    setOpen(false)
    setText('')
    onPlaceSelected(item.lat, item.lng, item.name)
  }, [onPlaceSelected])

  useEffect(() => {
    if (!open || !text) { if (!text) setSuggestions([]); return }
    const timer = setTimeout(() => suggestPlaces(text), 250)
    return () => clearTimeout(timer)
  }, [text, open, suggestPlaces])

  return (
    <>
      {/* Pill bar */}
      <button
        onClick={() => {
          sessionTokenRef.current = crypto.randomUUID()
          setText('')
          setSuggestions([])
          setOpen(true)
        }}
        style={{
          display: 'flex', alignItems: 'center', gap: 10,
          background: 'white', borderRadius: 26, height: 52,
          padding: '0 20px', boxShadow: '0 2px 16px rgba(0,0,0,0.3)',
          border: 'none', cursor: 'pointer', width: '100%', textAlign: 'left',
        }}
      >
        <span style={{ fontSize: 18, flexShrink: 0 }}>🔍</span>
        <span style={{ flex: 1, fontSize: 15, color: '#9ca3af', fontWeight: 500 }}>Para onde vais?</span>
      </button>

      {/* Full-screen overlay */}
      {open && (
        <div style={{
          position: 'fixed', inset: 0, zIndex: 2000,
          background: 'var(--surface)', display: 'flex', flexDirection: 'column',
        }}>
          {/* Input row */}
          <div style={{ display: 'flex', gap: 8, padding: '12px 12px 10px', alignItems: 'center', borderBottom: '1px solid var(--border)' }}>
            <span style={{ fontSize: 16, flexShrink: 0, color: 'var(--muted)' }}>🔍</span>
            <input
              autoFocus
              autoCorrect="off"
              autoCapitalize="off"
              spellCheck={false}
              value={text}
              onChange={e => setText(e.target.value)}
              onKeyDown={e => {
                if (e.key === 'Enter' && suggestions.length > 0) selectSuggestion(suggestions[0])
                if ((e.metaKey || e.ctrlKey) && e.key === 'z') e.preventDefault()
              }}
              placeholder="Para onde vais?"
              style={{ flex: 1, background: 'transparent', border: 'none', color: 'var(--text)', fontSize: 15, outline: 'none', fontWeight: 500 }}
            />
            {text && (
              <button onClick={() => { setText(''); setSuggestions([]) }}
                style={{ background: 'var(--bg)', border: '1px solid var(--border)', borderRadius: 8, padding: '4px 8px', color: 'var(--muted)', cursor: 'pointer', fontSize: 12 }}>
                ✕
              </button>
            )}
            <button
              onClick={() => { setOpen(false); setText(''); setSuggestions([]) }}
              style={{ background: 'var(--bg)', border: '1px solid var(--border)', borderRadius: 8, padding: '6px 10px', color: 'var(--muted)', cursor: 'pointer', fontSize: 13 }}>
              Cancelar
            </button>
          </div>

          {/* Content area */}
          <div style={{ flex: 1, overflowY: 'auto' }}>
            {/* Live suggestions when typing */}
            {text.length >= 2 ? (
              <>
                {suggestions.map((s, i) => (
                  <button key={i} onClick={() => selectSuggestion(s)}
                    style={{ width: '100%', display: 'flex', alignItems: 'center', gap: 10, padding: '12px 16px', background: 'transparent', border: 'none', cursor: 'pointer', textAlign: 'left', borderBottom: '1px solid rgba(255,255,255,0.04)' }}>
                    <span style={{ fontSize: 20, flexShrink: 0 }}>{getSearchIcon(s.feature_type)}</span>
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <div style={{ fontSize: 14, fontWeight: 700, color: 'var(--text)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{s.name}</div>
                      <div style={{ fontSize: 12, color: 'var(--muted)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', marginTop: 1 }}>
                        {s.full_address || s.place_formatted || s.address || ''}
                      </div>
                    </div>
                  </button>
                ))}
                {loading && <div style={{ padding: 16, textAlign: 'center', fontSize: 13, color: 'var(--muted)' }}>A pesquisar...</div>}
                {!loading && suggestions.length === 0 && text.length >= 2 && (
                  <div style={{ padding: 16, textAlign: 'center', fontSize: 13, color: 'var(--muted)' }}>Sem resultados</div>
                )}
              </>
            ) : (
              /* History when idle */
              <>
                {history.length > 0 && (
                  <>
                    <div style={{ padding: '12px 16px 4px', fontSize: 11, fontWeight: 700, color: 'var(--muted)', letterSpacing: 0.5, textTransform: 'uppercase' }}>
                      🕐 Recentes
                    </div>
                    {history.map((item) => (
                      <button key={item.id} onClick={() => selectHistory(item)}
                        style={{ width: '100%', display: 'flex', alignItems: 'center', gap: 10, padding: '10px 16px', background: 'transparent', border: 'none', cursor: 'pointer', textAlign: 'left', borderBottom: '1px solid rgba(255,255,255,0.04)' }}>
                        <span style={{ fontSize: 18, flexShrink: 0, color: 'var(--muted)' }}>🕐</span>
                        <div style={{ flex: 1, minWidth: 0 }}>
                          <div style={{ fontSize: 13, fontWeight: 600, color: 'var(--text)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{item.name}</div>
                          <div style={{ fontSize: 11, color: 'var(--muted)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', marginTop: 1 }}>
                            {item.address}
                            {userLocation ? ` · ${fmtDist(haversineDist(userLocation, item))}` : ''}
                          </div>
                        </div>
                      </button>
                    ))}
                    <button
                      onClick={() => { localStorage.setItem('searchHistory', '[]'); setHistory([]) }}
                      style={{ width: '100%', padding: '10px 16px', background: 'transparent', border: 'none', cursor: 'pointer', textAlign: 'center', fontSize: 11, color: 'var(--muted)' }}>
                      Limpar histórico
                    </button>
                  </>
                )}
                {history.length === 0 && (
                  <div style={{ padding: 24, textAlign: 'center', fontSize: 13, color: 'var(--muted)' }}>
                    Começa a escrever para pesquisar
                  </div>
                )}
              </>
            )}
          </div>
        </div>
      )}
    </>
  )
}
