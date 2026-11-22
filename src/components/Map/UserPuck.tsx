'use client'
// Seta/pino do usuário. Durante a navegação tem a PRÓPRIA animação (requestAnimationFrame):
// só este componente pequeno é redesenhado a cada quadro, não o mapa inteiro.
import { MutableRefObject, ReactNode, useEffect, useState } from 'react'
import { Marker } from 'react-map-gl/mapbox'
import { paleta } from '@/lib/googleLook'

interface Props {
  navigating: boolean
  posRef: MutableRefObject<{ lat: number; lng: number }>
  headingRef: MutableRefObject<number>
  northLocked: boolean
  fallback: { lat: number; lng: number } | null
  idlePin: ReactNode
  noite?: boolean
}

export default function UserPuck({ navigating, posRef, headingRef, northLocked, fallback, idlePin, noite = false }: Props) {
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
  const P = paleta(noite)
  return (
    // Seta como a do Google Maps: disco deitado no chão (acompanha a inclinação) com a seta azul
    // (de dia, disco branco) ou branca (à noite, disco azul)
    <Marker longitude={where.lng} latitude={where.lat} anchor={navigating ? 'center' : 'bottom'}
      pitchAlignment={navigating ? 'map' : 'auto'} rotationAlignment={navigating ? 'viewport' : 'auto'}>
      {navigating ? (
        <div style={{
          width: 58, height: 58,
          transform: northLocked ? `rotate(${heading}deg)` : 'rotate(0deg)',
          pointerEvents: 'none',
        }}>
          <svg width="58" height="58" viewBox="0 0 58 58">
            <defs>
              <filter id="zivoPuckSombra" x="-30%" y="-30%" width="160%" height="160%">
                <feDropShadow dx="0" dy="1.5" stdDeviation="2" floodColor="#000" floodOpacity="0.35" />
              </filter>
            </defs>
            <circle cx="29" cy="29" r="25" fill={P.setaFundo} fillOpacity={noite ? 0.92 : 1} filter="url(#zivoPuckSombra)" />
            {!noite && <circle cx="29" cy="29" r="25" fill="none" stroke="rgba(0,0,0,0.08)" strokeWidth="1" />}
            <polygon points="29,10 42,42 29,35 16,42" fill={P.seta} strokeLinejoin="round" stroke={P.seta} strokeWidth="2" />
          </svg>
        </div>
      ) : idlePin}
    </Marker>
  )
}
