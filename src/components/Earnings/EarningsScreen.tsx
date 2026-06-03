// src/components/Earnings/EarningsScreen.tsx
'use client'
import { useState, useEffect } from 'react'
import { useLang } from '@/contexts/LangContext'
import { useShift } from '@/contexts/ShiftContext'
import toast from 'react-hot-toast'

interface PlatformEntry {
  name: string
  earnings: number
}

interface Session {
  id: string
  date: string
  hours: number
  platformEntries: PlatformEntry[]
  fuel: number
  notes?: string
}

const PLATFORMS = ['Deliveroo', 'Just Eat', 'Uber Eats', 'Other'] as const
const STORAGE_KEY = 'rs-earnings'
type Period = 'day' | 'week' | 'month' | 'custom'

const PLATFORM_COLORS: Record<string, string> = {
  'Deliveroo': '#00CCBC', 'Just Eat': '#FF8000', 'Uber Eats': '#06C167', 'Other': '#4f8ef7',
}

const INITIAL_EARNINGS: Record<string, string> = { Deliveroo: '', 'Just Eat': '', 'Uber Eats': '', Other: '' }

function loadSessions(): Session[] {
  if (typeof window === 'undefined') return []
  try {
    const raw: any[] = JSON.parse(localStorage.getItem(STORAGE_KEY) || '[]')
    return raw.map(s => ({
      id: s.id,
      date: s.date,
      hours: s.hours,
      fuel: s.fuel || 0,
      notes: s.notes,
      platformEntries: s.platformEntries ?? [{ name: s.platform || 'Other', earnings: s.earnings || 0 }],
    }))
  } catch { return [] }
}
function saveSessions(s: Session[]) { localStorage.setItem(STORAGE_KEY, JSON.stringify(s)) }

