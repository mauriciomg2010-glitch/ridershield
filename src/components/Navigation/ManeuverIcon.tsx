// src/components/Navigation/ManeuverIcon.tsx
// Setas de manobra desenhadas (estilo Google Maps) — antes eram emojis/caracteres (↰ ↻ 🏁)
// que mudavam de aspeto entre iPhone e Android.
'use client'
import { distM, bearing, LngLat } from '@/lib/navigation/geo'

interface Props { type?: string; modifier?: string; exit?: number; size?: number; color?: string; dim?: boolean
  /** ângulo da saída da rotatória em relação à entrada (0 = em frente, +90 = direita, −90 = esquerda) */
  exitAngle?: number | null }

/**
 * Ângulo real da saída da rotatória, a partir da geometria do passo: direção da estrada de saída
 * (entre ~90 e ~140 m depois da entrada) menos a direção em que se chega. Assim a seta mostra a
 * 2ª, 3ª ou 4ª saída como ela é — antes só havia "esquerda/frente/direita".
 */
export function roundaboutExitAngle(step: any): number | null {
  try {
    const coords: LngLat[] = step?.geometry?.coordinates
    const before = step?.maneuver?.bearing_before
    if (!Array.isArray(coords) || coords.length < 3 || typeof before !== 'number') return null
    const total = coords.slice(1).reduce((s, c, i) => s + distM(coords[i], c), 0)
    const a = Math.min(90, total * 0.55), b = Math.min(140, total * 0.95)
    const at = (d: number): LngLat => {
      let acc = 0
      for (let i = 1; i < coords.length; i++) {
        const l = distM(coords[i - 1], coords[i])
        if (acc + l >= d) { const t = l > 0 ? (d - acc) / l : 0; return [coords[i - 1][0] + (coords[i][0] - coords[i - 1][0]) * t, coords[i - 1][1] + (coords[i][1] - coords[i - 1][1]) * t] }
        acc += l
      }
      return coords[coords.length - 1]
    }
    const pa = at(a), pb = at(b)
    if (distM(pa, pb) < 10) return null
    let ang = bearing(pa, pb) - before
    ang = ((ang + 540) % 360) - 180
    return ang
  } catch { return null }
}

export default function ManeuverIcon({ type = '', modifier = '', size = 44, color = 'white', dim, exitAngle = null, exit }: Props) {
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
    // Rotatória (Irlanda: sentido horário). Entrada em baixo; arco grosso até à saída real.
    const ang = exitAngle != null ? exitAngle
      : m.includes('sharp right') ? 135 : m.includes('slight right') ? 45 : m.includes('right') ? 90
      : m.includes('sharp left') ? -135 : m.includes('slight left') ? -45 : m.includes('left') ? -90
      : m === 'uturn' ? 180 : 0
    const cx = 24, cy = 21, R = 8
    // ângulos de ecrã: 0 = cima, 90 = direita; entrada em 180 (baixo); horário = ângulos a subir
    let fim = ((ang % 360) + 360) % 360
    if (fim <= 180) fim += 360           // 180 → … → 540 no sentido horário
    const pt = (deg: number, r: number) => [cx + r * Math.sin(deg * Math.PI / 180), cy - r * Math.cos(deg * Math.PI / 180)]
    const [sx, sy] = pt(180, R)
    const [ex, ey] = pt(fim, R)
    const large = fim - 180 > 180 ? 1 : 0
    const [ox, oy] = pt(fim, R + 12)
    body = <>
      <circle cx={cx} cy={cy} r={R} fill="none" stroke={stroke} strokeWidth={2} strokeOpacity={0.4} />
      <path d={`M24 44 L${sx} ${sy} A ${R} ${R} 0 ${large} 1 ${ex} ${ey} L${ox} ${oy}`} {...common} />
      {head(ox, oy, fim % 360)}
      {exit ? <text x={cx} y={cy + 3.5} textAnchor="middle" fontSize="10" fontWeight="800" fill={stroke} fontFamily="system-ui, sans-serif">{exit}</text> : null}
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
