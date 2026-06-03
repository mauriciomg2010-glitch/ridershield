// src/components/Onboarding/OnboardingScreen.tsx
'use client'
import { useState, useRef } from 'react'
import { useStore } from '@/lib/store'
import { useAuth } from '@/contexts/AuthContext'
import { saveEmergencyContacts } from '@/lib/firestore'

interface Props {
  onComplete: () => void
}

const TOTAL = 5
const AMBER = '#f59e0b'
const DARK = '#0a0e1a'
const CARD = '#111827'
const BORDER_AMBER = 'rgba(245,158,11,0.35)'

export default function OnboardingScreen({ onComplete }: Props) {
  const [screen, setScreen] = useState(0)
  const [ec1Name, setEc1Name] = useState('')
  const [ec1Phone, setEc1Phone] = useState('')
  const [ec1Relation, setEc1Relation] = useState('Família')
  const [locationGranted, setLocationGranted] = useState(false)
  const touchStartX = useRef(0)
  const { firebaseUser } = useAuth()
  const user = useStore((s) => s.user)
  const setEmergencyContacts = useStore((s) => s.setEmergencyContacts)

  function next() { setScreen(s => Math.min(s + 1, TOTAL - 1)) }
  function back() { setScreen(s => Math.max(s - 1, 0)) }

  function handleTouchStart(e: React.TouchEvent) { touchStartX.current = e.touches[0].clientX }
  function handleTouchEnd(e: React.TouchEvent) {
    const delta = e.changedTouches[0].clientX - touchStartX.current
    if (Math.abs(delta) > 60) {
      if (delta < 0 && screen < TOTAL - 1) next()
      else if (delta > 0 && screen > 0) back()
    }
  }

  function handleRequestLocation() {
    if (!navigator.geolocation) { next(); return }
    navigator.geolocation.getCurrentPosition(
      () => { setLocationGranted(true); setTimeout(next, 700) },
      () => next(),
      { timeout: 8000, enableHighAccuracy: false, maximumAge: 60000 }
    )
  }

  async function handleComplete() {
    if (ec1Name.trim() && ec1Phone.trim() && firebaseUser?.uid) {
      const contacts = {
        contact1: { name: ec1Name.trim(), phone: ec1Phone.trim() },
        guardaNumber: '112' as const,
      }
      try { await saveEmergencyContacts(firebaseUser.uid, contacts); setEmergencyContacts(contacts) } catch {}
    }
    onComplete()
  }

  return (
    <div className="fixed inset-0 z-[9999]" onTouchStart={handleTouchStart} onTouchEnd={handleTouchEnd}>
      {/* Progress dots */}
      {screen > 0 && (
        <div className="absolute top-0 left-0 right-0 z-10 flex items-center justify-center gap-2"
          style={{ paddingTop: 'max(env(safe-area-inset-top), 16px)' }}>
          {Array.from({ length: TOTAL }).map((_, i) => (
            <div key={i} style={{
              width: i === screen ? 20 : 7, height: 7, borderRadius: 4, transition: 'all 0.3s',
              background: i === screen ? AMBER : i < screen ? 'rgba(245,158,11,0.4)' : 'rgba(255,255,255,0.15)',
            }} />
          ))}
        </div>
      )}

      {screen > 0 && screen < TOTAL - 1 && (
        <button onClick={back}
          className="absolute z-10 flex items-center gap-1 px-4 py-2 text-sm font-semibold"
          style={{ top: 'max(env(safe-area-inset-top), 12px)', left: 12, color: 'rgba(255,255,255,0.5)' }}>
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
            <polyline points="15 18 9 12 15 6" />
          </svg>
          Voltar
        </button>
      )}

      {screen === 0 && <Screen0 onNext={next} />}
      {screen === 1 && <Screen1 onNext={next} />}
      {screen === 2 && (
        <Screen2
          name={ec1Name} setName={setEc1Name}
          phone={ec1Phone} setPhone={setEc1Phone}
          relation={ec1Relation} setRelation={setEc1Relation}
          onNext={next} onSkip={next}
        />
      )}
      {screen === 3 && <Screen3 onAllow={handleRequestLocation} onSkip={next} granted={locationGranted} />}
      {screen === 4 && <Screen4 userName={user?.name?.split(' ')[0] ?? 'Rider'} onComplete={handleComplete} />}
    </div>
  )
}

