// src/hooks/useDeepLink.ts
'use client'
import { useEffect } from 'react'
import { isDublinAddress } from './useClipboardDestination'

// Two entry points:
//  1. iOS Shortcut → ?address=<encoded address>
//  2. Android Share Target → ?text=<notification text>  (via Web Share Target in manifest)
// Fires callback once on mount, then cleans the URL.
export function useDeepLink(onAddress: (address: string) => void) {
  useEffect(() => {
    if (typeof window === 'undefined') return
    const params = new URLSearchParams(window.location.search)

    const directAddress = params.get('address')
    const sharedText = params.get('text')

    // Always clean all share-target params from the URL
    const clean = new URL(window.location.href)
    clean.searchParams.delete('address')
    clean.searchParams.delete('text')
    clean.searchParams.delete('title')
    clean.searchParams.delete('url')
    window.history.replaceState({}, '', clean.toString())

    // Priority 1: explicit ?address= (iOS Shortcut)
    if (directAddress?.trim()) {
      onAddress(directAddress.trim())
      return
    }

    // Priority 2: ?text= from Android share sheet
    if (sharedText?.trim()) {
      const text = sharedText.trim()
      // Try full text first, then scan line-by-line for an address
      if (isDublinAddress(text)) {
        onAddress(text)
        return
      }
      const lines = text.split(/[\n.•·,]+/).map(l => l.trim()).filter(Boolean)
      for (const line of lines) {
        if (isDublinAddress(line)) {
          onAddress(line)
          return
        }
      }
    }
  }, []) // intentionally empty — runs once on mount
}
