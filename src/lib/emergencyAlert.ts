// src/lib/emergencyAlert.ts
import { ref, set, push, remove } from 'firebase/database'
import { rtdb, db } from './firebase'
import { sendEmergencyAlert } from './firestore'
import { doc, getDoc, getDocs, collection, query, where, addDoc, serverTimestamp } from 'firebase/firestore'

async function getGroupMemberTokens(groupId: string, excludeUserId: string): Promise<string[]> {
  try {
    const groupDoc = await getDoc(doc(db, 'groups', groupId))
    if (!groupDoc.exists()) return []

    const members: string[] = groupDoc.data()?.members ?? []
    const others = members.filter((id) => id !== excludeUserId)

    const allTokens: string[] = []
    for (const memberId of others) {
      try {
        const tokensSnap = await getDocs(
          query(collection(db, 'users', memberId, 'pushTokens'), where('active', '==', true))
        )
        tokensSnap.docs.forEach((d) => {
          if (d.data().token) allTokens.push(d.data().token)
        })
      } catch {
        // member has no tokens
      }
    }
    return allTokens
  } catch {
    return []
  }
}

export async function triggerEmergencyAlert({
  userId,
  userName,
  groupId,
  groupName,
  location,
}: {
  userId: string
  userName: string
  groupId: string
  groupName?: string
  location: { lat: number; lng: number } | null
}) {
  const timeStr = new Date().toLocaleTimeString('en-IE', { hour: '2-digit', minute: '2-digit' })
  const locationStr = location
    ? `${location.lat.toFixed(4)}, ${location.lng.toFixed(4)}`
    : 'Location unavailable'

  // 1. Write emergency pin to RTDB (map marker + triggers real-time overlay on other devices)
  await set(ref(rtdb, `emergencies/${groupId}/${userId}`), {
    userName,
    lat: location?.lat ?? null,
    lng: location?.lng ?? null,
    timestamp: Date.now(),
    active: true,
  })

  // 2. Emergency message in group chat
  await push(ref(rtdb, `groupChats/${groupId}/messages`), {
    userId: 'system',
    userName: 'RiderShield Alert',
    text: `🚨 EMERGENCY ALERT\n${userName} needs immediate help!\n📍 ${locationStr}\n⏰ ${timeStr}`,
    timestamp: Date.now(),
    emergency: true,
    type: 'emergency',
  })

  // 3. Firestore alert (history panel)
  if (location) {
    await sendEmergencyAlert(userId, userName, groupId, location.lat, location.lng)
  }

  // 4. Firestore permanent emergency history
  try {
    await addDoc(collection(db, 'emergencies'), {
      userId,
      userName,
      groupId,
      groupName: groupName ?? groupId,
      lat: location?.lat ?? null,
      lng: location?.lng ?? null,
      timestamp: serverTimestamp(),
      status: 'active',
      resolvedAt: null,
      resolvedBy: null,
    })
  } catch (e) {
    console.warn('[Emergency] Firestore history write failed:', e)
  }

  // 5. Push notifications via API route (fire-and-forget, non-blocking)
  getGroupMemberTokens(groupId, userId).then((tokens) => {
    if (tokens.length === 0) return
    fetch('/api/emergency', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ tokens, userName, groupId }),
    }).catch(console.warn)
  }).catch(console.warn)

  // 6. Auto-clear the RTDB pin after 30 minutes
  setTimeout(() => clearEmergencyPin(groupId, userId), 30 * 60 * 1000)
}

export async function clearEmergencyPin(groupId: string, userId: string) {
  try {
    await remove(ref(rtdb, `emergencies/${groupId}/${userId}`))
  } catch {}
}
