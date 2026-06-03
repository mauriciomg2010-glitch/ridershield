// src/components/Groups/GroupDetail.tsx
'use client'
import { useState, useEffect, useRef } from 'react'
import { useStore } from '@/lib/store'
import { useLang } from '@/contexts/LangContext'
import {
  subscribeToGroupLocations,
  subscribeToGroupAlerts,
  subscribeToGroupChat,
  clearLocation,
  removeMemberFromGroup,
  closeGroup,
  promoteToAdmin,
  ChatMessage,
} from '@/lib/firestore'
import { triggerEmergencyAlert } from '@/lib/emergencyAlert'
import { playEmergencySound, stopEmergencySound, playEmergencyConfirmSound, vibrateEmergency, ensureAudioUnlocked } from '@/lib/emergencySound'
import { collection, query, where, getDocs, updateDoc, serverTimestamp } from 'firebase/firestore'
import { db, rtdb } from '@/lib/firebase'
import { ref as rtdbRef, onValue, set as rtdbSet, remove as rtdbRemove } from 'firebase/database'
import { Group, Alert } from '@/types'
import GroupChat from './GroupChat'
import toast from 'react-hot-toast'
import { formatDistanceToNow } from 'date-fns'
import dynamic from 'next/dynamic'

const MapView = dynamic(() => import('../Map/MapView'), { ssr: false })

interface Props {
  group: Group
  onBack: () => void
}

