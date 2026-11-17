// src/components/Report/ReportPromptCard.tsx
// Aviso de report (antes de chegar) e pergunta "ainda está aí?" (depois de passar).
// Cartão grande e claro por cima de tudo — antes ficava espremido dentro do rodapé da navegação.
'use client'
import { useEffect, useState } from 'react'
import ReportIcon from './ReportIcon'
import { getIncidentType } from '@/data/incidentTypes'

interface Props {
  type: string
  timestamp?: Date
  phase: 'ahead' | 'passed'
  dist?: number | null
  isMine: boolean
  confirmations?: number
  /** ms que a pergunta fica no ecrã (para a barra de tempo) */
  askMs?: number
  bottom: string | number
  onVote: (vote: 'confirm' | 'deny') => Promise<void> | void
  onClose: () => void
}

function haQuanto(d?: Date): string {
  if (!(d instanceof Date)) return ''
  const m = Math.max(1, Math.round((Date.now() - d.getTime()) / 60000))
  if (m < 60) return `há ${m} min`
  const h = Math.round(m / 60)
  return h < 24 ? `há ${h} h` : `há ${Math.round(h / 24)} d`
}

export default function ReportPromptCard({ type, timestamp, phase, dist, isMine, confirmations = 0, askMs = 20000, bottom, onVote, onClose }: Props) {
  const def = getIncidentType(type)
  const label = def?.label ?? 'Incidente'
  const [busy, setBusy] = useState(false)
  const [startedAt] = useState(() => Date.now())
  const [, tick] = useState(0)
  useEffect(() => {
    if (phase !== 'passed') return
    const t = setInterval(() => tick(x => x + 1), 250)
    return () => clearInterval(t)
  }, [phase])
  const resta = phase === 'passed' ? Math.max(0, 1 - (Date.now() - startedAt) / askMs) : 1

  const votar = async (v: 'confirm' | 'deny') => {
    if (busy) return
    setBusy(true)
    try { await onVote(v) } finally { setBusy(false) }
  }

  const perguntar = phase === 'passed' && !isMine
  return (
    <div style={{
      position: 'fixed', left: 10, right: 10, bottom, zIndex: 700,
      background: 'white', color: '#202124', borderRadius: 18,
      boxShadow: '0 6px 24px rgba(0,0,0,0.35)', overflow: 'hidden',
      borderLeft: `6px solid ${def?.color ?? '#f29900'}`,
    }}>
      <div style={{ padding: '14px 14px 12px', display: 'flex', alignItems: 'center', gap: 12 }}>
        <ReportIcon type={type} size={48} />
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ fontSize: 19, fontWeight: 800, lineHeight: 1.15 }}>
            {perguntar ? `${label} ainda está aí?` : label}
          </div>
          <div style={{ fontSize: 14, color: '#5f6368', marginTop: 3 }}>
            {phase === 'ahead' && dist != null ? <b style={{ color: '#202124' }}>a {dist < 1000 ? `${Math.round(dist / 10) * 10} m` : `${(dist / 1000).toFixed(1).replace('.', ',')} km`}</b> : null}
            {phase === 'ahead' && dist != null ? ' · ' : ''}
            {haQuanto(timestamp)}
            {isMine ? ' · o teu report' : confirmations > 0 ? ` · confirmado por ${confirmations}` : ''}
          </div>
        </div>
        <button onClick={onClose} aria-label="Fechar"
          style={{ background: '#f1f3f4', border: 'none', width: 34, height: 34, borderRadius: '50%', fontSize: 16, color: '#5f6368', cursor: 'pointer', flexShrink: 0 }}>✕</button>
      </div>
      {perguntar && (
        <>
          <div style={{ display: 'flex', gap: 10, padding: '0 14px 14px' }}>
            <button disabled={busy} onClick={() => votar('confirm')}
              style={{ flex: 1, height: 52, borderRadius: 14, border: 'none', background: '#d93025', color: 'white', fontSize: 16, fontWeight: 800, cursor: 'pointer', opacity: busy ? 0.6 : 1 }}>
              Sim, está
            </button>
            <button disabled={busy} onClick={() => votar('deny')}
              style={{ flex: 1, height: 52, borderRadius: 14, border: 'none', background: '#188038', color: 'white', fontSize: 16, fontWeight: 800, cursor: 'pointer', opacity: busy ? 0.6 : 1 }}>
              Não, já saiu
            </button>
          </div>
          <div style={{ height: 4, background: '#e8eaed' }}>
            <div style={{ height: 4, width: `${resta * 100}%`, background: def?.color ?? '#f29900', transition: 'width 0.25s linear' }} />
          </div>
        </>
      )}
    </div>
  )
}
