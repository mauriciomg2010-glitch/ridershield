'use client'
import { useEffect } from 'react'

export default function AudioUnlockInit() {
  useEffect(() => {
    const unlock = () => {
      import('@/lib/emergencySound').then(({ initAudioContext }) => {
        initAudioContext()
      })
    }

    document.addEventListener('touchstart', unlock, { passive: true })
    document.addEventListener('touchend', unlock, { passive: true })
    document.addEventListener('click', unlock)
    document.addEventListener('keydown', unlock)

    return () => {
      document.removeEventListener('touchstart', unlock)
      document.removeEventListener('touchend', unlock)
      document.removeEventListener('click', unlock)
      document.removeEventListener('keydown', unlock)
    }
  }, [])

  return null
}
