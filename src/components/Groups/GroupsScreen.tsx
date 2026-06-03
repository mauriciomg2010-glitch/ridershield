// src/components/Groups/GroupsScreen.tsx
'use client'
import { useState, useEffect } from 'react'
import { useStore } from '@/lib/store'
import { useLang } from '@/contexts/LangContext'
import { createGroup, joinGroupByCode, subscribeToUserGroups } from '@/lib/firestore'
import { Group } from '@/types'
import toast from 'react-hot-toast'
import GroupDetail from './GroupDetail'
import ReportModal from '@/components/Report/ReportModal'

function FullModal({ onClose, title, children }: { onClose:()=>void; title:string; children:React.ReactNode }) {
  return (
    <div className="fixed inset-0 z-[500]" style={{background:'var(--surface)'}}>
      <div className="flex items-center justify-between px-5 pt-14 pb-4 border-b" style={{borderColor:'var(--border)'}}>
        <h2 className="text-xl font-bold" style={{color:'var(--text)'}}>{title}</h2>
        <button onClick={onClose} className="w-9 h-9 rounded-full flex items-center justify-center text-lg" style={{background:'var(--card)',color:'var(--muted)'}}>✕</button>
      </div>
      <div className="overflow-y-auto px-5 py-4" style={{height:'calc(100vh - 120px)'}}>
        {children}
        <div style={{height:'40px'}} />
      </div>
    </div>
  )
}

