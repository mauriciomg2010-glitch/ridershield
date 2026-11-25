'use client'
// Ecrã obrigatório até o rider confirmar o email (evita contas falsas e reports fantasma).
// Volta a verificar sozinho quando o rider regressa à app depois de abrir o link no email.
import { useEffect, useState } from 'react'
import { sendEmailVerification, signOut } from 'firebase/auth'
import { auth } from '@/lib/firebase'

export default function VerifyEmailGate({ onVerified }: { onVerified: () => void }) {
  const u = auth.currentUser
  const [msg, setMsg] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  async function verificar(silencioso = false) {
    const cur = auth.currentUser
    if (!cur) return
    try {
      await cur.reload()
      if (auth.currentUser?.emailVerified) {
        // o token tem de levar email_verified=true para as regras do Firebase
        await auth.currentUser.getIdToken(true).catch(() => {})
        onVerified()
      } else if (!silencioso) setMsg('Ainda não confirmado. Abre o link no email e volta aqui.')
    } catch { if (!silencioso) setMsg('Sem ligação. Tenta outra vez.') }
  }

  useEffect(() => {
    const onVis = () => { if (document.visibilityState === 'visible') verificar(true) }
    document.addEventListener('visibilitychange', onVis)
    window.addEventListener('focus', onVis)
    const t = setInterval(() => verificar(true), 8000)
    return () => { document.removeEventListener('visibilitychange', onVis); window.removeEventListener('focus', onVis); clearInterval(t) }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  return (
    <div style={{ position: 'fixed', inset: 0, background: '#0a0e1a', display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 24, zIndex: 9999 }}>
      <div style={{ maxWidth: 380, width: '100%', textAlign: 'center', color: 'white' }}>
        <img src="/icons/v2/zivo-app.svg" alt="ZIVO" width={64} height={64} style={{ borderRadius: 16, margin: '0 auto 20px' }} />
        <h1 style={{ fontSize: 22, fontWeight: 800, margin: 0 }}>Confirma o teu email</h1>
        <p style={{ color: 'rgba(255,255,255,0.65)', fontSize: 14, lineHeight: 1.5, marginTop: 10 }}>
          Enviámos um link para<br /><b style={{ color: '#f59e0b' }}>{u?.email}</b><br />
          Abre-o para ativar a conta. Vê também a pasta de spam.
        </p>
        <button disabled={busy} onClick={async () => { setBusy(true); setMsg(null); await verificar(); setBusy(false) }}
          style={{ width: '100%', marginTop: 22, padding: '14px 0', borderRadius: 14, background: '#f59e0b', color: '#111', fontWeight: 800, fontSize: 15, border: 'none' }}>
          {busy ? 'A verificar…' : 'Já confirmei'}
        </button>
        <button onClick={async () => {
            if (!u) return
            try { auth.languageCode = 'pt'; await sendEmailVerification(u); setMsg('Link enviado outra vez.') }
            catch (e: any) { setMsg(String(e?.code || '').includes('too-many') ? 'Espera uns minutos antes de reenviar.' : 'Não foi possível enviar.') }
          }}
          style={{ width: '100%', marginTop: 10, padding: '12px 0', borderRadius: 14, background: 'transparent', color: '#f59e0b', fontWeight: 700, fontSize: 14, border: '1px solid rgba(245,158,11,0.4)' }}>
          Reenviar link
        </button>
        <button onClick={() => signOut(auth).catch(() => {})}
          style={{ marginTop: 16, background: 'none', border: 'none', color: 'rgba(255,255,255,0.5)', fontSize: 13, textDecoration: 'underline' }}>
          Email errado? Sair e criar outra conta
        </button>
        {msg && <p style={{ marginTop: 14, fontSize: 13, color: 'rgba(255,255,255,0.7)' }}>{msg}</p>}
      </div>
    </div>
  )
}
