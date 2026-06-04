// src/lib/firebase.ts
import { initializeApp, getApps, getApp } from 'firebase/app'
import { getAuth } from 'firebase/auth'
import { getFirestore } from 'firebase/firestore'
import { getDatabase } from 'firebase/database'

const firebaseConfig = {
  apiKey:            (process.env.NEXT_PUBLIC_FIREBASE_API_KEY             ?? '').trim(),
  authDomain:        (process.env.NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN         ?? '').trim(),
  projectId:         (process.env.NEXT_PUBLIC_FIREBASE_PROJECT_ID          ?? '').trim(),
  storageBucket:     (process.env.NEXT_PUBLIC_FIREBASE_STORAGE_BUCKET      ?? '').trim(),
  messagingSenderId: (process.env.NEXT_PUBLIC_FIREBASE_MESSAGING_SENDER_ID ?? '').trim(),
  appId:             (process.env.NEXT_PUBLIC_FIREBASE_APP_ID              ?? '').trim(),
  databaseURL:       (process.env.NEXT_PUBLIC_FIREBASE_DATABASE_URL        ?? '').trim(),
}

const app = getApps().length === 0 ? initializeApp(firebaseConfig) : getApp()

export const auth = getAuth(app)
export const db = getFirestore(app)
export const rtdb = getDatabase(app)
export default app
