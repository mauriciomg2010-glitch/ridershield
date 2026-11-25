// src/components/Auth/AuthScreen.tsx
'use client'
import { useState, useRef, useEffect } from 'react'
import { sendPasswordResetEmail } from 'firebase/auth'
import { useAuth } from '@/contexts/AuthContext'
import { useLang } from '@/contexts/LangContext'
import { validateReferralCode } from '@/lib/firestore'
import { auth } from '@/lib/firebase'
import { captureReferralFromUrl, clearPendingReferral } from '@/lib/referralLink'
import toast from 'react-hot-toast'

export default function AuthScreen() {
  const { signIn, signUp } = useAuth()
  const { t } = useLang()
  const [mode, setMode] = useState<'login' | 'signup'>('login')
  const [name, setName] = useState('')
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [referralCode, setReferralCode] = useState('')
  const [referralStatus, setReferralStatus] = useState<'idle' | 'checking' | 'valid' | 'invalid'>('idle')
  const referrerIdRef = useRef<string | null>(null)
  const [loading, setLoading] = useState(false)
  // aceitar termos e privacidade é obrigatório para criar conta (RGPD / Play Store)
  const [aceito, setAceito] = useState(false)
  const [showResetInput, setShowResetInput] = useState(false)
  const [resetEmail, setResetEmail] = useState('')
  const [resetLoading, setResetLoading] = useState(false)

  // Link de indicação (?ref=ZIVO-XXXX): abre já no cadastro com o código preenchido e validado
  useEffect(() => {
    const code = captureReferralFromUrl()
    if (!code) return
    setMode('signup')
    setReferralCode(code)
    checkReferralCode(code)
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  async function checkReferralCode(code: string) {
    const trimmed = code.trim().toUpperCase()
    if (!trimmed || trimmed.length < 6) { setReferralStatus('idle'); return }
    setReferralStatus('checking')
    try {
      const uid = await validateReferralCode(trimmed)
      if (uid) {
        referrerIdRef.current = uid
        setReferralStatus('valid')
      } else {
        referrerIdRef.current = null
        setReferralStatus('invalid')
      }
    } catch {
      referrerIdRef.current = null
      setReferralStatus('invalid')
      toast.error('Não foi possível validar o código. Tenta novamente.')
    }
  }

  async function handleForgotPassword(emailArg: string) {
    const emailToUse = emailArg.trim()
    if (!emailToUse) return
    setResetLoading(true)
    try {
      await sendPasswordResetEmail(auth, emailToUse)
      toast.success(t('reset_email_sent'))
      setShowResetInput(false)
      setResetEmail('')
    } catch (err: any) {
      if (err.code === 'auth/user-not-found' || err.code === 'auth/invalid-email') {
        toast.error(t('email_not_found'))
      } else {
        toast.error('Erro ao enviar. Tenta novamente.')
      }
    } finally {
      setResetLoading(false)
    }
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    setLoading(true)
    try {
      if (mode === 'login') {
        await signIn(email, password)
        toast.success('Welcome back!')
      } else {
        if (!name.trim()) { toast.error(`${t('full_name')} is required`); setLoading(false); return }
        if (!aceito) { toast.error('Aceita os Termos e a Política de Privacidade para continuar.'); setLoading(false); return }

        // If a referral code was typed it MUST be valid — block otherwise
        const codeTyped = referralCode.trim()
        if (codeTyped) {
          if (referralStatus === 'checking') {
            toast.error('A verificar código… aguarda um momento.')
            setLoading(false)
            return
          }
          if (referralStatus !== 'valid') {
            // Re-trigger check in case user typed without blurring
            const uid = await validateReferralCode(codeTyped.toUpperCase())
            if (!uid) {
              setReferralStatus('invalid')
              referrerIdRef.current = null
              toast.error('Código de indicação inválido. Corrige ou apaga o campo.')
              setLoading(false)
              return
            }
            referrerIdRef.current = uid
            setReferralStatus('valid')
          }
        }

        await signUp(
          email, password, name,
          referrerIdRef.current ?? undefined,
          codeTyped ? codeTyped.toUpperCase() : undefined
        )
        clearPendingReferral()
        toast.success('Conta criada!')
      }
    } catch (err: any) {
      toast.error(err.message || 'Authentication failed')
    } finally {
      setLoading(false)
    }
  }

  return (
    // o body tem overflow:hidden (por causa do mapa): este ecrã rola sozinho, senão em telemóveis
    // pequenos o botão "Criar conta" ficava escondido por baixo do ecrã
    <div className="fixed inset-0 bg-shield-bg overflow-y-auto" style={{ WebkitOverflowScrolling: 'touch', overscrollBehavior: 'contain' }}>
    <div className="min-h-full flex flex-col items-center justify-center px-6 py-10" style={{ paddingBottom: 'calc(40px + env(safe-area-inset-bottom, 0px))' }}>
      {/* Logo */}
      <div className="mb-10 text-center">
        <div className="inline-flex items-center justify-center w-16 h-16 mb-4">
          <img src="/icons/v2/zivo-app.svg" alt="ZIVO" width={64} height={64} style={{ borderRadius: 16, boxShadow: '0 6px 24px rgba(245,158,11,0.25)' }} />
        </div>
        <h1 className="text-3xl font-bold text-white tracking-tight">ZIVO</h1>
        <p className="text-shield-muted text-sm mt-1">{t('safety_tagline')}</p>
      </div>

      {/* Card */}
      <div className="w-full max-w-sm">
        {/* Tab switcher */}
        <div className="flex rounded-xl bg-shield-surface border border-shield-border p-1 mb-6">
          <button
            onClick={() => setMode('login')}
            className={`flex-1 py-2 rounded-lg text-sm font-semibold transition-all ${
              mode === 'login' ? 'bg-[#d97706] text-white' : 'text-shield-muted hover:text-white'
            }`}
          >
            {t('sign_in')}
          </button>
          <button
            onClick={() => setMode('signup')}
            className={`flex-1 py-2 rounded-lg text-sm font-semibold transition-all ${
              mode === 'signup' ? 'bg-[#d97706] text-white' : 'text-shield-muted hover:text-white'
            }`}
          >
            {t('sign_up')}
          </button>
        </div>

        <form onSubmit={handleSubmit} className="space-y-4">
          {mode === 'signup' && (
            <div>
              <label className="block text-xs font-semibold text-shield-text-dim mb-1.5 uppercase tracking-wide">
                {t('full_name')}
              </label>
              <input
                type="text"
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder={t('your_name')}
                className="w-full bg-shield-surface border border-shield-border rounded-xl px-4 py-3 text-white placeholder-shield-muted focus:outline-none focus:border-[#d97706] transition-colors"
              />
            </div>
          )}

          <div>
            <label className="block text-xs font-semibold text-shield-text-dim mb-1.5 uppercase tracking-wide">
              {t('email')}
            </label>
            <input
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              placeholder="rider@example.com"
              required
              className="w-full bg-shield-surface border border-shield-border rounded-xl px-4 py-3 text-white placeholder-shield-muted focus:outline-none focus:border-[#d97706] transition-colors"
            />
          </div>

          <div>
            <label className="block text-xs font-semibold text-shield-text-dim mb-1.5 uppercase tracking-wide">
              {t('password')}
            </label>
            <input
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              placeholder="••••••••"
              required
              minLength={6}
              className="w-full bg-shield-surface border border-shield-border rounded-xl px-4 py-3 text-white placeholder-shield-muted focus:outline-none focus:border-[#d97706] transition-colors"
            />
          </div>

          {/* Referral code — signup only */}
          {mode === 'signup' && (
            <div>
              <label className="block text-xs font-semibold text-shield-text-dim mb-1.5 uppercase tracking-wide">
                Código de convite (opcional)
              </label>
              <div className="relative">
                <input
                  type="text"
                  value={referralCode}
                  onChange={(e) => {
                    const v = e.target.value.toUpperCase().slice(0, 10)
                    setReferralCode(v)
                    if (referralStatus !== 'idle') setReferralStatus('idle')
                  }}
                  onBlur={() => checkReferralCode(referralCode)}
                  placeholder="REF-XXXXXX"
                  maxLength={10}
                  className="w-full bg-shield-surface border rounded-xl px-4 py-3 text-white placeholder-shield-muted focus:outline-none transition-colors font-mono text-sm pr-10"
                  style={{
                    borderColor: referralStatus === 'valid' ? '#10b981'
                      : referralStatus === 'invalid' ? '#ef4444'
                      : undefined,
                  }}
                />
                {referralStatus === 'checking' && (
                  <div className="absolute right-3 top-1/2 -translate-y-1/2 w-4 h-4 border-2 border-t-transparent rounded-full animate-spin" style={{ borderColor: '#d97706', borderTopColor: 'transparent' }} />
                )}
                {referralStatus === 'valid' && (
                  <span className="absolute right-3 top-1/2 -translate-y-1/2 text-base">✅</span>
                )}
                {referralStatus === 'invalid' && (
                  <span className="absolute right-3 top-1/2 -translate-y-1/2 text-base">❌</span>
                )}
              </div>
              {referralStatus === 'valid' && (
                <p className="text-xs mt-1.5 font-semibold" style={{ color: '#10b981' }}>
                  ✅ Código válido! Tens 30 dias grátis de Pro
                </p>
              )}
              {referralStatus === 'invalid' && (
                <p className="text-xs mt-1.5 font-semibold" style={{ color: '#ef4444' }}>
                  ❌ Código de indicação inválido — corrige ou apaga o campo
                </p>
              )}
            </div>
          )}

          {mode === 'signup' && (
            <label className="flex items-start gap-3 text-left" style={{ fontSize: 13, color: 'rgba(255,255,255,0.75)', lineHeight: 1.4 }}>
              <input type="checkbox" checked={aceito} onChange={e => setAceito(e.target.checked)}
                style={{ width: 20, height: 20, marginTop: 1, accentColor: '#f59e0b', flexShrink: 0 }} />
              <span>
                Tenho 18 anos ou mais e aceito os <a href="/termos" target="_blank" style={{ color: '#f59e0b' }}>Termos de Uso</a> e
                a <a href="/privacidade" target="_blank" style={{ color: '#f59e0b' }}>Política de Privacidade</a>.
              </span>
            </label>
          )}

          <button
            type="submit"
            disabled={
              loading ||
              (mode === 'signup' && !aceito) ||
              (mode === 'signup' && referralCode.trim().length > 0 &&
                (referralStatus === 'invalid' || referralStatus === 'checking'))
            }
            className="w-full text-white font-bold py-3.5 rounded-xl disabled:opacity-60 disabled:cursor-not-allowed mt-2"
            style={{ background: 'linear-gradient(135deg, #f59e0b 0%, #b45309 100%)' }}
          >
            {loading ? t('loading') : mode === 'login' ? t('sign_in') : t('create_account')}
          </button>

          {/* Forgot password — login mode only */}
          {mode === 'login' && (
            <div className="mt-3">
              <button
                type="button"
                onClick={() => email.trim() ? handleForgotPassword(email) : setShowResetInput(v => !v)}
                className="w-full text-center text-xs"
                style={{ color: '#f59e0b', background: 'none', border: 'none', cursor: 'pointer' }}
              >
                {t('forgot_password')}
              </button>

              {showResetInput && (
                <div className="mt-3 flex gap-2">
                  <input
                    type="email"
                    value={resetEmail}
                    onChange={e => setResetEmail(e.target.value)}
                    placeholder="rider@example.com"
                    className="flex-1 min-w-0 bg-shield-surface border border-shield-border rounded-xl px-4 py-3 text-white placeholder-shield-muted focus:outline-none focus:border-[#d97706] transition-colors text-sm"
                  />
                  <button
                    type="button"
                    onClick={() => handleForgotPassword(resetEmail)}
                    disabled={resetLoading || !resetEmail.trim()}
                    className="flex-shrink-0 py-3 px-4 rounded-xl text-sm font-semibold disabled:opacity-50"
                    style={{ background: 'rgba(245,158,11,0.15)', color: '#f59e0b', border: '1px solid rgba(245,158,11,0.3)' }}
                  >
                    {resetLoading ? '…' : t('send_reset_link')}
                  </button>
                </div>
              )}
            </div>
          )}
        </form>

        {/* exigido pela Play Store: link para a política de privacidade e termos */}
        <p className="text-center mt-5" style={{ fontSize: 11, color: 'rgba(255,255,255,0.45)' }}>
          <a href="/termos" style={{ color: '#f59e0b' }}>Termos de Uso</a> e a <a href="/privacidade" style={{ color: '#f59e0b' }}>Política de Privacidade</a>
        </p>

      </div>
    </div>
    </div>
  )
}
