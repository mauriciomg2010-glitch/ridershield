// src/components/Report/ReportModal.tsx
'use client'
import { useState, useRef, useEffect } from 'react'
import { useStore } from '@/lib/store'
import { sentidoAtual } from '@/lib/reportHeading'
import { reportIncident, getRiderScore } from '@/lib/firestore'
import { REPORT_MENU_TYPES, IncidentTypeDef } from '@/data/incidentTypes'
import ReportIcon from './ReportIcon'
import { IncidentType } from '@/types'
import toast from 'react-hot-toast'

interface FrozenLocation {
  lat: number
  lng: number
  timestamp?: number
  heading?: number
  speed?: number
  roadSegment?: string | null
}

interface Props {
  onClose: () => void
  initialLocation?: FrozenLocation | null
  /** Durante a navegação: 1 toque envia (sem ecrã de detalhes). */
  quick?: boolean
}

/** Tempo até o ecrã "Reporte enviado" fechar sozinho. */
const AUTO_CLOSE_MS = 3000

type Screen = 'type' | 'details' | 'confirm'

function ScoreBar({ score }: { score: number }) {
  const color = score >= 70 ? '#22c55e' : score >= 45 ? '#f59e0b' : '#ef4444'
  const label = score >= 70 ? 'Alta fiabilidade' : score >= 45 ? 'Fiabilidade média' : 'Fiabilidade baixa'
  return (
    <div className="mb-4">
      <div className="flex justify-between items-center mb-1">
        <span className="text-xs font-semibold uppercase tracking-wide" style={{ color: 'var(--muted)' }}>
          Score de confiança
        </span>
        <span className="text-sm font-bold" style={{ color }}>{score}%</span>
      </div>
      <div className="h-2 rounded-full overflow-hidden" style={{ background: 'var(--border)' }}>
        <div
          className="h-full rounded-full transition-all duration-500"
          style={{ width: `${score}%`, background: color }}
        />
      </div>
      <p className="text-xs mt-1" style={{ color }}>{label}</p>
    </div>
  )
}

