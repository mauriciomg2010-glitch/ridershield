// src/contexts/AuthContext.tsx
'use client'
import { createContext, useContext, useEffect, useState, ReactNode } from 'react'
import {
  createUserWithEmailAndPassword,
  signInWithEmailAndPassword,
  signOut as firebaseSignOut,
  onAuthStateChanged,
  User as FirebaseUser,
} from 'firebase/auth'
import { auth } from '@/lib/firebase'
import { createUserProfile, getUserProfile } from '@/lib/firestore'
import { collection, getDocs, query, where } from 'firebase/firestore'
import { db } from '@/lib/firebase'
import { useStore } from '@/lib/store'
import { User } from '@/types'
import { registerPushToken } from '@/lib/pushNotifications'

interface AuthContextType {
  firebaseUser: FirebaseUser | null
  loading: boolean
  signUp: (email: string, password: string, name: string) => Promise<void>
  signIn: (email: string, password: string) => Promise<void>
  signOut: () => Promise<void>
}

const AuthContext = createContext<AuthContextType | null>(null)

export function AuthProvider({ children }: { children: ReactNode }) {
  const [firebaseUser, setFirebaseUser] = useState<FirebaseUser | null>(null)
  const [loading, setLoading] = useState(true)
  const setUser = useStore((s) => s.setUser)

  useEffect(() => {
    const unsub = onAuthStateChanged(auth, async (fbUser) => {
      setFirebaseUser(fbUser)
      if (fbUser) {
        // Check if account is disabled before allowing access
        try {
          const q = query(collection(db, 'users'), where('id', '==', fbUser.uid))
          const snap = await getDocs(q)
          if (!snap.empty) {
            const data = snap.docs[0].data()
            if (data.isDisabled || data.isDeleted) {
              await firebaseSignOut(auth)
              setUser(null)
              setLoading(false)
              alert('O teu acesso foi desativado.\nContacta o administrador para mais informações.')
              return
            }
          }
        } catch { /* non-blocking */ }
        const profile = await getUserProfile(fbUser.uid)
        setUser(profile)
        registerPushToken(fbUser.uid).catch(() => {})
      } else {
        setUser(null)
      }
      setLoading(false)
    })
    return unsub
  }, [setUser])

  async function signUp(email: string, password: string, name: string) {
    const cred = await createUserWithEmailAndPassword(auth, email, password)
    await createUserProfile(cred.user.uid, name, email)
    const profile = await getUserProfile(cred.user.uid)
    setUser(profile)
  }

  async function signIn(email: string, password: string) {
    await signInWithEmailAndPassword(auth, email, password)
  }

  async function signOut() {
    await firebaseSignOut(auth)
    setUser(null)
  }

  return (
    <AuthContext.Provider value={{ firebaseUser, loading, signUp, signIn, signOut }}>
      {children}
    </AuthContext.Provider>
  )
}

export function useAuth() {
  const ctx = useContext(AuthContext)
  if (!ctx) throw new Error('useAuth must be used within AuthProvider')
  return ctx
}
