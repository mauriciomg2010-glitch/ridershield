import { useStore } from '@/lib/store'

/** Sentido em que o rider vai agora (graus), para o report de polícia/trânsito avisar só esse lado da pista. */
export function sentidoAtual(): number | null {
  const st = useStore.getState()
  const f = st.currentFix
  if (f && (f.speed ?? 0) > 2 && f.heading != null && isFinite(f.heading)) return f.heading
  const m = st.lastMoveHeading
  return m && Date.now() - m.time < 2 * 60 * 1000 ? m.deg : null   // parado no semáforo: último rumo
}
