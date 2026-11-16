// src/components/Navigation/ManeuverIcon.tsx
// Setas de manobra desenhadas (estilo Google Maps) — antes eram emojis/caracteres (↰ ↻ 🏁)
// que mudavam de aspeto entre iPhone e Android.
'use client'

interface Props { type?: string; modifier?: string; exit?: number; size?: number; color?: string; dim?: boolean }

export default function ManeuverIcon({ type = '', modifier = '', size = 44, color = 'white', dim }: Props) {
  const stroke = color
  const op = dim ? 0.55 : 1
  const common = { fill: 'none', stroke, strokeWidth: 3.2, strokeLinecap: 'round' as const, strokeLinejoin: 'round' as const }
  const head = (x: number, y: number, ang: number) => {
    // ponta de seta em (x,y) apontando para `ang` graus (0 = cima)
    const r = (a: number) => (a * Math.PI) / 180
    const L = 7
    const p1 = [x + L * Math.sin(r(ang + 140)), y - L * Math.cos(r(ang + 140))]
    const p2 = [x + L * Math.sin(r(ang - 140)), y - L * Math.cos(r(ang - 140))]
    return <path d={`M${p1[0]} ${p1[1]} L${x} ${y} L${p2[0]} ${p2[1]}`} {...common} />
  }
  const m = modifier.toLowerCase()
  const t = type.toLowerCase()
  let body: JSX.Element

  if (t === 'arrive') {
    body = <>
      <path d="M14 38 V8" {...common} />
      <path d="M14 9 H32 L28 15 L32 21 H14" {...common} fill={stroke} fillOpacity={0.9} />
    </>
  } else if (t === 'roundabout' || t === 'rotary' || t === 'roundabout turn' || t === 'exit roundabout' || t === 'exit rotary') {
    // rotatória: círculo + saída para o lado indicado
    const right = m.includes('right'), left = m.includes('left'), straight = !right && !left
    body = <>
      <path d="M24 40 V30" {...common} />
      <circle cx="24" cy="22" r="7" {...common} />
      {straight && <><path d="M24 15 V5" {...common} />{head(24, 5, 0)}</>}
      {right && <><path d="M29 17 L38 9" {...common} />{head(38, 9, 45)}</>}
      {left && <><path d="M19 17 L10 9" {...common} />{head(10, 9, -45)}</>}
    </>
  } else if (m === 'uturn') {
    body = <><path d="M30 40 V18 a8 8 0 0 0 -16 0 V30" {...common} />{head(14, 30, 180)}</>
  } else if (m === 'sharp right') {
    body = <><path d="M16 40 V14 L32 30" {...common} />{head(32, 30, 135)}</>
  } else if (m === 'sharp left') {
    body = <><path d="M32 40 V14 L16 30" {...common} />{head(16, 30, -135)}</>
  } else if (m === 'slight right') {
    body = <><path d="M18 40 V26 L32 10" {...common} />{head(32, 10, 40)}</>
  } else if (m === 'slight left') {
    body = <><path d="M30 40 V26 L16 10" {...common} />{head(16, 10, -40)}</>
  } else if (m.includes('right') || t === 'off ramp' && m.includes('right')) {
    body = <><path d="M16 40 V22 a6 6 0 0 1 6 -6 H36" {...common} />{head(36, 16, 90)}</>
  } else if (m.includes('left')) {
    body = <><path d="M32 40 V22 a6 6 0 0 0 -6 -6 H12" {...common} />{head(12, 16, -90)}</>
  } else {
    body = <><path d="M24 40 V8" {...common} />{head(24, 8, 0)}</>
  }
  return <svg width={size} height={size} viewBox="0 0 48 48" style={{ opacity: op, flexShrink: 0 }} aria-hidden>{body}</svg>
}
