// src/components/Map/DestinationBanner.tsx
'use client'
import { useState, useEffect } from 'react'
import { RISK_ZONES } from './MapView'

interface Props {
  address: string
  onDismiss: () => void
}

interface RiskResult {
  zone: typeof RISK_ZONES[number]
  distanceKm: number
}

function pointInPolygon(lng: number, lat: number, polygon: [number, number][]): boolean {
  // polygon vertices are [lat, lng] (Leaflet order)
  let inside = false
  for (let i = 0, j = polygon.length - 1; i < polygon.length; j = i++) {
    const [lati, lngi] = polygon[i]
    const [latj, lngj] = polygon[j]
    const intersect = ((lngi > lng) !== (lngj > lng)) &&
      (lat < (latj - lati) * (lng - lngi) / (lngj - lngi) + lati)
    if (intersect) inside = !inside
  }
  return inside
}

function findRiskZones(lng: number, lat: number): RiskResult[] {
  const results: RiskResult[] = []
  for (const zone of RISK_ZONES) {
    // Check exact containment
    if (pointInPolygon(lng, lat, zone.polygon)) {
      results.push({ zone, distanceKm: 0 })
    } else {
      // Check proximity (within ~400m) — rough degree approximation
      const centLat = zone.polygon.reduce((s, [la]) => s + la, 0) / zone.polygon.length
      const centLng = zone.polygon.reduce((s, [, lo]) => s + lo, 0) / zone.polygon.length
      const dLat = (lat - centLat) * 111
      const dLng = (lng - centLng) * 111 * Math.cos(lat * Math.PI / 180)
      const km = Math.sqrt(dLat * dLat + dLng * dLng)
      if (km < 0.4) results.push({ zone, distanceKm: km })
    }
  }
  results.sort((a, b) => {
    const order = { high: 0, medium: 1, low: 2 }
    return (order[a.zone.level] - order[b.zone.level]) || (a.distanceKm - b.distanceKm)
  })
  return results
}

const LEVEL_STYLE = {
  high: { bg: 'rgba(239,68,68,0.15)', border: 'rgba(239,68,68,0.4)', color: '#f87171', icon: '🔴' },
  medium: { bg: 'rgba(249,115,22,0.15)', border: 'rgba(249,115,22,0.4)', color: '#fb923c', icon: '🟠' },
  low: { bg: 'rgba(234,179,8,0.15)', border: 'rgba(234,179,8,0.4)', color: '#facc15', icon: '🟡' },
}

export default function DestinationBanner({ address, onDismiss }: Props) {
  const [status, setStatus] = useState<'loading' | 'risk' | 'safe' | 'error'>('loading')
  const [risks, setRisks] = useState<RiskResult[]>([])

  useEffect(() => {
    const token = process.env.NEXT_PUBLIC_MAPBOX_TOKEN
    if (!token || token === 'YOUR_MAPBOX_TOKEN_HERE') {
      setStatus('error')
      return
    }

    setStatus('loading')
    const encoded = encodeURIComponent(address)
    const url = `https://api.mapbox.com/geocoding/v5/mapbox.places/${encoded}.json?access_token=${token}&bbox=-6.55,53.1,-5.9,53.65&limit=1&country=ie`

    fetch(url)
      .then(r => r.json())
      .then(data => {
        const feature = data.features?.[0]
        if (!feature) { setStatus('error'); return }
        const [lng, lat] = feature.center as [number, number]
        const found = findRiskZones(lng, lat)
        setRisks(found)
        setStatus(found.length > 0 ? 'risk' : 'safe')
      })
      .catch(() => setStatus('error'))
  }, [address])

  const topRisk = risks[0]
  const style = topRisk ? LEVEL_STYLE[topRisk.zone.level] : null

  const googleMapsUrl = `https://www.google.com/maps/dir/?api=1&destination=${encodeURIComponent(address)}&travelmode=bicycling`

  return (
    <div
      className="absolute z-[500]"
      style={{ bottom: '80px', left: '12px', right: '12px' }}
    >
      <div
        className="rounded-xl shadow-lg px-3 py-2.5 flex items-center gap-2"
        style={{
          background: status === 'risk' && style
            ? style.bg
            : status === 'safe'
            ? 'rgba(16,185,129,0.15)'
            : 'var(--surface)',
          border: `1px solid ${status === 'risk' && style ? style.border : status === 'safe' ? 'rgba(16,185,129,0.4)' : 'var(--border)'}`,
          backdropFilter: 'blur(8px)',
        }}
      >
        {/* Icon */}
        <span style={{ fontSize: 18, flexShrink: 0 }}>
          {status === 'loading' ? '📍' : status === 'safe' ? '✅' : status === 'risk' ? (style?.icon ?? '⚠️') : '📍'}
        </span>

        {/* Text */}
        <div className="flex-1 min-w-0">
          <p className="text-xs font-semibold truncate" style={{ color: status === 'risk' && style ? style.color : status === 'safe' ? '#34d399' : 'var(--text)' }}>
            {status === 'loading' && 'A verificar destino…'}
            {status === 'error' && <span style={{ color: 'var(--muted)' }}>Destino detetado · {address.slice(0, 40)}</span>}
            {status === 'safe' && 'Rota parece segura'}
            {status === 'risk' && topRisk && (
              topRisk.distanceKm === 0
                ? `Destino em zona de risco — ${topRisk.zone.name}`
                : `Perto de zona de risco — ${topRisk.zone.name}`
            )}
          </p>
          {status === 'risk' && topRisk && (
            <p className="text-xs truncate" style={{ color: 'var(--muted)' }}>
              {topRisk.zone.description}
            </p>
          )}
          {(status === 'safe' || status === 'risk') && (
            <p className="text-xs truncate mt-0.5" style={{ color: 'var(--muted)' }}>
              {address.slice(0, 50)}{address.length > 50 ? '…' : ''}
            </p>
          )}
        </div>

        {/* Actions */}
        <div className="flex items-center gap-1.5 flex-shrink-0">
          {(status === 'safe' || status === 'risk') && (
            <a
              href={googleMapsUrl}
              target="_blank"
              rel="noopener noreferrer"
              className="text-xs font-semibold px-2.5 py-1.5 rounded-lg"
              style={{ background: 'rgba(45,111,232,0.2)', color: '#93c5fd', whiteSpace: 'nowrap' }}
            >
              🧭 Navegar
            </a>
          )}
          <button
            onClick={onDismiss}
            className="w-6 h-6 flex items-center justify-center rounded-full text-xs"
            style={{ background: 'rgba(255,255,255,0.08)', color: 'var(--muted)' }}
          >
            ✕
          </button>
        </div>
      </div>
    </div>
  )
}
