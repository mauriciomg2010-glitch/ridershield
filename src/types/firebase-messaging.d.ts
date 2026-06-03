// Stub types for firebase/messaging (not exposed in this firebase bundle)
declare module 'firebase/messaging' {
  import { FirebaseApp } from 'firebase/app'

  export interface Messaging {}
  export interface MessagePayload {
    notification?: { title?: string; body?: string; icon?: string }
    data?: Record<string, string>
    fcmOptions?: { link?: string }
  }

  export function getMessaging(app?: FirebaseApp): Messaging
  export function getToken(messaging: Messaging, options?: { vapidKey?: string; serviceWorkerRegistration?: ServiceWorkerRegistration }): Promise<string>
  export function onMessage(messaging: Messaging, nextOrObserver: (payload: MessagePayload) => void): () => void
}
