'use client'
// Seta/pino do usuário. Durante a navegação tem a PRÓPRIA animação (requestAnimationFrame):
// só este componente pequeno é redesenhado a cada quadro, não o mapa inteiro.
import { MutableRefObject, ReactNode, useEffect, useState } from 'react'
import { Marker } from 'react-map-gl/mapbox'

interface Props {
  navigating: boolean
  posRef: MutableRefObject<{ lat: number; lng: number }>
  headingRef: MutableRefObject<number>
  northLocked: boolean
  fallback: { lat: number; lng: number } | null
  idlePin: ReactNode
}

export default function UserPuck({ navigating, posRef, headingRef, northLocked, fallback, idlePin }: Props) {
  const [pos, setPos] = useState<{ lat: number; lng: number } | null>(null)
  const [heading, setHeading] = useState(0)

  useEffect(() => {
    if (!navigating) { setPos(null); return }
    let id = 0
    let last = { lat: 0, lng: 0, h: -999 }
    const tick = () => {
      const p = posRef.current
      const h = headingRef.current
      if (p.lat !== 0 && (Math.abs(p.lat - last.lat) > 1e-6 || Math.abs(p.lng - last.lng) > 1e-6)) {
        last = { ...last, lat: p.lat, lng: p.lng }
        setPos({ lat: p.lat, lng: p.lng })
      }
      let d = Math.abs(h - last.h); if (d > 180) d = 360 - d
      if (d > 1) { last.h = h; setHeading(h) }
      id = requestAnimationFrame(tick)
    }
    id = requestAnimationFrame(tick)
    return () => cancelAnimationFrame(id)
  }, [navigating, posRef, headingRef])

  const where = navigating ? (pos ?? fallback) : fallback
  if (!where) return null
  return (
    <Marker longitude={where.lng} latitude={where.lat} anchor={navigating ? 'center' : 'bottom'}>
      {navigating ? (
        <div style={{
          width: 48, height: 48,
          filter: 'drop-shadow(0 3px 6px rgba(0,0,0,0.4))',
          transform: northLocked ? `rotate(${heading}deg)` : 'rotate(0deg)',
          pointerEvents: 'none',
        }}>
          <svg width="48" height="48" viewBox="0 0 48 48">
            <polygon points="24,4 38,40 24,33 10,40" fill="#f59e0b" stroke="rgba(0,0,0,0.3)" strokeWidth="1.5" strokeLinejoin="round"/>
          </svg>
        </div>
      ) : idlePin}
    </Marker>
  )
}
