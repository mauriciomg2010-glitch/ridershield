// src/components/Upgrade/UpgradeScreen.tsx
'use client'
// ZIVO Pro. O pagamento vai ser feito pela Google Play (obrigatório para assinaturas na app da
// Play Store). Até lá o botão regista o interesse do rider e avisa que chega com a app.
import { useState } from 'react'
import { collection, query, where, getDocs, updateDoc, serverTimestamp } from 'firebase/firestore'
import { db } from '@/lib/firebase'
import { useAuth } from '@/contexts/AuthContext'
import toast from 'react-hot-toast'

interface Props {
  onClose: () => void
}

// Só o que é verdade hoje (nov 2026). Acrescentar aqui quando houver mais funções Pro.
const FREE_FEATURES = [
  { label: 'Mapa de zonas de risco', free: true },
  { label: 'Navegação que evita zonas', free: true },
  { label: 'Reports e alertas de segurança', free: true },
  { label: 'Grupos e SOS', free: true },
  { label: 'Descontos dos parceiros', free: true },
  { label: 'Sem anúncios (mapa, menu e fim de entrega)', free: false },
  { label: 'Suporte prioritário', free: false },
  { label: 'Novas funções Pro primeiro', free: false },
]

export default function UpgradeScreen({ onClose }: Props) {
  const { firebaseUser } = useAuth()
  const [registado, setRegistado] = useState(false)
  const [aGuardar, setAGuardar] = useState(false)

  async function quero() {
    if (!firebaseUser?.uid) return
    setAGuardar(true)
    try {
      const snap = await getDocs(query(collection(db, 'users'), where('id', '==', firebaseUser.uid)))
      if (!snap.empty) await updateDoc(snap.docs[0].ref, { proInteresse: true, proInteresseEm: serverTimestamp() })
      setRegistado(true)
      toast.success('Combinado! Avisamos-te quando o Pro abrir na app.')
    } catch {
      toast.error('Não foi possível guardar. Tenta outra vez.')
    } finally {
      setAGuardar(false)
    }
  }

  return (
    <div style={{
      position: 'fixed', inset: 0, zIndex: 9999,
      background: 'var(--bg)', display: 'flex', flexDirection: 'column',
      overflowY: 'auto',
    }}>
      {/* Header */}
      <div style={{
        padding: '16px 16px 12px',
        borderBottom: '1px solid var(--border)',
        display: 'flex', alignItems: 'center', gap: 12,
        background: 'linear-gradient(135deg, rgba(124,58,237,0.15), var(--surface))',
        flexShrink: 0,
      }}>
        <button
          onClick={onClose}
          style={{
            background: 'none', border: 'none', color: 'var(--muted)',
            cursor: 'pointer', fontSize: 22, padding: '0 4px', lineHeight: 1,
          }}
        >
          ✕
        </button>
        <h1 style={{ fontSize: 18, fontWeight: 800, color: 'var(--text)', flex: 1 }}>
          ⭐ ZIVO Pro
        </h1>
      </div>

      <div style={{ padding: '20px 16px', display: 'flex', flexDirection: 'column', gap: 20 }}>

        {/* Hero */}
        <div style={{
          borderRadius: 16, padding: '20px 16px',
          background: 'linear-gradient(135deg, #4f46e5, #7c3aed)',
          textAlign: 'center',
        }}>
          <div style={{ fontSize: 40, marginBottom: 8 }}>🛡️</div>
          <h2 style={{ color: 'white', fontSize: 20, fontWeight: 800, marginBottom: 6 }}>
            Protege mais. Ganha mais.
          </h2>
          <p style={{ color: 'rgba(255,255,255,0.8)', fontSize: 13, lineHeight: 1.5 }}>
            Acesso completo a todas as funcionalidades premium do ZIVO para riders profissionais.
          </p>
        </div>

        {/* Comparison table */}
        <div>
          <p style={{ fontSize: 11, fontWeight: 700, color: 'var(--muted)', textTransform: 'uppercase', letterSpacing: 0.5, marginBottom: 10 }}>
            O que está incluído
          </p>
          <div style={{ borderRadius: 12, overflow: 'hidden', border: '1px solid var(--border)' }}>
            {/* Column headers */}
            <div style={{
              display: 'grid', gridTemplateColumns: '1fr 60px 60px',
              background: 'var(--surface)', padding: '8px 16px',
              borderBottom: '1px solid var(--border)',
            }}>
              <span style={{ fontSize: 11, color: 'var(--muted)', fontWeight: 700 }}>FUNCIONALIDADE</span>
              <span style={{ fontSize: 11, color: 'var(--muted)', fontWeight: 700, textAlign: 'center' }}>Free</span>
              <span style={{ fontSize: 11, color: '#a78bfa', fontWeight: 700, textAlign: 'center' }}>Pro</span>
            </div>
            {FREE_FEATURES.map((f, i) => (
              <div
                key={i}
                style={{
                  display: 'grid', gridTemplateColumns: '1fr 60px 60px',
                  padding: '11px 16px', alignItems: 'center',
                  background: i % 2 === 0 ? 'transparent' : 'rgba(255,255,255,0.02)',
                  borderBottom: i < FREE_FEATURES.length - 1 ? '1px solid var(--border)' : 'none',
                }}
              >
                <span style={{ fontSize: 13, color: 'var(--text)' }}>{f.label}</span>
                <span style={{ textAlign: 'center', fontSize: 16 }}>{f.free ? '✅' : '❌'}</span>
                <span style={{ textAlign: 'center', fontSize: 16 }}>✅</span>
              </div>
            ))}
          </div>
        </div>

        {/* Referral offer */}
        <div style={{
          borderRadius: 12, padding: '14px 16px',
          background: 'rgba(16,185,129,0.08)', border: '1px solid rgba(16,185,129,0.2)',
          display: 'flex', alignItems: 'flex-start', gap: 10,
        }}>
          <span style={{ fontSize: 22, flexShrink: 0 }}>🎁</span>
          <div>
            <p style={{ fontSize: 13, fontWeight: 700, color: '#34d399', marginBottom: 3 }}>
              Traz 2 riders → 1 mês grátis
            </p>
            <p style={{ fontSize: 12, color: 'var(--muted)', lineHeight: 1.5 }}>
              Partilha o teu código de referral com outros riders. Quando 2 se registarem, ganhas 1 mês de Pro sem custo.
            </p>
          </div>
        </div>

        {/* Pricing */}
        <div style={{
          borderRadius: 12, padding: '16px',
          background: 'var(--surface)', border: '1px solid var(--border)',
          textAlign: 'center',
        }}>
          <div style={{ fontSize: 13, color: 'var(--muted)', marginBottom: 4 }}>Plano mensal</div>
          <div style={{ display: 'flex', alignItems: 'baseline', justifyContent: 'center', gap: 4, marginBottom: 4 }}>
            <span style={{ fontSize: 36, fontWeight: 800, color: 'var(--text)' }}>€4,99</span>
            <span style={{ fontSize: 14, color: 'var(--muted)' }}>/mês</span>
          </div>
          <p style={{ fontSize: 12, color: 'var(--muted)' }}>Cancela quando quiseres</p>
        </div>

        {/* CTA: pagamento chega com a app da Play Store */}
        <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
          <div style={{ borderRadius: 12, padding: '12px 14px', background: 'rgba(59,130,246,0.08)', border: '1px solid rgba(59,130,246,0.25)', fontSize: 13, color: 'var(--text)', lineHeight: 1.5 }}>
            📲 A assinatura Pro vai estar disponível na <b>app ZIVO da Google Play</b>, já a seguir ao lançamento. O pagamento é feito em segurança pela Google.
          </div>
          <button
            onClick={quero}
            disabled={registado || aGuardar}
            style={{
              padding: '15px 0', borderRadius: 12,
              background: registado ? 'rgba(16,185,129,0.2)' : 'linear-gradient(135deg, #4f46e5, #7c3aed)',
              border: 'none', color: registado ? '#10b981' : 'white', fontWeight: 800, fontSize: 16,
              cursor: 'pointer', opacity: aGuardar ? 0.7 : 1,
            }}
          >
            {registado ? '✓ Vais ser avisado' : aGuardar ? 'A guardar…' : '🔔 Avisa-me quando abrir'}
          </button>
          <button
            onClick={onClose}
            style={{
              padding: '13px 0', borderRadius: 12,
              background: 'none', border: '1px solid var(--border)',
              color: 'var(--muted)', fontSize: 13, cursor: 'pointer',
            }}
          >
            Continuar com o plano Free
          </button>
        </div>

        <p style={{ textAlign: 'center', fontSize: 11, color: 'var(--muted)', paddingBottom: 8 }}>
          Preço previsto · renovação mensal · cancela quando quiseres
        </p>
      </div>
    </div>
  )
}
