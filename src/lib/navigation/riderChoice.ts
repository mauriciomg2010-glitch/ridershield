// src/lib/navigation/riderChoice.ts
// "Respeitar a escolha do rider": quando a rota segura obriga a um desvio e o rider a ignora
// repetidamente (sai dela para seguir outro caminho), o ZIVO deixa de lutar com ele — passa a
// recalcular pela rota mais rápida, mantendo os avisos de zona e o botão "Rota segura".
// Antes (teste de Limerick, 18/11): 5 recálculos em 3 min, desvios de +1 km e ordens para voltar,
// enquanto o Google Maps simplesmente seguia o caminho escolhido.

export interface RouteLike { duration?: number; distance?: number; _hits?: unknown[] }

export interface ChoiceState {
  rejects: number        // vezes que o rider saiu de uma rota segura com desvio
  lastAt: number         // quando foi a última
  following: boolean     // já está a seguir o caminho do rider (rota mais rápida)
}

export const DETOUR_MIN_S = 60          // a rota segura é "desvio" se custa ≥ 1 min a mais…
export const DETOUR_MIN_M = 300         // …ou ≥ 300 m a mais
export const REJECTS_TO_FOLLOW = 2      // à 2.ª recusa passa a seguir o rider
export const REJECT_WINDOW_MS = 5 * 60 * 1000

export const newChoiceState = (): ChoiceState => ({ rejects: 0, lastAt: 0, following: false })

/** A rota segura é um desvio em relação à mais rápida (que passa por zona)? */
export function isDetour(safe: RouteLike | null | undefined, fastest: RouteLike | null | undefined): boolean {
  if (!safe || !fastest || safe === fastest) return false
  if (!fastest._hits?.length) return false
  const dS = (safe.duration ?? 0) - (fastest.duration ?? 0)
  const dM = (safe.distance ?? 0) - (fastest.distance ?? 0)
  return dS >= DETOUR_MIN_S || dM >= DETOUR_MIN_M
}

/**
 * Regista um recálculo. Só conta como "recusa" se o rider estava a andar (não é ruído de GPS parado)
 * e a rota de onde saiu era um desvio de segurança.
 */
export function registerReroute(s: ChoiceState, o: { leftDetour: boolean; moving: boolean; now: number }): ChoiceState {
  if (s.following) return s
  if (!o.leftDetour || !o.moving) return s
  const rejects = o.now - s.lastAt > REJECT_WINDOW_MS ? 1 : s.rejects + 1
  return { rejects, lastAt: o.now, following: rejects >= REJECTS_TO_FOLLOW }
}
