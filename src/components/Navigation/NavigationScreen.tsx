// src/components/Navigation/NavigationScreen.tsx
'use client'
import { useEffect, useRef, useCallback, useState } from 'react'
import { getModeIcon } from '@/components/Map/TransportModeSelector'
import { INCIDENT_TYPES } from '@/data/incidentTypes'
import { Incident } from '@/types'
import { VoiceGuide, instructionText, formatDistance } from '@/lib/navigation/instructions'

function timeAgo(d: Date): string {
  const mins = Math.floor((Date.now() - d.getTime()) / 60000)
  if (mins < 1) return 'agora mesmo'
  if (mins === 1) return 'há 1 min'
  if (mins < 60) return `há ${mins} min`
  const h = Math.floor(mins / 60)
  return h === 1 ? 'há 1h' : `há ${h}h`
}

function getManeuverIcon(type: string, modifier?: string): string {
  if (type === 'arrive') return '🏁'
  if (type === 'depart') return '🧭'
  if (type === 'roundabout' || type === 'rotary') return '↻'
  if (modifier === 'uturn') return '↩'
  if (modifier === 'slight left') return '↖'
  if (modifier === 'slight right') return '↗'
  if (modifier?.includes('left')) return '↰'
  if (modifier?.includes('right')) return '↱'
  return '↑'
}

interface Props {
  isNavigating: boolean
  currentStep: any
  nextStep?: any
  steps?: any[]
  stepIdx?: number
  nextGap?: number          // metros entre a próxima manobra e a seguinte
  speedMps?: number
  hasArrived?: boolean
  distToNext: number
  remainingDist: number
  remainingSec?: number
  navEta: number
  riskOnRoute: boolean
  navModeKey: string
  isRecalculating: boolean
  onCancel: () => void
  northLocked: boolean
  navBearing: number
  onToggleNorth: () => void
  onSOS?: () => void
  onReport?: () => void
  totalDist?: number
  speed?: number
  heading?: number
  hideControls?: boolean
  nearbyIncident?: Incident | null
  currentUserId?: string
  onVoteIncident?: (id: string, vote: 'confirm' | 'deny') => void
}