/* ─── SCREEN 0 — Splash / Welcome ──────────────────────────────────────────── */
function Screen0({ onNext }: { onNext: () => void }) {
  return (
    <div className="w-full h-full flex flex-col items-center justify-center px-8 pb-12"
      style={{ background: `linear-gradient(160deg, ${DARK} 0%, #0d1322 100%)` }}>

      {/* Logo */}
      <div style={{ marginBottom: 32, position: 'relative' }}>
        <svg width="96" height="96" viewBox="0 0 64 64" fill="none">
          <defs>
            <linearGradient id="g0a" x1="0" y1="0" x2="1" y2="1">
              <stop offset="0%" stopColor={AMBER} stopOpacity="0.9" />
              <stop offset="100%" stopColor="#d97706" stopOpacity="0.7" />
            </linearGradient>
          </defs>
          {/* Shield */}
          <path d="M32 4L8 14v16c0 13.2 10.2 25.5 24 28.6C45.8 55.5 56 43.2 56 30V14L32 4z"
            fill="url(#g0a)" stroke={AMBER} strokeWidth="1.5" />
          {/* Crack line */}
          <path d="M30 16 L28 28 L33 32 L31 46" stroke="#0a0e1a" strokeWidth="2.5" strokeLinecap="round" />
          {/* Z */}
          <text x="32" y="38" textAnchor="middle" fill={DARK} fontSize="18" fontWeight="900" fontFamily="system-ui, sans-serif">Z</text>
        </svg>
        {/* Glow */}
        <div style={{
          position: 'absolute', inset: -8, borderRadius: '50%',
          background: `radial-gradient(circle, ${AMBER}20 0%, transparent 70%)`,
          pointerEvents: 'none',
        }} />
      </div>

      <h1 style={{ fontSize: 52, fontWeight: 900, color: 'white', letterSpacing: -2, margin: 0 }}>
        ZIVO
      </h1>
      <p style={{ fontSize: 18, color: 'rgba(255,255,255,0.85)', marginTop: 10, textAlign: 'center', fontWeight: 500, letterSpacing: 1.5, textTransform: 'uppercase' }}>
        Ride smart. Go home.
      </p>
      <p style={{ fontSize: 13, color: 'rgba(255,255,255,0.4)', marginTop: 8, textAlign: 'center' }}>
        Feito por e para riders de entrega em Dublin
      </p>

      <button onClick={onNext}
        className="active:scale-95 transition-transform"
        style={{
          marginTop: 52,
          background: AMBER,
          color: DARK,
          borderRadius: 18,
          padding: '18px 56px',
          fontSize: 17,
          fontWeight: 800,
          border: 'none',
          boxShadow: `0 8px 32px ${AMBER}44`,
        }}>
        Começar →
      </button>

      <p style={{ marginTop: 24, fontSize: 12, color: 'rgba(255,255,255,0.3)' }}>
        9 idiomas · Grátis para começar
      </p>
    </div>
  )
}

/* ─── SCREEN 1 — Features ────────────────────────────────────────────────── */
const FEATURES = [
  { icon: '🚨', title: 'SOS Emergência', desc: 'Um toque envia a tua localização para os contactos + Guarda' },
  { icon: '🗺️', title: 'Mapa de Risco', desc: 'Zonas de atenção reportadas por outros riders em tempo real' },
  { icon: '👥', title: 'Grupos de Riders', desc: 'Pedala em grupo, partilha localização, fica ligado' },
  { icon: '💰', title: 'Ganhos', desc: 'Controla rendimentos do Deliveroo, Uber Eats e mais' },
]

function Screen1({ onNext }: { onNext: () => void }) {
  return (
    <div className="w-full h-full flex flex-col overflow-y-auto" style={{ background: DARK, paddingTop: 64 }}>
      <div className="px-6 flex-1">
        <h2 style={{ fontSize: 26, fontWeight: 800, color: 'white', marginBottom: 6 }}>
          Tudo que precisas<br />para andar seguro
        </h2>
        <p style={{ fontSize: 14, color: 'rgba(255,255,255,0.45)', marginBottom: 28 }}>
          Feito por e para riders de entrega
        </p>

        <div className="space-y-3">
          {FEATURES.map(f => (
            <div key={f.title} className="rounded-2xl px-4 py-4 flex items-start gap-4"
              style={{ background: CARD, border: `1px solid ${BORDER_AMBER}` }}>
              <div style={{
                width: 48, height: 48, borderRadius: 14, fontSize: 24,
                background: `${AMBER}18`,
                border: `1px solid ${AMBER}33`,
                display: 'flex', alignItems: 'center', justifyContent: 'center',
                flexShrink: 0,
              }}>{f.icon}</div>
              <div>
                <p style={{ fontWeight: 700, fontSize: 15, color: 'white', margin: '0 0 3px' }}>{f.title}</p>
                <p style={{ fontSize: 13, color: 'rgba(255,255,255,0.5)', margin: 0, lineHeight: 1.4 }}>{f.desc}</p>
              </div>
            </div>
          ))}
        </div>
      </div>

      <div className="px-6 pb-12 pt-6">
        <button onClick={onNext}
          className="w-full py-4 rounded-2xl text-base font-bold active:scale-95 transition-transform"
          style={{ background: AMBER, color: DARK, border: 'none', boxShadow: `0 6px 20px ${AMBER}44` }}>
          Próximo →
        </button>
      </div>
    </div>
  )
}

