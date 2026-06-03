'use client'
import { useEffect, useState } from 'react'

interface BeforeInstallPromptEvent extends Event {
  prompt: () => Promise<void>
  userChoice: Promise<{ outcome: 'accepted' | 'dismissed' }>
}

const DISMISSED_KEY = 'ridershield-pwa-banner-dismissed-until'

export default function PWAInstallBanner() {
  const [installPrompt, setInstallPrompt] = useState<BeforeInstallPromptEvent | null>(null)
  const [showAndroidBanner, setShowAndroidBanner] = useState(false)
  const [showIOSButton, setShowIOSButton] = useState(false)
  const [showIOSSheet, setShowIOSSheet] = useState(false)

  useEffect(() => {
    const standalone =
      window.matchMedia('(display-mode: standalone)').matches ||
      (window.navigator as any).standalone === true
    if (standalone) return

    const dismissed = localStorage.getItem(DISMISSED_KEY)
    if (dismissed && Date.now() < Number(dismissed)) return

    const ios = /iPad|iPhone|iPod/.test(navigator.userAgent) && !(window as any).MSStream

    if (ios) {
      const timer = setTimeout(() => setShowIOSButton(true), 2000)
      return () => clearTimeout(timer)
    }

    const handler = (e: Event) => {
      e.preventDefault()
      setInstallPrompt(e as BeforeInstallPromptEvent)
      setTimeout(() => setShowAndroidBanner(true), 2000)
    }

    window.addEventListener('beforeinstallprompt', handler)
    window.addEventListener('appinstalled', () => {
      setShowAndroidBanner(false)
      setShowIOSButton(false)
    })

    return () => window.removeEventListener('beforeinstallprompt', handler)
  }, [])

  function dismissAndroid() {
    localStorage.setItem(DISMISSED_KEY, String(Date.now() + 30 * 24 * 60 * 60 * 1000))
    setShowAndroidBanner(false)
  }

  function dismissIOS() {
    localStorage.setItem(DISMISSED_KEY, String(Date.now() + 7 * 24 * 60 * 60 * 1000))
    setShowIOSButton(false)
    setShowIOSSheet(false)
  }

  async function handleAndroidInstall() {
    if (!installPrompt) return
    await installPrompt.prompt()
    const { outcome } = await installPrompt.userChoice
    localStorage.setItem(
      DISMISSED_KEY,
      String(Date.now() + (outcome === 'accepted' ? 30 : 7) * 24 * 60 * 60 * 1000)
    )
    setShowAndroidBanner(false)
    setInstallPrompt(null)
  }

  return (
    <>
      <style>{`
        @keyframes pwa-slide-down {
          from { transform: translateY(-100%); opacity: 0; }
          to { transform: translateY(0); opacity: 1; }
        }
        @keyframes pwa-slide-up {
          from { transform: translateY(100%); }
          to { transform: translateY(0); }
        }
        .pwa-android { animation: pwa-slide-down 0.3s cubic-bezier(0.32,0.72,0,1); }
        .pwa-sheet { animation: pwa-slide-up 0.3s cubic-bezier(0.32,0.72,0,1); }
      `}</style>

      {/* Android banner — relative, not fixed */}
      {showAndroidBanner && (
        <div
          className="pwa-android"
          style={{
            position: 'relative',
            width: '100%',
            maxHeight: '52px',
            background: 'linear-gradient(135deg, #1e1b4b 0%, #2e1065 100%)',
            borderBottom: '1px solid rgba(167,139,250,0.3)',
            display: 'flex',
            alignItems: 'center',
            gap: '10px',
            padding: '0 14px',
            height: '52px',
            flexShrink: 0,
            zIndex: 100,
          }}
        >
          <span style={{ fontSize: '20px', flexShrink: 0 }}>🛡️</span>
          <div style={{ flex: 1, minWidth: 0 }}>
            <p style={{ margin: 0, fontSize: '13px', fontWeight: 700, color: '#e9d5ff', lineHeight: 1.2 }}>
              Install ZIVO
            </p>
            <p style={{ margin: 0, fontSize: '11px', color: '#a78bfa', lineHeight: 1.2 }}>
              Faster access &amp; offline support
            </p>
          </div>
          <button
            onClick={handleAndroidInstall}
            style={{
              flexShrink: 0,
              background: 'linear-gradient(135deg, #7c3aed 0%, #5b21b6 100%)',
              color: '#fff',
              border: 'none',
              borderRadius: '8px',
              padding: '6px 12px',
              fontSize: '12px',
              fontWeight: 700,
              cursor: 'pointer',
              whiteSpace: 'nowrap',
            }}
          >
            Install
          </button>
          <button
            onClick={dismissAndroid}
            style={{
              flexShrink: 0,
              background: 'transparent',
              border: 'none',
              color: '#6b7280',
              cursor: 'pointer',
              padding: '4px',
              fontSize: '18px',
              lineHeight: 1,
            }}
          >
            ×
          </button>
        </div>
      )}

      {/* iOS floating button */}
      {showIOSButton && !showIOSSheet && (
        <button
          onClick={() => setShowIOSSheet(true)}
          style={{
            position: 'fixed',
            bottom: '80px',
            right: '16px',
            zIndex: 900,
            background: '#7c3aed',
            color: '#fff',
            border: 'none',
            borderRadius: '20px',
            padding: '8px 14px',
            fontSize: '13px',
            fontWeight: 700,
            cursor: 'pointer',
            display: 'flex',
            alignItems: 'center',
            gap: '6px',
          }}
        >
          <span style={{ fontSize: '15px' }}>⊕</span> Install
        </button>
      )}

      {/* iOS bottom sheet */}
      {showIOSSheet && (
        <div
          style={{
            position: 'fixed',
            inset: 0,
            zIndex: 9999,
            background: 'rgba(0,0,0,0.6)',
            display: 'flex',
            alignItems: 'flex-end',
          }}
          onClick={() => setShowIOSSheet(false)}
        >
          <div
            className="pwa-sheet"
            onClick={(e) => e.stopPropagation()}
            style={{
              width: '100%',
              background: 'var(--surface, #1a1033)',
              borderRadius: '20px 20px 0 0',
              padding: '24px',
              paddingBottom: 'calc(24px + env(safe-area-inset-bottom))',
            }}
          >
            <div style={{ width: '40px', height: '4px', borderRadius: '2px', background: 'rgba(255,255,255,0.2)', margin: '0 auto 20px' }} />
            <h3 style={{ margin: '0 0 20px', fontSize: '17px', fontWeight: 700, color: 'var(--text, #fff)', textAlign: 'center' }}>
              Add to Home Screen
            </h3>
            <div style={{ display: 'flex', flexDirection: 'column', gap: '16px', marginBottom: '28px' }}>
              {[
                { icon: '↑', step: '1. Tap the Share button below' },
                { icon: '📋', step: '2. Scroll and tap Add to Home Screen' },
                { icon: '✓', step: '3. Tap Add' },
              ].map(({ icon, step }) => (
                <div key={step} style={{ display: 'flex', alignItems: 'center', gap: '14px' }}>
                  <div style={{
                    width: '36px', height: '36px', borderRadius: '10px',
                    background: 'rgba(124,58,237,0.15)', border: '1px solid rgba(124,58,237,0.3)',
                    display: 'flex', alignItems: 'center', justifyContent: 'center',
                    fontSize: '16px', flexShrink: 0,
                  }}>
                    {icon}
                  </div>
                  <span style={{ fontSize: '14px', color: 'var(--text, #e5e7eb)', lineHeight: 1.4 }}>{step}</span>
                </div>
              ))}
            </div>
            <button
              onClick={dismissIOS}
              style={{
                width: '100%',
                background: 'linear-gradient(135deg, #7c3aed 0%, #5b21b6 100%)',
                color: '#fff',
                border: 'none',
                borderRadius: '14px',
                padding: '14px',
                fontSize: '15px',
                fontWeight: 700,
                cursor: 'pointer',
              }}
            >
              Got it
            </button>
          </div>
        </div>
      )}
    </>
  )
}
