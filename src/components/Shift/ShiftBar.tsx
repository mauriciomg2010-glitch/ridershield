// src/components/Shift/ShiftBar.tsx
'use client'
import { useState } from 'react'
import { useShift } from '@/contexts/ShiftContext'
import toast from 'react-hot-toast'

function fmt(s: number) {
  const h = Math.floor(s / 3600).toString().padStart(2, '0')
  const m = Math.floor((s % 3600) / 60).toString().padStart(2, '0')
  const sec = (s % 60).toString().padStart(2, '0')
  return `${h}:${m}:${sec}`
}

export default function ShiftBar() {
  const { isActive, elapsedSeconds, earnings, hourlyRate, dailyGoal, endShift, addEarnings } = useShift()
  const [addAmount, setAddAmount] = useState('')
  const [showAdd, setShowAdd] = useState(false)

  function handleEnd() {
    const s = endShift()
    if (s) {
      toast.success(
        `✅ Turno: ${fmt(s.durationSeconds)} · €${s.earnings.toFixed(2)} · €${s.hourlyRate.toFixed(2)}/h`,
        { duration: 7000 }
      )
    }
    setShowAdd(false)
  }

  function handleAddEarnings() {
    const n = parseFloat(addAmount.replace(',', '.'))
    if (!isNaN(n) && n > 0) {
      addEarnings(n)
      setAddAmount('')
      setShowAdd(false)
      toast.success(`+€${n.toFixed(2)} adicionado`, { duration: 2000 })
    }
  }

  if (!isActive) return null

  const progress = Math.min(earnings / dailyGoal, 1)

  return (
    <div style={{ flexShrink: 0, background: 'linear-gradient(135deg, #0f172a 0%, #111827 100%)', borderBottom: '1px solid rgba(45,111,232,0.25)' }}>

      {/* Main bar */}
      <div style={{ display: 'flex', alignItems: 'center', gap: '10px', padding: '7px 12px' }}>

        {/* Timer */}
        <div style={{ flexShrink: 0, minWidth: 80 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 4, marginBottom: 1 }}>
            <span style={{
              width: 6, height: 6, borderRadius: '50%', background: '#10b981',
              display: 'inline-block', boxShadow: '0 0 6px rgba(16,185,129,0.8)',
            }} />
            <span style={{ fontSize: 9, color: '#10b981', fontWeight: 700, letterSpacing: '0.1em', textTransform: 'uppercase' }}>Turno</span>
          </div>
          <p style={{ fontFamily: 'monospace', fontSize: 13, fontWeight: 700, color: 'white', lineHeight: 1 }}>{fmt(elapsedSeconds)}</p>
        </div>

        {/* Progress bar + labels */}
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 4 }}>
            <span style={{ fontSize: 11, color: '#93c5fd', fontWeight: 600 }}>€{earnings.toFixed(2)}</span>
            <span style={{ fontSize: 11, color: 'var(--muted)' }}>meta €{dailyGoal}</span>
          </div>
          <div style={{ height: 4, background: 'rgba(255,255,255,0.08)', borderRadius: 3, overflow: 'hidden' }}>
            <div style={{
              height: '100%',
              width: `${progress * 100}%`,
              background: progress >= 1
                ? '#10b981'
                : 'linear-gradient(90deg, #2d6fe8, #4f8ef7)',
              borderRadius: 3,
              transition: 'width 0.6s ease',
            }} />
          </div>
        </div>

        {/* €/h — tap to add earnings */}
        <button
          onClick={() => setShowAdd(v => !v)}
          style={{
            flexShrink: 0,
            background: showAdd ? 'rgba(16,185,129,0.15)' : 'rgba(45,111,232,0.1)',
            border: `1px solid ${showAdd ? 'rgba(16,185,129,0.35)' : 'rgba(45,111,232,0.2)'}`,
            borderRadius: 8,
            padding: '4px 9px',
            cursor: 'pointer',
          }}
        >
          <p style={{ fontSize: 11, fontWeight: 700, color: showAdd ? '#10b981' : '#93c5fd', lineHeight: 1, whiteSpace: 'nowrap' }}>
            {hourlyRate > 0 ? `€${hourlyRate.toFixed(2)}/h` : '+€'}
          </p>
        </button>

        {/* End shift */}
        <button
          onClick={handleEnd}
          style={{
            flexShrink: 0,
            background: 'rgba(239,68,68,0.08)',
            border: '1px solid rgba(239,68,68,0.25)',
            color: '#f87171',
            borderRadius: 8,
            padding: '5px 9px',
            fontSize: 12,
            cursor: 'pointer',
          }}
          title="Terminar turno"
        >
          ⏹
        </button>
      </div>

      {/* Quick add earnings */}
      {showAdd && (
        <div style={{ padding: '0 12px 9px', display: 'flex', gap: 8 }}>
          <input
            type="number"
            inputMode="decimal"
            value={addAmount}
            onChange={e => setAddAmount(e.target.value)}
            onKeyDown={e => e.key === 'Enter' && handleAddEarnings()}
            placeholder="€ ganho agora"
            autoFocus
            style={{
              flex: 1,
              background: 'rgba(255,255,255,0.05)',
              border: '1px solid rgba(255,255,255,0.12)',
              borderRadius: 9,
              padding: '8px 12px',
              color: 'white',
              fontSize: 13,
              outline: 'none',
            }}
          />
          <button
            onClick={handleAddEarnings}
            disabled={!addAmount.trim()}
            style={{
              background: 'rgba(16,185,129,0.15)',
              border: '1px solid rgba(16,185,129,0.3)',
              color: '#10b981',
              borderRadius: 9,
              padding: '8px 16px',
              fontSize: 14,
              fontWeight: 700,
              cursor: 'pointer',
            }}
          >
            +
          </button>
        </div>
      )}
    </div>
  )
}
