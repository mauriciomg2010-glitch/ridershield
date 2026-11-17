'use client'
// Faixa do MODO ALERTA — fica na tela enquanto a rota tiver zonas de risco pela frente.
import { useEffect, useState } from 'react'
import type { ZoneAlertState } from '@/lib/navigation/zoneAlert'
import { formatDistance } from '@/lib/navigation/instructions'

interface Props {
  alert: ZoneAlertState | null
  isRecalculating: boolean
  onSwitchToSafe: () => void
  top?: number
  /** há rota que evita esta zona? (null/checking = ainda a calcular) */
  safeAlt?: 'checking' | 'yes' | 'no' | 'none-needed' | null
  /** zona onde fica o destino (entrega dentro de zona de risco) */
  destZone?: { id: string; name: string } | null
}

const COLORS: Record<string, string> = { critical: '#4c1d95', high: '#991b1b', medium: '#9a3412', low: '#854d0e' }

export default function ZoneAlertBanner({ alert, isRecalculating, onSwitchToSafe, top = 150, safeAlt = null, destZone = null }: Props) {
  // "Rota livre" aparece por alguns segundos e some
  const [showClear, setShowClear] = useState(false)
  useEffect(() => {
    if (alert?.phase !== 'clear') { setShowClear(false); return }
    setShowClear(true)
    const t = setTimeout(() => setShowClear(false), 6000)
    return () => clearTimeout(t)
  }, [alert?.phase])

  if (!alert || alert.phase === 'none') return null
  if (alert.phase === 'clear') {
    if (!showClear) return null
    return (
      <div className="absolute z-[602]" style={{ top, left: 12, right: 64, background: '#166534', color: 'white', borderRadius: 14, padding: '10px 14px', fontWeight: 700, fontSize: 14, boxShadow: '0 4px 16px rgba(0,0,0,0.4)' }}>
        🛡️ Rota livre de zonas de risco
      </div>
    )
  }

  const inside = alert.phase === 'inside'
  const near = alert.phase === 'approaching'
  // A zona em causa é a do DESTINO: não há como evitar → aviso próprio, sem botão
  const eDestino = !!destZone && alert.zoneId === destZone.id && alert.remaining <= 1
  if (eDestino) {
    return (
      <div className="absolute z-[602]" style={{ top, left: 12, right: 64, background: '#4c1d95', color: 'white', borderRadius: 14, padding: '10px 12px', boxShadow: '0 4px 16px rgba(0,0,0,0.45)' }}>
        <div style={{ fontWeight: 800, fontSize: 15 }}>📦 Entrega dentro de zona de risco</div>
        <div style={{ fontSize: 12, opacity: 0.92, marginTop: 2 }}>
          {destZone.name}{!inside && alert.distToEntry != null ? ` · entras em ${formatDistance(alert.distToEntry)}` : ''} · atenção redobrada, sai pelo mesmo caminho
        </div>
      </div>
    )
  }
  const bg = inside ? COLORS[alert.level ?? 'high'] ?? COLORS.high : near ? '#c2410c' : 'rgba(17,24,39,0.92)'
  const title = inside
    ? `🔴 Você está em zona de risco`
    : near
      ? `⚠️ Zona de risco em ${formatDistance(alert.distToEntry ?? 0)}`
      : `⚠️ ${alert.remaining} ${alert.remaining === 1 ? 'zona de risco' : 'zonas de risco'} nesta rota`
  const sub = inside
    ? `${alert.zoneName ?? ''}${alert.distToExit != null ? ` · saída em ${formatDistance(alert.distToExit)}` : ''}`
    : near
      ? `${alert.zoneName ?? ''}${alert.remaining > 1 ? ` · ${alert.remaining} zonas na rota` : ''}`
      : `Próxima em ${formatDistance(alert.distToEntry ?? 0)}${alert.zoneName ? ` · ${alert.zoneName}` : ''}`

  return (
    <div className="absolute z-[602]" style={{
      top, left: 12, right: 64, background: bg, color: 'white', borderRadius: 14,
      padding: inside || near ? '10px 12px' : '8px 12px',
      display: 'flex', alignItems: 'center', gap: 10,
      boxShadow: '0 4px 16px rgba(0,0,0,0.45)',
      animation: inside ? 'zoneAlertPulse 1.6s ease-in-out infinite' : undefined,
    }}>
      <style>{`@keyframes zoneAlertPulse{0%,100%{box-shadow:0 0 0 0 rgba(239,68,68,.6)}50%{box-shadow:0 0 0 6px rgba(239,68,68,0)}}`}</style>
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ fontWeight: 800, fontSize: inside || near ? 15 : 13 }}>{title}</div>
        {sub && <div style={{ fontSize: 12, opacity: 0.9, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', marginTop: 2 }}>{sub}</div>}
      </div>
      {safeAlt === 'yes' || isRecalculating ? (
        <button
          onClick={onSwitchToSafe}
          disabled={isRecalculating}
          style={{ flexShrink: 0, background: 'white', color: '#14532d', border: 'none', borderRadius: 10, padding: '8px 10px', fontSize: 12, fontWeight: 800, cursor: 'pointer', opacity: isRecalculating ? 0.6 : 1 }}
        >
          {isRecalculating ? 'Calculando…' : '🛡️ Rota segura'}
        </button>
      ) : safeAlt === 'no' ? (
        <span style={{ flexShrink: 0, fontSize: 11, opacity: 0.85, maxWidth: 90, textAlign: 'right' }}>Sem rota alternativa segura</span>
      ) : null}
    </div>
  )
}