export default function ReportModal({ onClose, initialLocation, quick = false }: Props) {
  const user = useStore((s) => s.user)
  const [screen, setScreen] = useState<Screen>('type')
  const [selectedType, setSelectedType] = useState<IncidentTypeDef | null>(null)
  const selectedTypeState = selectedType
  const [selectedSub, setSelectedSub] = useState<string | null>(null)
  const [description, setDescription] = useState('')
  const [loading, setLoading] = useState(false)
  const [confidenceScore, setConfidenceScore] = useState(0)
  const startY = useRef(0)

  // "Reporte enviado" fecha sozinho (antes ficava à espera do botão Fechar)
  useEffect(() => {
    if (screen !== 'confirm') return
    const t = setTimeout(onClose, AUTO_CLOSE_MS)
    return () => clearTimeout(t)
  }, [screen, onClose])

  function onTouchStart(e: React.TouchEvent) { startY.current = e.touches[0].clientY }
  function onTouchEnd(e: React.TouchEvent) {
    if (screen === 'type' && e.changedTouches[0].clientY - startY.current > 80) onClose()
  }

  async function handleTypeSelect(typeDef: IncidentTypeDef) {
    setSelectedType(typeDef)
    setSelectedSub(null)
    setDescription('')

    const riderScore = user ? await getRiderScore(user.id).catch(() => 50) : 50
    const hour = new Date().getHours()
    const isPeak = (hour >= 7 && hour <= 9) || (hour >= 17 && hour <= 20) || (hour >= 22 || hour <= 2)
    const base = Math.round(
      (riderScore / 100) * 35 +
      (typeDef.initialScore / 100) * 35 +
      (isPeak ? 5 : 0)
    )
    setConfidenceScore(base)
    if (quick) { await handleSubmit(typeDef); return }
    setScreen('details')
  }

  function handleDescChange(val: string) {
    setDescription(val)
    if (!selectedType) return
    setConfidenceScore(prev => {
      const hadDesc = description.length >= 10
      const hasDesc = val.length >= 10
      if (hadDesc === hasDesc) return prev
      return prev + (hasDesc ? 5 : -5)
    })
  }

  async function handleSubmit(typeArg?: IncidentTypeDef) {
    const selectedType = typeArg ?? selectedTypeState
    if (!selectedType || !initialLocation) return
    if (!user) return toast.error('Não autenticado')
    setLoading(true)
    try {
      await reportIncident(
        user.id,
        user.name,
        selectedType.id as IncidentType,
        initialLocation.lat,
        initialLocation.lng,
        {
          description,
          subcategory: selectedSub ?? undefined,
          hasPhoto: false,
          initialScore: selectedType.initialScore,
          mapWeight: selectedType.mapWeight,
          affectsMap: selectedType.affectsMap,
          heading: sentidoAtual(),
        }
      )
      setScreen('confirm')
    } catch {
      toast.error('Erro ao enviar. Tenta novamente.')
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="fixed inset-0 z-[800] flex flex-col justify-end">
      <div className="absolute inset-0 bg-black/60 backdrop-blur-sm" onClick={screen === 'confirm' ? onClose : undefined} />
      <div
        onTouchStart={onTouchStart}
        onTouchEnd={onTouchEnd}
        className="relative rounded-t-3xl animate-slide-up overflow-y-auto"
        style={{
          background: 'var(--surface)',
          borderTop: '1px solid var(--border)',
          maxHeight: '90vh',
          paddingBottom: 'env(safe-area-inset-bottom, 24px)',
        }}
      >
        {/* drag handle */}
        <div className="sticky top-0 flex justify-center pt-3 pb-2" style={{ background: 'var(--surface)' }}>
          <div className="w-10 h-1 rounded-full" style={{ background: 'var(--border)' }} />
        </div>

        {/* ── SCREEN 1: Type Grid ── */}
        {screen === 'type' && (
          <div className="px-5 pb-8">
            <div className="flex items-center justify-between mb-4">
              <h2 className="text-lg font-bold" style={{ color: 'var(--text)' }}>O que aconteceu?</h2>
              <button onClick={onClose} className="p-1" style={{ color: 'var(--muted)' }}>
                <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                  <line x1="18" y1="6" x2="6" y2="18" /><line x1="6" y1="6" x2="18" y2="18" />
                </svg>
              </button>
            </div>

            {/* o local fica gravado no momento do toque em reportar (em segundo plano, sem mapa) */}
            {initialLocation ? null : (
              <div className="flex items-center gap-2 px-3 py-2 rounded-xl mb-4 text-sm bg-red-500/10 border border-red-500/20 text-red-400">
                <div className="w-2 h-2 rounded-full bg-red-400" />
                A aguardar GPS…
              </div>
            )}

            {([['seguranca', '🛡️ Segurança'], ['estrada', '🛣️ Estrada']] as const).map(([grp, titulo]) => (
              <div key={grp} className="mb-3">
                <p className="text-xs font-bold uppercase tracking-wide mb-2" style={{ color: 'var(--muted)' }}>{titulo}</p>
                <div className="grid grid-cols-3 gap-2">
                  {REPORT_MENU_TYPES.filter(t => t.group === grp).map((item) => (
                    <button
                      key={item.id}
                      onClick={() => handleTypeSelect(item)}
                      disabled={!initialLocation || loading}
                      className="flex flex-col items-center py-3 px-1 rounded-xl border text-center transition-all active:scale-95 disabled:opacity-40"
                      style={{ background: 'var(--card)', borderColor: 'var(--border)' }}
                    >
                      <ReportIcon type={item.id} size={40} />
                      <span className="text-xs font-semibold leading-tight mt-1.5" style={{ color: 'var(--text)' }}>{item.label}</span>
                    </button>
                  ))}
                </div>
              </div>
            ))}
            <p className="text-xs text-center mt-4" style={{ color: 'var(--muted)' }}>
              Os reportes são anónimos e protegem a comunidade
            </p>
          </div>
        )}

        {/* ── SCREEN 2: Details ── */}
        {screen === 'details' && selectedType && (
          <div className="px-5 pb-8">
            <div className="flex items-center gap-3 mb-4">
              <button onClick={() => setScreen('type')} style={{ color: 'var(--muted)' }}>
                <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                  <polyline points="15 18 9 12 15 6" />
                </svg>
              </button>
              <div className="flex items-center gap-2 flex-1">
                <ReportIcon type={selectedType.id} size={30} />
                <h2 className="text-lg font-bold" style={{ color: 'var(--text)' }}>{selectedType.label}</h2>
              </div>
            </div>

            <ScoreBar score={confidenceScore} />

            {selectedType.subcategories.length > 0 && (
            <p className="text-xs font-semibold uppercase tracking-wide mb-2" style={{ color: 'var(--muted)' }}>
              O que aconteceu exactamente?
            </p>
            )}
            <div className="grid grid-cols-1 gap-2 mb-4">
              {selectedType.subcategories.map((sub) => (
                <button
                  key={sub.id}
                  onClick={() => setSelectedSub(sub.id === selectedSub ? null : sub.id)}
                  className="flex items-center gap-2 px-3 py-2.5 rounded-xl border text-sm text-left transition-all"
                  style={{
                    background: selectedSub === sub.id ? selectedType.color + '15' : 'var(--card)',
                    borderColor: selectedSub === sub.id ? selectedType.color : 'var(--border)',
                    color: selectedSub === sub.id ? selectedType.color : 'var(--text)',
                  }}
                >
                  <div className="w-4 h-4 rounded-full border flex items-center justify-center flex-shrink-0"
                    style={{ borderColor: selectedSub === sub.id ? selectedType.color : 'var(--border)' }}>
                    {selectedSub === sub.id && (
                      <div className="w-2 h-2 rounded-full" style={{ background: selectedType.color }} />
                    )}
                  </div>
                  {sub.label}
                </button>
              ))}
            </div>

            <p className="text-xs font-semibold uppercase tracking-wide mb-2" style={{ color: 'var(--muted)' }}>
              Descrição (opcional — aumenta o score)
            </p>
            <textarea
              value={description}
              onChange={(e) => handleDescChange(e.target.value)}
              placeholder="Descreve brevemente o que viste…"
              rows={3}
              className="w-full rounded-xl px-4 py-3 text-sm focus:outline-none resize-none mb-5"
              style={{ background: 'var(--card)', border: '1px solid var(--border)', color: 'var(--text)' }}
            />

            <button
              onClick={() => handleSubmit()}
              disabled={loading}
              className="w-full text-white font-bold py-4 rounded-xl text-base disabled:opacity-50"
              style={{ background: `linear-gradient(135deg, ${selectedType.color} 0%, ${selectedType.color}cc 100%)` }}
            >
              {loading ? 'A enviar…' : `Reportar ${selectedType.label}`}
            </button>
          </div>
        )}

        {/* ── SCREEN 3: Confirmation ── */}
        {screen === 'confirm' && selectedType && (
          <div className="px-5 pb-10 text-center">
            <div className="text-5xl mt-6 mb-4">🛡️</div>
            <h2 className="text-xl font-bold mb-2" style={{ color: 'var(--text)' }}>Reporte enviado!</h2>
            <p className="text-sm mb-1" style={{ color: 'var(--muted)' }}>
              {selectedType.emoji} <strong style={{ color: 'var(--text)' }}>{selectedType.label}</strong>
            </p>
            <p className="text-sm mb-6" style={{ color: 'var(--muted)' }}>
              Score de confiança: <strong style={{ color: confidenceScore >= 70 ? '#22c55e' : '#f59e0b' }}>{confidenceScore}%</strong>
            </p>
            {confidenceScore >= 70 ? (
              <div className="px-4 py-3 rounded-xl mb-6 text-sm" style={{ background: '#22c55e15', border: '1px solid #22c55e33', color: '#22c55e' }}>
                ✅ Score alto — zona de atenção actualizada
              </div>
            ) : (
              <div className="px-4 py-3 rounded-xl mb-6 text-sm" style={{ background: '#f59e0b15', border: '1px solid #f59e0b33', color: '#f59e0b' }}>
                ⏳ Aguarda confirmação de outros riders
              </div>
            )}
            <button
              onClick={onClose}
              className="relative w-full font-bold py-4 rounded-xl text-base overflow-hidden"
              style={{ background: 'var(--card)', color: 'var(--text)', border: '1px solid var(--border)' }}
            >
              {/* barra a esvaziar: fecha sozinho em 3 s */}
              <span className="absolute left-0 bottom-0 h-1" style={{ background: selectedType.color, animation: `zivoShrink ${AUTO_CLOSE_MS}ms linear forwards` }} />
              OK
            </button>
            <style>{`@keyframes zivoShrink { from { width: 100% } to { width: 0% } }`}</style>
            <p className="text-xs mt-3" style={{ color: 'var(--muted)' }}>+{selectedType.affectsMap ? '2-3' : '2'} pts no teu rider score</p>
          </div>
        )}
      </div>
    </div>
  )
}
