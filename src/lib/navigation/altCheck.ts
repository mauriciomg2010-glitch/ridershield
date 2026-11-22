// src/lib/navigation/altCheck.ts — quando vale a pena pedir rotas alternativas (custa um pedido à API).
// Corridas de entrega são curtas (5–10 min): verificar "de X em X minutos" ou não serve (intervalo
// longo) ou gasta à toa (curto). Verifica quando o rider está a ATRASAR em relação ao previsto
// (trânsito), e só de vez em quando se tudo corre bem.

export interface AltCheckState {
  routeStart: number      // quando começou esta rota (ms)
  plannedS: number        // duração prevista da rota quando foi escolhida
  lastCheck: number       // último pedido (ms), 0 = nenhum
  checks: number          // pedidos feitos nesta rota
}

export const ALT = {
  SLIP_S: 60,              // atraso que dispara uma verificação (trânsito)
  PERIODIC_MS: 3 * 60_000, // sem atraso: no máximo de 3 em 3 min…
  PERIODIC_MIN_LEFT_S: 240,//   …e só se ainda faltam 4+ min
  MIN_GAP_MS: 60_000,      // nunca dois pedidos com menos de 1 min
  GRACE_MS: 120_000,       // as alternativas da escolha da rota acabaram de ser calculadas
  MIN_LEFT_S: 180,         // nos últimos 3 min já não compensa trocar
  MIN_LEFT_M: 1500,
  MAX_CHECKS: 4,
}

export const newAltState = (now: number, plannedS: number): AltCheckState => ({ routeStart: now, plannedS, lastCheck: 0, checks: 0 })

/** Atraso (s): tempo já gasto menos o que o plano previa para o troço feito. */
export function slipS(s: AltCheckState, now: number, remainingS: number): number {
  const gasto = (now - s.routeStart) / 1000
  const previstoFeito = Math.max(0, s.plannedS - remainingS)
  return gasto - previstoFeito
}

export type AltMotivo = 'atraso' | 'periodica' | null

export function shouldCheckAlt(s: AltCheckState, now: number, remainingS: number, remainingM: number): AltMotivo {
  if (s.checks >= ALT.MAX_CHECKS) return null
  if (remainingS < ALT.MIN_LEFT_S || remainingM < ALT.MIN_LEFT_M) return null
  if (s.lastCheck && now - s.lastCheck < ALT.MIN_GAP_MS) return null
  if (slipS(s, now, remainingS) >= ALT.SLIP_S) return 'atraso'
  if (now - s.routeStart < ALT.GRACE_MS) return null
  const desde = s.lastCheck || s.routeStart
  if (now - desde >= ALT.PERIODIC_MS && remainingS >= ALT.PERIODIC_MIN_LEFT_S) return 'periodica'
  return null
}