/* ─── SCREEN 2 — Emergency Contact ──────────────────────────────────────── */
interface Screen2Props {
  name: string; setName: (v: string) => void
  phone: string; setPhone: (v: string) => void
  relation: string; setRelation: (v: string) => void
  onNext: () => void; onSkip: () => void
}

function Screen2({ name, setName, phone, setPhone, relation, setRelation, onNext, onSkip }: Screen2Props) {
  const RELATIONS = ['Família', 'Amigo', 'Colega']
  const inputStyle = {
    background: CARD,
    border: `1px solid ${BORDER_AMBER}`,
    color: 'white',
    outline: 'none',
    width: '100%',
  }

  return (
    <div className="w-full h-full flex flex-col overflow-y-auto" style={{ background: DARK, paddingTop: 72 }}>
      <div className="px-6 flex-1">
        <div className="text-center mb-6">
          <div style={{
            width: 64, height: 64, borderRadius: '50%',
            background: 'rgba(220,53,69,0.15)',
            border: '1px solid rgba(220,53,69,0.3)',
            display: 'flex', alignItems: 'center', justifyContent: 'center',
            fontSize: 32, margin: '0 auto 16px',
          }}>🚨</div>
          <h2 style={{ fontSize: 24, fontWeight: 800, color: 'white', margin: '0 0 8px' }}>
            Contacto de Emergência
          </h2>
          <p style={{ fontSize: 14, color: 'rgba(255,255,255,0.5)', lineHeight: 1.5, margin: 0 }}>
            Quando activares o SOS, serão notificados com a tua localização GPS
          </p>
        </div>

        <div className="space-y-3">
          <div>
            <label className="block text-xs font-semibold uppercase tracking-wide mb-1.5" style={{ color: 'rgba(255,255,255,0.4)' }}>
              Nome do contacto
            </label>
            <input value={name} onChange={e => setName(e.target.value)} placeholder="Ex: Maria Silva"
              className="px-4 py-3 rounded-xl text-sm" style={inputStyle} />
          </div>
          <div>
            <label className="block text-xs font-semibold uppercase tracking-wide mb-1.5" style={{ color: 'rgba(255,255,255,0.4)' }}>
              Número de telefone
            </label>
            <input value={phone} onChange={e => setPhone(e.target.value)} placeholder="+353 83 000 0000"
              type="tel" className="px-4 py-3 rounded-xl text-sm font-mono" style={inputStyle} />
          </div>
          <div>
            <label className="block text-xs font-semibold uppercase tracking-wide mb-1.5" style={{ color: 'rgba(255,255,255,0.4)' }}>
              Relação
            </label>
            <div className="flex gap-2">
              {RELATIONS.map(r => (
                <button key={r} onClick={() => setRelation(r)}
                  className="flex-1 py-2.5 rounded-xl text-sm font-semibold"
                  style={{
                    background: relation === r ? AMBER : CARD,
                    border: `1px solid ${relation === r ? AMBER : BORDER_AMBER}`,
                    color: relation === r ? DARK : 'rgba(255,255,255,0.5)',
                  }}>
                  {r}
                </button>
              ))}
            </div>
          </div>
        </div>
      </div>

      <div className="px-6 pb-12 pt-6 space-y-3">
        <button onClick={onNext}
          className="w-full py-4 rounded-2xl text-base font-bold active:scale-95 transition-transform"
          style={{ background: AMBER, color: DARK, border: 'none', boxShadow: `0 6px 20px ${AMBER}44` }}>
          Salvar e Continuar
        </button>
        <button onClick={onSkip}
          className="w-full py-3 text-sm font-semibold"
          style={{ color: 'rgba(255,255,255,0.35)', background: 'transparent', border: 'none' }}>
          Pular por agora
        </button>
      </div>
    </div>
  )
}

