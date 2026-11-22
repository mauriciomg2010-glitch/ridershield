// Zoom da câmara na navegação (estilo Google Maps).
// 1) Base pela velocidade: mais perto do que antes (pedido do Maurício: ver bem a rua certa).
// 2) Ao aproximar de uma manobra (curva, rotunda, saída) a devagar, aproxima aos poucos para
//    mostrar exatamente em que rua entrar — mais ainda em rotundas.
// 3) Nos últimos metros até ao destino aproxima até se verem os números das casas.

export const NAV_ZOOM_MAX = 18.4

// Medido nos vídeos do Google Maps (22 nov 2026): a ~15 km/h as casas aparecem grandes (≈ z17,2) e
// mesmo a 60–70 km/h o Google quase não afasta (≈ z16,4). O diagnóstico também mostrou o Maurício
// a aproximar à mão até 16,9 quando o ZIVO estava em 15,1.
export function zoomPorVelocidade(speedKmh: number): number {
  if (!speedKmh || speedKmh < 5) return 17.3   // parado / a pé
  if (speedKmh < 15)             return 17.2   // bicicleta / trânsito lento
  if (speedKmh < 30)             return 17.0   // cidade
  if (speedKmh < 50)             return 16.8   // avenidas
  if (speedKmh < 70)             return 16.5
  if (speedKmh < 90)             return 16.1
  return 15.7                                  // via rápida
}

const ROTUNDA = new Set(['roundabout', 'rotary', 'roundabout turn', 'exit roundabout', 'exit rotary'])
const SEM_MANOBRA = new Set(['depart', 'continue', 'new name', 'notification'])

export interface ZoomInput {
  speedKmh: number
  distToManeuverM?: number | null
  remainingM?: number | null
  maneuverType?: string | null
  maneuverModifier?: string | null
}

/** Quanto aproximar (0..0.9) por causa da manobra ou do destino. */
export function zoomBoost(i: ZoomInput): number {
  let boost = 0
  const v = i.speedKmh || 0
  const d = i.distToManeuverM
  const tipo = i.maneuverType ?? ''
  const reto = SEM_MANOBRA.has(tipo) || (i.maneuverModifier === 'straight' && !ROTUNDA.has(tipo))
  if (d != null && d >= 0 && v < 50 && tipo !== 'arrive' && !reto) {
    const RAIO = 250
    if (d < RAIO) {
      const t = Math.min(1, (RAIO - d) / (RAIO - 30))   // 0 a 250 m → 1 a 30 m
      const max = ROTUNDA.has(tipo) ? 0.7 : 0.55
      boost = Math.max(boost, max * t)
    }
  }
  const r = i.remainingM
  if (r != null && r >= 0 && r < 300 && v < 50) {
    const t = Math.min(1, (300 - r) / (300 - 40))
    boost = Math.max(boost, 0.9 * t)
  }
  return boost
}

export function navZoom(i: ZoomInput, bias = 0): number {
  return Math.min(NAV_ZOOM_MAX, zoomPorVelocidade(i.speedKmh) + bias + zoomBoost(i))
}

/** Número da porta no início/fim da morada ("12 Main St" ou "Main St 12" → "12"). */
export function numeroDaPorta(morada?: string | null): string | null {
  if (!morada) return null
  const primeira = morada.split(',')[0].trim()
  const m = primeira.match(/^(\d{1,4}[a-zA-Z]?)\b/) || primeira.match(/\b(\d{1,4}[a-zA-Z]?)$/)
    || primeira.match(/^(?:apt|apartment|unit|flat|no\.?|nº)\s*(\d{1,4}[a-zA-Z]?)/i)
  return m ? m[1] : null
}
