// src/lib/deleteAccount.ts
// Exclusão de conta feita pelo próprio utilizador (exigência da Google Play e do GDPR).
// Não depende de Cloud Functions: pede a senha (o Firebase exige login recente),
// apaga os dados pessoais e por fim a conta de acesso.
import { EmailAuthProvider, reauthenticateWithCredential, deleteUser } from 'firebase/auth'
import {
  collection, getDocs, getDoc, doc, query, where, deleteDoc, updateDoc, arrayRemove,
} from 'firebase/firestore'
import { ref, remove } from 'firebase/database'
import { auth, db, rtdb } from './firebase'

export type DeleteStep = 'auth' | 'groups' | 'reports' | 'profile' | 'account'

/** Cada passo de limpeza é independente: um erro num não impede os outros nem a exclusão. */
async function tryStep(label: string, fn: () => Promise<unknown>) {
  try { await fn() } catch (e) { console.warn(`[deleteAccount] ${label} falhou:`, e) }
}

export async function deleteOwnAccount(password: string, onStep?: (s: DeleteStep) => void): Promise<void> {
  const user = auth.currentUser
  if (!user || !user.email) throw new Error('Sessão expirada. Entra outra vez e tenta de novo.')
  const uid = user.uid

  // 1) Confirma a senha ANTES de apagar qualquer coisa (evita exclusão pela metade)
  onStep?.('auth')
  try {
    await reauthenticateWithCredential(user, EmailAuthProvider.credential(user.email, password))
  } catch (e: any) {
    const c = e?.code ?? ''
    if (c.includes('wrong-password') || c.includes('invalid-credential')) throw new Error('Senha incorreta.')
    if (c.includes('too-many-requests')) throw new Error('Muitas tentativas. Espera uns minutos.')
    throw new Error('Não foi possível confirmar a senha. Verifica a internet.')
  }

  // 2) Sai dos grupos e apaga a localização partilhada
  onStep?.('groups')
  await tryStep('grupos', async () => {
    const snap = await getDocs(query(collection(db, 'groups'), where('members', 'array-contains', uid)))
    await Promise.all(snap.docs.map(async g => {
      const members: string[] = g.data().members ?? []
      if (members.length <= 1) {
        await deleteDoc(g.ref)                       // era o único membro: apaga o grupo
      } else {
        await updateDoc(g.ref, { members: arrayRemove(uid), memberCount: members.length - 1 })
      }
      await remove(ref(rtdb, `groupLocations/${g.id}/${uid}`)).catch(() => {})
    }))
  })
  await tryStep('presença', () => remove(ref(rtdb, `riderPresence/${uid}`)))

  // 3) Reports ficam no mapa (são dados da comunidade), mas sem nome nem ligação à pessoa
  onStep?.('reports')
  await tryStep('reports', async () => {
    const snap = await getDocs(query(collection(db, 'incidents'), where('userId', '==', uid)))
    await Promise.all(snap.docs.map(d => updateDoc(d.ref, { userName: 'Rider', userAnonymized: true })))
  })

  // 4) Perfil, código de indicação e tokens de notificação
  onStep?.('profile')
  await tryStep('tokens', async () => {
    const snap = await getDocs(collection(db, 'users', uid, 'pushTokens'))
    await Promise.all(snap.docs.map(d => deleteDoc(d.ref)))
  })
  await tryStep('perfil', async () => {
    const direct = await getDoc(doc(db, 'users', uid))
    const code = direct.exists() ? (direct.data() as any).referralCode : undefined
    if (code) await deleteDoc(doc(db, 'referralCodes', code)).catch(() => {})
    if (direct.exists()) await deleteDoc(direct.ref)
    const legacy = await getDocs(query(collection(db, 'users'), where('id', '==', uid)))
    await Promise.all(legacy.docs.map(d => deleteDoc(d.ref)))
  })
  try { localStorage.clear() } catch {}

  // 5) Por último a conta de acesso
  onStep?.('account')
  await deleteUser(user)
}