export default function GroupDetail({ group: initialGroup, onBack }: Props) {
  const user = useStore((s) => s.user)
  const isSharingLocation = useStore((s) => s.isSharingLocation)
  const toggleLocationSharing = useStore((s) => s.toggleLocationSharing)
  const currentLocation = useStore((s) => s.currentLocation)
  const setActiveGroupId = useStore((s) => s.setActiveGroupId)
  const { t } = useLang()
  const [group, setGroup] = useState(initialGroup)
  const [memberLocations, setMemberLocations] = useState<Record<string, { lat: number; lng: number; lastUpdated: number }>>({})
  const [alerts, setAlerts] = useState<Alert[]>([])
  const [emergencyLoading, setEmergencyLoading] = useState(false)
  const [showAlerts, setShowAlerts] = useState(false)
  const [showAdminPanel, setShowAdminPanel] = useState(false)
  const [showChat, setShowChat] = useState(false)
  const [headerCollapsed, setHeaderCollapsed] = useState(false)
  const [chatMessages, setChatMessages] = useState<ChatMessage[]>([])
  const [memberNames, setMemberNames] = useState<Record<string, string>>({})
  const [rtdbEmergency, setRtdbEmergency] = useState<{ userId: string; userName: string; lat: number | null; lng: number | null } | null>(null)
  const [isPanelOpen, setIsPanelOpen] = useState(false)
  const [showCloseGroupConfirm, setShowCloseGroupConfirm] = useState(false)
  const [showLeaveConfirm, setShowLeaveConfirm] = useState(false)
  const [followUserId, setFollowUserId] = useState<string | null>(null)
  const seenCountRef = useRef(0)
  const dismissedSosIdsRef = useRef(new Set<string>())
  const activeSosRef = useRef<{ id: string; userName: string; userId: string } | null>(null)
  const [activeSos, setActiveSos] = useState<{ id: string; userName: string; userId: string } | null>(null)
  const soundPlayingRef = useRef(false)

  const unreadCount = showChat ? 0 : Math.max(0, chatMessages.length - seenCountRef.current)
  const isAdmin = group.adminId === user?.id || group.ownerId === user?.id || (group.members.length > 0 && group.members[0] === user?.id && !group.adminId)
  const isMySos = activeSos?.userId === user?.id

  // Register active group for page-level location sharing
  useEffect(() => {
    setActiveGroupId(group.id)
  }, [group.id, setActiveGroupId])

  useEffect(() => {
    const unsub = subscribeToGroupLocations(group.id, setMemberLocations)
    return unsub
  }, [group.id])

  // Alerts history (for panel + bell badge)
  useEffect(() => {
    const unsub = subscribeToGroupAlerts(group.id, setAlerts)
    return unsub
  }, [group.id])

  // Chat unread badge
  useEffect(() => {
    const unsub = subscribeToGroupChat(group.id, setChatMessages)
    return unsub
  }, [group.id])

  // RTDB emergency listener — shows overlay on all group members' devices
  useEffect(() => {
    if (!user?.id) return
    const RECENT_MS = 5 * 60 * 1000 // 5 minutes
    const emergRef = rtdbRef(rtdb, `emergencies/${group.id}`)
    const unsub = onValue(emergRef, (snapshot) => {
      const data: Record<string, any> = snapshot.val() ?? {}
      const activeEntry = Object.entries(data).find(([uid, emerg]: [string, any]) =>
        uid !== user.id && emerg?.active && Date.now() - emerg.timestamp < RECENT_MS
      )
      if (activeEntry) {
        const [uid, emerg] = activeEntry as [string, any]
        setRtdbEmergency({ userId: uid, userName: emerg.userName, lat: emerg.lat ?? null, lng: emerg.lng ?? null })
      } else {
        setRtdbEmergency(null)
      }
    })
    return () => unsub()
  }, [group.id, user?.id])

  // Stop sound on unmount, reset playing ref
  useEffect(() => {
    return () => {
      soundPlayingRef.current = false
      stopEmergencySound()
    }
  }, [])

  // Listen to groupAlerts/sos — sound + vibration on receive; unified activeSos for all members
  useEffect(() => {
    if (!user?.id) return
    const sosRef = rtdbRef(rtdb, `groupAlerts/${group.id}/sos`)
    const unsub = onValue(sosRef, async (snapshot) => {
      const data = snapshot.val()

      if (!data || !data.active) {
        activeSosRef.current = null
        setActiveSos(null)
        soundPlayingRef.current = false
        stopEmergencySound()
        return
      }

      const alertId = `${data.userId}_${data.timestamp}`
      const sosEntry = { id: alertId, userName: data.userName, userId: data.userId }

      // Own SOS — show cancel button but don't play sound
      if (data.userId === user.id) {
        const isRecent = Date.now() - data.timestamp < 2 * 60 * 1000
        if (isRecent) { activeSosRef.current = sosEntry; setActiveSos(sosEntry) }
        return
      }

      if (dismissedSosIdsRef.current.has(alertId)) return
      if (activeSosRef.current?.id === alertId) return

      activeSosRef.current = sosEntry
      setActiveSos(sosEntry)
      await ensureAudioUnlocked()
      stopEmergencySound()  // stop any previous before starting fresh
      soundPlayingRef.current = true
      playEmergencySound()
      vibrateEmergency()
    })
    return () => unsub()
  }, [group.id, user?.id])

  // Load real first names from Firestore users collection
  useEffect(() => {
    if (group.members.length === 0) return
    const load = async () => {
      const names: Record<string, string> = {}
      await Promise.all(group.members.map(async (uid) => {
        try {
          const snap = await getDocs(query(collection(db, 'users'), where('id', '==', uid)))
          names[uid] = snap.empty
            ? `Rider ${uid.slice(0, 4)}`
            : (snap.docs[0].data().name ?? `Rider ${uid.slice(0, 4)}`)
        } catch {
          names[uid] = `Rider ${uid.slice(0, 4)}`
        }
      }))
      setMemberNames(names)
    }
    load()
  }, [group.members.join(',')])

  function handleBack() {
    if (isSharingLocation) {
      setShowLeaveConfirm(true)
      return
    }
    setActiveGroupId(null)
    onBack()
  }

  function confirmLeave() {
    if (user?.id) clearLocation(user.id, group.id)
    setActiveGroupId(null)
    toggleLocationSharing()
    localStorage.setItem('locationSharing', 'false')
    setShowLeaveConfirm(false)
    onBack()
  }

  const handleEmergency = async () => {
    if (!user) {
      toast.error('Not signed in')
      return
    }
    if (emergencyLoading) return
    setEmergencyLoading(true)
    try {
      await triggerEmergencyAlert({
        userId: user.id,
        userName: user.name,
        groupId: group.id,
        groupName: group.name,
        location: currentLocation ?? null,
      })
      // Write to groupAlerts so other members' devices receive sound + toast (BUG 3)
      rtdbSet(rtdbRef(rtdb, `groupAlerts/${group.id}/sos`), {
        userId: user.id,
        userName: user.name,
        timestamp: Date.now(),
        active: true,
      }).catch(() => {})
      playEmergencyConfirmSound()
      toast.error('🚨 Emergency alert sent to all members!', { duration: 5000 })
    } catch {
      toast.error('Failed to send alert')
    } finally {
      setEmergencyLoading(false)
    }
  }

  const handleRemoveMember = async (memberId: string) => {
    if (!isAdmin || memberId === group.ownerId) return
    try {
      await removeMemberFromGroup(group.id, memberId)
      setGroup(g => ({ ...g, members: g.members.filter(m => m !== memberId) }))
      toast.success('Member removed')
    } catch {
      toast.error('Failed to remove member')
    }
  }

  const handleCloseGroup = async () => {
    if (!isAdmin) return
    try {
      await closeGroup(group.id)
      toast.success(t('close_group'))
      handleBack()
    } catch {
      toast.error(t('close_group_error'))
    }
  }

  const handlePromote = async (memberId: string) => {
    if (!isAdmin) return
    try {
      await promoteToAdmin(group.id, memberId)
      setGroup(g => ({ ...g, adminId: memberId }))
      toast.success('New admin promoted!')
    } catch {
      toast.error('Failed to promote member')
    }
  }

  async function handleCancelSos() {
    const sos = activeSosRef.current ?? activeSos
    const sosUserId = sos?.userId ?? rtdbEmergency?.userId
    const sosUserName = sos?.userName ?? rtdbEmergency?.userName ?? ''
    if (!user || !sosUserId) return

    const isSender = sosUserId === user.id

    if (isSender) {
      // Full cancel: write active:false to RTDB, remove pin, resolve Firestore history
      try {
        await rtdbSet(rtdbRef(rtdb, `groupAlerts/${group.id}/sos`), {
          userId: sosUserId, userName: sosUserName, timestamp: Date.now(), active: false,
        })
        rtdbRemove(rtdbRef(rtdb, `emergencies/${group.id}/${sosUserId}`)).catch(() => {})
        getDocs(query(
          collection(db, 'emergencies'),
          where('userId', '==', sosUserId),
          where('groupId', '==', group.id),
          where('status', '==', 'active')
        )).then(snap => {
          snap.docs.forEach(d => updateDoc(d.ref, {
            status: 'resolved',
            resolvedAt: serverTimestamp(),
            resolvedBy: user.id,
          }).catch(() => {}))
        }).catch(() => {})
      } catch {
        toast.error('Erro ao cancelar SOS')
        return
      }
    }
    // Both sender and non-sender: stop locally
    soundPlayingRef.current = false
    stopEmergencySound()
    setActiveSos(null)
    activeSosRef.current = null
    setRtdbEmergency(null)
  }

  const FIVE_MIN = 5 * 60 * 1000
  const membersOnMap = Object.entries(memberLocations)
    .filter(([uid, loc]) => uid !== user?.id && Date.now() - loc.lastUpdated < FIVE_MIN)
    .map(([uid, loc]) => ({
      userId: uid,
      name: memberNames[uid] ?? uid.slice(0, 6),
      lat: loc.lat,
      lng: loc.lng,
    }))

  const activeMembers = Object.values(memberLocations)
    .filter(loc => Date.now() - loc.lastUpdated < FIVE_MIN).length

  return (
    <>
      {/* Emergency screen overlay */}
      {rtdbEmergency && (
        <>
          <div className="emergency-overlay" />
          <div className="emergency-banner" style={{ paddingTop: 'calc(12px + env(safe-area-inset-top))' }}>
            <span style={{ flex: 1, minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
              🚨 EMERGENCY — {rtdbEmergency.userName} needs help!
            </span>
            <div style={{ display: 'flex', gap: '6px', flexShrink: 0 }}>
              <button
                onClick={() => { stopEmergencySound(); setShowChat(false); setRtdbEmergency(null) }}
                style={{ background: 'white', color: '#dc2626', border: 'none', borderRadius: '8px', padding: '5px 10px', fontWeight: 700, fontSize: '12px', cursor: 'pointer', whiteSpace: 'nowrap' }}
              >
                View Map
              </button>
              <button
                onClick={handleCancelSos}
                style={{ background: 'rgba(255,255,255,0.2)', color: 'white', border: '1px solid rgba(255,255,255,0.4)', borderRadius: '8px', padding: '5px 10px', fontWeight: 600, fontSize: '12px', cursor: 'pointer', whiteSpace: 'nowrap' }}
              >
                ✕ {t('dismiss_alert')}
              </button>
            </div>
          </div>
        </>
      )}

      {/* SOS alert banner — shows for receivers when overlay isn't active */}
      {activeSos && !rtdbEmergency && activeSos.userId !== user?.id && (
        <div style={{
          position: 'fixed',
          top: 0,
          left: 0,
          right: 0,
          zIndex: 99999,
          background: '#dc2626',
          padding: 'calc(env(safe-area-inset-top) + 10px) 16px 10px',
          display: 'flex',
          alignItems: 'center',
          gap: 10,
        }}>
          <span style={{ flex: 1, color: 'white', fontWeight: 700, fontSize: 14 }}>
            🚨 SOS de {activeSos.userName}!
          </span>
          <button
            onClick={handleCancelSos}
            style={{
              background: 'rgba(255,255,255,0.2)',
              border: '1px solid rgba(255,255,255,0.4)',
              color: 'white',
              borderRadius: 8,
              padding: '5px 12px',
              fontWeight: 600,
              fontSize: 12,
              cursor: 'pointer',
              whiteSpace: 'nowrap',
              flexShrink: 0,
            }}
          >
            ✕ {t('dismiss_alert')}
          </button>
        </div>
      )}

      <div className="flex flex-col h-full bg-shield-bg relative" style={{ minHeight: 0 }}>

        {/* ── CHAT VIEW ─────────────────────────────────────── */}
        {showChat ? (
          <GroupChat
            groupId={group.id}
            groupName={group.name}
            onClose={() => { seenCountRef.current = chatMessages.length; setShowChat(false) }}
            currentUserId={user?.id ?? ''}
            currentUserName={user?.name ?? ''}
          />
        ) : (

          /* ── NORMAL GROUP VIEW ────────────────────────────── */
          <>
            {/* Header — collapsible */}
            {headerCollapsed ? (
              /* MINIMISED — 40px single line */
              <div className="flex items-center gap-2 px-3 border-b border-shield-border bg-shield-bg flex-shrink-0"
                style={{ height: '40px' }}>
                <button onClick={handleBack} className="p-1 -ml-1 text-shield-muted flex-shrink-0">
                  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
                    <polyline points="15 18 9 12 15 6"/>
                  </svg>
                </button>
                <span className="font-bold text-white text-sm truncate" style={{ maxWidth: '110px' }}>
                  {isAdmin ? '👑 ' : ''}{group.name}
                </span>
                <span className="flex items-center gap-1 flex-1 min-w-0" style={{ color: 'var(--muted)' }}>
                  <span className="text-xs truncate">{activeMembers} online · {group.members.length} total</span>
                </span>
                <button onClick={() => setHeaderCollapsed(false)} className="p-1 flex-shrink-0 text-xs" style={{ color: 'var(--muted)' }}>▲</button>
              </div>
            ) : (
              /* EXPANDED */
              <div className="flex items-center gap-2 px-4 pt-8 pb-3 border-b border-shield-border bg-shield-bg">
                <button onClick={handleBack} className="p-2 -ml-2 text-shield-muted hover:text-white">
                  <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
                    <polyline points="15 18 9 12 15 6"/>
                  </svg>
                </button>
                <div className="flex-1 min-w-0">
                  <h1 className="text-base font-bold text-white truncate flex items-center gap-1.5">
                    {isAdmin && <span>👑</span>}
                    {group.name}
                  </h1>
                  <p className="text-xs text-shield-muted">
                    {activeMembers} {t('active_sharing')} · {group.members.length} {t('total_members')}
                  </p>
                </div>
                <div className="flex items-center gap-1.5">
                  {isAdmin && (
                    <button onClick={() => setShowAdminPanel(!showAdminPanel)}
                      className="p-1.5 text-yellow-400 hover:text-yellow-300">
                      👑
                    </button>
                  )}
                  <button onClick={() => setShowAlerts(!showAlerts)} className="relative p-1.5 text-shield-muted hover:text-white">
                    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                      <path d="M18 8A6 6 0 0 0 6 8c0 7-3 9-3 9h18s-3-2-3-9"/>
                      <path d="M13.73 21a2 2 0 0 1-3.46 0"/>
                    </svg>
                    {alerts.length > 0 && (
                      <span className="absolute top-0.5 right-0.5 w-2 h-2 bg-red-500 rounded-full animate-pulse" />
                    )}
                  </button>
                  <button
                    onClick={() => { navigator.clipboard?.writeText(group.inviteCode); toast.success('Invite code copied!') }}
                    className="text-xs font-mono bg-shield-card border border-shield-border px-1.5 py-0.5 rounded text-shield-orange">
                    {group.inviteCode}
                  </button>
                  <button onClick={() => { setShowAlerts(false); setShowAdminPanel(false); setHeaderCollapsed(true) }} className="p-1.5 text-xs" style={{ color: 'var(--muted)' }}>▼</button>
                </div>
              </div>
            )}

            {/* Admin panel */}
            {showAdminPanel && isAdmin && (
              <div className="bg-yellow-950/30 border-b border-yellow-800/30 px-4 py-3">
                <p className="text-xs font-bold text-yellow-400 mb-2">👑 {t('admin')} Panel</p>
                <div className="space-y-2">
                  {group.members.map((memberId) => (
                    <div key={memberId} className="flex items-center justify-between py-1">
                      <span className="text-xs text-shield-muted">
                        {memberId === group.ownerId ? '👑 ' : ''}
                        {memberNames[memberId] ?? `Rider ${memberId.slice(0, 4)}`}
                        {memberId === user?.id ? ' (you)' : ''}
                      </span>
                      {memberId !== user?.id && (
                        <div className="flex gap-2">
                          <button onClick={() => handlePromote(memberId)}
                            className="text-xs px-2 py-0.5 rounded border border-yellow-700/50 text-yellow-400">
                            {t('promote_admin')}
                          </button>
                          <button onClick={() => handleRemoveMember(memberId)}
                            className="text-xs px-2 py-0.5 rounded border border-red-700/50 text-red-400">
                            {t('remove_member')}
                          </button>
                        </div>
                      )}
                    </div>
                  ))}
                </div>
                <button onClick={() => setShowCloseGroupConfirm(true)}
                  className="mt-3 w-full py-2 rounded-xl text-xs font-semibold border border-red-700/50 text-red-400">
                  🗑 {t('close_group')}
                </button>
              </div>
            )}

            {/* Alerts panel */}
            {showAlerts && (
              <div className="bg-red-950/40 border-b border-red-800/30 px-4 py-3 max-h-40 overflow-y-auto">
                {alerts.length === 0 ? (
                  <p className="text-xs text-shield-muted">{t('no_alerts')}</p>
                ) : (
                  alerts.slice(0, 5).map((alert) => (
                    <div key={alert.id} className="flex items-center gap-3 py-1.5">
                      <span className="text-red-400 text-sm">🚨</span>
                      <div>
                        <p className="text-xs font-semibold text-red-300">
                          {alert.userName} sent an emergency alert
                        </p>
                        <p className="text-xs text-shield-muted">
                          {formatDistanceToNow(alert.timestamp, { addSuffix: true })}
                        </p>
                      </div>
                    </div>
                  ))
                )}
              </div>
            )}

            {/* Map — fills remaining space */}
            <div className="flex-1 relative">
              <MapView
                groupMembers={membersOnMap}
                currentUserId={user?.id}
                groupId={group.id}
                onPanelChange={setIsPanelOpen}
                followUserId={followUserId ?? undefined}
                onFollowChange={setFollowUserId}
              />
            </div>

            {/* Cancel/Dismiss SOS — visible to ALL members when SOS is active */}
            {(activeSos || rtdbEmergency) && (
              <button
                onClick={handleCancelSos}
                style={{
                  position: 'fixed',
                  bottom: '134px',
                  left: '50%',
                  transform: 'translateX(-50%)',
                  zIndex: 1000,
                  background: isMySos ? '#7f1d1d' : '#1a1035',
                  border: `1px solid ${isMySos ? '#ef4444' : '#6b7280'}`,
                  color: isMySos ? '#f87171' : '#9ca3af',
                  borderRadius: '20px',
                  padding: '6px 18px',
                  fontSize: 13,
                  fontWeight: 700,
                  cursor: 'pointer',
                  whiteSpace: 'nowrap',
                }}
              >
                ✕ {isMySos ? t('cancel_sos') : t('dismiss_alert')}
              </button>
            )}

            {/* Emergency button — centered pill, fixed */}
            <button
              onClick={handleEmergency}
              disabled={emergencyLoading}
              style={{
                position: 'fixed',
                bottom: '80px',
                left: '50%',
                transform: 'translateX(-50%)',
                zIndex: 1000,
                maxWidth: '200px',
                width: 'auto',
                height: '44px',
                background: '#dc2626',
                borderRadius: '25px',
                padding: '0 24px',
                fontSize: '14px',
                color: 'white',
                fontWeight: '700',
                border: 'none',
                cursor: emergencyLoading ? 'not-allowed' : 'pointer',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                gap: '6px',
                opacity: emergencyLoading ? 0.7 : isPanelOpen ? 0.3 : 1,
                transition: 'opacity 0.2s',
                pointerEvents: 'auto',
                whiteSpace: 'nowrap',
                boxShadow: '0 4px 16px rgba(220,38,38,0.5)',
              }}
            >
              <span>🚨</span>
              {emergencyLoading ? t('sending') : t('emergency')}
            </button>

            {/* Chat button — fixed, bottom-right */}
            <button
              onClick={() => { seenCountRef.current = chatMessages.length; setShowChat(true) }}
              style={{
                position: 'fixed',
                bottom: '80px',
                right: '16px',
                zIndex: 1000,
                width: '44px',
                height: '44px',
                borderRadius: '50%',
                background: 'linear-gradient(135deg, #4f8ef7 0%, #1a5fd4 100%)',
                boxShadow: '0 4px 15px rgba(45,111,232,0.45)',
                border: 'none',
                cursor: 'pointer',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                opacity: isPanelOpen ? 0.3 : 1,
                transition: 'opacity 0.2s',
                pointerEvents: 'auto',
              }}
            >
              <span style={{ fontSize: '20px' }}>💬</span>
              {unreadCount > 0 && (
                <span style={{
                  position: 'absolute',
                  top: '-4px',
                  right: '-4px',
                  minWidth: '16px',
                  height: '16px',
                  padding: '0 2px',
                  borderRadius: '9999px',
                  background: '#ef4444',
                  color: 'white',
                  fontSize: '9px',
                  fontWeight: '700',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                }}>
                  {unreadCount > 99 ? '99+' : unreadCount}
                </span>
              )}
            </button>
          </>
        )}
      </div>

      {/* Leave group confirmation modal — shown when back is pressed while sharing location */}
      {showLeaveConfirm && (
        <>
          <div
            onClick={() => setShowLeaveConfirm(false)}
            style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.7)', zIndex: 9998 }}
          />
          <div style={{
            position: 'fixed', top: '50%', left: '50%',
            transform: 'translate(-50%, -50%)',
            zIndex: 9999, background: 'var(--surface, #1a1033)',
            borderRadius: '16px', padding: '24px',
            width: 'min(320px, 90vw)',
            boxShadow: '0 20px 60px rgba(0,0,0,0.6)',
            border: '1px solid rgba(45,111,232,0.3)',
          }}>
            <h2 style={{ fontSize: '18px', fontWeight: '700', color: 'var(--text, white)', marginBottom: '12px' }}>A partilhar localização</h2>
            <p style={{ fontSize: '14px', color: 'var(--text-dim, #a0a0b0)', marginBottom: '24px', lineHeight: '1.5' }}>
              Estás a partilhar a tua localização com o grupo. Queres parar a partilha e sair?
            </p>
            <div style={{ display: 'flex', gap: '8px' }}>
              <button
                onClick={() => setShowLeaveConfirm(false)}
                style={{ flex: 1, padding: '10px', borderRadius: '10px', border: '1px solid var(--border, #2a2040)', background: 'transparent', color: 'var(--text, white)', fontSize: '14px', cursor: 'pointer' }}
              >
                Ficar
              </button>
              <button
                onClick={confirmLeave}
                style={{ flex: 1, padding: '10px', borderRadius: '10px', border: 'none', background: '#2d6fe8', color: 'white', fontSize: '14px', fontWeight: '700', cursor: 'pointer' }}
              >
                Sair
              </button>
            </div>
          </div>
        </>
      )}

      {/* Close group confirmation modal */}
      {showCloseGroupConfirm && (
        <>
          <div
            onClick={() => setShowCloseGroupConfirm(false)}
            style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.7)', zIndex: 9998 }}
          />
          <div style={{
            position: 'fixed',
            top: '50%',
            left: '50%',
            transform: 'translate(-50%, -50%)',
            zIndex: 9999,
            background: 'var(--surface, #1a1033)',
            borderRadius: '16px',
            padding: '24px',
            width: 'min(320px, 90vw)',
            boxShadow: '0 20px 60px rgba(0,0,0,0.6)',
            border: '1px solid rgba(220,38,38,0.3)',
          }}>
            <h2 style={{ fontSize: '18px', fontWeight: '700', color: 'var(--text, white)', marginBottom: '12px' }}>⚠️ {t('close_group_confirm_title')}</h2>
            <p style={{ fontSize: '14px', color: 'var(--text-dim, #a0a0b0)', marginBottom: '24px', lineHeight: '1.5' }}>
              {t('close_group_confirm_text')}
            </p>
            <div style={{ display: 'flex', gap: '8px' }}>
              <button
                onClick={() => setShowCloseGroupConfirm(false)}
                style={{ flex: 1, padding: '10px', borderRadius: '10px', border: '1px solid var(--border, #2a2040)', background: 'transparent', color: 'var(--text, white)', fontSize: '14px', cursor: 'pointer' }}
              >
                {t('close_group_cancel')}
              </button>
              <button
                onClick={() => { setShowCloseGroupConfirm(false); handleCloseGroup() }}
                style={{ flex: 1, padding: '10px', borderRadius: '10px', border: 'none', background: '#dc2626', color: 'white', fontSize: '14px', fontWeight: '700', cursor: 'pointer' }}
              >
                {t('close_group_confirm_button')}
              </button>
            </div>
          </div>
        </>
      )}
    </>
  )
}
