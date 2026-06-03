// src/components/Referral/ReferralsListScreen.tsx
'use client'
import { useState, useEffect } from 'react'
import { getDetailedReferrals, ReferralDetail } from '@/lib/firestore'

interface Props {
  uid: string
  credits: number
  onBack: () => void
}

function fmtDate(d: Date): string {
  return d.toLocaleDateString('pt-PT', { day: 'numeric', month: 'short' })
}

function addMonths(d: Date, n: number): Date {
  const r = new Date(d)
  r.setMonth(r.getMonth() + n)
  return r
}

function StatusBadge({ status, month1PaidAt }: { status: ReferralDetail['status']; month1PaidAt: Date | null }) {
  if (status === 'confirmed') {
    return (
      <span style={{
        fontSize: 12, fontWeight: 700, color: '#10b981',
        display: 'flex', alignItems: 'center', gap: 4,
      }}>
        ✅ 2 meses pagos
      </span>
    )
  }
  if (status === 'pending') {
    const monthsCompleted = month1PaidAt ? 1 : 0
    return (
      <span style={{
        fontSize: 12, fontWeight: 700, color: '#f59e0b',
        display: 'flex', alignItems: 'center', gap: 4,
      }}>
        ⏳ Mês {monthsCompleted + 1} de 2
      </span>
    )
  }
  if (status === 'cancelled') {
    return <span style={{ fontSize: 12, fontWeight: 700, color: '#ef4444' }}>🔴 Cancelou PRO</span>
  }
  return <span style={{ fontSize: 12, fontWeight: 700, color: '#f59e0b' }}>⚠️ Inválido</span>
}

function ReferralCard({ r }: { r: ReferralDetail }) {
  const isConfirmed = r.status === 'confirmed'
  const isCancelled = r.status === 'cancelled' || r.status === 'invalid'
  const estimatedConfirmation = r.month1PaidAt
    ? addMonths(r.month1PaidAt, 1)
    : addMonths(r.createdAt, 2)

  return (
    <div style={{
      padding: '14px 0',
      borderBottom: '1px solid var(--border)',
    }}>
      <div style={{ display: 'flex', alignItems: 'flex-start', gap: 10 }}>
        <div style={{
          width: 36, height: 36, borderRadius: '50%', flexShrink: 0,
          background: isConfirmed ? 'rgba(16,185,129,0.12)' : isCancelled ? 'rgba(239,68,68,0.1)' : 'rgba(245,158,11,0.1)',
          border: `1px solid ${isConfirmed ? 'rgba(16,185,129,0.3)' : isCancelled ? 'rgba(239,68,68,0.25)' : 'rgba(245,158,11,0.25)'}`,
          display: 'flex', alignItems: 'center', justifyContent: 'center',
          fontSize: 16,
        }}>
          👤
        </div>
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8, marginBottom: 3 }}>
            <span style={{ fontSize: 14, fontWeight: 700, color: 'var(--text)' }}>{r.referredName}</span>
            <StatusBadge status={r.status} month1PaidAt={r.month1PaidAt} />
          </div>
          <p style={{ fontSize: 12, color: 'var(--muted)', marginBottom: 2 }}>
            Indicado em: {fmtDate(r.createdAt)}
          </p>
          {isConfirmed && r.commissionPaidAt && (
            <p style={{ fontSize: 12, color: '#10b981' }}>
              €{r.commissionAmount.toFixed(2)} creditados em: {fmtDate(r.commissionPaidAt)}
            </p>
          )}
          {r.status === 'pending' && (
            <p style={{ fontSize: 12, color: 'var(--muted)' }}>
              Confirmação prevista: {fmtDate(estimatedConfirmation)}
            </p>
          )}
          {isCancelled && (
            <p style={{ fontSize: 12, color: '#ef4444' }}>
              {r.status === 'invalid' ? 'Fraude detectada · Sem comissão' : 'Cancelou antes do 2º mês · Sem comissão'}
            </p>
          )}
        </div>
      </div>
      {r.status === 'pending' && (
        <div style={{
          marginTop: 8, marginLeft: 46,
          padding: '5px 10px', borderRadius: 8,
          background: 'rgba(245,158,11,0.08)', border: '1px solid rgba(245,158,11,0.2)',
          display: 'inline-flex', alignItems: 'center', gap: 5,
        }}>
          <div style={{ width: 6, height: 6, borderRadius: '50%', background: '#f59e0b' }} />
          <span style={{ fontSize: 11, color: '#f59e0b', fontWeight: 600 }}>Aguarda renovação</span>
        </div>
      )}
    </div>
  )
}