export default function NavigationScreen({
  isNavigating,
  currentStep,
  nextStep,
  steps = [],
  stepIdx = 0,
  nextGap,
  speedMps = 0,
  hasArrived = false,
  distToNext,
  remainingDist,
  remainingSec,
  navEta,
  riskOnRoute,
  navModeKey,
  isRecalculating,
  onCancel,
  northLocked,
  navBearing,
  onToggleNorth,
  onSOS,
  onReport,
  totalDist = 0,
  speed = 0,
  heading = 0,
  hideControls = false,
  nearbyIncident = null,
  currentUserId,
  onVoteIncident,
}: Props) {
  const [muted, setMuted] = useState(false)
  const [voting, setVoting] = useState(false)
  // Cache voices — on mobile they load asynchronously after mount
  const voicesRef = useRef<SpeechSynthesisVoice[]>([])

  // Load and cache voices; re-fires on voiceschanged (iOS/Android async load)
  useEffect(() => {
    if (typeof window === 'undefined' || !window.speechSynthesis) return
    const load = () => { voicesRef.current = window.speechSynthesis.getVoices() }
    load()
    window.speechSynthesis.addEventListener('voiceschanged', load)
    return () => window.speechSynthesis.removeEventListener('voiceschanged', load)
  }, [])

  const getVoice = useCallback((): SpeechSynthesisVoice | null => {
    const voices = voicesRef.current.length
      ? voicesRef.current
      : (typeof window !== 'undefined' ? window.speechSynthesis?.getVoices() ?? [] : [])
    const filters: Array<(v: SpeechSynthesisVoice) => boolean> = [
      v => v.lang === 'pt-BR' && v.name.toLowerCase().includes('francisca'),
      v => v.lang === 'pt-BR' && v.name.toLowerCase().includes('luciana'),
      v => v.lang === 'pt-BR' && v.name.toLowerCase().includes('vitoria'),
      v => v.lang === 'pt-BR' && !v.name.toLowerCase().includes('male'),
      v => v.lang === 'pt-BR',
      v => v.lang === 'pt-PT',
      v => v.lang.startsWith('pt'),
    ]
    for (const f of filters) {
      const voice = voices.find(f)
      if (voice) return voice
    }
    return null
  }, [])

  const speak = useCallback((text: string) => {
    if (typeof window === 'undefined' || !window.speechSynthesis) return
    if (muted) return
    window.speechSynthesis.cancel()
    const utterance = new SpeechSynthesisUtterance(text)
    const voice = getVoice()
    if (voice) utterance.voice = voice
    utterance.lang = 'pt-BR'
    utterance.rate = 0.9
    utterance.pitch = 1.0
    utterance.volume = 1
    window.speechSynthesis.speak(utterance)
  }, [getVoice, muted])

  // Guia de voz estilo Google Maps: aviso antecipado ("Em 300 metros, vire à direita"),
  // aviso na hora da manobra e "Siga em frente por 2 km" quando a próxima está longe.
  // (Antes falava uma única vez, logo depois da manobra anterior, e às vezes em inglês.)
  const guideRef = useRef(new VoiceGuide())
  const guideStepsRef = useRef<any[] | null>(null)
  useEffect(() => {
    if (!isNavigating || muted || !steps.length || hasArrived) return
    // Rota nova (recálculo / troca de rota) → recomeça os avisos
    if (guideStepsRef.current !== steps) { guideStepsRef.current = steps; guideRef.current.reset() }
    const text = guideRef.current.next(steps, stepIdx, distToNext, speedMps, nextGap)
    if (text) speak(text)
  }, [isNavigating, steps, stepIdx, distToNext, speedMps, nextGap, muted, hasArrived, speak])

  useEffect(() => {
    if (hasArrived && isNavigating && !muted) speak('Você chegou ao destino')
  }, [hasArrived, isNavigating, muted, speak])

  // Announce recalculation
  useEffect(() => {
    if (isRecalculating && !muted) speak('Recalculando rota')
  }, [isRecalculating, speak, muted])

  // Cancel speech on nav end
  useEffect(() => {
    if (!isNavigating) {
      window.speechSynthesis?.cancel()
      guideRef.current.reset()
      guideStepsRef.current = null
    }
    return () => { window.speechSynthesis?.cancel() }
  }, [isNavigating])

  // Reset voting state when incident panel closes
  useEffect(() => {
    if (!nearbyIncident) setVoting(false)
  }, [nearbyIncident])

  if (!isNavigating) return null

  const progressPct = totalDist > 0 ? Math.min(100, ((totalDist - remainingDist) / totalDist) * 100) : 0
  const arrivalTime = new Date(Date.now() + (remainingSec ?? navEta * 60) * 1000)
  const arrivalStr = arrivalTime.toLocaleTimeString('pt-PT', { hour: '2-digit', minute: '2-digit' })

  return (
    <>
      {/* Route progress bar */}
      {totalDist > 0 && (
        <div className="absolute z-[601]" style={{ top: 0, left: 0, right: 0, height: 3, background: 'rgba(0,0,0,0.2)' }}>
          <div style={{ height: '100%', background: '#4ade80', width: `${progressPct}%`, transition: 'width 1s linear' }} />
        </div>
      )}

      {/* Speed badge */}
      {speed > 0 && (
        <div className="absolute z-[601]" style={{
          bottom: 96, left: 16,
          background: speed > 80 ? '#dc2626' : speed > 50 ? '#f59e0b' : '#16a34a',
          borderRadius: 8, padding: '5px 11px', color: 'white', fontWeight: 800, fontSize: 15,
          boxShadow: '0 2px 8px rgba(0,0,0,0.35)',
        }}>
          {speed} <span style={{ fontSize: 10, fontWeight: 600 }}>km/h</span>
        </div>
      )}

      {/* Top navigation banner */}
      {currentStep && (
        <div className="absolute z-[600]" style={{ top: 0, left: 0, right: 0 }}>
          <div style={{
            background: '#1a5e38',
            borderRadius: '0 0 18px 18px',
            padding: '14px 16px 12px',
            boxShadow: '0 4px 24px rgba(0,0,0,0.5)',
          }}>
            {riskOnRoute && (
              <div style={{ color: '#fbbf24', fontSize: 11, fontWeight: 700, marginBottom: 6, letterSpacing: 0.3 }}>
                ⚠️ Zona de risco à frente
              </div>
            )}
            {isRecalculating && (
              <div style={{ color: '#86efac', fontSize: 11, fontWeight: 700, marginBottom: 6 }}>
                🔄 A recalcular rota...
              </div>
            )}
            <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
              <div style={{
                width: 52, height: 52, borderRadius: '50%', flexShrink: 0,
                background: 'rgba(255,255,255,0.15)', border: '2px solid rgba(255,255,255,0.3)',
                display: 'flex', alignItems: 'center', justifyContent: 'center',
                fontSize: 26, lineHeight: 1, color: 'white',
              }}>
                {getManeuverIcon(currentStep.maneuver?.type ?? '', currentStep.maneuver?.modifier)}
              </div>
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{
                  color: 'white', fontSize: 17, fontWeight: 700, lineHeight: 1.25,
                  overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
                }}>
                  {instructionText(currentStep)}
                </div>
                <div style={{ color: '#93c5fd', fontSize: 13, marginTop: 3 }}>
                  {currentStep.name ? `${currentStep.name} · ` : ''}
                  {formatDistance(distToNext)}
                </div>
              </div>
              {/* Mode icon — static display */}
              <span style={{ fontSize: 20, flexShrink: 0 }}>{getModeIcon(navModeKey)}</span>
            </div>

            {/* Next step preview */}
            {nextStep?.maneuver && nextStep.maneuver.type !== 'arrive' && (
              <div style={{
                marginTop: 8, paddingTop: 8,
                borderTop: '1px solid rgba(255,255,255,0.1)',
                display: 'flex', alignItems: 'center', gap: 8,
              }}>
                <span style={{ color: '#475569', fontSize: 14, flexShrink: 0 }}>
                  {getManeuverIcon(nextStep.maneuver?.type ?? '', nextStep.maneuver?.modifier)}
                </span>
                <span style={{
                  color: '#64748b', fontSize: 11,
                  overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
                }}>
                  A seguir: {instructionText(nextStep)}
                </span>
              </div>
            )}
          </div>
        </div>
      )}

      {/* Side column: compass + mute + SOS — hidden when any report panel is open */}
      {!hideControls && <div className="absolute z-[600]" style={{ top: 140, right: 12, display: 'flex', flexDirection: 'column', gap: 10 }}>
        <button
          onClick={onToggleNorth}
          title={northLocked ? 'Norte fixo' : 'Norte livre'}
          style={{
            width: 44, height: 44, borderRadius: '50%',
            background: northLocked ? '#1a56db' : 'var(--surface)',
            border: `2px solid ${northLocked ? '#1a56db' : 'var(--border)'}`,
            display: 'flex', alignItems: 'center', justifyContent: 'center',
            cursor: 'pointer', boxShadow: '0 2px 12px rgba(0,0,0,0.4)',
            padding: 0,
          }}
        >
          <svg
            width="24" height="24" viewBox="0 0 24 24"
            style={{
              transform: northLocked ? 'rotate(0deg)' : `rotate(${-heading}deg)`,
              transition: 'transform 0.15s linear',
            }}
          >
            <polygon points="12,2 16,12 12,10 8,12"
              fill={northLocked ? 'white' : '#dc3545'} />
            <polygon points="12,22 16,12 12,14 8,12"
              fill={northLocked ? 'rgba(255,255,255,0.5)' : '#94a3b8'} />
          </svg>
        </button>
        <button
          onClick={() => {
            setMuted(m => {
              const next = !m
              // Cancel any in-progress speech immediately when muting
              if (next && typeof window !== 'undefined') window.speechSynthesis?.cancel()
              return next
            })
          }}
          style={{
            width: 44, height: 44, borderRadius: '50%',
            background: muted ? 'rgba(239,68,68,0.15)' : 'var(--surface)',
            border: `2px solid ${muted ? '#ef4444' : 'var(--border)'}`,
            display: 'flex', alignItems: 'center', justifyContent: 'center',
            cursor: 'pointer', boxShadow: '0 2px 12px rgba(0,0,0,0.4)',
            fontSize: 18,
          }}
        >
          {muted ? '🔇' : '🔊'}
        </button>
        {onSOS && (
          <button
            onClick={onSOS}
            style={{
              width: 44, height: 44, borderRadius: '50%',
              background: '#8b0000', border: '2px solid #dc3545',
              display: 'flex', alignItems: 'center', justifyContent: 'center',
              cursor: 'pointer', boxShadow: '0 2px 12px rgba(220,53,69,0.5)',
              animation: 'sosRingPulse 1.5s ease-in-out infinite',
            }}
          >
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none">
              <path d="M12 2L3 7v5c0 5.25 3.75 10.15 9 11.35C17.25 22.15 21 17.25 21 12V7L12 2z" fill="white"/>
              <line x1="11" y1="7" x2="13" y2="17" stroke="#dc3545" strokeWidth="2" strokeLinecap="round"/>
            </svg>
          </button>
        )}
        {/* Report button moved to bottom-right standalone position below */}
      </div>}

      {/* Bottom bar — expands upward when a nearby incident is detected */}
      <div className="absolute z-[600]" style={{ bottom: '12px', left: '12px', right: '12px' }}>
        <div style={{
          background: 'var(--surface)',
          border: `1px solid ${nearbyIncident ? '#f59e0b' : 'var(--border)'}`,
          borderRadius: 16,
          overflow: 'hidden',
          boxShadow: nearbyIncident
            ? '0 4px 24px rgba(245,158,11,0.35)'
            : '0 4px 20px rgba(0,0,0,0.3)',
          transition: 'border-color 0.3s ease, box-shadow 0.3s ease',
        }}>
          {/* Incident confirmation panel — animates in/out */}
          {(() => {
            const incType = nearbyIncident
              ? INCIDENT_TYPES.find(t => t.id === nearbyIncident.type)
              : null
            return (
              <div style={{
                maxHeight: nearbyIncident ? '120px' : '0px',
                overflow: 'hidden',
                transition: 'max-height 0.3s ease',
              }}>
                <div style={{ padding: '12px 16px 0' }}>
                  {/* Header row */}
                  <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 10 }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                      <span style={{ fontSize: 18 }}>{incType?.emoji ?? '⚠️'}</span>
                      <span style={{ fontSize: 14, fontWeight: 700, color: 'var(--text)' }}>
                        {incType?.label ?? 'Incidente'}
                      </span>
                    </div>
                    <span style={{ fontSize: 11, color: 'var(--muted)' }}>
                      {nearbyIncident ? timeAgo(nearbyIncident.timestamp) : ''}
                    </span>
                  </div>
                  {/* Vote buttons */}
                  <div style={{ display: 'flex', gap: 8, marginBottom: 12 }}>
                    <button
                      disabled={voting}
                      onClick={async () => {
                        if (!nearbyIncident || !onVoteIncident || voting) return
                        setVoting(true)
                        await onVoteIncident(nearbyIncident.id, 'confirm')
                        setVoting(false)
                      }}
                      style={{
                        flex: 1, padding: '8px 0', borderRadius: 10, border: 'none',
                        background: voting ? 'rgba(34,197,94,0.1)' : '#16a34a',
                        color: voting ? '#16a34a' : 'white',
                        fontWeight: 700, fontSize: 13, cursor: voting ? 'default' : 'pointer',
                        transition: 'background 0.2s',
                      }}
                    >
                      ✓ Ainda está
                    </button>
                    <button
                      disabled={voting}
                      onClick={async () => {
                        if (!nearbyIncident || !onVoteIncident || voting) return
                        setVoting(true)
                        await onVoteIncident(nearbyIncident.id, 'deny')
                        setVoting(false)
                      }}
                      style={{
                        flex: 1, padding: '8px 0', borderRadius: 10, border: 'none',
                        background: voting ? 'rgba(239,68,68,0.1)' : '#dc2626',
                        color: voting ? '#dc2626' : 'white',
                        fontWeight: 700, fontSize: 13, cursor: voting ? 'default' : 'pointer',
                        transition: 'background 0.2s',
                      }}
                    >
                      ✗ Já saiu
                    </button>
                  </div>
                  {/* Divider */}
                  <div style={{ height: 1, background: 'var(--border)', marginLeft: -16, marginRight: -16 }} />
                </div>
              </div>
            )
          })()}

          {/* Distance / ETA / Cancel row — always visible */}
          <div style={{ padding: '12px 16px', display: 'flex', alignItems: 'center', gap: 12 }}>
            <div>
              <div style={{ fontSize: 20, fontWeight: 700, color: 'var(--text)', lineHeight: 1 }}>
                {formatDistance(remainingDist)}
              </div>
              <div style={{ fontSize: 12, color: 'var(--muted)', marginTop: 2 }}>{navEta} min · Chega às {arrivalStr}</div>
            </div>
            <div style={{ flex: 1 }} />
            <button
              onClick={onCancel}
              style={{
                background: '#ef4444', border: 'none', borderRadius: 12,
                padding: '9px 20px', color: 'white', fontWeight: 700,
                fontSize: 13, cursor: 'pointer',
              }}
            >
              Cancelar
            </button>
          </div>
        </div>
      </div>

      {/* Report button — bottom-right, consistent with main map position */}
      {onReport && !hideControls && (
        <button
          onClick={onReport}
          title="Reportar incidente"
          className="absolute z-[601]"
          style={{
            bottom: 96, right: 12,
            width: 48, height: 48, borderRadius: '50%',
            background: '#f59e0b',
            border: '2px solid #f59e0b',
            display: 'flex', alignItems: 'center', justifyContent: 'center',
            cursor: 'pointer',
            boxShadow: '0 0 16px rgba(245,158,11,0.5), 0 2px 12px rgba(0,0,0,0.4)',
            fontSize: 20,
          }}
        >
          ⚠️
        </button>
      )}
    </>
  )
}
