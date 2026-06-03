'use client'
import { useState, useEffect, useRef } from 'react'
import { useRouter } from 'next/navigation'
import { useAuth } from '@/contexts/AuthContext'
import {
  collection, getDocs, getDoc, addDoc, query, orderBy, limit, onSnapshot,
  where, Timestamp, updateDoc, serverTimestamp, writeBatch, doc, deleteDoc,
} from 'firebase/firestore'
import { ref as rtdbRef, remove as rtdbRemove } from 'firebase/database'
import { db, rtdb } from '@/lib/firebase'
import dynamic from 'next/dynamic'
import {
  LineChart, Line, BarChart, Bar, XAxis, YAxis, Tooltip,
  ResponsiveContainer, CartesianGrid, Cell,
} from 'recharts'
import { isAdminUser, canDeleteData, ADMIN_UID } from '@/lib/admin'

const ZoneEditor = dynamic(() => import('@/components/Admin/ZoneEditor'), { ssr: false })

type Tab = 'visao' | 'zonas' | 'usuarios' | 'feedbacks' | 'emergencias' | 'indicados' | 'limpeza'

const INCIDENT_PT: Record<string, string> = {
  assault_robbery: 'Assalto', bike_theft: 'Furto Bike', physical_assault: 'Agressão',
  attempted_robbery: 'Tent. Roubo', suspicious_activity: 'Suspeito', road_hazard: 'Perigo na Via',
  no_entry_zone: 'Zona Restrita', confirmed_safe: 'Área Segura',
  robbery: 'Roubo', aggression: 'Agressão', accident: 'Acidente',
}
const INCIDENT_COLOR: Record<string, string> = {
  robbery: '#ef4444', attempted_robbery: '#f97316', aggression: '#f59e0b',
  suspicious_activity: '#8b5cf6', accident: '#06b6d4', road_hazard: '#10b981',
}

function timeAgo(d: Date) {
  const s = Math.floor((Date.now() - d.getTime()) / 1000)
  if (s < 60) return `${s}s atrás`
  if (s < 3600) return `${Math.floor(s / 60)}m atrás`
  if (s < 86400) return `${Math.floor(s / 3600)}h atrás`
  return `${Math.floor(s / 86400)}d atrás`
}

interface FeedbackDoc { id: string; docRef: any; userId: string; tipo: string; mensagem: string; timestamp: Date; read?: boolean }
interface EmergencyDoc { id: string; docRef: any; userId: string; userName: string; groupName: string; lat: number | null; lng: number | null; timestamp: Date; status: string; resolvedAt: Date | null }

