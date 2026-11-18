'use client'
// Espaço de anúncio vazio para mostrar a parceiros ("o seu anúncio aparece aqui").
// Substitui os banners de exemplo do menu (topo e fundo). O do Centro de Segurança fica.

interface Props {
  /** 'topo' = faixa larga no cabeçalho do menu; 'cartao' = cartão no meio da lista */
  variante?: 'topo' | 'cartao'
}

export default function AdSlot({ variante = 'cartao' }: Props) {
  const topo = variante === 'topo'
  return (
    <div
      style={{
        position: 'relative',
        height: topo ? 120 : 132,
        borderRadius: topo ? '0 0 12px 12px' : 12,
        border: '1.5px dashed rgba(217,173,60,0.75)',
        background: 'repeating-linear-gradient(135deg, rgba(217,173,60,0.07) 0 12px, rgba(217,173,60,0.02) 12px 24px)',
        display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center',
        textAlign: 'center', padding: '0 18px', gap: 4,
      }}
    >
      <span style={{
        position: 'absolute', top: 8, right: 8, fontSize: 10, fontWeight: 700,
        padding: '2px 7px', borderRadius: 20, background: 'rgba(217,173,60,0.18)', color: '#b8860b',
      }}>
        Espaço publicitário
      </span>
      <svg width="26" height="26" viewBox="0 0 24 24" fill="none" stroke="#d9ad3c" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
        <path d="M3 11v2a1 1 0 0 0 1 1h2l5 4V6L6 10H4a1 1 0 0 0-1 1z" />
        <path d="M15.5 8.5a5 5 0 0 1 0 7" /><path d="M18.5 5.5a9 9 0 0 1 0 13" />
      </svg>
      <div style={{ fontSize: 16, fontWeight: 800, color: 'var(--text)' }}>Anuncie aqui</div>
      <div style={{ fontSize: 12, color: 'var(--muted)', lineHeight: 1.35 }}>
        A sua marca vista por riders de entrega todos os dias
      </div>
    </div>
  )
}
