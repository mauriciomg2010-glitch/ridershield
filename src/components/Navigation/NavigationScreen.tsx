// src/components/Navigation/NavigationScreen.tsx
'use client'
import { useEffect, useRef, useCallback, useState } from 'react'
import { getModeIcon } from '@/components/Map/TransportModeSelector'

function traduzirInstrucao(type: string, modifier: string | undefined, street: string | undefined, distMetros: number): string {
  const dist = distMetros >= 1000
    ? `em ${(distMetros / 1000).toFixed(1)} quilômetros`
    : distMetros > 60
    ? `em ${Math.round(distMetros / 10) * 10} metros`
    : ''
  const rua = street || ''
  const key = `${type}${modifier ? ' ' + modifier : ''}`
  const map: Record<string, string> = {
    'turn right':        `${dist}, vire à direita`,
    'turn left':         `${dist}, vire à esquerda`,
    'turn sharp right':  `${dist}, vire acentuadamente à direita`,
    'turn sharp left':   `${dist}, vire acentuadamente à esquerda`,
    'turn slight right': `${dist}, mantenha-se à direita`,
    'turn slight left':  `${dist}, mantenha-se à esquerda`,
    'turn uturn':        `${dist}, faça inversão de marcha`,
    'continue straight': `siga em frente${rua ? ' por ' + rua : ''}`,
    'straight':          `siga em frente${rua ? ' por ' + rua : ''}`,
    'arrive':            'chegou ao destino',
    'depart':            `siga em frente${rua ? ' por ' + rua : ''}`,
    'roundabout':        `${dist}, entre na rotunda`,
    'rotary':            `${dist}, entre na rotunda`,
    'exit roundabout':   `saia da rotunda${rua ? ' em direção a ' + rua : ''}`,
    'merge':             `${dist}, incorpore-se à via`,
    'fork right':        `${dist}, mantenha-se à direita na bifurcação`,
    'fork left':         `${dist}, mantenha-se à esquerda na bifurcação`,
    'on ramp':           `${dist}, entre na via`,
    'off ramp':          `${dist}, saia da via${rua ? ' em direção a ' + rua : ''}`,
  }
  const base = map[key] ?? map[type] ?? `${dist} ${key}`.trim()
  return rua && !base.includes(rua) && type !== 'arrive' ? `${base}, em direção a ${rua}` : base
}

function getManeuverIcon(type: string, modifier?: string): string {
  if (type === 'arrive') return '🏁'
  if (type === 'depart') return '🧭'
  if (type === 'roundabout' || type === 'rotary') return '↻'
  if (type === 'uturn') return '↩'
  if (modifier?.includes('left')) return '↰'
  if (modifier?.includes('right')) return '↱'
  return '↑'
}

interface Props {
  isNavigating: boolean
  currentStep: any
  nextStep?: any
  distToNext: number
  remainingDist: number
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
}

export default function NavigationScreen({
  isNavigating,
  currentStep,
  nextStep,
  distToNext,
  remainingDist,
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
}: Props) {
  const prevInstructionRef = useRef<string | null>(null)
  const distToNextRef = useRef(0)
  distToNextRef.current = distToNext
  const [muted, setMuted] = useState(false)
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

  // Speak when step changes — use PT-BR natural instruction
  useEffect(() => {
    if (!isNavigating || !currentStep || muted) return
    const instruction = currentStep.maneuver?.instruction ?? ''
    if (!instruction || instruction === prevInstructionRef.current) return
    prevInstructionRef.current = instruction
    const texto = traduzirInstrucao(
      currentStep.maneuver?.type ?? '',
      currentStep.maneuver?.modifier,
      currentStep.name,
      distToNextRef.current,
    )
    speak(texto)
  }, [isNavigating, currentStep, speak, muted])

  // Announce recalculation
  useEffect(() => {
    if (isRecalculating && !muted) speak('A recalcular rota')
  }, [isRecalculating, speak, muted])

  // Cancel speech on nav end
  useEffect(() => {
    if (!isNavigating) {
      window.speechSynthesis?.cancel()
      prevInstructionRef.current = null
    }
    return () => { window.speechSynthesis?.cancel() }
  }, [isNavigating])

  if (!isNavigating) return null

  const progressPct = totalDist > 0 ? Math.min(100, ((totalDist - remainingDist) / totalDist) * 100) : 0
  const arrivalTime = new Date(Date.now() + navEta * 60 * 1000)
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
                  {currentStep.maneuver?.instruction ?? ''}
                </div>
                <div style={{ color: '#93c5fd', fontSize: 13, marginTop: 3 }}>
                  {currentStep.name ? `${currentStep.name} · ` : ''}
                  {distToNext > 999 ? `${(distToNext / 1000).toFixed(1)}km` : `${distToNext}m`}
                </div>
              </div>
              {/* Mode icon — static display */}
              <span style={{ fontSize: 20, flexShrink: 0 }}>{getModeIcon(navModeKey)}</span>
            </div>

            {/* Next step preview */}
            {nextStep?.maneuver?.instruction && (
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
                  A seguir: {nextStep.maneuver.instruction}
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

      {/* Bottom bar */}
      <div className="absolute z-[600]" style={{ bottom: '12px', left: '12px', right: '12px' }}>
        <div style={{
          background: 'var(--surface)',
          border: '1px solid var(--border)',
          borderRadius: 16,
          padding: '12px 16px',
          display: 'flex', alignItems: 'center', gap: 12,
          boxShadow: '0 4px 20px rgba(0,0,0,0.3)',
        }}>
          <div>
            <div style={{ fontSize: 20, fontWeight: 700, color: 'var(--text)', lineHeight: 1 }}>
              {remainingDist > 1000
                ? `${(remainingDist / 1000).toFixed(1)}km`
                : `${Math.round(remainingDist)}m`}
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
