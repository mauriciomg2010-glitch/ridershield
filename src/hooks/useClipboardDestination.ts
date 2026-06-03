// src/hooks/useClipboardDestination.ts
'use client'
import { useState, useEffect, useRef, useCallback } from 'react'

const STREET_PATTERNS = /\b(road|street|avenue|lane|drive|close|park|way|place|court|terrace|gardens|square|crescent|grove|walk|quay|row|rd|sq|blvd)\b/i

export function isDublinAddress(text: string): boolean {
  const t = text.trim()
  if (!t || t.length < 5 || t.length > 300) return false
  if (t.includes('\n') && t.split('\n').length > 6) return false

  const hasDublin = /\bdublin\b/i.test(t)
  const hasStreet = STREET_PATTERNS.test(t)
  const hasNumber = /\d/.test(t)

  // Dublin mention + street type or number → definite address
  if (hasDublin && (hasStreet || hasNumber)) return true
  // Street type + number, long enough → address without explicit "Dublin" (e.g. pasted from delivery app)
  if (hasStreet && hasNumber && t.length > 10) return true

  return false
}

function detectIOS(): boolean {
  if (typeof navigator === 'undefined') return false
  // iPad Pro reports as MacIntel but has touch points
  return /iPad|iPhone|iPod/.test(navigator.userAgent) ||
    (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1)
}

export function useClipboardDestination() {
  const [address, setAddress] = useState<string | null>(null)
  // iOS-only: show a tap-to-check prompt since readText() needs a user gesture
  const [needsTap, setNeedsTap] = useState(false)
  const lastClipRef = useRef<string>('')
  const dismissedRef = useRef<string>('')
  const isIOSRef = useRef(false)

  const processText = useCallback((text: string) => {
    if (!text || text === lastClipRef.current) return
    lastClipRef.current = text
    if (text === dismissedRef.current) return
    if (isDublinAddress(text)) {
      setAddress(text.trim())
    } else {
      setAddress(prev => (prev && prev !== text ? null : prev))
    }
  }, [])

  // Called from a button click — safe for iOS because it's a real user gesture
  const checkNow = useCallback(async () => {
    setNeedsTap(false)
    if (!navigator.clipboard?.readText) return
    try {
      const text = await navigator.clipboard.readText()
      processText(text)
    } catch {
      // Still denied (e.g. user blocked clipboard) — silently ignore
    }
  }, [processText])

  const dismissTap = useCallback(() => setNeedsTap(false), [])

  function dismiss() {
    dismissedRef.current = lastClipRef.current
    setAddress(null)
    setNeedsTap(false)
  }

  useEffect(() => {
    if (typeof navigator === 'undefined' || !navigator.clipboard?.readText) return

    isIOSRef.current = detectIOS()

    const checkAuto = async () => {
      if (document.hidden) return
      try {
        const text = await navigator.clipboard.readText()
        processText(text)
      } catch {
        // On iOS: readText() throws without user gesture — show tap prompt instead
        if (isIOSRef.current) setNeedsTap(true)
      }
    }

    const handleVisibility = () => {
      if (document.hidden) return
      if (isIOSRef.current) {
        // Don't attempt readText here — it will fail on iOS without user gesture
        setNeedsTap(true)
      } else {
        checkAuto()
      }
    }

    document.addEventListener('visibilitychange', handleVisibility)

    if (!isIOSRef.current) {
      checkAuto()
      const interval = setInterval(checkAuto, 3000)
      return () => {
        document.removeEventListener('visibilitychange', handleVisibility)
        clearInterval(interval)
      }
    }

    return () => document.removeEventListener('visibilitychange', handleVisibility)
  }, [processText])

  return { address, dismiss, needsTap, checkNow, dismissTap }
}