/* ─── SCREEN 3 — Location ────────────────────────────────────────────────── */
function Screen3({ onAllow, onSkip, granted }: { onAllow: () => void; onSkip: () => void; granted: boolean }) {
  return (
    <div className="w-full h-full flex flex-col items-center justify-center px-8 pb-12"
      style={{ background: DARK, paddingTop: 80 }}>

      <div style={{
        width: 80, height: 80, borderRadius: '50%',
        background: `${AMBER}18`, border: `1px solid ${BORDER_AMBER}`,
        display: 'flex', alignItems: 'center', justifyContent: 'center',
        fontSize: 36, marginBottom: 24,
      }}>📍</div>

      <h2 style={{ fontSize: 26, fontWeight: 800, color: 'white', textAlign: 'center', margin: '0 0 12px' }}>
        Permitir localização
      </h2>
      <p style={{ fontSize: 15, color: 'rgba(255,255,255,0.5)', textAlign: 'center', lineHeight: 1.5, margin: '0 0 20px' }}>
        Necessário para SOS, mapa de risco e partilha de localização em grupo
      </p>

      <div className="rounded-2xl px-5 py-4 text-center mb-8"
        style={{ background: CARD, border: `1px solid ${BORDER_AMBER}`, maxWidth: 320 }}>
        <p style={{ fontSize: 13, color: 'rgba(255,255,255,0.5)', lineHeight: 1.6, margin: 0 }}>
          A tua localização só é partilhada quando <strong style={{ color: 'white' }}>TU escolhes</strong>.
          Nunca vendida. Nunca armazenada sem permissão.
        </p>
      </div>

      {granted ? (
        <div className="flex items-center gap-2 py-4" style={{ color: AMBER, fontSize: 16, fontWeight: 700 }}>
          ✅ Localização concedida!
        </div>
      ) : (
        <>
          <button onClick={onAllow}
            className="w-full max-w-xs py-4 rounded-2xl text-base font-bold active:scale-95 transition-transform mb-3"
            style={{ background: AMBER, color: DARK, border: 'none', boxShadow: `0 6px 20px ${AMBER}44` }}>
            Permitir Localização →
          </button>
          <button onClick={onSkip}
            className="py-3 text-sm font-semibold"
            style={{ color: 'rgba(255,255,255,0.35)', background: 'transparent', border: 'none' }}>
            Talvez depois
          </button>
        </>
      )}
    </div>
  )
}

/* ─── SCREEN 4 — Done ────────────────────────────────────────────────────── */
function Screen4({ userName, onComplete }: { userName: string; onComplete: () => void }) {
  const STATS = [
    { label: '9 idiomas', sub: 'Suportados' },
    { label: 'Dublin', sub: '+ em expansão' },
    { label: 'Grátis', sub: 'para começar' },
  ]

  return (
    <div className="w-full h-full flex flex-col items-center justify-center px-8 pb-12"
      style={{ background: DARK }}>

      <div style={{
        width: 88, height: 88, borderRadius: '50%',
        background: `${AMBER}15`, border: `2px solid ${AMBER}55`,
        display: 'flex', alignItems: 'center', justifyContent: 'center',
        fontSize: 44, marginBottom: 24,
        boxShadow: `0 0 0 14px ${AMBER}08`,
      }}>🛡️</div>

      <h2 style={{ fontSize: 28, fontWeight: 900, color: 'white', textAlign: 'center', margin: '0 0 10px' }}>
        Estás protegido,<br />{userName}!
      </h2>
      <p style={{ fontSize: 15, color: 'rgba(255,255,255,0.45)', textAlign: 'center', margin: '0 0 36px' }}>
        Bem-vindo à comunidade ZIVO
      </p>

      <div className="flex gap-3 w-full max-w-sm mb-10">
        {STATS.map(s => (
          <div key={s.label} className="flex-1 rounded-2xl py-4 text-center"
            style={{ background: CARD, border: `1px solid ${BORDER_AMBER}` }}>
            <p style={{ fontSize: 15, fontWeight: 800, color: AMBER, margin: '0 0 2px' }}>{s.label}</p>
            <p style={{ fontSize: 11, color: 'rgba(255,255,255,0.4)', margin: 0 }}>{s.sub}</p>
          </div>
        ))}
      </div>

      <button onClick={onComplete}
        className="w-full max-w-sm py-4 rounded-2xl text-base font-bold active:scale-95 transition-transform"
        style={{
          background: AMBER, color: DARK, border: 'none',
          boxShadow: `0 8px 24px ${AMBER}44`,
        }}>
        Começar a pedalar seguro →
      </button>

      <p style={{ marginTop: 16, fontSize: 12, color: 'rgba(255,255,255,0.25)' }}>
        Feito por e para riders de entrega
      </p>
    </div>
  )
}
