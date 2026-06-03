// src/components/Feedback/FeedbackButton.tsx
'use client'
import { useState } from 'react'
import { useStore } from '@/lib/store'
import { useLang } from '@/contexts/LangContext'
import { submitFeedback } from '@/lib/firestore'
import toast from 'react-hot-toast'

type FeedbackType = 'bug' | 'suggestion' | 'praise'

const FEEDBACK_TYPES: { value: FeedbackType; icon: string; key: string }[] = [
  { value: 'bug', icon: '🐛', key: 'feedback_bug' },
  { value: 'suggestion', icon: '💡', key: 'feedback_suggestion' },
  { value: 'praise', icon: '⭐', key: 'feedback_praise' },
]

interface Props {
  open?: boolean
  onOpen?: () => void
  onClose?: () => void
}

export default function FeedbackButton({ open: externalOpen, onOpen, onClose: externalOnClose }: Props) {
  const user = useStore((s) => s.user)
  const { t } = useLang()
  const [internalOpen, setInternalOpen] = useState(false)
  const open = externalOpen !== undefined ? externalOpen : internalOpen
  const setOpen = (v: boolean) => {
    if (externalOpen !== undefined) { if (v) onOpen?.(); else externalOnClose?.() }
    else setInternalOpen(v)
  }
  const [tipo, setTipo] = useState<FeedbackType>('suggestion')
  const [mensagem, setMensagem] = useState('')
  const [loading, setLoading] = useState(false)

  async function handleSubmit() {
    if (!mensagem.trim()) return toast.error(t('feedback_message'))
    setLoading(true)
    try {
      await submitFeedback(user?.id ?? 'anonymous', tipo, mensagem.trim())
      toast.success(t('feedback_success'))
      setMensagem('')
      setOpen(false)
    } catch {
      toast.error('Failed to send feedback')
    } finally {
      setLoading(false)
    }
  }

  return (
    <>
      {/* Modal */}
      {open && (
        <div className="fixed inset-0 z-[600] flex flex-col justify-end">
          <div className="absolute inset-0 bg-black/60 backdrop-blur-sm" onClick={() => setOpen(false)} />
          <div className="relative rounded-t-3xl animate-slide-up"
            style={{ background: 'var(--surface)', borderTop: '1px solid var(--border)', paddingBottom: 'env(safe-area-inset-bottom, 24px)' }}>
            {/* Drag handle */}
            <div className="flex justify-center pt-3 pb-1">
              <div className="w-10 h-1 rounded-full" style={{ background: 'var(--border)' }} />
            </div>
            <div className="px-6 pb-8 pt-2">
              <div className="flex items-center justify-between mb-5">
                <h2 className="text-xl font-bold" style={{ color: 'var(--text)' }}>💬 {t('feedback_title')}</h2>
                <button onClick={() => setOpen(false)} className="p-1" style={{ color: 'var(--muted)' }}>
                  <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                    <line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/>
                  </svg>
                </button>
              </div>

              {/* Type selector */}
              <div className="grid grid-cols-3 gap-2 mb-5">
                {FEEDBACK_TYPES.map((ft) => (
                  <button key={ft.value} onClick={() => setTipo(ft.value)}
                    className="py-3 rounded-xl text-sm font-semibold flex flex-col items-center gap-1.5 transition-all"
                    style={{
                      background: tipo === ft.value ? 'rgba(45,111,232,0.15)' : 'var(--card)',
                      border: `1px solid ${tipo === ft.value ? '#2d6fe8' : 'var(--border)'}`,
                      color: tipo === ft.value ? '#93c5fd' : 'var(--muted)',
                    }}>
                    <span style={{ fontSize: '22px' }}>{ft.icon}</span>
                    <span className="text-xs">{t(ft.key)}</span>
                  </button>
                ))}
              </div>

              {/* Message */}
              <p className="text-xs font-semibold uppercase tracking-wide mb-2" style={{ color: 'var(--muted)' }}>{t('feedback_message')}</p>
              <textarea
                value={mensagem}
                onChange={(e) => setMensagem(e.target.value)}
                placeholder={t('feedback_placeholder')}
                rows={4}
                className="w-full rounded-xl px-4 py-3 text-sm focus:outline-none resize-none mb-5"
                style={{ background: 'var(--card)', border: '1px solid var(--border)', color: 'var(--text)' }}
              />

              <button
                onClick={handleSubmit}
                disabled={!mensagem.trim() || loading}
                className="w-full text-white font-bold py-4 rounded-xl transition-opacity"
                style={{ background: 'linear-gradient(135deg, #4f8ef7 0%, #1a5fd4 100%)' }}>
                {loading ? t('loading') : `📤 ${t('feedback_title')}`}
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  )
}
