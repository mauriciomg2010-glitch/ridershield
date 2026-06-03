// src/components/Layout/BetaBanner.tsx
'use client'
import { useState, useEffect } from 'react'

const SHOW_BETA_BANNER = false
const STORAGE_KEY = 'betaBannerDismissed'

interface Props {
  onFeedback: () => void
}

export default function BetaBanner({ onFeedback }: Props) {
  if (!SHOW_BETA_BANNER) return null
  const [visible, setVisible] = useState(false)

  useEffect(() => {
    if (!localStorage.getItem(STORAGE_KEY)) setVisible(true)
  }, [])

  function dismiss() {
    localStorage.setItem(STORAGE_KEY, '1')
    setVisible(false)
  }

  if (!visible) return null

  return (
    <div
      className="flex items-center justify-between gap-2 px-4 py-2 flex-shrink-0 text-white text-xs font-semibold"
      style={{ background: 'linear-gradient(135deg, #4f8ef7 0%, #1a5fd4 100%)' }}
    >
      <span>🧪 Beta — Help us improve ZIVO</span>
      <div className="flex items-center gap-3 flex-shrink-0">
        <button
          onClick={onFeedback}
          className="underline underline-offset-2 opacity-90 hover:opacity-100 transition-opacity whitespace-nowrap"
        >
          Give feedback
        </button>
        <button
          onClick={dismiss}
          className="opacity-75 hover:opacity-100 transition-opacity text-sm leading-none"
          aria-label="Dismiss banner"
        >
          ✕
        </button>
      </div>
    </div>
  )
}
