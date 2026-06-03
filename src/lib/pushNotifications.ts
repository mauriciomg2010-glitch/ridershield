// src/lib/pushNotifications.ts — client-only, never imported server-side
import { doc, setDoc, serverTimestamp } from 'firebase/firestore'
import { db } from './firebase'

export async function registerPushToken(userId: string): Promise<string | null> {
  if (typeof window === 'undefined') return null
  if (!('Notification' in window)) return null

  try {
    const permission = await Notification.requestPermission()
    if (permission !== 'granted') return null

    const { getMessaging, getToken } = await import('firebase/messaging')
    const { getApp } = await import('firebase/app')

    const messaging = getMessaging(getApp())
    const swReg = await navigator.serviceWorker.ready

    const token = await getToken(messaging, {
      vapidKey: process.env.NEXT_PUBLIC_FIREBASE_VAPID_KEY,
      serviceWorkerRegistration: swReg,
    })

    if (token) {
      const platform = /iPhone|iPad|iPod/.test(navigator.userAgent) ? 'ios'
        : /Android/.test(navigator.userAgent) ? 'android' : 'web'

      await setDoc(
        doc(db, 'users', userId, 'pushTokens', token.slice(-20)),
        { token, platform, createdAt: serverTimestamp(), active: true },
        { merge: true }
      )
    }
    return token
  } catch (err) {
    console.warn('[Push] Failed to register token:', err)
    return null
  }
}

export async function onForegroundMessage(callback: (payload: any) => void): Promise<() => void> {
  if (typeof window === 'undefined') return () => {}
  try {
    const { getMessaging, onMessage } = await import('firebase/messaging')
    const { getApp } = await import('firebase/app')
    const messaging = getMessaging(getApp())
    return onMessage(messaging, callback)
  } catch {
    return () => {}
  }
}
