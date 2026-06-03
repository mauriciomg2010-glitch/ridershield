// src/components/Layout/SideMenu.tsx
'use client'
import { useState, useEffect } from 'react'
import { useRouter } from 'next/navigation'
import { useStore } from '@/lib/store'
import { useAuth } from '@/contexts/AuthContext'
import { useTheme } from '@/contexts/ThemeContext'
import { useLang } from '@/contexts/LangContext'
import { LANGUAGES } from '@/lib/i18n'
import { getRiderID, saveEmergencyContacts, clearLocation, clearGlobalPresence, getUserReferralData } from '@/lib/firestore'
import { db } from '@/lib/firebase'
import { collection, query, where, onSnapshot, getDoc, doc } from 'firebase/firestore'
import { isAdminUser, ADMIN_UID as MENU_ADMIN_UID } from '@/lib/admin'
import { EmergencyContacts } from '@/types'
import ReferralPanel from '@/components/Referral/ReferralPanel'
import toast from 'react-hot-toast'

interface Props {
  open: boolean
  onClose: () => void
  onNavigate: (tab: string) => void
}

export default function SideMenu({ open, onClose, onNavigate }: Props) {
  const router = useRouter()
  const { signOut, firebaseUser } = useAuth()
  const { theme, toggleTheme } = useTheme()
  const { lang, setLang, t } = useLang()
  const user = useStore((s) => s.user)
  const isSharingLocation = useStore((s) => s.isSharingLocation)
  const toggleLocationSharing = useStore((s) => s.toggleLocationSharing)
  const activeGroupId = useStore((s) => s.activeGroupId)
  const [riderId, setRiderId] = useState('')
  const [copied, setCopied] = useState(false)
  const [langOpen, setLangOpen] = useState(false)
  const [showAccountPanel, setShowAccountPanel] = useState(false)
  const [showReferralPanel, setShowReferralPanel] = useState(false)
  const [showShortcutPanel, setShowShortcutPanel] = useState(false)
  const [shortcutUrlCopied, setShortcutUrlCopied] = useState(false)
  const emergencyContacts = useStore((s) => s.emergencyContacts)
  const setEmergencyContacts = useStore((s) => s.setEmergencyContacts)
  const [c1Name, setC1Name] = useState('')
  const [c1Phone, setC1Phone] = useState('')
  const [c2Name, setC2Name] = useState('')
  const [c2Phone, setC2Phone] = useState('')
  const [guardaNumber, setGuardaNumber] = useState<'112' | '999'>('112')
  const [savingContacts, setSavingContacts] = useState(false)
  const [ecOpen, setEcOpen] = useState(false)
  const [pendingServicesCount, setPendingServicesCount] = useState(0)
  const [hasOwnedServices, setHasOwnedServices] = useState(false)
  const [referralCredits, setReferralCredits] = useState(0)

  const currentLang = LANGUAGES.find((l) => l.code === lang) ?? LANGUAGES[0]

  const ADMIN_UID = 'kXNpNTLYe5P55PhI8K4VrZSahOC2'
  const ADMIN_EMAILS = ['mauriciomg_2010@hotmail.com', 'daianeschlichting83@gmail.com']
  const [isAdminFirestore, setIsAdminFirestore] = useState(false)
  const [isSuperAdminFirestore, setIsSuperAdminFirestore] = useState(false)

  // Real-time admin status — updates immediately when Firestore doc changes
  useEffect(() => {
    if (!firebaseUser?.uid) return
    const uid = firebaseUser.uid
    const q = query(collection(db, 'users'), where('id', '==', uid))
    const unsub = onSnapshot(q, async snap => {
      if (!snap.empty) {
        const data = snap.docs[0].data()
        setIsAdminFirestore(!!data.isAdmin)
        setIsSuperAdminFirestore(!!data.isSuperAdmin)
        return
      }
      // Fallback: doc without 'id' field — lookup by UID as document ID
      try {
        const direct = await getDoc(doc(db, 'users', uid))
        if (direct.exists()) {
          const data = direct.data()
          setIsAdminFirestore(!!data.isAdmin)
          setIsSuperAdminFirestore(!!data.isSuperAdmin)
        }
      } catch { /* non-blocking */ }
    }, () => {})
    return unsub
  }, [firebaseUser?.uid])

  const emailIsAdmin = ADMIN_EMAILS.includes((firebaseUser?.email ?? '').toLowerCase())
  const isAdmin = firebaseUser?.uid === ADMIN_UID || emailIsAdmin || isAdminFirestore
  const showRequests = firebaseUser?.uid === ADMIN_UID || emailIsAdmin || isSuperAdminFirestore

  useEffect(() => {
    if (firebaseUser?.uid) {
      getRiderID(firebaseUser.uid).then(setRiderId)
    }
  }, [firebaseUser?.uid])

  // Sync store emergency contacts into local form state when panel opens
  useEffect(() => {
    if (showAccountPanel && emergencyContacts) {
      setC1Name(emergencyContacts.contact1.name)
      setC1Phone(emergencyContacts.contact1.phone)
      setC2Name(emergencyContacts.contact2?.name ?? '')
      setC2Phone(emergencyContacts.contact2?.phone ?? '')
      setGuardaNumber(emergencyContacts.guardaNumber)
    }
  }, [showAccountPanel])

  // Subscribe to pending services count for admin badge
  useEffect(() => {
    if (!showRequests) return
    const q = query(collection(db, 'services'), where('status', '==', 'pending'))
    const unsub = onSnapshot(q, (snap) => {
      setPendingServicesCount(snap.size)
    }, () => {})
    return () => unsub()
  }, [showRequests])

  // Check if current user has any registered services (any status)
  useEffect(() => {
    if (!user?.id) return
    const q = query(collection(db, 'services'), where('ownerId', '==', user.id))
    const unsub = onSnapshot(q, (snap) => {
      setHasOwnedServices(snap.size > 0)
    }, () => {})
    return () => unsub()
  }, [user?.id])

  // Load referral credits for badge
  useEffect(() => {
    if (!firebaseUser?.uid || !open) return
    getUserReferralData(firebaseUser.uid)
      .then(data => setReferralCredits(data.credits))
      .catch(() => {})
  }, [firebaseUser?.uid, open])

  async function handleSignOut() {
    onClose()
    await signOut()
    toast.success(t('sign_out'))
  }

  async function handleSaveContacts() {
    if (!firebaseUser?.uid || !c1Name.trim() || !c1Phone.trim()) {
      toast.error('Nome e telefone do contacto 1 são obrigatórios')
      return
    }
    setSavingContacts(true)
    try {
      const contacts: EmergencyContacts = {
        contact1: { name: c1Name.trim(), phone: c1Phone.trim() },
        contact2: c2Name.trim() && c2Phone.trim()
          ? { name: c2Name.trim(), phone: c2Phone.trim() }
          : undefined,
        guardaNumber,
      }
      await saveEmergencyContacts(firebaseUser.uid, contacts)
      setEmergencyContacts(contacts)
      toast.success('Contactos guardados')
    } catch {
      toast.error('Erro ao guardar')
    } finally {
      setSavingContacts(false)
    }
  }

  const SHORTCUT_URL = 'https://ridershield.vercel.app/?address='

  function copyShortcutUrl() {
    navigator.clipboard.writeText(SHORTCUT_URL)
    setShortcutUrlCopied(true)
    setTimeout(() => setShortcutUrlCopied(false), 2000)
    toast.success('URL copiado!')
  }

  function copyRiderId() {
    if (!riderId) return
    navigator.clipboard.writeText(riderId)
    setCopied(true)
    setTimeout(() => setCopied(false), 2000)
    toast.success(t('copied'))
  }

  if (!open) return null

  const initials = user?.name
    ? user.name.split(' ').map((w: string) => w[0]).slice(0, 2).join('').toUpperCase()
    : '?'

  const planLabel = user?.isPremium ? 'Pro' : t('free_plan')
  const planColor = user?.isPremium ? '#3b82f6' : '#6b7280'
  const planBg = user?.isPremium ? 'rgba(59,130,246,0.15)' : 'rgba(107,114,128,0.15)'

  const navItems: { tab: string; label: string; icon: string; badge?: number | string }[] = [
    ...(!user?.isPremium ? [{ tab: 'upgrade', label: 'ZIVO Pro', icon: '⭐' }] : []),
    { tab: 'referral-panel', label: 'Indicações', icon: '💰', badge: referralCredits > 0 ? `€${referralCredits.toFixed(2)}` : undefined },
    { tab: 'services', label: 'Preciso de ajuda', icon: '🔧' },
    { tab: 'safety', label: t('safety'), icon: '🛡️' },
    { tab: 'safety-tips', label: t('safety_tips_nav'), icon: '🎥' },
    { tab: 'account-panel', label: t('account'), icon: '👤' },
    ...(showRequests ? [{ tab: 'service-requests', label: 'Solicitações', icon: '📋', badge: pendingServicesCount > 0 ? pendingServicesCount : undefined }] : []),
    ...(isAdminUser(firebaseUser?.email) || firebaseUser?.uid === MENU_ADMIN_UID ? [{ tab: 'painel-admin', label: '⚙️ Painel Admin', icon: '⚙️' }] : []),
  ]

  return (
    <>
      <style>{`
        @keyframes slideInFromRight {
          from { transform: translateX(100%); }
          to { transform: translateX(0); }
        }
        .side-menu-drawer { animation: slideInFromRight 0.25s cubic-bezier(0.32,0.72,0,1); }
      `}</style>

      <div className="fixed inset-0 z-[800] bg-black/60 backdrop-blur-sm" onClick={onClose} />

      <div className="side-menu-drawer fixed top-0 right-0 h-full z-[900]"
        style={{ width: 'min(85vw, 320px)', background: 'var(--surface)', borderLeft: '1px solid var(--border)', overflowY: showAccountPanel ? 'hidden' : 'auto' }}>

        {/* Referral Panel — overlays the main menu */}
        {showReferralPanel && firebaseUser?.uid && (
          <ReferralPanel uid={firebaseUser.uid} onClose={() => setShowReferralPanel(false)} onUpgrade={() => { setShowReferralPanel(false); onNavigate('upgrade'); onClose() }} />
        )}

        {/* iOS Shortcut Panel — overlays the main menu */}
        {showShortcutPanel && (
          <div style={{ position: 'absolute', inset: 0, background: 'var(--surface)', zIndex: 10, overflowY: 'auto' }}>
            {/* Header */}
            <div className="flex items-center gap-2 px-4 pt-14 pb-4 border-b flex-shrink-0"
              style={{ borderColor: 'var(--border)' }}>
              <button onClick={() => setShowShortcutPanel(false)} className="p-2 -ml-2" style={{ color: 'var(--text)' }}>
                <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
                  <polyline points="15 18 9 12 15 6" />
                </svg>
              </button>
              <h2 className="text-lg font-bold" style={{ color: 'var(--text)' }}>⚡ Deteção Automática</h2>
            </div>

            <div className="px-4 py-5 space-y-4">
              {/* Intro */}
              <div className="rounded-xl p-4" style={{ background: 'rgba(45,111,232,0.1)', border: '1px solid rgba(45,111,232,0.25)' }}>
                <p className="text-sm font-semibold mb-1" style={{ color: '#93c5fd' }}>Como funciona</p>
                <p className="text-xs leading-relaxed" style={{ color: 'var(--muted)' }}>
                  Cria um Atalho no iPhone que lê o endereço copiado e abre o ZIVO com a rota já verificada — sem trocar de app manualmente.
                </p>
              </div>

              {/* Steps */}
              <div>
                <p className="text-xs font-semibold uppercase tracking-widest mb-3" style={{ color: 'var(--muted)' }}>Passo a passo</p>
                <div className="space-y-2">
                  {[
                    { n: '1', icon: '📱', title: 'Abre a app "Atalhos"', sub: 'Vem instalada no iPhone (iOS 13+). Procura no Spotlight se não estiver no ecrã.' },
                    { n: '2', icon: '➕', title: 'Toca em + para criar novo atalho', sub: 'Canto superior direito.' },
                    { n: '3', icon: '🔍', title: 'Pesquisa "Obter clipboard"', sub: 'Adiciona a ação "Obter conteúdo do clipboard". Não precisa de configuração.' },
                    { n: '4', icon: '🌐', title: 'Adiciona ação "Abrir URLs"', sub: 'Cola o URL abaixo no campo. O [Clipboard] será substituído pelo endereço copiado.' },
                    { n: '5', icon: '✏️', title: 'Dá o nome "ZIVO"', sub: 'Toca no título no topo. Podes também adicionar ao ecrã inicial como ícone.' },
                    { n: '6', icon: '✅', title: 'Guarda e testa', sub: 'Copia um endereço → executa o atalho → o ZIVO abre com a rota verificada.' },
                  ].map(({ n, icon, title, sub }) => (
                    <div key={n} className="rounded-xl px-4 py-3 flex gap-3"
                      style={{ background: 'var(--card)', border: '1px solid var(--border)' }}>
                      <div style={{
                        flexShrink: 0, width: 24, height: 24, borderRadius: '50%',
                        background: 'rgba(45,111,232,0.2)', border: '1px solid rgba(45,111,232,0.35)',
                        display: 'flex', alignItems: 'center', justifyContent: 'center',
                        fontSize: 11, fontWeight: 700, color: '#93c5fd',
                      }}>{n}</div>
                      <div className="min-w-0">
                        <p className="text-sm font-semibold" style={{ color: 'var(--text)' }}>{icon} {title}</p>
                        <p className="text-xs mt-0.5 leading-relaxed" style={{ color: 'var(--muted)' }}>{sub}</p>
                      </div>
                    </div>
                  ))}
                </div>
              </div>

              {/* URL to copy */}
              <div>
                <p className="text-xs font-semibold uppercase tracking-widest mb-2" style={{ color: 'var(--muted)' }}>URL para o passo 4</p>
                <div className="rounded-xl overflow-hidden" style={{ background: 'var(--card)', border: '1px solid var(--border)' }}>
                  <div className="px-3 py-2.5" style={{ borderBottom: '1px solid var(--border)' }}>
                    <p className="text-xs font-mono break-all" style={{ color: '#93c5fd' }}>
                      {SHORTCUT_URL}<span style={{ color: '#fbbf24' }}>[Clipboard]</span>
                    </p>
                  </div>
                  <button
                    onClick={copyShortcutUrl}
                    className="w-full py-2.5 text-sm font-semibold flex items-center justify-center gap-2"
                    style={{ color: shortcutUrlCopied ? '#10b981' : '#93c5fd', background: 'none', border: 'none', cursor: 'pointer' }}
                  >
                    {shortcutUrlCopied ? '✓ Copiado!' : '📋 Copiar URL base'}
                  </button>
                </div>
                <p className="text-xs mt-2 leading-relaxed" style={{ color: 'var(--muted)' }}>
                  No campo "Abrir URLs" do Atalho, cola este URL e substitui <span style={{ color: '#fbbf24' }}>[Clipboard]</span> pela variável "Resultado do Clipboard" que aparece nas sugestões.
                </p>
              </div>

              {/* iOS Share Sheet tip */}
              <div className="rounded-xl p-4" style={{ background: 'rgba(16,185,129,0.08)', border: '1px solid rgba(16,185,129,0.2)' }}>
                <p className="text-sm font-semibold mb-1" style={{ color: '#34d399' }}>Dica extra — Folha de Partilha iOS</p>
                <p className="text-xs leading-relaxed" style={{ color: 'var(--muted)' }}>
                  Nas definições do Atalho, ativa <strong style={{ color: 'var(--text)' }}>"Usar na Folha de Partilha"</strong> e seleciona texto como tipo de entrada. Assim podes partilhar um endereço diretamente do Uber ou Google Maps para o ZIVO em 2 toques.
                </p>
              </div>

              {/* Divider */}
              <div style={{ height: 1, background: 'var(--border)', margin: '4px 0' }} />

              {/* Android section */}
              <div>
                <p className="text-xs font-semibold uppercase tracking-widest mb-3" style={{ color: 'var(--muted)' }}>Android — Partilha direta</p>
                <div className="rounded-xl p-4 mb-3" style={{ background: 'rgba(52,211,153,0.08)', border: '1px solid rgba(52,211,153,0.2)' }}>
                  <p className="text-sm font-semibold mb-1" style={{ color: '#34d399' }}>Como usar no Android</p>
                  <p className="text-xs leading-relaxed" style={{ color: 'var(--muted)' }}>
                    O ZIVO aparece na <strong style={{ color: 'var(--text)' }}>Folha de Partilha</strong> do Android depois de instalar como PWA. Partilha qualquer texto com endereço diretamente para o app.
                  </p>
                </div>
                <div className="space-y-2">
                  {[
                    { n: '1', icon: '📲', title: 'Instala o ZIVO como app', sub: 'Abre no Chrome → menu (⋮) → "Adicionar ao ecrã inicial". Só é necessário uma vez.' },
                    { n: '2', icon: '🔔', title: 'Recebe notificação do Uber Eats', sub: 'Quando chega um pedido com endereço, faz long-press na notificação.' },
                    { n: '3', icon: '↗️', title: 'Toca em "Partilhar"', sub: 'Aparece no menu da notificação ou nas opções de texto selecionado.' },
                    { n: '4', icon: '🛡️', title: 'Escolhe ZIVO', sub: 'O app abre imediatamente com o endereço extraído e a análise de zona de risco.' },
                  ].map(({ n, icon, title, sub }) => (
                    <div key={n} className="rounded-xl px-4 py-3 flex gap-3"
                      style={{ background: 'var(--card)', border: '1px solid var(--border)' }}>
                      <div style={{
                        flexShrink: 0, width: 24, height: 24, borderRadius: '50%',
                        background: 'rgba(52,211,153,0.15)', border: '1px solid rgba(52,211,153,0.3)',
                        display: 'flex', alignItems: 'center', justifyContent: 'center',
                        fontSize: 11, fontWeight: 700, color: '#34d399',
                      }}>{n}</div>
                      <div className="min-w-0">
                        <p className="text-sm font-semibold" style={{ color: 'var(--text)' }}>{icon} {title}</p>
                        <p className="text-xs mt-0.5 leading-relaxed" style={{ color: 'var(--muted)' }}>{sub}</p>
                      </div>
                    </div>
                  ))}
                </div>
                <div className="rounded-xl p-3 mt-3" style={{ background: 'rgba(251,191,36,0.08)', border: '1px solid rgba(251,191,36,0.2)' }}>
                  <p className="text-xs leading-relaxed" style={{ color: 'var(--muted)' }}>
                    <strong style={{ color: '#fbbf24' }}>Nota:</strong> também funciona com texto copiado de qualquer app. A deteção automática por clipboard já está ativa em segundo plano no Android — se copiares um endereço, o banner aparece sem precisar de partilhar.
                  </p>
                </div>
              </div>
            </div>
          </div>
        )}

        {/* Account Panel — overlays the main menu */}
        {showAccountPanel && (
          <div style={{ position: 'absolute', inset: 0, background: 'var(--surface)', zIndex: 10, overflowY: 'auto' }}>
            {/* Panel header */}
            <div className="flex items-center gap-2 px-4 pt-14 pb-4 border-b flex-shrink-0"
              style={{ borderColor: 'var(--border)' }}>
              <button onClick={() => setShowAccountPanel(false)} className="p-2 -ml-2" style={{ color: 'var(--text)' }}>
                <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
                  <polyline points="15 18 9 12 15 6" />
                </svg>
              </button>
              <h2 className="text-lg font-bold" style={{ color: 'var(--text)' }}>{t('account')}</h2>
            </div>

            {/* Avatar + name */}
            <div className="flex flex-col items-center py-7 px-4" style={{ borderBottom: '1px solid var(--border)' }}>
              <div style={{
                width: 72, height: 72, borderRadius: '50%',
                background: 'linear-gradient(135deg, #7c3aed, #4f46e5)',
                display: 'flex', alignItems: 'center', justifyContent: 'center',
                color: 'white', fontSize: '26px', fontWeight: 700,
                boxShadow: '0 4px 20px rgba(124,58,237,0.4)',
              }}>
                {initials}
              </div>
              <h3 style={{ fontSize: '18px', fontWeight: 700, color: 'var(--text)', marginTop: '12px' }}>{user?.name}</h3>
            </div>

            {/* Info rows */}
            <div className="px-4 py-4 space-y-3">
              <div className="rounded-xl overflow-hidden" style={{ background: 'var(--card)', border: '1px solid var(--border)' }}>
                <div className="flex items-center justify-between px-4 py-3" style={{ borderBottom: '1px solid var(--border)' }}>
                  <span className="text-sm" style={{ color: 'var(--muted)' }}>{t('email')}</span>
                  <span className="text-sm font-medium truncate ml-4" style={{ color: 'var(--text)', maxWidth: '150px' }}>{user?.email}</span>
                </div>
                <div className="flex items-center justify-between px-4 py-3">
                  <span className="text-sm" style={{ color: 'var(--muted)' }}>{t('plan')}</span>
                  <span className="text-xs font-bold px-3 py-1 rounded-full" style={{ background: planBg, color: planColor }}>{planLabel}</span>
                </div>
              </div>

              {/* Upgrade button — only for Free users */}
              {!user?.isPremium && (
                <button
                  className="w-full py-3 rounded-xl text-sm font-bold"
                  style={{ background: 'linear-gradient(135deg, #7c3aed, #4f46e5)', color: 'white', border: 'none' }}
                >
                  ⭐ {t('upgrade_plan')}
                </button>
              )}

              {/* Emergency Contacts — accordion, collapsed by default */}
              <div className="rounded-xl overflow-hidden" style={{ background: 'var(--card)', border: '1px solid rgba(220,53,69,0.25)' }}>
                <button
                  onClick={() => setEcOpen(o => !o)}
                  className="w-full px-4 py-3 flex items-center gap-2"
                  style={{ background: 'rgba(220,53,69,0.06)', borderBottom: ecOpen ? '1px solid var(--border)' : 'none' }}>
                  <span>🚨</span>
                  <span className="text-sm font-bold flex-1 text-left" style={{ color: '#f87171' }}>Contactos de Emergência SOS</span>
                  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="#f87171" strokeWidth="2.5"
                    style={{ transform: ecOpen ? 'rotate(180deg)' : 'none', transition: 'transform 0.2s', flexShrink: 0 }}>
                    <polyline points="6 9 12 15 18 9" />
                  </svg>
                </button>
                {ecOpen && <div className="px-4 py-3 space-y-3">
                  {/* Contact 1 */}
                  <div>
                    <p className="text-xs font-semibold mb-1.5" style={{ color: 'var(--muted)' }}>Contacto 1 *</p>
                    <div className="flex gap-2">
                      <input
                        value={c1Name} onChange={e => setC1Name(e.target.value)}
                        placeholder="Nome"
                        className="flex-1 min-w-0 px-3 py-2 rounded-lg text-sm"
                        style={{ background: 'var(--bg)', border: '1px solid var(--border)', color: 'var(--text)' }}
                      />
                      <input
                        value={c1Phone} onChange={e => setC1Phone(e.target.value)}
                        placeholder="+353..."
                        type="tel"
                        className="flex-1 min-w-0 px-3 py-2 rounded-lg text-sm font-mono"
                        style={{ background: 'var(--bg)', border: '1px solid var(--border)', color: 'var(--text)' }}
                      />
                    </div>
                  </div>
                  {/* Contact 2 */}
                  <div>
                    <p className="text-xs font-semibold mb-1.5" style={{ color: 'var(--muted)' }}>Contacto 2 (opcional)</p>
                    <div className="flex gap-2">
                      <input
                        value={c2Name} onChange={e => setC2Name(e.target.value)}
                        placeholder="Nome"
                        className="flex-1 min-w-0 px-3 py-2 rounded-lg text-sm"
                        style={{ background: 'var(--bg)', border: '1px solid var(--border)', color: 'var(--text)' }}
                      />
                      <input
                        value={c2Phone} onChange={e => setC2Phone(e.target.value)}
                        placeholder="+353..."
                        type="tel"
                        className="flex-1 min-w-0 px-3 py-2 rounded-lg text-sm font-mono"
                        style={{ background: 'var(--bg)', border: '1px solid var(--border)', color: 'var(--text)' }}
                      />
                    </div>
                  </div>
                  {/* Emergency number selector */}
                  <div>
                    <p className="text-xs font-semibold mb-1.5" style={{ color: 'var(--muted)' }}>Número de emergência</p>
                    <div className="flex gap-2">
                      {(['112', '999'] as const).map(n => (
                        <button key={n} onClick={() => setGuardaNumber(n)}
                          className="flex-1 py-2 rounded-lg text-sm font-bold"
                          style={{
                            background: guardaNumber === n ? 'rgba(220,53,69,0.2)' : 'var(--bg)',
                            border: `1px solid ${guardaNumber === n ? 'rgba(220,53,69,0.5)' : 'var(--border)'}`,
                            color: guardaNumber === n ? '#f87171' : 'var(--muted)',
                          }}>
                          {n}
                        </button>
                      ))}
                    </div>
                  </div>
                  <button
                    onClick={handleSaveContacts}
                    disabled={savingContacts}
                    className="w-full py-2.5 rounded-lg text-sm font-bold"
                    style={{ background: 'rgba(220,53,69,0.15)', color: '#f87171', border: '1px solid rgba(220,53,69,0.3)', opacity: savingContacts ? 0.6 : 1 }}
                  >
                    {savingContacts ? 'A guardar…' : '💾 Guardar contactos'}
                  </button>
                </div>}
              </div>

            </div>
          </div>
        )}

        {/* Header + main content — hidden when any sub-panel is open */}
        <div style={{ display: showAccountPanel || showReferralPanel || showShortcutPanel ? 'none' : 'block' }}>
        {/* Header */}
        <div className="relative" style={{ borderBottom: '1px solid var(--border)' }}>
          {/* Sponsor banner — full width, no padding above */}
          <img
            src="/seven-bikes.JPG"
            alt="Seven Electric Bikes - We Rent Electric Bikes"
            style={{
              width: '100%',
              height: '120px',
              objectFit: 'cover',
              objectPosition: 'center 20%',
              borderRadius: '0 0 12px 12px',
              cursor: 'pointer',
              display: 'block',
            }}
            onClick={() => window.open('https://wa.me/3530834153650', '_blank')}
          />

          {/* Name + rider ID */}
          <div className="px-5 pt-3 pb-4" style={{ background: 'linear-gradient(135deg, rgba(45,111,232,0.1), var(--surface))' }}>
            <h2 style={{ fontSize: '18px', fontWeight: 500, color: 'var(--text)', marginBottom: '8px' }}>{user?.name}</h2>
            {riderId && (
              <button onClick={copyRiderId}
                className="inline-flex items-center gap-2 px-3 py-1.5 rounded-lg text-xs font-mono font-bold"
                style={{ background: 'rgba(26,95,212,0.08)', border: '1px solid #1a5fd4', color: '#1a5fd4' }}>
                {riderId}
                <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
                  {copied
                    ? <polyline points="20 6 9 17 4 12" />
                    : <><rect x="9" y="9" width="13" height="13" rx="2" /><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1" /></>}
                </svg>
              </button>
            )}
          </div>
        </div>

        <div className="px-4 py-4 space-y-5">

          {/* Preferences */}
          <div>
            <p className="text-xs font-semibold uppercase tracking-widest mb-2" style={{ color: 'var(--muted)' }}>
              {t('preferences')}
            </p>

            {/* Theme toggle */}
            <div className="rounded-xl px-4 py-3 flex items-center justify-between mb-2"
              style={{ background: 'var(--card)', border: '1px solid var(--border)' }}>
              <div className="flex items-center gap-3">
                <span className="text-base">{theme === 'dark' ? '🌙' : '☀️'}</span>
                <span className="text-sm font-medium" style={{ color: 'var(--text)' }}>
                  {theme === 'dark' ? t('dark_mode') : t('light_mode')}
                </span>
              </div>
              <button onClick={toggleTheme}
                className="w-11 h-6 rounded-full relative transition-colors"
                style={{ background: theme === 'dark' ? '#2d6fe8' : '#d1d5db' }}>
                <div className="w-4 h-4 bg-white rounded-full absolute top-1 transition-all shadow"
                  style={{ left: theme === 'dark' ? '24px' : '4px' }} />
              </button>
            </div>

            {/* Location sharing toggle — same style as theme toggle */}
            <div className="rounded-xl px-4 py-3 flex items-center justify-between mb-2"
              style={{ background: 'var(--card)', border: '1px solid var(--border)' }}>
              <div className="flex items-center gap-3">
                <span className="text-base">📍</span>
                <span className="text-sm font-medium" style={{ color: 'var(--text)' }}>
                  Localização
                </span>
              </div>
              <button
                onClick={() => {
                  const newValue = !isSharingLocation
                  toggleLocationSharing()
                  localStorage.setItem('locationSharing', String(newValue))
                  if (!newValue && user?.id) {
                    if (activeGroupId) clearLocation(user.id, activeGroupId)
                    clearGlobalPresence(user.id)
                  }
                }}
                className="w-11 h-6 rounded-full relative transition-colors"
                style={{ background: isSharingLocation ? '#2d6fe8' : '#d1d5db' }}>
                <div className="w-4 h-4 bg-white rounded-full absolute top-1 transition-all shadow"
                  style={{ left: isSharingLocation ? '24px' : '4px' }} />
              </button>
            </div>

            {/* FIX 3: Language dropdown */}
            <div className="rounded-xl overflow-hidden" style={{ background: 'var(--card)', border: '1px solid var(--border)' }}>
              <button
                onClick={() => setLangOpen(!langOpen)}
                className="w-full flex items-center justify-between px-4 py-3">
                <div className="flex items-center gap-2">
                  <span>🌍</span>
                  <span className="text-sm font-medium" style={{ color: 'var(--text)' }}>
                    {t('language')}
                  </span>
                </div>
                <div className="flex items-center gap-2">
                  <span className="text-sm" style={{ color: 'var(--muted)' }}>
                    {currentLang.flag} {currentLang.name.split(' ')[0]}
                  </span>
                  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"
                    style={{ color: 'var(--muted)', transform: langOpen ? 'rotate(180deg)' : 'none', transition: 'transform 0.2s' }}>
                    <polyline points="6 9 12 15 18 9" />
                  </svg>
                </div>
              </button>

              {langOpen && (
                <div style={{ borderTop: '1px solid var(--border)', maxHeight: '220px', overflowY: 'auto' }}>
                  {LANGUAGES.map((l, i) => (
                    <button key={l.code}
                      onClick={() => { setLang(l.code); setLangOpen(false) }}
                      className="w-full flex items-center gap-3 px-4 py-2.5"
                      style={{
                        background: lang === l.code ? 'rgba(45,111,232,0.12)' : 'transparent',
                        borderBottom: i < LANGUAGES.length - 1 ? '1px solid var(--border)' : 'none',
                      }}>
                      <span className="text-base">{l.flag}</span>
                      <span className="text-sm font-medium" style={{ color: lang === l.code ? '#93c5fd' : 'var(--text)' }}>
                        {l.name}
                      </span>
                      {lang === l.code && (
                        <svg className="ml-auto flex-shrink-0" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="#93c5fd" strokeWidth="2.5">
                          <polyline points="20 6 9 17 4 12" />
                        </svg>
                      )}
                    </button>
                  ))}
                </div>
              )}
            </div>
          </div>

          {/* Navigation shortcuts */}
          <div>
            <p className="text-xs font-semibold uppercase tracking-widest mb-2" style={{ color: 'var(--muted)' }}>
              {t('navigation')}
            </p>
            <div className="rounded-xl overflow-hidden" style={{ background: 'var(--card)', border: '1px solid var(--border)' }}>
              {navItems.map(({ tab, label, icon, badge }, i) => (
                <button key={tab}
                  onClick={() => {
                    if (tab === 'safety-tips') {
                      router.push('/safety-tips')
                      onClose()
                    } else if (tab === 'painel-admin') {
                      onClose()
                      window.location.href = '/painel-admin'
                    } else if (tab === 'account-panel') {
                      setShowAccountPanel(true)
                    } else if (tab === 'referral-panel') {
                      setShowReferralPanel(true)
                    } else if (tab === 'shortcut-panel') {
                      setShowShortcutPanel(true)
                    } else if (tab === 'upgrade') {
                      onNavigate('upgrade')
                      onClose()
                    } else {
                      onNavigate(tab)
                      onClose()
                    }
                  }}
                  className="w-full flex items-center gap-3 px-4 py-3 text-left active:bg-blue-900/20"
                  style={{ borderBottom: i < navItems.length - 1 ? '1px solid var(--border)' : 'none' }}>
                  <span className="text-base">{icon}</span>
                  <span className="text-sm font-medium flex-1" style={{ color: 'var(--text)' }}>{label}</span>
                  {badge ? (
                    <span className="text-xs font-bold px-1.5 rounded-full mr-1 leading-5"
                      style={{
                        background: typeof badge === 'string' ? 'rgba(16,185,129,0.2)' : '#ef4444',
                        color: typeof badge === 'string' ? '#10b981' : 'white',
                        minWidth: '20px', textAlign: 'center', display: 'inline-block',
                        border: typeof badge === 'string' ? '1px solid rgba(16,185,129,0.4)' : 'none',
                      }}>
                      {typeof badge === 'number' && badge > 99 ? '99+' : badge}
                    </span>
                  ) : null}
                  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"
                    style={{ color: 'var(--muted)', flexShrink: 0 }}>
                    <polyline points="9 18 15 12 9 6" />
                  </svg>
                </button>
              ))}
            </div>
          </div>

          {/* Alpha Van sponsor banner */}
          <div
            className="relative cursor-pointer"
            style={{ borderRadius: '12px', overflow: 'hidden' }}
            onClick={() => window.open('https://wa.me/3530872180548', '_blank')}
          >
            <img
              src="/images/Publicidade_ALPHAVAN.png"
              alt="Alpha Van — Patrocinado"
              style={{ width: '100%', maxHeight: '160px', objectFit: 'cover', display: 'block' }}
            />
            <span style={{
              position: 'absolute', top: '8px', right: '8px',
              background: 'rgba(0,0,0,0.5)', color: 'white',
              fontSize: '10px', padding: '2px 6px', borderRadius: '20px',
            }}>
              Patrocinado
            </span>
          </div>

          {/* Sign out */}
          <button onClick={handleSignOut}
            className="w-full py-3 rounded-xl text-sm font-semibold"
            style={{ border: '1px solid rgba(239,68,68,0.3)', color: '#ef4444', background: 'rgba(239,68,68,0.05)' }}>
            {t('sign_out')}
          </button>

          <p className="text-center text-xs pb-6" style={{ color: 'var(--muted)' }}>
            ZIVO v0.2.0 · Dublin, Ireland
          </p>
        </div>
        </div>{/* end show-when-no-panel wrapper */}
      </div>
    </>
  )
}
