// src/components/Account/DeleteAccountSection.tsx
'use client'
import { useState } from 'react'
import toast from 'react-hot-toast'
import { deleteOwnAccount, DeleteStep } from '@/lib/deleteAccount'

const STEP_LABEL: Record<DeleteStep, string> = {
  auth: 'A confirmar a senha…',
  groups: 'A sair dos grupos…',
  reports: 'A anonimizar os teus reports…',
  profile: 'A apagar o teu perfil…',
  account: 'A apagar a conta…',
}

export default function DeleteAccountSection() {
  const [open, setOpen] = useState(false)
  const [password, setPassword] = useState('')
  const [confirmText, setConfirmText] = useState('')
  const [step, setStep] = useState<DeleteStep | null>(null)
  const [error, setError] = useState('')

  const busy = step !== null
  const canDelete = password.length > 0 && confirmText.trim().toUpperCase() === 'EXCLUIR' && !busy

  async function handleDelete() {
    if (!canDelete) return
    setError('')
    try {
      await deleteOwnAccount(password, setStep)
      toast.success('Conta excluída. Obrigado por teres usado o ZIVO.')
      // onAuthStateChanged leva para o ecrã de login automaticamente
    } catch (e: any) {
      setError(e?.message ?? 'Erro ao excluir a conta.')
      setStep(null)
    }
  }

  if (!open) {
    return (
      <div className="px-4 py-6">
        <button onClick={() => setOpen(true)}
          className="w-full py-2.5 rounded-lg text-xs font-semibold"
          style={{ background: 'transparent', color: 'var(--muted)', border: '1px solid var(--border)' }}>
          🗑️ Excluir a minha conta
        </button>
      </div>
    )
  }

  return (
    <div className="px-4 py-6">
      <div className="rounded-xl p-4" style={{ background: 'rgba(239,68,68,0.06)', border: '1px solid rgba(239,68,68,0.3)' }}>
        <p className="text-sm font-bold mb-2" style={{ color: '#f87171' }}>Excluir conta para sempre</p>
        <ul className="text-xs mb-3" style={{ color: 'var(--muted)', lineHeight: 1.5, paddingLeft: 16, listStyle: 'disc' }}>
          <li>Apagamos o teu perfil, contactos de emergência, ID de rider e código de indicação.</li>
          <li>Sais de todos os grupos e a tua localização deixa de ser partilhada.</li>
          <li>Os teus reports continuam no mapa, mas sem o teu nome.</li>
          <li>Não dá para desfazer.</li>
        </ul>

        <label className="text-xs font-semibold" style={{ color: 'var(--text)' }}>A tua senha</label>
        <input type="password" value={password} onChange={e => setPassword(e.target.value)}
          autoComplete="current-password" disabled={busy}
          className="w-full rounded-lg px-3 py-2 mt-1 mb-3 text-sm"
          style={{ background: 'var(--bg)', border: '1px solid var(--border)', color: 'var(--text)' }} />

        <label className="text-xs font-semibold" style={{ color: 'var(--text)' }}>Escreve EXCLUIR para confirmar</label>
        <input value={confirmText} onChange={e => setConfirmText(e.target.value)} disabled={busy}
          autoCapitalize="characters"
          className="w-full rounded-lg px-3 py-2 mt-1 mb-3 text-sm"
          style={{ background: 'var(--bg)', border: '1px solid var(--border)', color: 'var(--text)' }} />

        {error && <p className="text-xs mb-3" style={{ color: '#f87171' }}>{error}</p>}

        <div className="flex gap-2">
          <button onClick={() => { setOpen(false); setPassword(''); setConfirmText(''); setError('') }} disabled={busy}
            className="flex-1 py-2.5 rounded-lg text-sm"
            style={{ background: 'var(--bg)', color: 'var(--muted)', border: '1px solid var(--border)' }}>
            Cancelar
          </button>
          <button onClick={handleDelete} disabled={!canDelete}
            className="flex-[2] py-2.5 rounded-lg text-sm font-bold"
            style={{ background: '#dc2626', color: 'white', opacity: canDelete ? 1 : 0.45 }}>
            {busy ? STEP_LABEL[step!] : 'Excluir conta'}
          </button>
        </div>
      </div>
    </div>
  )
}