export default function EarningsScreen() {
  const [sessions, setSessions] = useState<Session[]>([])
  const [showAdd, setShowAdd] = useState(false)
  const [period, setPeriod] = useState<Period>('week')
  const [customFrom, setCustomFrom] = useState('')
  const [customTo, setCustomTo] = useState('')
  const [form, setForm] = useState({
    date: new Date().toISOString().split('T')[0],
    hours: '',
    selectedPlatforms: ['Deliveroo'] as string[],
    platformEarnings: { ...INITIAL_EARNINGS },
    fuel: '',
    notes: '',
  })
  const { t } = useLang()
  const { isActive, elapsedSeconds, startShift, endShift } = useShift()

  function formatTime(secs: number): string {
    const h = Math.floor(secs / 3600).toString().padStart(2, '0')
    const m = Math.floor((secs % 3600) / 60).toString().padStart(2, '0')
    const s = (secs % 60).toString().padStart(2, '0')
    return `${h}:${m}:${s}`
  }

  useEffect(() => { setSessions(loadSessions()) }, [])

  function togglePlatform(p: string) {
    setForm(f => ({
      ...f,
      selectedPlatforms: f.selectedPlatforms.includes(p)
        ? f.selectedPlatforms.filter(x => x !== p)
        : [...f.selectedPlatforms, p],
    }))
  }

  function handleAdd() {
    if (!form.hours || form.selectedPlatforms.length === 0) return toast.error('Fill in hours and select a platform')
    const platformEntries: PlatformEntry[] = form.selectedPlatforms.map(p => ({
      name: p,
      earnings: parseFloat(form.platformEarnings[p] || '0'),
    }))
    if (platformEntries.every(e => e.earnings === 0)) return toast.error('Add earnings for at least one platform')
    const session: Session = {
      id: Date.now().toString(),
      date: form.date,
      hours: parseFloat(form.hours),
      platformEntries,
      fuel: parseFloat(form.fuel || '0'),
      notes: form.notes,
    }
    const updated = [session, ...sessions]
    setSessions(updated); saveSessions(updated)
    setForm({ date: new Date().toISOString().split('T')[0], hours: '', selectedPlatforms: ['Deliveroo'], platformEarnings: { ...INITIAL_EARNINGS }, fuel: '', notes: '' })
    setShowAdd(false); toast.success('Session saved! 💰')
  }

  function handleDelete(id: string) {
    const updated = sessions.filter(s => s.id !== id)
    setSessions(updated); saveSessions(updated); toast.success('Deleted')
  }

  const todayStr = new Date().toISOString().split('T')[0]
  const now = new Date()
  const filtered = sessions.filter(s => {
    if (period === 'day') return s.date === todayStr
    const date = new Date(s.date + 'T00:00:00')
    if (period === 'week') return date >= new Date(now.getTime() - 7 * 24 * 3600000)
    if (period === 'month') return date >= new Date(now.getTime() - 30 * 24 * 3600000)
    if (period === 'custom' && customFrom && customTo) return s.date >= customFrom && s.date <= customTo
    return true
  })

  const totalEarnings = filtered.reduce((a, s) => a + s.platformEntries.reduce((b, pe) => b + pe.earnings, 0), 0)
  const totalCosts = filtered.reduce((a, s) => a + s.fuel, 0)
  const totalHours = filtered.reduce((a, s) => a + s.hours, 0)
  const netEarnings = totalEarnings - totalCosts
  const hourlyRate = totalHours > 0 ? netEarnings / totalHours : 0

  const byPlatform = PLATFORMS.map(p => {
    const entries = filtered.flatMap(s => s.platformEntries).filter(pe => pe.name === p)
    return {
      name: p,
      earnings: entries.reduce((a, pe) => a + pe.earnings, 0),
      sessions: filtered.filter(s => s.platformEntries.some(pe => pe.name === p)).length,
    }
  }).filter(p => p.sessions > 0)

  const PERIOD_LABELS: Record<Period, string> = {
    day: t('daily'), week: t('weekly'), month: t('monthly'), custom: t('custom'),
  }

  return (
    <div className="flex flex-col h-full" style={{ background: 'var(--bg)' }}>
      {/* Header */}
      <div className="px-5 pt-14 pb-4 border-b flex-shrink-0" style={{ background: 'var(--surface)', borderColor: 'var(--border)' }}>
        <div className="flex items-center justify-between mb-1">
          <h1 className="text-2xl font-bold" style={{ color: 'var(--text)' }}>{t('earnings_title')}</h1>
          <button onClick={() => setShowAdd(true)} className="text-white font-semibold px-4 py-2 rounded-xl text-sm" style={{ background: 'linear-gradient(135deg, #4f8ef7 0%, #1a5fd4 100%)' }}>
            {t('add_session')}
          </button>
        </div>
        <p className="text-sm mb-3" style={{ color: 'var(--muted)' }}>{t('track_income')}</p>
        <div className="flex gap-2 flex-wrap">
          {(['day', 'week', 'month', 'custom'] as Period[]).map(p => (
            <button key={p} onClick={() => setPeriod(p)}
              className="px-3 py-1.5 rounded-xl text-xs font-semibold transition-colors"
              style={{ background: period === p ? '#2d6fe8' : 'var(--card)', color: period === p ? 'white' : 'var(--muted)', border: `1px solid ${period === p ? '#2d6fe8' : 'var(--border)'}` }}>
              {PERIOD_LABELS[p]}
            </button>
          ))}
        </div>
        {period === 'custom' && (
          <div className="flex gap-2 mt-2 items-center">
            <input type="date" value={customFrom} onChange={e => setCustomFrom(e.target.value)}
              className="flex-1 rounded-xl px-3 py-2 text-xs focus:outline-none"
              style={{ background: 'var(--card)', border: '1px solid var(--border)', color: 'var(--text)' }} />
            <span className="text-xs" style={{ color: 'var(--muted)' }}>→</span>
            <input type="date" value={customTo} onChange={e => setCustomTo(e.target.value)}
              className="flex-1 rounded-xl px-3 py-2 text-xs focus:outline-none"
              style={{ background: 'var(--card)', border: '1px solid var(--border)', color: 'var(--text)' }} />
          </div>
        )}
      </div>

      {/* Scrollable content */}
      <div className="flex-1 overflow-y-auto px-5 py-4 space-y-4 pb-24">
        {/* Shift card */}
        <div className="rounded-2xl p-4" style={{ background: 'var(--surface)', border: `1px solid ${isActive ? 'rgba(16,185,129,0.3)' : 'var(--border)'}` }}>
          <p className="text-sm font-bold mb-3" style={{ color: 'var(--text)' }}>
            {isActive ? '🟢 Turno Activo' : '⏱ Turno'}
          </p>
          {isActive ? (
            <div className="flex items-center justify-between gap-3">
              <div>
                <p className="text-3xl font-bold font-mono" style={{ color: '#10b981' }}>{formatTime(elapsedSeconds)}</p>
                <p className="text-xs mt-0.5" style={{ color: 'var(--muted)' }}>em andamento</p>
              </div>
              <button onClick={() => endShift()} className="px-4 py-3 rounded-xl text-sm font-bold text-white" style={{ background: '#dc2626' }}>
                ⏹ {t('shift_end')}
              </button>
            </div>
          ) : (
            <button onClick={startShift} className="w-full py-3 rounded-xl text-sm font-bold text-white" style={{ background: 'linear-gradient(135deg, #10b981, #059669)' }}>
              ▶ {t('shift_start')}
            </button>
          )}
        </div>

        {/* Stats */}
        <div className="grid grid-cols-2 gap-3">
          {[
            { label: t('net_earnings'), value: `€${netEarnings.toFixed(2)}`, sub: t('after_costs'), color: '#22c55e' },
            { label: t('hourly_rate'), value: `€${hourlyRate.toFixed(2)}/h`, sub: t('net_per_hour'), color: '#4f8ef7' },
            { label: t('gross_earnings'), value: `€${totalEarnings.toFixed(2)}`, sub: `${totalHours.toFixed(1)}h ${t('worked')}`, color: 'var(--text)' },
            { label: t('total_costs'), value: `€${totalCosts.toFixed(2)}`, sub: t('fuel_expenses'), color: '#ef4444' },
          ].map(stat => (
            <div key={stat.label} className="rounded-2xl p-4" style={{ background: 'var(--surface)', border: '1px solid var(--border)' }}>
              <p className="text-xs font-semibold mb-1" style={{ color: 'var(--muted)' }}>{stat.label}</p>
              <p className="text-xl font-bold" style={{ color: stat.color }}>{stat.value}</p>
              <p className="text-xs mt-0.5" style={{ color: 'var(--text-dim)' }}>{stat.sub}</p>
            </div>
          ))}
        </div>

        {/* Platform breakdown */}
        {byPlatform.length > 0 && (
          <div className="rounded-2xl p-4" style={{ background: 'var(--surface)', border: '1px solid var(--border)' }}>
            <p className="text-sm font-bold mb-3" style={{ color: 'var(--text)' }}>{t('multi_platform')}</p>
            {byPlatform.map(p => (
              <div key={p.name} className="flex items-center gap-3 mb-2">
                <div className="w-3 h-3 rounded-full flex-shrink-0" style={{ background: PLATFORM_COLORS[p.name] }} />
                <div className="flex-1">
                  <div className="flex justify-between">
                    <span className="text-sm font-semibold" style={{ color: 'var(--text)' }}>{p.name}</span>
                    <span className="text-sm font-bold" style={{ color: '#22c55e' }}>€{p.earnings.toFixed(2)}</span>
                  </div>
                  <div className="h-1.5 rounded-full mt-1 overflow-hidden" style={{ background: 'var(--border)' }}>
                    <div className="h-full rounded-full" style={{ background: PLATFORM_COLORS[p.name], width: `${totalEarnings > 0 ? (p.earnings / totalEarnings) * 100 : 0}%` }} />
                  </div>
                </div>
                <span className="text-xs" style={{ color: 'var(--muted)' }}>{p.sessions}x</span>
              </div>
            ))}
          </div>
        )}

        {/* Sessions list */}
        <div>
          <p className="text-sm font-bold mb-3" style={{ color: 'var(--text)' }}>{t('sessions')} ({filtered.length})</p>
          {filtered.length === 0 ? (
            <div className="text-center py-10 rounded-2xl" style={{ background: 'var(--surface)', border: '1px solid var(--border)' }}>
              <p className="text-3xl mb-2">💰</p>
              <p className="font-semibold" style={{ color: 'var(--text)' }}>No sessions yet</p>
              <p className="text-sm mt-1" style={{ color: 'var(--muted)' }}>Tap "{t('add_session')}" to start tracking</p>
            </div>
          ) : (
            <div className="space-y-2">
              {filtered.map(s => {
                const sTotal = s.platformEntries.reduce((a, pe) => a + pe.earnings, 0)
                return (
                  <div key={s.id} className="rounded-2xl p-4" style={{ background: 'var(--surface)', border: '1px solid var(--border)' }}>
                    <div className="flex items-start justify-between">
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-2 mb-2 flex-wrap">
                          {s.platformEntries.map(pe => (
                            <span key={pe.name} className="text-xs px-2 py-0.5 rounded-full font-semibold"
                              style={{ background: PLATFORM_COLORS[pe.name] + '22', color: PLATFORM_COLORS[pe.name] }}>
                              {pe.name}: €{pe.earnings.toFixed(2)}
                            </span>
                          ))}
                          <span className="text-xs" style={{ color: 'var(--muted)' }}>{s.date}</span>
                        </div>
                        <div className="flex gap-3 flex-wrap">
                          <div>
                            <p className="text-base font-bold" style={{ color: '#22c55e' }}>€{sTotal.toFixed(2)}</p>
                            <p className="text-xs" style={{ color: 'var(--muted)' }}>{t('earned')}</p>
                          </div>
                          {s.fuel > 0 && (
                            <div>
                              <p className="text-base font-bold" style={{ color: '#ef4444' }}>-€{s.fuel.toFixed(2)}</p>
                              <p className="text-xs" style={{ color: 'var(--muted)' }}>{t('fuel')}</p>
                            </div>
                          )}
                          <div>
                            <p className="text-base font-bold" style={{ color: 'var(--text)' }}>{s.hours}h</p>
                            <p className="text-xs" style={{ color: 'var(--muted)' }}>{t('worked')}</p>
                          </div>
                          <div>
                            <p className="text-base font-bold" style={{ color: '#4f8ef7' }}>€{((sTotal - s.fuel) / s.hours).toFixed(2)}/h</p>
                            <p className="text-xs" style={{ color: 'var(--muted)' }}>{t('rate')}</p>
                          </div>
                        </div>
                        {s.notes && <p className="text-xs mt-1" style={{ color: 'var(--text-dim)' }}>{s.notes}</p>}
                      </div>
                      <button onClick={() => handleDelete(s.id)} className="p-1 text-lg flex-shrink-0" style={{ color: 'var(--muted)' }}>🗑</button>
                    </div>
                  </div>
                )
              })}
            </div>
          )}
        </div>

        {/* Anti-theft tips */}
        <div className="rounded-2xl p-4" style={{ background: '#1a0a2e', border: '1px solid #4c1d95' }}>
          <p className="text-sm font-bold mb-2" style={{ color: '#c4b5fd' }}>🔒 {t('anti_theft_tips')}</p>
          {[t('anti_theft_tip1'), t('anti_theft_tip2'), t('anti_theft_tip3'), t('anti_theft_tip4'), t('anti_theft_tip5')].map((tip, i) => (
            <div key={i} className="flex gap-2 mb-1.5">
              <span className="text-xs" style={{ color: '#4f8ef7' }}>•</span>
              <p className="text-xs" style={{ color: '#c4b5fd' }}>{tip}</p>
            </div>
          ))}
        </div>
      </div>

      {/* ADD SESSION — full screen modal */}
      {showAdd && (
        <div className="fixed inset-0 z-[500] flex flex-col" style={{ background: 'var(--surface)' }}>
          <div className="flex items-center justify-between px-5 pt-14 pb-4 border-b flex-shrink-0" style={{ borderColor: 'var(--border)' }}>
            <h2 className="text-xl font-bold" style={{ color: 'var(--text)' }}>{t('add_work_session')}</h2>
            <button onClick={() => setShowAdd(false)} className="w-9 h-9 rounded-full flex items-center justify-center text-lg" style={{ background: 'var(--card)', color: 'var(--muted)' }}>✕</button>
          </div>

          <div className="flex-1 overflow-y-auto px-5 py-4 space-y-4">
            <div>
              <label className="text-xs font-semibold uppercase tracking-wide block mb-1.5" style={{ color: 'var(--muted)' }}>{t('date')}</label>
              <input type="date" value={form.date} onChange={e => setForm({ ...form, date: e.target.value })}
                className="w-full rounded-xl px-4 py-3 text-sm focus:outline-none"
                style={{ background: 'var(--card)', border: '1px solid var(--border)', color: 'var(--text)' }} />
            </div>

            <div>
              <label className="text-xs font-semibold uppercase tracking-wide block mb-1.5" style={{ color: 'var(--muted)' }}>{t('platform')}</label>
              <div className="grid grid-cols-2 gap-2">
                {PLATFORMS.map(p => (
                  <button key={p} onClick={() => togglePlatform(p)}
                    className="py-3 rounded-xl text-sm font-semibold transition-colors"
                    style={{ background: form.selectedPlatforms.includes(p) ? '#2d6fe8' : 'var(--card)', color: form.selectedPlatforms.includes(p) ? 'white' : 'var(--muted)', border: `1px solid ${form.selectedPlatforms.includes(p) ? '#2d6fe8' : 'var(--border)'}` }}>
                    {p === 'Other' ? t('other') : p}
                  </button>
                ))}
              </div>
            </div>

            {form.selectedPlatforms.length > 0 && (
              <div>
                <label className="text-xs font-semibold uppercase tracking-wide block mb-2" style={{ color: 'var(--muted)' }}>Earnings (€) *</label>
                {form.selectedPlatforms.map(p => (
                  <div key={p} className="flex items-center gap-3 mb-2">
                    <div className="w-2.5 h-2.5 rounded-full flex-shrink-0" style={{ background: PLATFORM_COLORS[p] }} />
                    <span className="text-xs font-semibold flex-shrink-0" style={{ color: 'var(--text)', minWidth: '72px' }}>{p === 'Other' ? t('other') : p}</span>
                    <input type="number"
                      value={form.platformEarnings[p] || ''}
                      onChange={e => setForm(f => ({ ...f, platformEarnings: { ...f.platformEarnings, [p]: e.target.value } }))}
                      placeholder="€0.00" step="0.01" min="0"
                      className="flex-1 rounded-xl px-3 py-2 text-sm focus:outline-none"
                      style={{ background: 'var(--card)', border: '1px solid var(--border)', color: 'var(--text)' }} />
                  </div>
                ))}
              </div>
            )}

            <div>
              <label className="text-xs font-semibold uppercase tracking-wide block mb-1.5" style={{ color: 'var(--muted)' }}>{t('hours')} *</label>
              <input type="number" value={form.hours} onChange={e => setForm({ ...form, hours: e.target.value })} placeholder="e.g. 4.5" step="0.5" min="0"
                className="w-full rounded-xl px-4 py-3 text-sm focus:outline-none"
                style={{ background: 'var(--card)', border: '1px solid var(--border)', color: 'var(--text)' }} />
            </div>

            <div>
              <label className="text-xs font-semibold uppercase tracking-wide block mb-1.5" style={{ color: 'var(--muted)' }}>{t('fuel_costs')}</label>
              <input type="number" value={form.fuel} onChange={e => setForm({ ...form, fuel: e.target.value })} placeholder="e.g. 8.00" step="0.01" min="0"
                className="w-full rounded-xl px-4 py-3 text-sm focus:outline-none"
                style={{ background: 'var(--card)', border: '1px solid var(--border)', color: 'var(--text)' }} />
            </div>

            <div>
              <label className="text-xs font-semibold uppercase tracking-wide block mb-1.5" style={{ color: 'var(--muted)' }}>{t('notes')}</label>
              <input type="text" value={form.notes} onChange={e => setForm({ ...form, notes: e.target.value })} placeholder="e.g. Busy Friday night"
                className="w-full rounded-xl px-4 py-3 text-sm focus:outline-none"
                style={{ background: 'var(--card)', border: '1px solid var(--border)', color: 'var(--text)' }} />
            </div>

            <div className="pt-2">
              <button onClick={handleAdd} className="w-full text-white font-bold py-4 rounded-xl text-base" style={{ background: 'linear-gradient(135deg, #4f8ef7 0%, #1a5fd4 100%)' }}>
                💾 {t('save_session')}
              </button>
            </div>
            <div style={{ height: '100px' }} />
          </div>
        </div>
      )}
    </div>
  )
}
