// src/components/Map/LocationBottomSheet.tsx
'use client'
import { useCallback } from 'react'

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

export interface TappedLocation {
  lat: number
  lng: number
  address?: string
  name?: string
  category?: string
  loading?: boolean
}

function getCategoryEmoji(category: string): string {
  const c = category.toLowerCase()
  if (c.includes('coffee') || c.includes('café') || c.includes('cafe')) return '☕'
  if (c.includes('restaurant') || c.includes('food') || c.includes('dining')) return '🍽️'
  if (c.includes('bar') || c.includes('pub')) return '🍺'
  if (c.includes('shop') || c.includes('store') || c.includes('retail') || c.includes('supermarket')) return '🛍️'
  if (c.includes('airport')) return '✈️'
  if (c.includes('bus') || c.includes('transit') || c.includes('stop')) return '🚌'
  if (c.includes('train') || c.includes('metro') || c.includes('rail')) return '🚂'
  if (c.includes('hotel') || c.includes('lodging') || c.includes('accommodation')) return '🏨'
  if (c.includes('hospital') || c.includes('medical') || c.includes('health') || c.includes('clinic')) return '🏥'
  if (c.includes('school') || c.includes('university') || c.includes('college')) return '🏫'
  if (c.includes('park') || c.includes('garden')) return '🌳'
  if (c.includes('gym') || c.includes('fitness') || c.includes('sport')) return '💪'
  if (c.includes('bank') || c.includes('atm') || c.includes('finance')) return '🏦'
  if (c.includes('gas') || c.includes('petrol') || c.includes('fuel')) return '⛽'
  if (c.includes('pharmacy') || c.includes('chemist') || c.includes('drug')) return '💊'
  if (c.includes('church') || c.includes('mosque') || c.includes('temple')) return '⛪'
  return '📍'
}

interface Props {
  location: TappedLocation
  riderLocation?: { lat: number; lng: number }
  onNavigate: () => void
  onClose: () => void
}

export default function LocationBottomSheet({ location, riderLocation, onNavigate, onClose }: Props) {
  const handleShare = useCallback(() => {
    const coordStr = `${location.lat.toFixed(6)}, ${location.lng.toFixed(6)}`
    const text = location.name
      ? `${location.name} — ${location.address ?? coordStr}`
      : (location.address ?? coordStr)

    if (navigator.share) {
      navigator.share({
        title: location.name ?? 'Localização',
        text,
        url: `https://maps.google.com/?q=${location.lat},${location.lng}`,
      }).catch(() => {})
    } else {
      navigator.clipboard?.writeText(text).catch(() => {})
    }
  }, [location])

  const headline = location.loading
    ? 'A obter endereço...'
    : location.name ?? location.address?.split(',')[0] ?? 'Localização'

  const subline = !location.loading && location.address
    ? location.name
      ? location.address           // POI → show full address as sub
      : location.address           // plain tap → show full address
    : null

  return (
    <div
      className="absolute z-[1100]"
      style={{ bottom: '80px', left: '12px', right: '12px', animation: 'slideUp 0.22s ease-out' }}
    >
      <div style={{
        background: 'var(--surface)',
        border: '1px solid var(--border)',
        borderRadius: 18,
        padding: '16px',
        boxShadow: '0 8px 32px rgba(0,0,0,0.45)',
      }}>
        {/* Header row */}
        <div style={{ display: 'flex', alignItems: 'flex-start', gap: 10, marginBottom: 14 }}>
          <span style={{ fontSize: 24, flexShrink: 0, marginTop: 1 }}>
            {location.loading ? '📍' : (location.category ? getCategoryEmoji(location.category) : '📍')}
          </span>
          <div style={{ flex: 1, minWidth: 0 }}>
            <div style={{
              fontSize: 15, fontWeight: 700, color: 'var(--text)',
              overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
            }}>
              {headline}
            </div>
            {subline && (
              <div style={{
                fontSize: 12, color: 'var(--muted)', marginTop: 2,
                overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
              }}>
                {subline}
              </div>
            )}
            {!location.loading && location.category && (
              <div style={{ fontSize: 11, color: '#4f8ef7', marginTop: 2 }}>
                {location.category}
              </div>
            )}
            {!location.loading && riderLocation && (
              <div style={{ fontSize: 11, color: 'var(--muted)', marginTop: 3 }}>
                {fmtDist(haversineDist(riderLocation, location))} de distância
              </div>
            )}
          </div>
          <button
            onClick={onClose}
            style={{
              background: 'var(--bg)', border: '1px solid var(--border)',
              borderRadius: 8, padding: '5px 9px', color: 'var(--muted)',
              cursor: 'pointer', fontSize: 14, flexShrink: 0,
            }}
          >
            ✕
          </button>
        </div>

        {/* Action buttons */}
        <div style={{ display: 'flex', gap: 8 }}>
          <button
            onClick={onNavigate}
            disabled={!!location.loading}
            style={{
              flex: 1,
              background: location.loading ? '#374151' : '#2d6fe8',
              border: 'none', borderRadius: 12, padding: '11px',
              color: 'white', fontWeight: 700, fontSize: 13,
              cursor: location.loading ? 'default' : 'pointer',
              display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 6,
            }}
          >
            🧭 Navegar
          </button>
          <button
            onClick={handleShare}
            style={{
              background: 'var(--bg)', border: '1px solid var(--border)',
              borderRadius: 12, padding: '11px 16px',
              color: 'var(--text)', fontWeight: 600, fontSize: 13,
              cursor: 'pointer', display: 'flex', alignItems: 'center', gap: 5,
              whiteSpace: 'nowrap',
            }}
          >
            ↗ Partilhar
          </button>
        </div>
      </div>
    </div>
  )
}