export default function PainelAdmin() {
  const router = useRouter()
  const { firebaseUser, loading: authLoading } = useAuth()
  const [authChecked, setAuthChecked] = useState(false)
  const [isSuperAdmin, setIsSuperAdmin] = useState(false)
  const [activeTab, setActiveTab] = useState<Tab>('visao')
  const [toast, setToast] = useState('')
  const toastRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const [now, setNow] = useState(new Date())

  // ── stats ──────────────────────────────────────────────────────────────────
  const [stats, setStats] = useState({ users: -1, zones: -1, emergencias: -1, feedbacks: -1 })
  const [userChart, setUserChart] = useState<{ day: string; users: number }[]>([])
  const [liveIncidents, setLiveIncidents] = useState<any[]>([])

  // ── users ──────────────────────────────────────────────────────────────────
  const [users, setUsers] = useState<any[]>([])
  const [usersLoading, setUsersLoading] = useState(false)
  const [userAction, setUserAction] = useState<string | null>(null)

  // ── feedbacks ──────────────────────────────────────────────────────────────
  const [feedbacks, setFeedbacks] = useState<FeedbackDoc[]>([])
  const feedbackUnsubRef = useRef<(() => void) | null>(null)

  // ── emergencies ────────────────────────────────────────────────────────────
  const [emergencias, setEmergencias] = useState<EmergencyDoc[]>([])
  const emergencyUnsubRef = useRef<(() => void) | null>(null)

  // ── indicados ─────────────────────────────────────────────────────────────
  const [indicados, setIndicados] = useState<any[]>([])
  const indicadosUnsubRef = useRef<(() => void) | null>(null)
  const [referralCode, setReferralCode] = useState('')
  const [referralCount, setReferralCount] = useState(0)

  // ── cleanup ────────────────────────────────────────────────────────────────
  const [testLat, setTestLat] = useState('53.3498')
  const [testLng, setTestLng] = useState('-6.2603')
  const [testLat2, setTestLat2] = useState('')
  const [testLng2, setTestLng2] = useState('')
  const [cleanMsg, setCleanMsg] = useState('')
  const [cleanLoading, setCleanLoading] = useState(false)

  function showToast(msg: string) {
    setToast(msg)
    if (toastRef.current) clearTimeout(toastRef.current)
    toastRef.current = setTimeout(() => setToast(''), 3500)
  }

  useEffect(() => { const t = setInterval(() => setNow(new Date()), 1000); return () => clearInterval(t) }, [])

  // ── SCROLL FIX ─────────────────────────────────────────────────────────────
  useEffect(() => {
    const html = document.documentElement, body = document.body
    const ph = html.style.overflow, pb = body.style.overflow
    html.style.overflow = 'auto'
    body.style.overflow = 'auto'
    return () => { html.style.overflow = ph; body.style.overflow = pb }
  }, [])

  // ── AUTH — só admins da whitelist entram ──────────────────────────────────
  useEffect(() => {
    if (authLoading) return
    if (!firebaseUser) { router.replace('/'); return }
    if (!isAdminUser(firebaseUser.email) && firebaseUser.uid !== ADMIN_UID) {
      // Redireciona silenciosamente — sem mensagem de erro
      router.replace('/')
      return
    }
    setAuthChecked(true)
  }, [firebaseUser, authLoading, router])

  // ── SUPER ADMIN CHECK (non-blocking) ───────────────────────────────────────
  useEffect(() => {
    if (!firebaseUser?.uid) return
    const uid = firebaseUser.uid
    if (uid === ADMIN_UID || isAdminUser(firebaseUser.email)) {
      setIsSuperAdmin(true)
    }
    const q = query(collection(db, 'users'), where('id', '==', uid))
    const unsub = onSnapshot(q, async snap => {
      const data = snap.empty
        ? await getDoc(doc(db, 'users', uid)).then(d => d.exists() ? d.data() : null).catch(() => null)
        : snap.docs[0].data()
      if (data?.isSuperAdmin || uid === ADMIN_UID) setIsSuperAdmin(true)
    }, () => {})
    return unsub
  }, [firebaseUser?.uid, firebaseUser?.email])

  // ── LOAD DATA ──────────────────────────────────────────────────────────────
  useEffect(() => {
    if (!authChecked) return
    const cut24h = new Date(Date.now() - 86400000)
    const cut7d  = new Date(Date.now() - 7 * 86400000)

    // stats
    getDocs(collection(db, 'users')).then(s => setStats(p => ({ ...p, users: s.size }))).catch(() => {})
    getDocs(collection(db, 'risk_zones')).then(s => setStats(p => ({ ...p, zones: s.size }))).catch(() => {})

    // user chart
    getDocs(query(collection(db, 'users'), where('createdAt', '>=', Timestamp.fromDate(cut7d)))).then(snap => {
      const days = Array.from({ length: 7 }, (_, i) => new Date(Date.now() - (6 - i) * 86400000).toLocaleDateString('pt', { weekday: 'short' }))
      const counts: Record<string, number> = {}
      days.forEach(d => { counts[d] = 0 })
      snap.docs.forEach(d => {
        const ts = d.data().createdAt?.toDate() as Date | undefined
        if (ts) { const k = ts.toLocaleDateString('pt', { weekday: 'short' }); if (k in counts) counts[k]++ }
      })
      setUserChart(days.map(d => ({ day: d, users: counts[d] })))
    }).catch(() => {})

    // live incidents (admin only)
    const unsubInc = onSnapshot(
      query(collection(db, 'incidents'), orderBy('timestamp', 'desc'), limit(50)),
      snap => setLiveIncidents(snap.docs.map(d => ({ id: d.id, ...d.data(), ts: d.data().timestamp?.toDate() }))),
      () => {}
    )

    // feedbacks
    feedbackUnsubRef.current = onSnapshot(query(collection(db, 'feedback'), orderBy('timestamp', 'desc'), limit(50)), snap => {
      setFeedbacks(snap.docs.map(d => ({ id: d.id, docRef: d.ref, userId: d.data().userId ?? '', tipo: d.data().tipo ?? 'other', mensagem: d.data().mensagem ?? '', timestamp: d.data().timestamp?.toDate() ?? new Date(), read: d.data().read ?? false })))
      setStats(p => ({ ...p, feedbacks: snap.size }))
    }, () => {})

    // emergencies
    emergencyUnsubRef.current = onSnapshot(query(collection(db, 'emergencies'), orderBy('timestamp', 'desc'), limit(50)), snap => {
      const docs = snap.docs.map(d => ({
        id: d.id, docRef: d.ref,
        userId: d.data().userId ?? '', userName: d.data().userName ?? 'Desconhecido',
        groupName: d.data().groupName ?? '', lat: d.data().lat ?? null, lng: d.data().lng ?? null,
        timestamp: d.data().timestamp?.toDate() ?? new Date(),
        status: d.data().status ?? 'active',
        resolvedAt: d.data().resolvedAt?.toDate() ?? null,
      }))
      setEmergencias(docs)
      setStats(p => ({ ...p, emergencias: docs.filter(e => e.status === 'active').length }))
    }, () => {})

    // indicados — todos os referrals feitos pelo utilizador atual
    if (firebaseUser?.uid) {
      indicadosUnsubRef.current = onSnapshot(
        query(collection(db, 'referrals'), where('referrerId', '==', firebaseUser.uid), orderBy('createdAt', 'desc')),
        snap => setIndicados(snap.docs.map(d => ({ id: d.id, ...d.data(), createdAt: d.data().createdAt?.toDate() ?? null }))),
        () => {}
      )
    }

    return () => { unsubInc(); feedbackUnsubRef.current?.(); emergencyUnsubRef.current?.(); indicadosUnsubRef.current?.() }
  }, [authChecked, firebaseUser?.uid])

  useEffect(() => {
    const fetchReferral = async () => {
      const userDoc = await getDoc(doc(db, 'users', firebaseUser?.uid || ''))
      const refCode = userDoc.data()?.referralCode || 'ZIVO-' + (firebaseUser?.uid?.slice(-5).toUpperCase() ?? 'XXXXX')
      setReferralCode(refCode)
      const refSnap = await getDocs(query(collection(db, 'referrals'), where('referrerId', '==', firebaseUser?.uid)))
      setReferralCount(refSnap.size)
    }
    if (firebaseUser?.uid) fetchReferral()
  }, [firebaseUser?.uid])

  // ── USERS ──────────────────────────────────────────────────────────────────
  async function carregarUsuarios() {
    setUsersLoading(true)
    try {
      const snap = await getDocs(query(collection(db, 'users'), orderBy('createdAt', 'desc')))
      setUsers(snap.docs.map(d => ({ docId: d.id, ...d.data() })))
    } catch { showToast('❌ Erro ao carregar') }
    setUsersLoading(false)
  }

  async function mudarAdmin(docId: string, nivel: 'super' | 'editor' | 'remover') {
    setUserAction(docId)
    const up = nivel === 'super'  ? { isAdmin: true,  isSuperAdmin: true,  adminLevel: 'super',  adminSince: serverTimestamp() }
             : nivel === 'editor' ? { isAdmin: true,  isSuperAdmin: false, adminLevel: 'editor', adminSince: serverTimestamp() }
             :                      { isAdmin: false, isSuperAdmin: false, adminLevel: null }
    await updateDoc(doc(db, 'users', docId), up)
    showToast(nivel === 'remover' ? '✅ Admin removido' : `✅ ${nivel === 'super' ? 'Super' : 'Editor'} Admin ativado`)
    await carregarUsuarios(); setUserAction(null)
  }

  async function togglePro(docId: string, atual: boolean) {
    setUserAction(docId)
    await updateDoc(doc(db, 'users', docId), { isPremium: !atual })
    showToast(atual ? '✅ PRO removido' : '✅ PRO ativado')
    await carregarUsuarios(); setUserAction(null)
  }

  async function toggleDisable(docId: string, email: string, off: boolean) {
    if (!confirm(off ? `Reativar ${email}?` : `Desativar ${email}?`)) return
    setUserAction(docId)
    await updateDoc(doc(db, 'users', docId), { isDisabled: !off, disabledAt: off ? null : serverTimestamp() })
    showToast(off ? '✅ Reativado' : '✅ Desativado')
    await carregarUsuarios(); setUserAction(null)
  }

  async function apagarUser(docId: string, email: string) {
    if (!confirm(`APAGAR permanentemente ${email}?`)) return
    setUserAction(docId)
    try { await deleteDoc(doc(db, 'users', docId)); showToast('✅ Apagado') }
    catch (e) { showToast('❌ ' + (e as Error).message) }
    await carregarUsuarios(); setUserAction(null)
  }

  async function apagarReport(docId: string) {
    if (!confirm('APAGAR este relatório?')) return
    try {
      await deleteDoc(doc(db, 'incidents', docId))
      showToast('✅ Relatório apagado')
    } catch (e: any) {
      showToast('❌ ' + e.message)
    }
  }

  // ── FEEDBACK ──────────────────────────────────────────────────────────────
  async function marcarLido(fb: FeedbackDoc) {
    try { await updateDoc(fb.docRef, { read: true }) } catch { /* non-critical */ }
  }

  function tipoBadge(tipo: string) {
    if (tipo === 'Bug' || tipo === 'bug') return { label: 'Bug', bg: 'rgba(239,68,68,0.15)', color: '#ef4444' }
    if (tipo === 'Sugestão' || tipo === 'suggestion') return { label: 'Sugestão', bg: 'rgba(59,130,246,0.15)', color: '#3b82f6' }
    if (tipo === 'Elogio' || tipo === 'praise') return { label: 'Elogio', bg: 'rgba(16,185,129,0.15)', color: '#10b981' }
    return { label: tipo, bg: 'rgba(156,163,175,0.1)', color: '#9ca3af' }
  }

  // ── EMERGÊNCIAS ────────────────────────────────────────────────────────────
  async function resolverEmergencia(em: EmergencyDoc) {
    try {
      await updateDoc(em.docRef, { status: 'resolved', resolvedAt: serverTimestamp(), resolvedBy: firebaseUser?.uid ?? 'admin' })
      rtdbRemove(rtdbRef(rtdb, `emergencies/${em.userId}`)).catch(() => {})
      showToast('✅ Emergência resolvida')
    } catch { showToast('❌ Erro ao resolver') }
  }

  // ── LIMPEZA ────────────────────────────────────────────────────────────────
  function isManualZone(data: any) { return data.isPermanent || data.source === 'admin_manual' || data.zoneType === 'manual' }

  async function limparZonasAuto() {
    if (!confirm('Apagar zonas automáticas? Zonas manuais são preservadas.')) return
    setCleanLoading(true); setCleanMsg('A limpar…')
    try {
      const snap = await getDocs(collection(db, 'risk_zones'))
      const auto = snap.docs.filter(d => !isManualZone(d.data()))
      let b = writeBatch(db), ops = 0
      for (const d of auto) { b.delete(d.ref); if (++ops % 499 === 0) { await b.commit(); b = writeBatch(db); ops = 0 } }
      if (ops > 0) await b.commit()
      setCleanMsg(`✅ ${auto.length} zonas auto apagadas`)
    } catch (e) { setCleanMsg('❌ ' + (e as Error).message) }
    setCleanLoading(false)
  }

  async function criarContasTeste() {
    setCleanLoading(true); setCleanMsg('A criar…')
    try {
      const names = ['Rider Teste A', 'Rider Teste B', 'Rider Teste C', 'Rider Teste D', 'Rider Teste E']
      for (let i = 0; i < 5; i++) await addDoc(collection(db, 'users'), { name: names[i], email: `teste${i + 1}@zivo-test.dev`, isPremium: false, riderScore: (i + 1) * 20, isTestData: true, createdAt: serverTimestamp() })
      setCleanMsg('✅ 5 contas criadas')
    } catch (e) { setCleanMsg('❌ ' + (e as Error).message) }
    setCleanLoading(false)
  }

  async function simularRelatorios() {
    const lat = parseFloat(testLat), lng = parseFloat(testLng)
    if (isNaN(lat) || isNaN(lng)) { setCleanMsg('❌ Coordenadas A inválidas'); return }
    const lat2 = parseFloat(testLat2), lng2 = parseFloat(testLng2)
    const hasB = testLat2.trim() !== '' && testLng2.trim() !== '' && !isNaN(lat2) && !isNaN(lng2)
    setCleanLoading(true); setCleanMsg('A simular…')
    try {
      const { latLngToCell } = await import('h3-js')
      const types = ['robbery', 'attempted_robbery', 'aggression', 'suspicious_activity', 'road_hazard']
      const locs = hasB
        ? Array.from({ length: 4 }, () => ({ lat, lng })).concat(Array.from({ length: 4 }, () => ({ lat: lat2, lng: lng2 })))
        : Array.from({ length: 8 }, () => ({ lat, lng }))
      for (let i = 0; i < locs.length; i++) {
        const jitter = hasB ? 0.0004 : 0.004
        const jLat = locs[i].lat + (Math.random() - 0.5) * jitter
        const jLng = locs[i].lng + (Math.random() - 0.5) * jitter
        const ts = new Date(Date.now() - Math.random() * 5 * 86400000)
        await addDoc(collection(db, 'incidents'), { type: types[i % types.length], location: { lat: jLat, lng: jLng }, originalLocation: { lat: jLat, lng: jLng }, h3Index: latLngToCell(jLat, jLng, 9), h3IndexRes10: latLngToCell(jLat, jLng, 10), hour: ts.getHours(), dayOfWeek: ts.getDay(), timestamp: Timestamp.fromDate(ts), userName: `Teste${i + 1}`, userId: `test-${i}`, createdBy: firebaseUser?.uid ?? 'test-admin', riderScore: 50, confidenceScore: 60, wasSnapped: false, status: 'pending', confirmations: 0, denials: 0, isTestData: true })
      }
      const msg = hasB
        ? `✅ 8 relatórios criados: A (${lat.toFixed(4)}, ${lng.toFixed(4)}) + B (${lat2.toFixed(4)}, ${lng2.toFixed(4)})`
        : `✅ 8 relatórios criados em (${lat.toFixed(4)}, ${lng.toFixed(4)})`
      setCleanMsg(msg)
    } catch (e) { setCleanMsg('❌ ' + (e as Error).message) }
    setCleanLoading(false)
  }

  async function apagarTeste() {
    if (!confirm('Apagar todos os dados de teste?')) return
    setCleanLoading(true); setCleanMsg('A apagar…')
    try {
      let total = 0
      for (const col of ['incidents', 'users', 'risk_zones']) {
        const snap = await getDocs(query(collection(db, col), where('isTestData', '==', true)))
        const b = writeBatch(db); snap.docs.forEach(d => b.delete(d.ref))
        if (snap.size > 0) await b.commit()
        total += snap.size
      }
      setCleanMsg(`✅ ${total} registos de teste apagados`)
    } catch (e) { setCleanMsg('❌ ' + (e as Error).message) }
    setCleanLoading(false)
  }

  // ── GUARDS ─────────────────────────────────────────────────────────────────
  if (authLoading || !authChecked) {
    return <div style={{ minHeight: '100vh', background: '#0a0e1a', display: 'flex', alignItems: 'center', justifyContent: 'center' }}><p style={{ color: '#9ca3af' }}>A carregar…</p></div>
  }

  const card: React.CSSProperties = { background: '#111827', border: '1px solid rgba(245,158,11,0.2)', borderRadius: 14, padding: 20, marginBottom: 14 }
  const sTitle: React.CSSProperties = { fontSize: 14, fontWeight: 700, color: '#f59e0b', marginBottom: 12 }
  const btn = (bg: string, color = '#fff'): React.CSSProperties => ({ padding: '10px 16px', background: bg, border: 'none', color, borderRadius: 10, fontSize: 13, fontWeight: 700, cursor: 'pointer', marginBottom: 8, width: '100%' })
  const inp: React.CSSProperties = { width: '100%', padding: '9px 12px', background: '#0a0e1a', border: '1px solid rgba(245,158,11,0.3)', borderRadius: 8, color: '#fff', fontSize: 13, boxSizing: 'border-box', marginBottom: 10 }

  const TABS: { key: Tab; label: string; badge?: number }[] = [
    { key: 'visao',       label: '📊 Visão Geral' },
    { key: 'zonas',       label: '📍 Zonas' },
    { key: 'usuarios',    label: '👥 Usuários' },
    { key: 'feedbacks',   label: '💬 Feedbacks',   badge: feedbacks.filter(f => !f.read).length || undefined },
    { key: 'emergencias', label: '🚨 Emergências', badge: emergencias.filter(e => e.status === 'active').length || undefined },
    { key: 'indicados',   label: '🔗 Indicados',   badge: indicados.length || undefined },
    { key: 'limpeza',     label: '🧹 Limpeza' },
  ]

  return (
    <div style={{ minHeight: '100vh', background: '#0a0e1a', color: '#fff', paddingBottom: 60, overflowY: 'auto' }}>

      {/* Toast */}
      {toast && <div style={{ position: 'fixed', top: 16, left: '50%', transform: 'translateX(-50%)', background: '#111827', border: '1px solid #f59e0b', borderRadius: 12, padding: '10px 20px', fontSize: 14, zIndex: 9999, whiteSpace: 'nowrap' }}>{toast}</div>}

      {/* Header */}
      <div style={{ background: '#0d1117', borderBottom: '1px solid rgba(245,158,11,0.3)', padding: '14px 20px', position: 'sticky', top: 0, zIndex: 200 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
          <button onClick={() => router.push('/')} style={{ background: 'rgba(245,158,11,0.1)', border: '1px solid rgba(245,158,11,0.3)', color: '#f59e0b', borderRadius: 10, padding: '6px 14px', fontSize: 13, cursor: 'pointer' }}>← Voltar</button>
          <div style={{ flex: 1 }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
              <span style={{ fontWeight: 800, fontSize: 17 }}>⚙️ Painel Admin ZIVO</span>
              <span style={{ background: '#10b981', color: '#fff', fontSize: 10, fontWeight: 700, padding: '2px 7px', borderRadius: 20 }}>LIVE</span>
            </div>
            <p style={{ fontSize: 11, color: '#6b7280', margin: '2px 0 0' }}>
              {now.toLocaleString('pt', { weekday: 'short', day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit', second: '2-digit' })} · {firebaseUser?.email}
            </p>
          </div>
        </div>
      </div>

      {/* Tab Bar */}
      <div style={{ background: '#0d1117', borderBottom: '1px solid rgba(245,158,11,0.15)', display: 'flex', overflowX: 'auto', position: 'sticky', top: 65, zIndex: 100 }}>
        {TABS.map(({ key, label, badge }) => (
          <button key={key} onClick={() => setActiveTab(key)} style={{ position: 'relative', flexShrink: 0, padding: '12px 16px', background: 'none', border: 'none', borderBottom: activeTab === key ? '2px solid #f59e0b' : '2px solid transparent', color: activeTab === key ? '#f59e0b' : '#6b7280', fontSize: 12, fontWeight: 700, cursor: 'pointer', whiteSpace: 'nowrap' }}>
            {label}
            {badge ? <span style={{ position: 'absolute', top: 6, right: 6, background: '#ef4444', color: '#fff', fontSize: 9, fontWeight: 800, borderRadius: 99, padding: '1px 5px', minWidth: 14, textAlign: 'center' }}>{badge}</span> : null}
          </button>
        ))}
      </div>

      <div style={{ padding: '20px 16px', maxWidth: 860, margin: '0 auto' }}>

        {/* ══ VISÃO GERAL ═══════════════════════════════════════════════════════ */}
        {activeTab === 'visao' && <>
          {/* Stats */}
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10, marginBottom: 16 }}>
            {[
              { label: 'Total Riders',     value: stats.users,        color: '#1a56db' },
              { label: 'Zonas ativas',     value: stats.zones,        color: '#10b981' },
              { label: 'Emergências ativas', value: stats.emergencias, color: '#ef4444' },
              { label: 'Feedbacks',        value: stats.feedbacks,    color: '#8b5cf6' },
            ].map(({ label, value, color }) => (
              <div key={label} style={{ background: '#111827', border: `1px solid ${color}44`, borderRadius: 12, padding: '14px 16px' }}>
                <p style={{ fontSize: 11, color: '#6b7280', margin: '0 0 4px', fontWeight: 600 }}>{label}</p>
                <p style={{ fontSize: 26, fontWeight: 800, color, margin: 0 }}>{value === -1 ? '…' : value}</p>
              </div>
            ))}
          </div>

          {/* User chart */}
          {userChart.length > 0 && (
            <div style={card}>
              <p style={sTitle}>📈 Novos Riders (7 dias)</p>
              <ResponsiveContainer width="100%" height={150}>
                <LineChart data={userChart}>
                  <CartesianGrid strokeDasharray="3 3" stroke="rgba(245,158,11,0.08)" />
                  <XAxis dataKey="day" tick={{ fill: '#6b7280', fontSize: 11 }} />
                  <YAxis tick={{ fill: '#6b7280', fontSize: 11 }} allowDecimals={false} />
                  <Tooltip contentStyle={{ background: '#111827', border: '1px solid #f59e0b', borderRadius: 8, fontSize: 12 }} />
                  <Line type="monotone" dataKey="users" stroke="#f59e0b" strokeWidth={2} dot={{ fill: '#f59e0b', r: 3 }} />
                </LineChart>
              </ResponsiveContainer>
            </div>
          )}

          {/* Live incidents */}
          <div style={card}>
            <p style={sTitle}>⚡ Relatórios recentes</p>
            <div style={{ overflowX: 'auto' }}>
              <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12 }}>
                <thead>
                  <tr style={{ color: '#6b7280' }}>
                    {['Tipo', 'Rider', 'Hora', 'Snapped', 'Score', ''].map(h => (
                      <th key={h} style={{ padding: '6px 8px', borderBottom: '1px solid rgba(245,158,11,0.1)', textAlign: 'left', fontWeight: 600 }}>{h}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {liveIncidents.map(inc => (
                    <tr key={inc.id} style={{ borderBottom: '1px solid rgba(255,255,255,0.04)' }}>
                      <td style={{ padding: '7px 8px', color: '#d1d5db' }}>{INCIDENT_PT[inc.type] ?? inc.type}</td>
                      <td style={{ padding: '7px 8px', color: '#9ca3af' }}>{inc.userName ?? '—'}</td>
                      <td style={{ padding: '7px 8px', color: '#6b7280' }}>{inc.ts instanceof Date ? inc.ts.toLocaleTimeString('pt', { hour: '2-digit', minute: '2-digit' }) : '—'}</td>
                      <td style={{ padding: '7px 8px', color: inc.wasSnapped ? '#10b981' : '#6b7280' }}>{inc.wasSnapped ? '✓' : '✗'}</td>
                      <td style={{ padding: '7px 8px', color: '#f59e0b', fontWeight: 700 }}>{inc.confidenceScore ?? '—'}</td>
                      <td style={{ padding: '7px 8px' }}>
                        <button
                          onClick={() => apagarReport(inc.id)}
                          style={{ background: 'rgba(239,68,68,0.1)', border: '1px solid #ef4444', color: '#f87171', padding: '4px 8px', borderRadius: 4, cursor: 'pointer', fontSize: 12 }}>
                          🗑️
                        </button>
                      </td>
                    </tr>
                  ))}
                  {liveIncidents.length === 0 && <tr><td colSpan={6} style={{ padding: 20, textAlign: 'center', color: '#6b7280' }}>Nenhum relatório</td></tr>}
                </tbody>
              </table>
            </div>
          </div>

        </>}

        {/* ══ ZONAS ═════════════════════════════════════════════════════════════ */}
        {activeTab === 'zonas' && (
          <div style={card}>
            <p style={sTitle}>📍 Editor de Zonas de Risco</p>
            <ZoneEditor onToast={showToast} isSuperAdmin={isSuperAdmin} currentUid={firebaseUser?.uid ?? ''} />
          </div>
        )}

        {/* ══ USUÁRIOS ══════════════════════════════════════════════════════════ */}
        {activeTab === 'usuarios' && (
          <div style={card}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16 }}>
              <p style={{ ...sTitle, marginBottom: 0 }}>👥 Gestão de Usuários</p>
              <button onClick={carregarUsuarios} disabled={usersLoading} style={{ background: '#1a56db', border: 'none', color: '#fff', borderRadius: 10, padding: '8px 16px', fontSize: 13, fontWeight: 700, cursor: 'pointer' }}>
                {usersLoading ? 'A carregar…' : `Carregar (${users.length > 0 ? users.length : 'todos'})`}
              </button>
            </div>
            {users.length === 0
              ? <p style={{ color: '#6b7280', fontSize: 13, textAlign: 'center', padding: 24 }}>Clica "Carregar" para ver todos os utilizadores</p>
              : <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                  {users.map((u: any) => (
                    <div key={u.docId} style={{ background: '#0a0e1a', border: '1px solid rgba(245,158,11,0.1)', borderRadius: 12, padding: '12px 14px' }}>
                      <div style={{ display: 'flex', gap: 8, marginBottom: 4, flexWrap: 'wrap', alignItems: 'center' }}>
                        <span style={{ fontWeight: 600, fontSize: 14, color: '#e5e7eb', flex: 1 }}>{u.name ?? 'Sem nome'}</span>
                        {u.isSuperAdmin && <span style={{ fontSize: 10, background: '#7c3aed', color: '#fff', padding: '2px 7px', borderRadius: 20, fontWeight: 700 }}>SUPER</span>}
                        {u.isAdmin && !u.isSuperAdmin && <span style={{ fontSize: 10, background: '#1a56db', color: '#fff', padding: '2px 7px', borderRadius: 20, fontWeight: 700 }}>EDITOR</span>}
                        {u.isPremium && <span style={{ fontSize: 10, background: '#f59e0b', color: '#0a0e1a', padding: '2px 7px', borderRadius: 20, fontWeight: 700 }}>PRO</span>}
                        {u.isDisabled && <span style={{ fontSize: 10, background: '#dc3545', color: '#fff', padding: '2px 7px', borderRadius: 20, fontWeight: 700 }}>OFF</span>}
                        {u.isTestData && <span style={{ fontSize: 10, background: '#374151', color: '#9ca3af', padding: '2px 7px', borderRadius: 20 }}>TESTE</span>}
                      </div>
                      <p style={{ fontSize: 12, color: '#9ca3af', margin: '0 0 8px' }}>{u.email} · score: {u.riderScore ?? '—'}</p>
                      <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
                        {!u.isSuperAdmin && <button onClick={() => mudarAdmin(u.docId, 'super')} disabled={userAction === u.docId} style={{ fontSize: 11, padding: '4px 10px', background: 'rgba(124,58,237,0.15)', border: '1px solid rgba(124,58,237,0.3)', color: '#c4b5fd', borderRadius: 8, cursor: 'pointer' }}>🔝 Super Admin</button>}
                        {!u.isAdmin && <button onClick={() => mudarAdmin(u.docId, 'editor')} disabled={userAction === u.docId} style={{ fontSize: 11, padding: '4px 10px', background: 'rgba(26,86,219,0.12)', border: '1px solid rgba(26,86,219,0.3)', color: '#93c5fd', borderRadius: 8, cursor: 'pointer' }}>✏️ Editor Admin</button>}
                        {u.isAdmin && <button onClick={() => mudarAdmin(u.docId, 'remover')} disabled={userAction === u.docId} style={{ fontSize: 11, padding: '4px 10px', background: 'rgba(107,114,128,0.15)', border: '1px solid rgba(107,114,128,0.2)', color: '#9ca3af', borderRadius: 8, cursor: 'pointer' }}>✕ Remover Admin</button>}
                        <button onClick={() => togglePro(u.docId, !!u.isPremium)} disabled={userAction === u.docId} style={{ fontSize: 11, padding: '4px 10px', background: 'rgba(245,158,11,0.1)', border: '1px solid rgba(245,158,11,0.2)', color: '#f59e0b', borderRadius: 8, cursor: 'pointer' }}>{u.isPremium ? '↓ Rem. PRO' : '⭐ Dar PRO'}</button>
                        <button onClick={() => toggleDisable(u.docId, u.email, !!u.isDisabled)} disabled={userAction === u.docId} style={{ fontSize: 11, padding: '4px 10px', background: u.isDisabled ? 'rgba(16,185,129,0.1)' : 'rgba(245,158,11,0.08)', border: `1px solid ${u.isDisabled ? 'rgba(16,185,129,0.3)' : 'rgba(245,158,11,0.15)'}`, color: u.isDisabled ? '#10b981' : '#f59e0b', borderRadius: 8, cursor: 'pointer' }}>{u.isDisabled ? '✅ Reativar' : '⛔ Desativar'}</button>
                        <button onClick={() => apagarUser(u.docId, u.email)} disabled={userAction === u.docId} style={{ fontSize: 11, padding: '4px 10px', background: 'rgba(220,53,69,0.1)', border: '1px solid rgba(220,53,69,0.2)', color: '#f87171', borderRadius: 8, cursor: 'pointer' }}>🗑️ Apagar</button>
                      </div>
                    </div>
                  ))}
                </div>
            }
          </div>
        )}

        {/* ══ FEEDBACKS ═════════════════════════════════════════════════════════ */}
        {activeTab === 'feedbacks' && (
          <div style={card}>
            <p style={sTitle}>💬 Feedbacks dos Riders ({feedbacks.length})</p>
            {feedbacks.length === 0
              ? <p style={{ color: '#6b7280', fontSize: 13, textAlign: 'center', padding: 24 }}>Nenhum feedback recebido</p>
              : <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
                  {feedbacks.map(fb => {
                    const b = tipoBadge(fb.tipo)
                    return (
                      <div key={fb.id} onClick={() => !fb.read && marcarLido(fb)} style={{ background: fb.read ? '#0a0e1a' : 'rgba(245,158,11,0.04)', border: `1px solid ${fb.read ? 'rgba(255,255,255,0.06)' : 'rgba(245,158,11,0.2)'}`, borderRadius: 12, padding: '12px 14px', cursor: fb.read ? 'default' : 'pointer' }}>
                        <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 6 }}>
                          <span style={{ fontSize: 11, fontWeight: 700, padding: '2px 8px', borderRadius: 20, background: b.bg, color: b.color }}>{b.label}</span>
                          {!fb.read && <span style={{ fontSize: 10, background: '#f59e0b', color: '#0a0e1a', padding: '2px 6px', borderRadius: 20, fontWeight: 800 }}>NOVO</span>}
                          <span style={{ fontSize: 11, color: '#6b7280', marginLeft: 'auto' }}>{timeAgo(fb.timestamp)}</span>
                        </div>
                        <p style={{ fontSize: 13, color: '#d1d5db', margin: 0, lineHeight: 1.5 }}>{fb.mensagem || '(sem mensagem)'}</p>
                        <p style={{ fontSize: 11, color: '#4b5563', margin: '6px 0 0', fontFamily: 'monospace' }}>UID: {fb.userId.slice(0, 12)}…</p>
                      </div>
                    )
                  })}
                </div>
            }
          </div>
        )}

        {/* ══ EMERGÊNCIAS ═══════════════════════════════════════════════════════ */}
        {activeTab === 'emergencias' && (
          <div style={card}>
            <p style={sTitle}>🚨 Histórico de Emergências ({emergencias.length})</p>
            {emergencias.length === 0
              ? <p style={{ color: '#6b7280', fontSize: 13, textAlign: 'center', padding: 24 }}>Nenhuma emergência registada</p>
              : <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                  {emergencias.map(em => (
                    <div key={em.id} style={{ background: '#0a0e1a', border: `1px solid ${em.status === 'active' ? 'rgba(239,68,68,0.4)' : 'rgba(255,255,255,0.07)'}`, borderRadius: 12, padding: '12px 14px' }}>
                      <div style={{ display: 'flex', gap: 8, alignItems: 'center', marginBottom: 4 }}>
                        <span style={{ fontSize: 20 }}>{em.status === 'active' ? '🚨' : '✅'}</span>
                        <span style={{ fontWeight: 700, fontSize: 14, color: em.status === 'active' ? '#ef4444' : '#9ca3af', flex: 1 }}>{em.userName}</span>
                        <span style={{ fontSize: 11, color: '#6b7280' }}>{timeAgo(em.timestamp)}</span>
                      </div>
                      <p style={{ fontSize: 12, color: '#9ca3af', margin: '0 0 8px' }}>Grupo: {em.groupName || '—'} · {em.lat ? `${em.lat.toFixed(4)}, ${em.lng?.toFixed(4)}` : 'Sem GPS'}</p>
                      {em.status === 'active' && (
                        <button onClick={() => resolverEmergencia(em)} style={{ fontSize: 12, padding: '6px 14px', background: '#10b981', border: 'none', color: '#fff', borderRadius: 8, cursor: 'pointer', fontWeight: 700 }}>
                          ✅ Marcar como resolvida
                        </button>
                      )}
                      {em.resolvedAt && <p style={{ fontSize: 11, color: '#10b981', margin: '4px 0 0' }}>Resolvida {timeAgo(em.resolvedAt)}</p>}
                    </div>
                  ))}
                </div>
            }
          </div>
        )}

        {/* ══ INDICADOS ═════════════════════════════════════════════════════════ */}
        {activeTab === 'indicados' && (
          <div style={card}>
            <div style={{ padding: 20, background: 'rgba(245,158,11,0.1)', border: '1px solid rgba(245,158,11,0.3)', borderRadius: 12, marginBottom: 20 }}>
              <h3 style={{ color: '#f59e0b', margin: '0 0 12px', fontSize: 16 }}>💰 Sistema de Referência</h3>
              <p style={{ color: '#e5e7eb', margin: '0 0 6px', fontSize: 14 }}>Teu código: <strong style={{ fontFamily: 'monospace', fontSize: 16, color: '#fbbf24' }}>{referralCode || '…'}</strong></p>
              <p style={{ color: '#9ca3af', margin: '0 0 6px', fontSize: 12 }}>URL: ridershield.vercel.app?ref={referralCode}</p>
              <p style={{ color: '#e5e7eb', margin: 0, fontSize: 14 }}>Indicações: <strong style={{ color: '#f59e0b' }}>{referralCount}</strong></p>
            </div>
            <div style={{ display: 'flex', alignItems: 'center', gap: 16, marginBottom: 20 }}>
              <div style={{ background: 'rgba(245,158,11,0.08)', border: '1px solid rgba(245,158,11,0.25)', borderRadius: 12, padding: '16px 24px', textAlign: 'center' }}>
                <p style={{ fontSize: 36, fontWeight: 800, color: '#f59e0b', margin: 0 }}>{indicados.length}</p>
                <p style={{ fontSize: 12, color: '#9ca3af', margin: '4px 0 0' }}>pessoas indicadas</p>
              </div>
              <div style={{ background: 'rgba(16,185,129,0.08)', border: '1px solid rgba(16,185,129,0.25)', borderRadius: 12, padding: '16px 24px', textAlign: 'center' }}>
                <p style={{ fontSize: 36, fontWeight: 800, color: '#10b981', margin: 0 }}>
                  {indicados.filter(r => r.status === 'confirmed' || r.status === 'credited').length}
                </p>
                <p style={{ fontSize: 12, color: '#9ca3af', margin: '4px 0 0' }}>confirmadas</p>
              </div>
              <div style={{ background: 'rgba(139,92,246,0.08)', border: '1px solid rgba(139,92,246,0.25)', borderRadius: 12, padding: '16px 24px', textAlign: 'center' }}>
                <p style={{ fontSize: 36, fontWeight: 800, color: '#8b5cf6', margin: 0 }}>
                  €{indicados.filter(r => r.status === 'confirmed' || r.status === 'credited').length * 5}
                </p>
                <p style={{ fontSize: 12, color: '#9ca3af', margin: '4px 0 0' }}>comissões</p>
              </div>
            </div>

            {indicados.length === 0
              ? <p style={{ color: '#6b7280', fontSize: 13, textAlign: 'center', padding: 32 }}>Nenhuma indicação registada ainda.<br/>Partilha o teu código ZIVO para começar a ganhar!</p>
              : <div style={{ overflowX: 'auto' }}>
                  <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13 }}>
                    <thead>
                      <tr style={{ color: '#6b7280', borderBottom: '1px solid rgba(245,158,11,0.1)' }}>
                        {['Nome', 'Código usado', 'Status', 'Data', 'Comissão'].map(h => (
                          <th key={h} style={{ padding: '8px 10px', textAlign: 'left', fontWeight: 600, fontSize: 11 }}>{h}</th>
                        ))}
                      </tr>
                    </thead>
                    <tbody>
                      {indicados.map(r => {
                        const statusColor = r.status === 'confirmed' || r.status === 'credited' ? '#10b981'
                          : r.status === 'cancelled' || r.status === 'invalid' ? '#6b7280' : '#f59e0b'
                        const statusLabel = r.status === 'signed_up' ? 'Cadastrou' : r.status === 'confirmed' ? 'Confirmado' : r.status === 'credited' ? 'Pago' : r.status === 'cancelled' ? 'Cancelado' : r.status ?? '—'
                        return (
                          <tr key={r.id} style={{ borderBottom: '1px solid rgba(255,255,255,0.04)' }}>
                            <td style={{ padding: '9px 10px', color: '#e5e7eb', fontWeight: 600 }}>{r.referredName || '—'}</td>
                            <td style={{ padding: '9px 10px', color: '#9ca3af', fontFamily: 'monospace', fontSize: 12 }}>{r.code || '—'}</td>
                            <td style={{ padding: '9px 10px' }}>
                              <span style={{ background: `${statusColor}22`, color: statusColor, fontSize: 11, fontWeight: 700, padding: '3px 9px', borderRadius: 20 }}>{statusLabel}</span>
                            </td>
                            <td style={{ padding: '9px 10px', color: '#6b7280', fontSize: 12 }}>
                              {r.createdAt instanceof Date ? r.createdAt.toLocaleDateString('pt', { day: '2-digit', month: 'short', year: 'numeric' }) : '—'}
                            </td>
                            <td style={{ padding: '9px 10px', color: r.status === 'confirmed' || r.status === 'credited' ? '#10b981' : '#6b7280', fontWeight: 700 }}>
                              {r.status === 'confirmed' || r.status === 'credited' ? `€${r.commissionAmount ?? 5}` : '—'}
                            </td>
                          </tr>
                        )
                      })}
                    </tbody>
                  </table>
                </div>
            }
          </div>
        )}

        {/* ══ LIMPEZA ═══════════════════════════════════════════════════════════ */}
        {activeTab === 'limpeza' && <>
          <div style={card}>
            <p style={sTitle}>📍 Coordenadas para Simulação</p>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
              <div>
                <label style={{ fontSize: 11, color: '#f59e0b', fontWeight: 700, display: 'block', marginBottom: 4 }}>SAÍDA A (obrigatório)</label>
                <input value={testLat} onChange={e => setTestLat(e.target.value)} style={inp} placeholder="Latitude" />
                <input value={testLng} onChange={e => setTestLng(e.target.value)} style={inp} placeholder="Longitude" />
              </div>
              <div>
                <label style={{ fontSize: 11, color: '#9ca3af', fontWeight: 700, display: 'block', marginBottom: 4 }}>SAÍDA B (opcional — 4+4 reports)</label>
                <input value={testLat2} onChange={e => setTestLat2(e.target.value)} style={inp} placeholder="Latitude (deixar vazio = só A)" />
                <input value={testLng2} onChange={e => setTestLng2(e.target.value)} style={inp} placeholder="Longitude" />
              </div>
            </div>
          </div>
          <div style={card}>
            <p style={sTitle}>🧹 Ações</p>
            {cleanMsg && <p style={{ fontSize: 13, color: '#10b981', marginBottom: 12, padding: '8px 12px', background: 'rgba(16,185,129,0.07)', borderRadius: 8 }}>{cleanMsg}</p>}
            <button onClick={limparZonasAuto}    disabled={cleanLoading} style={btn('rgba(220,53,69,0.7)')}>🗑️ Limpar zonas automáticas</button>
            <button onClick={criarContasTeste}   disabled={cleanLoading} style={btn('#1a56db')}>👤 Criar 5 contas de teste</button>
            <button onClick={simularRelatorios}  disabled={cleanLoading} style={btn('rgba(245,158,11,0.7)', '#0a0e1a')}>📍 Simular 8 relatórios</button>
            <button onClick={apagarTeste}        disabled={cleanLoading} style={btn('rgba(107,114,128,0.4)')}>{cleanLoading ? 'A processar…' : '🧹 Apagar todos os dados de teste'}</button>
          </div>
        </>}

      </div>
    </div>
  )
}
