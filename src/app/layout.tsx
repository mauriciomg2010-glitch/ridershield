// src/app/layout.tsx
import type { Metadata, Viewport } from 'next'
import Script from 'next/script'
import './globals.css'
import { AuthProvider } from '@/contexts/AuthContext'
import { ThemeProvider } from '@/contexts/ThemeContext'
import { LangProvider } from '@/contexts/LangContext'
import { ShiftProvider } from '@/contexts/ShiftContext'
import { Toaster } from 'react-hot-toast'
import PWAInstallBanner from '@/components/PWAInstallBanner'
import AudioUnlockInit from '@/components/AudioUnlockInit'

export const metadata: Metadata = {
  title: 'ZIVO',
  description: 'Navigate safe. Arrive alive. Safety for Dublin delivery riders.',
  manifest: '/manifest.json?v=2',
  appleWebApp: {
    capable: true,
    statusBarStyle: 'black-translucent',
    title: 'ZIVO',
  },
  icons: {
    apple: '/icons/apple-touch-icon.png',
  },
}

export const viewport: Viewport = {
  width: 'device-width', initialScale: 1, maximumScale: 1,
  userScalable: false, themeColor: '#f59e0b',
}

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <head>
        <meta name="mobile-web-app-capable" content="yes" />
        <meta name="apple-mobile-web-app-capable" content="yes" />
        <meta name="apple-mobile-web-app-status-bar-style" content="black-translucent" />
        <meta name="apple-mobile-web-app-title" content="ZIVO" />
        <meta name="msapplication-TileColor" content="#f59e0b" />
        <Script
          id="sw-register"
          strategy="afterInteractive"
          dangerouslySetInnerHTML={{
            __html: `
(async function() {
  // 1. Unregister stale SWs that had the POST-caching bug (v1/v2)
  if ('serviceWorker' in navigator) {
    const regs = await navigator.serviceWorker.getRegistrations();
    for (const reg of regs) {
      // If the active SW is an old version, unregister so v3 can take over
      const swUrl = reg.active?.scriptURL || '';
      if (!swUrl) { await reg.unregister(); }
    }
  }

  // 2. Delete old caches (v1/v2) — v3 activate event also does this,
  //    but doing it here ensures it happens even before the new SW activates
  if ('caches' in window) {
    const keys = await caches.keys();
    for (const k of keys) {
      if (k.includes('-v1') || k.includes('-v2')) {
        await caches.delete(k);
        console.log('[ZIVO] Deleted stale cache:', k);
      }
    }
  }

  // 3. Register / update to v3 SW with updateViaCache:'none' to bypass HTTP cache
  if ('serviceWorker' in navigator) {
    try {
      const reg = await navigator.serviceWorker.register('/sw.js', {
        scope: '/',
        updateViaCache: 'none',
      });
      // Force immediate activation if a waiting worker exists
      if (reg.waiting) { reg.waiting.postMessage({ type: 'SKIP_WAITING' }); }
      reg.addEventListener('updatefound', () => {
        const nw = reg.installing;
        if (nw) nw.addEventListener('statechange', () => {
          if (nw.state === 'installed' && navigator.serviceWorker.controller) {
            nw.postMessage({ type: 'SKIP_WAITING' });
          }
        });
      });
      console.log('[ZIVO] SW v3 active:', reg.scope);
    } catch(e) {
      console.warn('[ZIVO] SW registration failed:', e);
    }
  }
})();
            `,
          }}
        />
      </head>
      <body>
        <PWAInstallBanner />
        <AudioUnlockInit />
        <ShiftProvider>
        <ThemeProvider>
          <LangProvider>
            <AuthProvider>
              {children}
              <Toaster position="top-center" toastOptions={{
                style: { background: '#150f2a', color: '#e5e7eb', border: '1px solid #2d1f5e', borderRadius: '12px', fontSize: '14px', fontWeight: '500', maxWidth: '360px' },
                success: { iconTheme: { primary: '#22c55e', secondary: '#150f2a' } },
                error: { iconTheme: { primary: '#ef4444', secondary: '#150f2a' }, style: { background: '#2d1515', border: '1px solid #7f1d1d', color: '#fca5a5' } },
              }} />
            </AuthProvider>
          </LangProvider>
        </ThemeProvider>
        </ShiftProvider>
      </body>
    </html>
  )
}
