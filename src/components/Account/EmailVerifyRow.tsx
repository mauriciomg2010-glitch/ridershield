'use client'
// Estado da verificação do email na Conta, com "Reenviar". Não bloqueia o uso da app.
import { useState } from 'react'
import { sendEmailVerification } from 'firebase/auth'
import { auth } from '@/lib/firebase'

export default function EmailVerifyRow() {
  const u = auth.currentUser
  const [verificado, setVerificado] = useState(!!u?.emailVerified)
  const [msg, setMsg] = useState<string | null>(null)
  if (!u || !u.email) return null
  if (verificado) return <p className="text-xs" style={{ color: '#16a34a' }}>✓ Email confirmado</p>
  return (
    <div className="rounded-xl p-3 text-xs" style={{ background: 'rgba(245,158,11,0.1)', border: '1px solid rgba(245,158,11,0.3)', color: 'var(--text)' }}>
      <div className="font-semibold">📧 Confirma o teu email</div>
      <div style={{ color: 'var(--muted)', marginTop: 2 }}>Enviámos um link para {u.email}. Confirmar protege a tua conta.</div>
      <div className="flex gap-2 mt-2">
        <button className="px-3 py-1.5 rounded-lg font-semibold" style={{ background: '#f59e0b', color: '#111' }}
          onClick={async () => {
            try { auth.languageCode = 'pt'; await sendEmailVerification(u); setMsg('Link enviado. Vê também o spam.') }
            catch (e: any) { setMsg(String(e?.code || '').includes('too-many') ? 'Espera uns minutos antes de reenviar.' : 'Não foi possível enviar.') }
          }}>Reenviar</button>
        <button className="px-3 py-1.5 rounded-lg" style={{ border: '1px solid var(--border)', color: 'var(--muted)' }}
          onClick={async () => { try { await u.reload(); setVerificado(!!auth.currentUser?.emailVerified); if (!auth.currentUser?.emailVerified) setMsg('Ainda não confirmado.') } catch {} }}>
          Já confirmei
        </button>
      </div>
      {msg && <div style={{ marginTop: 6, color: 'var(--muted)' }}>{msg}</div>}
    </div>
  )
}