export default function ReferralsListScreen({ uid, credits, onBack }: Props) {
  const [referrals, setReferrals] = useState<ReferralDetail[]>([])
  const [localCredits, setLocalCredits] = useState(credits)
  const [creditsPaid, setCreditsPaid] = useState(0)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    getDetailedReferrals(uid)
      .then(data => {
        setReferrals(data.referrals)
        setLocalCredits(data.credits)
        setCreditsPaid(data.creditsPaid)
      })
      .catch(() => {})
      .finally(() => setLoading(false))
  }, [uid])

  const confirmed = referrals.filter(r => r.status === 'confirmed')
  const pending = referrals.filter(r => r.status === 'pending')
  const inactive = referrals.filter(r => r.status === 'cancelled' || r.status === 'invalid')
  const minWithdraw = 10

  return (
    <div style={{ position: 'absolute', inset: 0, background: 'var(--surface)', zIndex: 20, overflowY: 'auto' }}>
      {/* Header */}
      <div className="flex items-center gap-2 px-4 pt-14 pb-4 border-b flex-shrink-0"
        style={{ borderColor: 'var(--border)' }}>
        <button onClick={onBack} className="p-2 -ml-2" style={{ color: 'var(--text)' }}>
          <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
            <polyline points="15 18 9 12 15 6" />
          </svg>
        </button>
        <h2 className="text-lg font-bold" style={{ color: 'var(--text)' }}>Os meus indicados</h2>
      </div>

      <div style={{ padding: '16px 16px 32px' }}>
        {loading ? (
          <div className="flex items-center justify-center py-16">
            <div className="w-8 h-8 border-2 border-t-transparent rounded-full animate-spin"
              style={{ borderColor: '#2d6fe8', borderTopColor: 'transparent' }} />
          </div>
        ) : referrals.length === 0 ? (
          <div style={{ textAlign: 'center', padding: '40px 16px' }}>
            <div style={{ fontSize: 40, marginBottom: 12 }}>👥</div>
            <p style={{ fontSize: 15, fontWeight: 700, color: 'var(--text)', marginBottom: 6 }}>Ainda sem indicados</p>
            <p style={{ fontSize: 13, color: 'var(--muted)' }}>Partilha o teu código para começar a ganhar</p>
          </div>
        ) : (
          <>
            {/* Confirmed */}
            {confirmed.length > 0 && (
              <div style={{ marginBottom: 8 }}>
                <p style={{ fontSize: 11, fontWeight: 700, color: '#10b981', textTransform: 'uppercase', letterSpacing: 0.5, marginBottom: 4 }}>
                  CONFIRMADOS — receberás €{(confirmed.length * 3).toFixed(2)} total
                </p>
                <div style={{ background: 'var(--card)', borderRadius: 12, padding: '0 14px', border: '1px solid rgba(16,185,129,0.2)' }}>
                  {confirmed.map(r => <ReferralCard key={r.id} r={r} />)}
                </div>
              </div>
            )}

            {/* Pending */}
            {pending.length > 0 && (
              <div style={{ marginBottom: 8 }}>
                <p style={{ fontSize: 11, fontWeight: 700, color: '#f59e0b', textTransform: 'uppercase', letterSpacing: 0.5, marginBottom: 4 }}>
                  A AGUARDAR — ainda não confirmados
                </p>
                <div style={{ background: 'var(--card)', borderRadius: 12, padding: '0 14px', border: '1px solid rgba(245,158,11,0.2)' }}>
                  {pending.map(r => <ReferralCard key={r.id} r={r} />)}
                </div>
              </div>
            )}

            {/* Inactive */}
            {inactive.length > 0 && (
              <div style={{ marginBottom: 8 }}>
                <p style={{ fontSize: 11, fontWeight: 700, color: '#ef4444', textTransform: 'uppercase', letterSpacing: 0.5, marginBottom: 4 }}>
                  CANCELADOS / INVÁLIDOS
                </p>
                <div style={{ background: 'var(--card)', borderRadius: 12, padding: '0 14px', border: '1px solid rgba(239,68,68,0.15)' }}>
                  {inactive.map(r => <ReferralCard key={r.id} r={r} />)}
                </div>
              </div>
            )}

            {/* Credits summary */}
            <div style={{
              marginTop: 8, borderRadius: 12, padding: '14px 16px',
              background: 'var(--card)', border: '1px solid var(--border)',
            }}>
              <p style={{ fontSize: 11, fontWeight: 700, color: 'var(--muted)', textTransform: 'uppercase', letterSpacing: 0.5, marginBottom: 10 }}>
                PENDENTE DE LEVANTAMENTO
              </p>
              <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 4 }}>
                <span style={{ fontSize: 13, color: 'var(--muted)' }}>Total disponível</span>
                <span style={{ fontSize: 13, fontWeight: 700, color: localCredits >= 10 ? '#10b981' : 'var(--text)' }}>
                  €{localCredits.toFixed(2)}
                </span>
              </div>
              <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 4 }}>
                <span style={{ fontSize: 13, color: 'var(--muted)' }}>Mínimo para levantar</span>
                <span style={{ fontSize: 13, color: 'var(--muted)' }}>€{minWithdraw.toFixed(2)}</span>
              </div>
              {localCredits < minWithdraw && (
                <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                  <span style={{ fontSize: 13, color: 'var(--muted)' }}>Falta</span>
                  <span style={{ fontSize: 13, color: 'var(--muted)' }}>
                    €{(minWithdraw - localCredits).toFixed(2)} (mais {Math.ceil((minWithdraw - localCredits) / 3)} confirmações)
                  </span>
                </div>
              )}
              {creditsPaid > 0 && (
                <div style={{ display: 'flex', justifyContent: 'space-between', marginTop: 4 }}>
                  <span style={{ fontSize: 13, color: 'var(--muted)' }}>Já levantado</span>
                  <span style={{ fontSize: 13, color: 'var(--muted)' }}>€{creditsPaid.toFixed(2)}</span>
                </div>
              )}
            </div>
          </>
        )}
      </div>
    </div>
  )
}