export default function GroupsScreen() {
  const user = useStore((s) => s.user)
  const groups = useStore((s) => s.groups)
  const setGroups = useStore((s) => s.setGroups)
  const currentLocation = useStore((s) => s.currentLocation)
  const { t } = useLang()
  const [activeGroup, setActiveGroup] = useState<Group|null>(null)
  const [showCreate, setShowCreate] = useState(false)
  const [showJoin, setShowJoin] = useState(false)
  const [groupName, setGroupName] = useState('')
  const [inviteCode, setInviteCode] = useState('')
  const [loading, setLoading] = useState(false)
  const [showReport, setShowReport] = useState(false)
  const [reportLocation, setReportLocation] = useState<{ lat: number; lng: number; timestamp: number } | null>(null)

  useEffect(() => {
    if (!user) return
    const unsub = subscribeToUserGroups(user.id, setGroups)
    return unsub
  }, [user, setGroups])

  async function handleCreate() {
    if (!user) return
    if (!user.isPremium && !user.isAdmin) return toast.error(t('premium_required_groups'))
    if (!groupName.trim()) return toast.error(t('group_name'))
    setLoading(true)
    try {
      const group = await createGroup(user.id, groupName.trim())
      setGroupName(''); setShowCreate(false)
      toast.success(`"${group.name}" created!`)
      setActiveGroup(group)
    } catch { toast.error('Failed to create group') }
    finally { setLoading(false) }
  }

  async function handleJoin() {
    if (!user) return
    if (!inviteCode.trim()) return toast.error(t('invite_code_label'))
    setLoading(true)
    try {
      const group = await joinGroupByCode(user.id, inviteCode.trim())
      if (!group) return toast.error('Invalid invite code')
      setInviteCode(''); setShowJoin(false)
      toast.success(`Joined "${group.name}"!`)
      setActiveGroup(group)
    } catch { toast.error('Failed to join group') }
    finally { setLoading(false) }
  }

  if (activeGroup) {
    return <GroupDetail group={activeGroup} onBack={()=>setActiveGroup(null)} />
  }

  const isAdmin = (group: Group) => group.adminId === user?.id || group.ownerId === user?.id

  return (
    <div className="flex flex-col h-full pb-20" style={{background:'var(--bg)'}}>
      <div className="px-6 pt-14 pb-4 border-b flex items-center justify-between" style={{background:'var(--surface)',borderColor:'var(--border)'}}>
        <div>
          <h1 className="text-2xl font-bold" style={{color:'var(--text)'}}>{t('groups')}</h1>
          <p className="text-sm mt-0.5" style={{color:'var(--muted)'}}>{t('ride_together')}</p>
        </div>
        <button
          onClick={() => {
            setReportLocation(currentLocation ? { ...currentLocation, timestamp: Date.now() } : null)
            setShowReport(true)
          }}
          style={{
            width: 40, height: 40, borderRadius: '50%',
            background: 'rgba(239,68,68,0.12)', border: '1px solid rgba(239,68,68,0.35)',
            display: 'flex', alignItems: 'center', justifyContent: 'center',
            cursor: 'pointer', fontSize: 18, flexShrink: 0,
          }}
          title="Reportar incidente"
        >
          ⚠️
        </button>
      </div>
      {showReport && <ReportModal onClose={() => setShowReport(false)} initialLocation={reportLocation} />}

      <div className="flex gap-3 px-6 py-4">
        <button onClick={()=>setShowCreate(true)}
          className="flex-1 flex items-center justify-center gap-2 text-white font-semibold py-3 rounded-xl text-sm"
          style={{background:'linear-gradient(135deg, #4f8ef7 0%, #1a5fd4 100%)'}}>
          + {t('create_group')}
        </button>
        <button onClick={()=>setShowJoin(true)}
          className="flex-1 flex items-center justify-center gap-2 font-semibold py-3 rounded-xl text-sm"
          style={{background:'var(--card)',border:'1px solid var(--border)',color:'var(--text)'}}>
          → {t('join_group')}
        </button>
      </div>

      <div className="flex-1 overflow-y-auto px-6 pb-4">
        {groups.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-16 text-center">
            <div className="w-16 h-16 rounded-2xl flex items-center justify-center mb-4" style={{background:'var(--card)',border:'1px solid var(--border)'}}>
              <svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="#6b7280" strokeWidth="1.5">
                <path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2"/>
                <circle cx="9" cy="7" r="4"/>
                <path d="M23 21v-2a4 4 0 0 0-3-3.87"/>
                <path d="M16 3.13a4 4 0 0 1 0 7.75"/>
              </svg>
            </div>
            <p className="font-semibold" style={{color:'var(--text)'}}>{t('no_groups')}</p>
            <p className="text-sm mt-1" style={{color:'var(--muted)'}}>{t('no_groups_desc')}</p>
          </div>
        ) : (
          <div className="space-y-3">
            {groups.map((group) => (
              <button key={group.id} onClick={()=>setActiveGroup(group)}
                className="w-full rounded-2xl p-4 text-left"
                style={{background:'var(--card)',border:'1px solid var(--border)'}}>
                <div className="flex items-start justify-between">
                  <div>
                    <h3 className="font-bold flex items-center gap-1.5" style={{color:'var(--text)'}}>
                      {isAdmin(group) && <span title={t('admin')}>👑</span>}
                      {group.name}
                    </h3>
                    <p className="text-xs mt-0.5" style={{color:'var(--muted)'}}>
                      {group.members.length} {group.members.length !== 1 ? t('members') : t('member')}
                      {isAdmin(group) && <span style={{color:'#4f8ef7'}}> · {t('admin')}</span>}
                    </p>
                  </div>
                  <span className="text-xs font-mono px-2 py-0.5 rounded" style={{background:'var(--surface)',border:'1px solid var(--border)',color:'var(--text-dim)'}}>
                    {group.inviteCode}
                  </span>
                </div>
              </button>
            ))}
          </div>
        )}
      </div>

      {/* Create Modal */}
      {showCreate && (
        <FullModal onClose={()=>setShowCreate(false)} title={t('create_group')}>
          {!user?.isPremium && !user?.isAdmin && (
            <div className="flex items-center gap-2 rounded-xl p-3 mb-4" style={{background:'rgba(234,179,8,0.1)',border:'1px solid rgba(234,179,8,0.2)'}}>
              <span>⭐</span>
              <p className="text-xs" style={{color:'#ca8a04'}}>{t('premium_required_groups')}</p>
            </div>
          )}
          <div className="mb-4">
            <label className="text-xs font-semibold uppercase tracking-wide block mb-1.5" style={{color:'var(--muted)'}}>{t('group_name')}</label>
            <input value={groupName} onChange={(e)=>setGroupName(e.target.value)}
              placeholder="e.g. Dublin South Riders"
              className="w-full rounded-xl px-4 py-3 text-sm focus:outline-none"
              style={{background:'var(--card)',border:'1px solid var(--border)',color:'var(--text)'}} />
          </div>
          <div className="flex gap-2">
            <button onClick={()=>setShowCreate(false)}
              className="flex-1 py-4 rounded-xl text-sm font-semibold"
              style={{border:'1px solid var(--border)',color:'var(--muted)'}}>{t('cancel')}</button>
            <button onClick={handleCreate} disabled={loading||(!user?.isPremium && !user?.isAdmin)}
              className="flex-1 py-4 rounded-xl text-sm font-semibold text-white disabled:opacity-50"
              style={{background:'linear-gradient(135deg, #4f8ef7 0%, #1a5fd4 100%)'}}>
              {loading ? t('creating') : t('create_group')}
            </button>
          </div>
        </FullModal>
      )}

      {/* Join Modal */}
      {showJoin && (
        <FullModal onClose={()=>setShowJoin(false)} title={t('join_with_code')}>
          <div className="mb-4">
            <label className="text-xs font-semibold uppercase tracking-wide block mb-1.5" style={{color:'var(--muted)'}}>{t('invite_code_label')}</label>
            <input value={inviteCode} onChange={(e)=>setInviteCode(e.target.value.toUpperCase())}
              placeholder="XXXXXXXX" maxLength={8}
              className="w-full rounded-xl px-4 py-3 text-sm focus:outline-none font-mono tracking-widest text-center uppercase"
              style={{background:'var(--card)',border:'1px solid var(--border)',color:'var(--text)'}} />
          </div>
          <div className="flex gap-2">
            <button onClick={()=>setShowJoin(false)}
              className="flex-1 py-4 rounded-xl text-sm font-semibold"
              style={{border:'1px solid var(--border)',color:'var(--muted)'}}>{t('cancel')}</button>
            <button onClick={handleJoin} disabled={loading}
              className="flex-1 py-4 rounded-xl text-sm font-semibold text-white disabled:opacity-50"
              style={{background:'linear-gradient(135deg, #4f8ef7 0%, #1a5fd4 100%)'}}>
              {loading ? t('joining') : t('join_group')}
            </button>
          </div>
        </FullModal>
      )}
    </div>
  )
}
