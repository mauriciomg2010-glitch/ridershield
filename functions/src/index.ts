import * as functions from 'firebase-functions'
import * as admin from 'firebase-admin'

admin.initializeApp()

// ── Delete user account (Auth + Firestore + groups) ──────────────────────────
export const deleteUserAccount = functions
  .region('europe-west1')
  .https.onCall(async (data, context) => {
    if (!context.auth) {
      throw new functions.https.HttpsError('unauthenticated', 'Não autenticado')
    }

    // Verify caller is super admin
    const callerSnap = await admin.firestore()
      .collection('users').where('id', '==', context.auth.uid).limit(1).get()
    const callerData = callerSnap.empty ? null : callerSnap.docs[0].data()
    const isSuperAdmin = callerData?.isSuperAdmin === true
      || context.auth.uid === 'kXNpNTLYe5P55PhI8K4VrZSahOC2'

    if (!isSuperAdmin) {
      throw new functions.https.HttpsError('permission-denied', 'Sem permissão')
    }

    const { userId } = data as { userId: string }
    if (!userId) throw new functions.https.HttpsError('invalid-argument', 'userId required')

    // 1. Delete from Firebase Auth
    try {
      await admin.auth().deleteUser(userId)
    } catch { /* already gone from Auth */ }

    // 2. Remove from all groups
    const gruposSnap = await admin.firestore().collection('groups').get()
    const batch = admin.firestore().batch()
    gruposSnap.docs.forEach(g => {
      const members: string[] = g.data().members ?? []
      if (members.includes(userId)) {
        batch.update(g.ref, {
          members: members.filter(id => id !== userId),
          memberCount: Math.max(0, (g.data().memberCount ?? members.length) - 1),
        })
      }
    })
    await batch.commit()

    // 3. Delete Firestore user doc (find by id field)
    const userSnap = await admin.firestore()
      .collection('users').where('id', '==', userId).limit(1).get()
    if (!userSnap.empty) await userSnap.docs[0].ref.delete()

    // 4. Delete rider score doc if exists
    await admin.firestore().collection('rider_scores').doc(userId).delete().catch(() => {})

    return { success: true }
  })

// Triggered when a new emergency is written to RTDB
export const onEmergencyAlert = functions
  .region('europe-west1')
  .database.ref('/emergencies/{groupId}/{userId}')
  .onCreate(async (snapshot, context) => {
    const { groupId, userId } = context.params
    const data = snapshot.val()
    if (!data?.active) return null

    // Get user name from RTDB data (already included) or Firestore fallback
    const userName: string = data.userName || 'A rider'

    // Get group members from Firestore
    const groupDoc = await admin.firestore().doc(`groups/${groupId}`).get()
    if (!groupDoc.exists) return null
    const members: string[] = groupDoc.data()?.members || []
    const others = members.filter((id) => id !== userId)
    if (others.length === 0) return null

    // Collect all active push tokens from other members
    const allTokens: string[] = []
    for (const memberId of others) {
      try {
        const snap = await admin.firestore()
          .collection(`users/${memberId}/pushTokens`)
          .where('active', '==', true)
          .get()
        snap.docs.forEach((d) => {
          const token = d.data().token
          if (token) allTokens.push(token)
        })
      } catch {
        // member has no tokens
      }
    }

    if (allTokens.length === 0) return null

    const locationStr = data.lat && data.lng
      ? `${Number(data.lat).toFixed(4)}, ${Number(data.lng).toFixed(4)}`
      : ''

    await admin.messaging().sendEachForMulticast({
      tokens: allTokens,
      notification: {
        title: '🚨 Emergency Alert',
        body: `${userName} needs help!${locationStr ? ` · ${locationStr}` : ''} Open the app now.`,
      },
      webpush: {
        notification: {
          icon: '/icons/icon-192x192.png',
          badge: '/icons/icon-72x72.png',
          vibrate: [300, 100, 300, 100, 300],
          requireInteraction: true,
        },
        fcmOptions: {
          link: 'https://ridershield.vercel.app/groups',
        },
      },
      data: { type: 'emergency', groupId, userId },
    })

    return null
  })
