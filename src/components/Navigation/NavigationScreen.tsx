// src/components/Navigation/NavigationScreen.tsx
'use client'
import { useEffect, useRef, useCallback, useState } from 'react'
import { diag } from '@/lib/diagnostics'
import ManeuverIcon, { roundaboutExitAngle } from './ManeuverIcon'
import ReportIcon from '@/components/Report/ReportIcon'
import { INCIDENT_TYPES } from '@/data/incidentTypes'
import { Incident } from '@/types'
import { VoiceGuide, bannerText, formatDistance, formatDuration, spokenDistance } from '@/lib/navigation/instructions'
import type { ZoneAlertState } from '@/lib/navigation/zoneAlert'
import ZoneAlertBanner from './ZoneAlertBanner'

function timeAgo(d: Date): string {
  const mins = Math.floor((Date.now() - d.getTime()) / 60000)
  if (mins < 1) return 'agora mesmo'
  if (mins === 1) return 'há 1 min'
  if (mins < 60) return `há ${mins} min`
  const h = Math.floor(mins / 60)
  return h === 1 ? 'há 1h' : `há ${h}h`
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
  /** limite de velocidade (km/h) da rua atual, quando conhecido */
  speedLimit?: number | null
  /** 'ahead' = aviso antes de chegar; 'passed' = já passou, pergunta se ainda está */
  incidentPhase?: 'ahead' | 'passed'
  incidentDist?: number | null
  currentUserId?: string
  onVoteIncident?: (id: string, vote: 'confirm' | 'deny') => void
  zoneAlert?: ZoneAlertState | null
  zoneSpeech?: { id: number; text: string } | null
  onSwitchToSafe?: () => void
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
  speedLimit = null,
  incidentPhase = 'passed',
  incidentDist = null,
  currentUserId,
  onVoteIncident,
  zoneAlert = null,
  zoneSpeech = null,
  onSwitchToSafe,
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
    diag('voz', { texto: text, mudo: muted })
    if (typeof window === 'undefined' || !window.speechSynthesis) return
    if (muted) return
    // não corta a frase que está sendo falada (ex.: aviso de zona); só descarta fila antiga
    if (window.speechSynthesis.pending) window.speechSynthesis.cancel()
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
    if (!isNavigating || muted || !steps.length || hasArrived) {
      if (isNavigating) diag('voz-pausa', { mudo: muted, passos: steps.length, chegou: hasArrived, passo: stepIdx, ate: Math.round(distToNext) }, 10000)
      return
    }
    // Rota nova (recálculo / troca de rota) → recomeça os avisos
    if (guideStepsRef.current !== steps) { guideStepsRef.current = steps; guideRef.current.reset() }
    const text = guideRef.current.next(steps, stepIdx, distToNext, speedMps, nextGap)
    if (text) speak(text)
    else diag('voz-nada', { passo: stepIdx, tipo: steps[stepIdx]?.maneuver?.type, ate: Math.round(distToNext), vel: +speedMps.toFixed(1) }, 3000)
  }, [isNavigating, steps, stepIdx, distToNext, speedMps, nextGap, muted, hasArrived, speak])

  useEffect(() => {
    if (hasArrived && isNavigating && !muted) speak('Você chegou ao destino')
  }, [hasArrived, isNavigating, muted, speak])

  // Modo alerta: avisos de zona de risco
  const lastZoneSpeechRef = useRef(0)
  useEffect(() => {
    if (!isNavigating || muted || !zoneSpeech || zoneSpeech.id === lastZoneSpeechRef.current) return
    lastZoneSpeechRef.current = zoneSpeech.id
    speak(zoneSpeech.text)
  }, [isNavigating, muted, zoneSpeech, speak])

  const lastRecalcSpeechRef = useRef(0)
  // Announce recalculation
  useEffect(() => {
    // no máximo 1 vez a cada 30 s (antes repetia a cada recálculo, até 5 vezes seguidas numa rotatória)
    if (isRecalculating && !muted && Date.now() - lastRecalcSpeechRef.current > 30_000) {
      lastRecalcSpeechRef.current = Date.now()
      speak('Recalculando rota')
    }
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

  // Voz: avisa uma vez por report, antes de chegar
  const spokenIncidentRef = useRef<string | null>(null)
  useEffect(() => {
    if (!isNavigating || muted || !nearbyIncident || incidentPhase !== 'ahead') return
    if (spokenIncidentRef.current === nearbyIncident.id) return
    spokenIncidentRef.current = nearbyIncident.id
    const label = INCIDENT_TYPES.find(t => t.id === nearbyIncident.type)?.label ?? 'Incidente'
    const d = incidentDist != null && incidentDist >= 30 ? ` a ${spokenDistance(incidentDist)}` : ' logo à frente'
    speak(`Atenção: ${label} reportado${d}`)
  }, [isNavigating, muted, nearbyIncident, incidentPhase, incidentDist, speak])

  // Reset voting state when incident panel closes
  useEffect(() => {
    if (!nearbyIncident) setVoting(false)
  }, [nearbyIncident])

  if (!isNavigating) return null

  const arrivalTime = new Date(Date.now() + (remainingSec ?? navEta * 60) * 1000)
  const arrivalStr = arrivalTime.toLocaleTimeString('pt-PT', { hour: '2-digit', minute: '2-digit' })

  return (
    <>
      {/* Limite da rua + velocidade (como no Google Maps). Passou do limite → número a vermelho */}
      {(speed > 0 || speedLimit) && (
        <div className="absolute z-[601]" style={{ bottom: 100, left: 14, display: 'flex', alignItems: 'flex-end', gap: 6 }}>
          {speedLimit ? (
            <div style={{
              width: 46, height: 46, borderRadius: '50%', background: 'white', border: '4px solid #d93025',
              boxShadow: '0 1px 4px rgba(0,0,0,0.3)', display: 'flex', alignItems: 'center', justifyContent: 'center',
              fontSize: 17, fontWeight: 800, color: '#202124',
            }}>{speedLimit}</div>
          ) : null}
          <div style={{
            width: 54, height: 54, borderRadius: '50%', background: 'white',
            color: speedLimit && speed > speedLimit + 4 ? '#d93025' : '#202124', boxShadow: '0 1px 4px rgba(0,0,0,0.3)',
            display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', lineHeight: 1,
          }}>
            <span style={{ fontSize: 19, fontWeight: 700 }}>{speed > 0 ? speed : '--'}</span>
            <span style={{ fontSize: 9, fontWeight: 600, color: '#5f6368', marginTop: 2 }}>km/h</span>
          </div>
        </div>
      )}

      {/* Barra de navegação (estilo Google Maps): seta grande + distância à esquerda,
          estrada em letra grande à direita, "Depois" quando a próxima manobra vem logo a seguir */}
      {currentStep && (() => {
        const tipo = currentStep.maneuver?.type ?? ''
        const mod = currentStep.maneuver?.modifier ?? ''
        const chegando = tipo === 'arrive'
        const longeDoFim = chegando && distToNext > 80
        const isRot = /roundabout|rotary/.test(tipo)
        const exitN = currentStep.maneuver?.exit
        const via = (currentStep.name || '').trim()
        const ref = (currentStep.ref || '').split(';')[0].trim()
        const nomeSemRef = ref && via.toUpperCase().startsWith(ref.toUpperCase()) ? via.slice(ref.length).replace(/^[\s/,-]+/, '') : via
        const titulo = chegando ? 'Destino' : (nomeSemRef || bannerText(currentStep, distToNext))
        const sub = isRot && exitN ? `Rotatória · ${exitN}ª saída` : ''
        const mostrarDepois = !!nextStep?.maneuver && nextStep.maneuver.type !== 'arrive' && nextGap != null && nextGap < 250
        // Faixas (lane guidance): faixas certas a branco, as outras apagadas
        const faixas: any[] = Array.isArray(currentStep.intersections?.[0]?.lanes) ? currentStep.intersections[0].lanes : []
        const mostrarFaixas = faixas.length >= 2 && distToNext < 600 && faixas.some(l => l.valid) && !faixas.every(l => l.valid)
        const setaFaixa = (l: any): string => {
          const ind: string[] = l.valid && l.valid_indication ? [l.valid_indication] : (l.indications ?? ['straight'])
          return ind[0] ?? 'straight'
        }
        return (
          <div className="absolute z-[600]" style={{ top: 'calc(env(safe-area-inset-top, 0px) + 6px)', left: 8, right: 8 }}>
            <div style={{
              background: '#0f5446', borderRadius: 16, padding: '12px 14px',
              boxShadow: '0 4px 16px rgba(0,0,0,0.35)', display: 'flex', alignItems: 'center', gap: 12,
            }}>
              <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', minWidth: 56 }}>
                <ManeuverIcon type={longeDoFim ? 'continue' : tipo} modifier={longeDoFim ? 'straight' : mod} size={46}
                  exitAngle={isRot ? roundaboutExitAngle(currentStep) : null} exit={isRot ? exitN : undefined} />
                <span style={{ color: 'white', fontSize: 17, fontWeight: 700, marginTop: 2, whiteSpace: 'nowrap' }}>
                  {formatDistance(distToNext)}
                </span>
              </div>
              <div style={{ flex: 1, minWidth: 0 }}>
                {ref && !chegando && (
                  <span style={{ display: 'inline-block', background: 'white', color: '#202124', fontWeight: 800, fontSize: 15, borderRadius: 4, padding: '1px 7px', marginBottom: 4 }}>
                    {ref}
                  </span>
                )}
                <div style={{
                  color: 'white', fontSize: titulo.length > 26 ? 21 : 26, fontWeight: 600, lineHeight: 1.15,
                  display: '-webkit-box', WebkitLineClamp: 2, WebkitBoxOrient: 'vertical', overflow: 'hidden',
                }}>
                  {titulo}
                </div>
                {sub && <div style={{ color: 'rgba(255,255,255,0.8)', fontSize: 14, marginTop: 3 }}>{sub}</div>}
              </div>
            </div>
            {mostrarFaixas && (
              <div style={{ background: '#0b3f35', borderRadius: '0 0 14px 14px', margin: '-8px 10px 0', padding: '10px 10px 6px', display: 'flex', justifyContent: 'center', gap: 4 }}>
                {faixas.map((l, i) => {
                  const ind = setaFaixa(l)
                  const isU = ind === 'uturn'
                  return (
                    <ManeuverIcon key={i} type="turn" modifier={isU ? 'uturn' : ind === 'straight' || ind === 'none' ? 'straight' : ind} size={30} dim={!l.valid} />
                  )
                })}
              </div>
            )}
            {(mostrarDepois || isRecalculating || (riskOnRoute && !zoneAlert)) && (
              <div style={{ display: 'flex', gap: 6, marginTop: 4 }}>
                {mostrarDepois && (
                  <div style={{ background: '#0b3f35', borderRadius: 12, padding: '6px 12px', display: 'flex', alignItems: 'center', gap: 6, boxShadow: '0 2px 8px rgba(0,0,0,0.3)' }}>
                    <span style={{ color: 'white', fontSize: 15, fontWeight: 600 }}>Depois</span>
                    <ManeuverIcon type={nextStep.maneuver?.type} modifier={nextStep.maneuver?.modifier} size={24}
                      exitAngle={/roundabout|rotary/.test(nextStep.maneuver?.type ?? '') ? roundaboutExitAngle(nextStep) : null} />
                  </div>
                )}
                {isRecalculating && (
                  <div style={{ background: '#0b3f35', borderRadius: 12, padding: '6px 12px', color: 'white', fontSize: 13, fontWeight: 600 }}>A recalcular…</div>
                )}
                {riskOnRoute && !zoneAlert && !isRecalculating && (
                  <div style={{ background: '#7c2d12', borderRadius: 12, padding: '6px 12px', color: 'white', fontSize: 13, fontWeight: 600 }}>⚠️ Zona de risco à frente</div>
                )}
              </div>
            )}
          </div>
        )
      })()}

      {/* Modo alerta — fica na tela até passar por todas as zonas ou mudar para a rota segura */}
      {!hideControls && onSwitchToSafe && (
        <ZoneAlertBanner alert={zoneAlert} isRecalculating={isRecalculating} onSwitchToSafe={onSwitchToSafe} top={158} />
      )}

      {/* Side column: compass + mute + SOS — hidden when any report panel is open */}
      {!hideControls && <div className="absolute z-[600]" style={{ top: 'calc(env(safe-area-inset-top, 0px) + 158px)', right: 12, display: 'flex', flexDirection: 'column', gap: 10 }}>
        <button
          onClick={onToggleNorth}
          title={northLocked ? 'Norte fixo' : 'Norte livre'}
          style={{
            width: 44, height: 44, borderRadius: '50%',
            background: northLocked ? '#e8f0fe' : 'white', border: 'none',
            display: 'flex', alignItems: 'center', justifyContent: 'center',
            cursor: 'pointer', boxShadow: '0 1px 4px rgba(0,0,0,0.3)',
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
            <polygon points="12,2 16,12 12,10 8,12" fill="#d93025" />
            <polygon points="12,22 16,12 12,14 8,12" fill="#9aa0a6" />
          </svg>
        </button>
        <button
          onClick={() => {
            setMuted(m => {
              const next = !m
              diag('voz-mudo', { mudo: next })
              // Cancel any in-progress speech immediately when muting
              if (next && typeof window !== 'undefined') window.speechSynthesis?.cancel()
              return next
            })
          }}
          style={{
            width: 44, height: 44, borderRadius: '50%',
            background: 'white', border: 'none',
            display: 'flex', alignItems: 'center', justifyContent: 'center',
            cursor: 'pointer', boxShadow: '0 1px 4px rgba(0,0,0,0.3)',
          }}
          title={muted ? 'Voz desligada' : 'Voz ligada'}
        >
          <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="#3c4043" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <path d="M4 9h4l5-4v14l-5-4H4z" fill="#3c4043" />
            {muted
              ? <path d="M17 9l5 6M22 9l-5 6" stroke="#d93025" />
              : <path d="M16.5 8.5a5 5 0 0 1 0 7M19 6a8.5 8.5 0 0 1 0 12" />}
          </svg>
        </button>
        {onSOS && (
          <button
            onClick={onSOS}
            style={{
              width: 44, height: 44, borderRadius: '50%',
              background: 'white', border: 'none',
              display: 'flex', alignItems: 'center', justifyContent: 'center',
              cursor: 'pointer', boxShadow: '0 1px 4px rgba(0,0,0,0.3)',
            }}
            title="SOS"
          >
            <svg width="22" height="22" viewBox="0 0 24 24" fill="none">
              <path d="M12 2L3 7v5c0 5.25 3.75 10.15 9 11.35C17.25 22.15 21 17.25 21 12V7L12 2z" fill="#d93025"/>
              <text x="12" y="15.5" textAnchor="middle" fontSize="7" fontWeight="900" fill="white" fontFamily="system-ui, sans-serif">SOS</text>
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
                      {nearbyIncident && <ReportIcon type={nearbyIncident.type} size={28} />}
                      <span style={{ fontSize: 14, fontWeight: 700, color: 'var(--text)' }}>
                        {incidentPhase === 'passed' ? `${incType?.label ?? 'Incidente'} — ainda está aí?` : (incType?.label ?? 'Incidente')}
                      </span>
                    </div>
                    <span style={{ fontSize: 11, color: 'var(--muted)', whiteSpace: 'nowrap' }}>
                      {nearbyIncident
                        ? (incidentPhase === 'ahead' && incidentDist != null ? `a ${formatDistance(incidentDist)} · ` : '') + timeAgo(nearbyIncident.timestamp)
                        : ''}
                    </span>
                  </div>
                  {incidentPhase === 'ahead' && (
                    <p style={{ fontSize: 12, color: 'var(--muted)', margin: '0 0 12px' }}>
                      {nearbyIncident?.userId === currentUserId ? 'O teu report.' : 'Reportado por outro rider. Vamos perguntar se ainda está lá depois de passares.'}
                    </p>
                  )}
                  {/* Vote buttons — só depois de passar (não distrai na aproximação) */}
                  <div style={{ display: incidentPhase === 'passed' ? 'flex' : 'none', gap: 8, marginBottom: 12 }}>
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
            <div style={{ flex: 1, textAlign: 'center' }}>
              <div style={{ fontSize: 24, fontWeight: 700, color: '#188038', lineHeight: 1.05 }}>
                {formatDuration(remainingSec ?? navEta * 60)}
              </div>
              <div style={{ fontSize: 14, color: 'var(--muted)', marginTop: 3 }}>{formatDistance(remainingDist)} · {arrivalStr}</div>
            </div>
            <button
              onClick={onCancel}
              style={{
                background: '#d93025', border: 'none', borderRadius: 22,
                padding: '10px 20px', color: 'white', fontWeight: 700,
                fontSize: 15, cursor: 'pointer',
              }}
            >
              Sair
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
            bottom: 100, right: 14,
            width: 54, height: 54, borderRadius: '50%',
            background: 'white', border: 'none',
            display: 'flex', alignItems: 'center', justifyContent: 'center',
            cursor: 'pointer',
            boxShadow: '0 1px 6px rgba(0,0,0,0.3)',
          }}
        >
          <svg width="26" height="26" viewBox="0 0 24 24"><path d="M12 3 L22 20 H2 Z" fill="#f29900" stroke="#f29900" strokeWidth="1.5" strokeLinejoin="round"/><rect x="11" y="9" width="2" height="6" rx="1" fill="white"/><circle cx="12" cy="17.2" r="1.2" fill="white"/></svg>
        </button>
      )}
    </>
  )
}
