// src/contexts/ShiftContext.tsx
'use client'
import { createContext, useContext, useState, useEffect, useRef, useCallback, ReactNode } from 'react'

export interface ShiftSummary {
  durationSeconds: number
  earnings: number
  hourlyRate: number
}

interface ShiftContextType {
  isActive: boolean
  elapsedSeconds: number
  earnings: number
  hourlyRate: number
  dailyGoal: number
  startShift: () => void
  endShift: () => ShiftSummary | null
  addEarnings: (amount: number) => void
}

const ShiftContext = createContext<ShiftContextType | null>(null)

export function ShiftProvider({ children }: { children: ReactNode }) {
  const [isActive, setIsActive] = useState(false)
  const [startTs, setStartTs] = useState<number | null>(null)
  const [elapsedSeconds, setElapsedSeconds] = useState(0)
  const [earnings, setEarnings] = useState(0)
  const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null)
  const dailyGoal = 80

  // Restore shift from localStorage on mount
  useEffect(() => {
    const active = localStorage.getItem('turnoActivo') === 'true'
    const inicio = localStorage.getItem('turnoInicio')
    if (active && inicio) {
      const ts = parseInt(inicio, 10)
      if (!isNaN(ts) && Date.now() - ts < 24 * 60 * 60 * 1000) {
        setIsActive(true)
        setStartTs(ts)
        setElapsedSeconds(Math.floor((Date.now() - ts) / 1000))
      } else {
        localStorage.removeItem('turnoActivo')
        localStorage.removeItem('turnoInicio')
      }
    }
  }, [])

  useEffect(() => {
    if (isActive && startTs !== null) {
      intervalRef.current = setInterval(() => {
        setElapsedSeconds(Math.floor((Date.now() - startTs) / 1000))
      }, 1000)
    } else {
      if (intervalRef.current) { clearInterval(intervalRef.current); intervalRef.current = null }
    }
    return () => { if (intervalRef.current) clearInterval(intervalRef.current) }
  }, [isActive, startTs])

  const hourlyRate = elapsedSeconds > 0 ? earnings / (elapsedSeconds / 3600) : 0

  const startShift = useCallback(() => {
    const now = Date.now()
    setIsActive(true)
    setStartTs(now)
    setElapsedSeconds(0)
    setEarnings(0)
    localStorage.setItem('turnoActivo', 'true')
    localStorage.setItem('turnoInicio', String(now))
  }, [])

  const endShift = useCallback((): ShiftSummary | null => {
    if (!isActive) return null
    const summary: ShiftSummary = { durationSeconds: elapsedSeconds, earnings, hourlyRate }
    setIsActive(false)
    setStartTs(null)
    localStorage.removeItem('turnoActivo')
    localStorage.removeItem('turnoInicio')
    return summary
  }, [isActive, elapsedSeconds, earnings, hourlyRate])

  const addEarnings = useCallback((amount: number) => {
    setEarnings(e => e + amount)
  }, [])

  return (
    <ShiftContext.Provider value={{ isActive, elapsedSeconds, earnings, hourlyRate, dailyGoal, startShift, endShift, addEarnings }}>
      {children}
    </ShiftContext.Provider>
  )
}

export function useShift() {
  const ctx = useContext(ShiftContext)
  if (!ctx) throw new Error('useShift must be used within ShiftProvider')
  return ctx
}
