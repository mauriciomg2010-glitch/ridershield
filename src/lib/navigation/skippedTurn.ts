// Entrada fechada / viragem que o rider não fez.
// Caso real (Maurício, 22 nov 2026, Kilcarbery Grange): a rota mandava virar para uma entrada do
// condomínio que estava desativada. Ele seguiu em frente e o ZIVO recalculava sempre a mandar voltar
// à MESMA entrada. O Google, depois de ele passar, mandou pela outra entrada.
// Aqui: se o rider estava a menos de 80 m de uma viragem e saiu da rota sem a fazer, guardamos um
// ponto ~20 m DENTRO da rua da viragem (a Mapbox encaixa-o nessa rua); o recálculo pede rotas que não passam por esse ponto.
import { LngLat, distM } from './geo'

const VIRAGENS = new Set(['turn', 'end of road', 'fork', 'off ramp', 'on ramp'])

export interface UltimaNaRota { stepIdx: number; distToManeuver: number; along: number }

export interface TrackerLike {
  steps: any[]
  maneuverAt: number[]
  length: number
  pointAt(along: number): LngLat
}

/** Ponto da viragem que o rider recusou (ou null se não foi isso que aconteceu). */
export function viragemRecusada(tr: TrackerLike, ultima: UltimaNaRota | null, aqui: LngLat): LngLat | null {
  if (!ultima || ultima.distToManeuver > 80) return null
  const st = tr.steps[ultima.stepIdx]
  const tipo = st?.maneuver?.type ?? ''
  const mod = st?.maneuver?.modifier ?? ''
  if (!VIRAGENS.has(tipo) || mod === 'straight' || mod === 'uturn') return null
  const at = tr.maneuverAt[ultima.stepIdx]
  if (at == null || at >= tr.length - 20) return null   // viragem colada ao destino: não bloqueia
  const dentro = tr.pointAt(Math.min(tr.length, at + 20))
  // fez a viragem? (está perto do ponto dentro da rua) → não é recusa
  if (distM(dentro, aqui) < 15) return null
  return dentro
}

/** A rota passa (a menos de `tolM`) por algum dos pontos? */
export function passaPor(coords: LngLat[], pts: LngLat[], tolM = 18): boolean {
  if (!pts.length) return false
  for (const p of pts) {
    for (let i = 1; i < coords.length; i++) {
      if (distSeg(p, coords[i - 1], coords[i]) < tolM) return true
    }
  }
  return false
}

function distSeg(p: LngLat, a: LngLat, b: LngLat): number {
  const k = Math.cos((p[1] * Math.PI) / 180) * 111320
  const ax = (a[0] - p[0]) * k, ay = (a[1] - p[1]) * 110540
  const bx = (b[0] - p[0]) * k, by = (b[1] - p[1]) * 110540
  const dx = bx - ax, dy = by - ay
  const L = dx * dx + dy * dy
  const t = L ? Math.max(0, Math.min(1, -(ax * dx + ay * dy) / L)) : 0
  return Math.hypot(ax + t * dx, ay + t * dy)
}
