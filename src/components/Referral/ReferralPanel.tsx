// src/components/Referral/ReferralPanel.tsx
'use client'
import { useState, useEffect } from 'react'
import { useStore } from '@/lib/store'
import { getUserReferralData, claimReferralCredits } from '@/lib/firestore'
import toast from 'react-hot-toast'
import ReferralsListScreen from './ReferralsListScreen'

interface Props {
  uid: string
  onClose: () => void
  onUpgrade?: () => void
}

export default function ReferralPanel({ uid, onClose, onUpgrade }: Props) {
  const user = useStore((s) => s.user)
  const isPro = (user?.isPremium || user?.isAdmin) ?? false

  const [code, setCode] = useState('')
  const [credits, setCredits] = useState(0)
  const [creditsPaid, setCreditsPaid] = useState(0)
  const [confirmedCount, setConfirmedCount] = useState(0)
  const [pendingCount, setPendingCount] = useState(0)
  const [loading, setLoading] = useState(true)
  const [showProGate, setShowProGate] = useState(false)
  const [claiming, setClaiming] = useState(false)
  const [showList, setShowList] = useState(false)

  useEffect(() => {
    getUserReferralData(uid)
      .then(data => {
        setCode(data.code)
        setCredits(data.credits)
        setCreditsPaid(data.creditsPaid)
        setConfirmedCount(data.confirmedCount)
        setPendingCount(data.pendingCount)
      })
      .catch(() => {})
      .finally(() => setLoading(false))
  }, [uid])

  function handleCopy() {
    navigator.clipboard.writeText(code)
    toast.success('Código copiado! Partilha com os teus amigos riders.')
  }

  async function handleShare() {
    const texto = `Estou a usar o ZIVO para navegar seguro em Dublin!\nUsa o meu código ${code} para teres 30 dias PRO grátis.\nDescarrega aqui: https://ridershield.vercel.app`
    if (navigator.share) {
      try {
        await navigator.share({ title: 'ZIVO — Navega seguro', text: texto, url: `https://ridershield.vercel.app?ref=${code}` })
      } catch {}
    } else {
      await navigator.clipboard.writeText(texto)
      toast.success('Texto copiado para partilhar!')
    }
  }

  async function handleClaim() {
    if (credits < 10) return
    setClaiming(true)
    try {
      await claimReferralCredits(uid, credits)
      setCreditsPaid(p => p + credits)
      setCredits(0)
      toast.success(`€${credits.toFixed(2)} em crédito solicitado! Processamos em 3-5 dias úteis.`)
    } catch {
      toast.error('Erro ao solicitar levantamento')
    } finally {
      setClaiming(false)
    }
  }

  if (showList) {
    return <ReferralsListScreen uid={uid} credits={credits} onBack={() => setShowList(false)} />
  }

  return (
    <div style={{ position: 'absolute', inset: 0, background: 'var(--surface)', zIndex: 10, overflowY: 'auto' }}>
      {/* Header */}
      <div className="flex items-center gap-2 px-4 pt-14 pb-4 border-b flex-shrink-0"
        style={{ borderColor: 'var(--border)' }}>
        <button onClick={onClose} className="p-2 -ml-2" style={{ color: 'var(--text)' }}>
          <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
            <polyline points="15 18 9 12 15 6" />
          </svg>
        </button>
        <div style={{ flex: 1 }}>
          <h2 className="text-lg font-bold" style={{ color: 'var(--text)' }}>Indicações</h2>
          <p className="text-xs" style={{ color: 'var(--muted)' }}>Ganha €5 por cada rider que assinar Pro</p>
        </div>
        {credits > 0 && (
          <span style={{
            background: 'rgba(16,185,129,0.15)', color: '#10b981',
            fontSize: 11, fontWeight: 700, padding: '3px 8px', borderRadius: 20,
            border: '1px solid rgba(16,185,129,0.3)',
          }}>
            €{credits.toFixed(2)} disponível
          </span>
        )}
      </div>

      <div className="px-4 py-4 space-y-4">
        {loading ? (
          <div className="flex items-center justify-center py-16">
            <div className="w-8 h-8 border-2 border-t-transparent rounded-full animate-spin"
              style={{ borderColor: '#2d6fe8', borderTopColor: 'transparent' }} />
          </div>
        ) : (
          <>
            {/* Credits balance card */}
            <div style={{
              borderRadius: 14, overflow: 'hidden',
              background: credits > 0 ? 'rgba(16,185,129,0.08)' : 'var(--card)',
              border: `1px solid ${credits > 0 ? 'rgba(16,185,129,0.25)' : 'var(--border)'}`,
            }}>
              <div style={{ padding: '16px' }}>
                <div style={{ display: 'flex', alignItems: 'baseline', gap: 6, marginBottom: 4 }}>
                  <span style={{ fontSize: 32, fontWeight: 800, color: credits > 0 ? '#10b981' : 'var(--text)' }}>
                    €{credits.toFixed(2)}
                  </span>
                  <span style={{ fontSize: 12, color: 'var(--muted)' }}>disponível para levantar</span>
                </div>
                <p style={{ fontSize: 12, color: 'var(--muted)' }}>
                  {confirmedCount > 0
                    ? `${confirmedCount} indicaç${confirmedCount === 1 ? 'ão confirmada' : 'ões confirmadas'}`
                    : 'Ainda sem indicações confirmadas'}
                  {creditsPaid > 0 && ` · €${creditsPaid.toFixed(2)} já levantado`}
                </p>
              </div>
              {credits >= 10 ? (
                <button
                  onClick={handleClaim}
                  disabled={claiming}
                  style={{
                    width: '100%', padding: '12px 0',
                    background: 'rgba(16,185,129,0.15)', border: 'none',
                    borderTop: '1px solid rgba(16,185,129,0.2)',
                    color: '#10b981', fontWeight: 700, fontSize: 14,
                    cursor: claiming ? 'default' : 'pointer',
                    opacity: claiming ? 0.7 : 1,
                  }}
                >
                  {claiming ? 'A processar…' : '💸 Levantar crédito'}
                </button>
              ) : credits > 0 ? (
                <div style={{
                  padding: '10px 16px',
                  borderTop: '1px solid rgba(16,185,129,0.2)',
                  fontSize: 12, color: 'var(--muted)',
                  background: 'rgba(16,185,129,0.04)',
                }}>
                  Faltam €{(10 - credits).toFixed(2)} para atingir o mínimo de €10
                </div>
              ) : (
                <div style={{
                  padding: '10px 16px',
                  borderTop: '1px solid var(--border)',
                  fontSize: 12, color: 'var(--muted)',
                }}>
                  Mínimo €10 para levantar · Método: crédito no app
                </div>
              )}
            </div>

            {/* Referral code card */}
            <div style={{ borderRadius: 14, overflow: 'hidden', background: 'var(--card)', border: '1px solid rgba(45,111,232,0.25)' }}>
              <div style={{ padding: '12px 16px 10px', borderBottom: '1px solid var(--border)' }}>
                <p style={{ fontSize: 11, fontWeight: 700, color: 'var(--muted)', textTransform: 'uppercase', letterSpacing: 0.5, marginBottom: 8 }}>
                  O teu código de indicação
                </p>
                <div style={{
                  display: 'flex', alignItems: 'center', gap: 10,
                  background: 'rgba(45,111,232,0.06)', borderRadius: 10,
                  padding: '10px 14px',
                  border: '1px solid rgba(45,111,232,0.15)',
                }}>
                  <span style={{ fontSize: 16, flexShrink: 0 }}>🛡️</span>
                  <span style={{ fontFamily: 'monospace', fontSize: 18, fontWeight: 800, color: '#4f8ef7', letterSpacing: 1, flex: 1 }}>
                    {code || '…'}
                  </span>
                  <button
                    onClick={handleCopy}
                    style={{
                      background: 'rgba(45,111,232,0.12)', border: '1px solid rgba(45,111,232,0.25)',
                      borderRadius: 8, padding: '6px 12px', color: '#4f8ef7',
                      fontSize: 12, fontWeight: 700, cursor: 'pointer', flexShrink: 0,
                    }}
                  >
                    Copiar
                  </button>
                </div>
              </div>
              <button
                onClick={handleShare}
                style={{
                  width: '100%', padding: '11px 16px',
                  background: 'none', border: 'none',
                  display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 8,
                  color: '#4f8ef7', fontWeight: 700, fontSize: 13, cursor: 'pointer',
                }}
              >
                <span style={{ fontSize: 16 }}>↗</span> Partilhar código
              </button>
            </div>

            {/* How it works */}
            <div style={{ borderRadius: 14, padding: '14px 16px', background: 'var(--card)', border: '1px solid var(--border)' }}>
              <p style={{ fontSize: 11, fontWeight: 700, color: 'var(--muted)', textTransform: 'uppercase', letterSpacing: 0.5, marginBottom: 12 }}>
                Como funciona
              </p>
              {[
                { n: '1', text: 'Partilha o teu código com outros riders' },
                { n: '2', text: 'O amigo cria conta usando o teu código' },
                { n: '3', text: 'Após 2 meses Pro pagos → recebes €5 em crédito' },
              ].map(({ n, text }) => (
                <div key={n} style={{ display: 'flex', alignItems: 'flex-start', gap: 10, marginBottom: 10 }}>
                  <div style={{
                    width: 22, height: 22, borderRadius: '50%', flexShrink: 0,
                    background: 'rgba(45,111,232,0.12)', border: '1px solid rgba(45,111,232,0.25)',
                    display: 'flex', alignItems: 'center', justifyContent: 'center',
                    fontSize: 11, fontWeight: 800, color: '#4f8ef7',
                  }}>{n}</div>
                  <p style={{ fontSize: 13, color: 'var(--text)', lineHeight: 1.5, paddingTop: 2 }}>{text}</p>
                </div>
              ))}
              <div style={{ marginTop: 4, padding: '8px 10px', borderRadius: 8, background: 'rgba(45,111,232,0.06)', border: '1px solid rgba(45,111,232,0.15)' }}>
                <p style={{ fontSize: 11, color: '#93c5fd' }}>
                  ℹ️ Qualquer rider pode indicar · Crédito só após 2º mês Pro · Mínimo €10 para levantar
                </p>
              </div>
            </div>

            {/* My referrals — summary row */}
            <button
              onClick={() => setShowList(true)}
              style={{
                width: '100%', borderRadius: 14, padding: '14px 16px',
                background: 'var(--card)', border: '1px solid var(--border)',
                display: 'flex', alignItems: 'center', gap: 12,
                cursor: 'pointer', textAlign: 'left',
              }}
            >
              <span style={{ fontSize: 22 }}>👥</span>
              <div style={{ flex: 1 }}>
                <p style={{ fontSize: 14, fontWeight: 700, color: 'var(--text)' }}>
                  Os teus indicados
                  {(confirmedCount + pendingCount) > 0 && (
                    <span style={{
                      marginLeft: 8, fontSize: 11, fontWeight: 700,
                      background: 'rgba(45,111,232,0.12)', color: '#4f8ef7',
                      padding: '2px 7px', borderRadius: 10,
                    }}>
                      {confirmedCount + pendingCount}
                    </span>
                  )}
                </p>
                <p style={{ fontSize: 12, color: 'var(--muted)', marginTop: 2 }}>
                  {confirmedCount} confirmados · {pendingCount} a aguardar
                </p>
              </div>
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" style={{ color: 'var(--muted)', flexShrink: 0 }}>
                <polyline points="9 18 15 12 9 6" />
              </svg>
            </button>

            <div style={{ paddingBottom: 24 }} />
          </>
        )}
      </div>

      {/* ProGate bottom sheet */}
      {showProGate && (
        <>
          <div
            onClick={() => setShowProGate(false)}
            style={{ position: 'fixed', inset: 0, zIndex: 20, background: 'rgba(0,0,0,0.5)' }}
          />
          <div
            onClick={e => e.stopPropagation()}
            style={{
              position: 'fixed', bottom: 0, left: 0, right: 0, zIndex: 21,
              background: 'var(--surface)', borderRadius: '16px 16px 0 0',
              boxShadow: '0 -4px 24px rgba(0,0,0,0.4)',
              padding: '20px 20px 40px',
            }}
          >
            <div style={{ width: 36, height: 4, background: 'var(--border)', borderRadius: 2, margin: '0 auto 18px' }} />
            <div style={{ textAlign: 'center', marginBottom: 20 }}>
              <div style={{ fontSize: 36, marginBottom: 10 }}>🔒</div>
              <h3 style={{ fontSize: 17, fontWeight: 800, color: 'var(--text)', marginBottom: 8 }}>
                Precisas de ser PRO para indicar
              </h3>
              <p style={{ fontSize: 13, color: 'var(--muted)', lineHeight: 1.6 }}>
                Só os riders PRO recebem €3 por cada amigo que trouxerem.
                Assina o PRO, partilha o teu código e o primeiro amigo quase paga o teu mês.
              </p>
            </div>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
              <button
                onClick={() => { setShowProGate(false); onUpgrade?.() }}
                style={{
                  padding: '14px 0', borderRadius: 12,
                  background: 'linear-gradient(135deg, #4f46e5, #7c3aed)',
                  border: 'none', color: 'white', fontWeight: 800, fontSize: 15,
                  cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 8,
                }}
              >
                <span>▲</span> Assinar PRO — €4,99/mês
              </button>
              <button
                onClick={() => setShowProGate(false)}
                style={{
                  padding: '12px 0', borderRadius: 12,
                  background: 'none', border: '1px solid var(--border)',
                  color: 'var(--muted)', fontSize: 13, cursor: 'pointer',
                }}
              >
                Agora não
              </button>
            </div>
          </div>
        </>
      )}
    </div>
  )
}
