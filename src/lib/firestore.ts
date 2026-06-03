// src/lib/firestore.ts
import {
  collection,
  addDoc,
  getDocs,
  getDoc,
  doc,
  setDoc,
  updateDoc,
  deleteDoc,
  query,
  where,
  orderBy,
  limit,
  onSnapshot,
  serverTimestamp,
  arrayUnion,
  arrayRemove,
  Timestamp,
  increment,
} from 'firebase/firestore'
import { ref, set, onValue, remove, push, query as rtdbQuery, limitToLast } from 'firebase/database'
import { db, rtdb, auth } from './firebase'
import { Incident, IncidentType, Group, Alert, User, EmergencyContacts } from '@/types'
import { nanoid } from 'nanoid'

// ─── USERS ───────────────────────────────────────────────────────────────────

export async function createUserProfile(
  uid: string,
  name: string,
  email: string
): Promise<void> {
  const code = generateReferralCode(name, uid)
  // setDoc with doc ID = uid satisfies Firestore rules that check request.auth.uid == docId
  await setDoc(doc(db, 'users', uid), {
    id: uid,
    name,
    email,
    isPremium: false,
    sharingLocation: false,
    createdAt: serverTimestamp(),
    referralCode: code,
    referralCredits: 0,
    referralCreditsPaid: 0,
    referralEarnings: 0,
  })
  // Index immediately so unauthenticated signup validation works
  await indexReferralCode(code, uid)
}

export async function getUserProfile(uid: string): Promise<User | null> {
  // Primary: direct lookup by doc ID (new format — doc ID == uid)
  let data: any = null
  try {
    const d = await getDoc(doc(db, 'users', uid))
    if (d.exists()) data = d.data()
  } catch { /* non-blocking */ }
  // Fallback: query by 'id' field (old format — doc ID is random)
  if (!data) {
    const snap = await getDocs(query(collection(db, 'users'), where('id', '==', uid)))
    if (snap.empty) return null
    data = snap.docs[0].data()
  }
  const isAdmin = !!(data.isAdmin || data.isSuperAdmin)
  return {
    id: data.id,
    name: data.name,
    email: data.email,
    isPremium: !!(data.isPremium || isAdmin),
    isAdmin: isAdmin,
    isSuperAdmin: !!data.isSuperAdmin,
    sharingLocation: data.sharingLocation ?? false,
    createdAt: data.createdAt?.toDate() ?? new Date(),
  }
}

export async function updateUserPremium(uid: string, isPremium: boolean): Promise<void> {
  const q = query(collection(db, 'users'), where('id', '==', uid))
  const snap = await getDocs(q)
  if (!snap.empty) {
    await updateDoc(snap.docs[0].ref, { isPremium })
  }
}

// ─── INCIDENTS ────────────────────────────────────────────────────────────────

export interface ReportOptions {
  description?: string
  subcategory?: string
  hasPhoto?: boolean
  riderTrustScore?: number
  initialScore?: number
  mapWeight?: number
  affectsMap?: boolean
}

function calcularScoreReporte(opts: {
  riderTrustScore: number
  initialScore: number
  hasPhoto: boolean
  hasDescription: boolean
  gpsSnapped: boolean
  isPeakHour: boolean
}): number {
  const { riderTrustScore, initialScore, hasPhoto, hasDescription, gpsSnapped, isPeakHour } = opts
  return Math.round(
    (riderTrustScore / 100) * 35 +
    (initialScore / 100) * 35 +
    (hasPhoto ? 10 : 0) +
    (hasDescription ? 5 : 0) +
    (gpsSnapped ? 5 : 0) +
    (isPeakHour ? 5 : 0)
  )
}

export async function getRiderScore(userId: string): Promise<number> {
  const q = query(collection(db, 'users'), where('id', '==', userId))
  const snap = await getDocs(q)
  if (snap.empty) return 50
  return (snap.docs[0].data().riderScore as number) ?? 50
}

export async function atualizarRiderScore(userId: string, delta: number): Promise<void> {
  const q = query(collection(db, 'users'), where('id', '==', userId))
  const snap = await getDocs(q)
  if (snap.empty) return
  const current = (snap.docs[0].data().riderScore as number) ?? 50
  const novo = Math.min(100, Math.max(0, current + delta))
  await updateDoc(snap.docs[0].ref, { riderScore: novo })
}

export async function reduzirScoreZona(h3Index: string, delta: number): Promise<void> {
  try {
    const { getDoc: _getDoc, doc: _doc, deleteDoc: _deleteDoc, updateDoc: _updateDoc } =
      await import('firebase/firestore')
    const zoneRef = _doc(db, 'risk_zones', `AUTO-${h3Index}`)
    const zoneSnap = await _getDoc(zoneRef)
    if (!zoneSnap.exists()) return
    const data = zoneSnap.data()
    // Never touch manual/permanent zones — belt-and-suspenders guard
    if (data.isPermanent || data.source === 'admin_manual' || data.zoneType === 'manual') return
    const current = (data.riskScore as number) ?? 50
    const novo = current + delta // delta is negative
    if (novo <= 0) {
      await _deleteDoc(zoneRef)
    } else {
      await _updateDoc(zoneRef, { riskScore: novo, updatedAt: serverTimestamp() })
    }
  } catch (e) {
    console.warn('reduzirScoreZona error:', e)
  }
}

export async function reportIncident(
  userId: string,
  userName: string,
  type: IncidentType,
  lat: number,
  lng: number,
  opts: ReportOptions = {}
): Promise<string> {
  const {
    description = '',
    subcategory,
    hasPhoto = false,
    riderTrustScore,
    initialScore = 50,
    mapWeight = 1,
    affectsMap = true,
  } = opts

  const riderScore = riderTrustScore ?? (await getRiderScore(userId))

  const { snapToRoad } = await import('./snapToRoad')
  const snap = await snapToRoad(lat, lng)
  const { latLngToCell } = await import('h3-js')
  const h3Index = latLngToCell(snap.lat, snap.lng, 9)
  const h3IndexRes10 = latLngToCell(snap.lat, snap.lng, 10)
  const hour = new Date().getHours()
  const isPeakHour = (hour >= 7 && hour <= 9) || (hour >= 17 && hour <= 20) || (hour >= 22 || hour <= 2)

  const confidenceScore = calcularScoreReporte({
    riderTrustScore: riderScore,
    initialScore,
    hasPhoto,
    hasDescription: description.length >= 10,
    gpsSnapped: snap.snapped,
    isPeakHour,
  })

  const status = confidenceScore >= 70 ? 'confirmed' : 'pending'

  const ref = await addDoc(collection(db, 'incidents'), {
    type,
    location: { lat: snap.lat, lng: snap.lng },
    originalLocation: { lat, lng },
    description,
    subcategory: subcategory ?? null,
    timestamp: serverTimestamp(),
    userId,
    userName,
    upvotes: 0,
    h3Index,
    h3IndexRes10,
    roadSegment: snap.segmentName,
    snapConfidence: snap.snapConfidence,
    wasSnapped: snap.snapped,
    hour,
    dayOfWeek: new Date().getDay(),
    riderScore,
    confidenceScore,
    hasPhoto,
    affectsMap,
    mapWeight,
    status,
    confirmations: 0,
    denials: 0,
  })

  // Update rider score: +2 for any valid report, +1 extra if has photo
  atualizarRiderScore(userId, hasPhoto ? 3 : 2).catch(() => {})

  if (type === 'confirmed_safe') {
    reduzirScoreZona(h3Index, -10).catch(() => {})
  } else if (affectsMap) {
    import('./clustering').then(({ processarClustering }) => {
      processarClustering(snap.lat, snap.lng).catch(e => console.warn('Clustering error:', e))
    })
  }

  return ref.id
}

// ─── GROUPS ───────────────────────────────────────────────────────────────────

export async function createGroup(
  ownerId: string,
  name: string
): Promise<Group> {
  const inviteCode = nanoid(8).toUpperCase()
  const docRef = await addDoc(collection(db, 'groups'), {
    name,
    ownerId,
    adminId: ownerId,
    inviteCode,
    members: [ownerId],
    createdAt: serverTimestamp(),
  })
  return {
    id: docRef.id,
    name,
    ownerId,
    adminId: ownerId,
    inviteCode,
    members: [ownerId],
    createdAt: new Date(),
  }
}

export async function joinGroupByCode(
  userId: string,
  code: string
): Promise<Group | null> {
  try {
    const normalized = code.trim().toUpperCase()
    const q = query(collection(db, 'groups'), where('inviteCode', '==', normalized))
    const snap = await getDocs(q)
    if (snap.empty) return null

    const docSnap = snap.docs[0]
    const data = docSnap.data()

    const alreadyMember = (data.members ?? []).includes(userId)
    if (!alreadyMember) {
      await updateDoc(docSnap.ref, { members: arrayUnion(userId) })
    }

    const members: string[] = alreadyMember
      ? (data.members ?? [])
      : [...(data.members ?? []), userId]

    return {
      id: docSnap.id,
      name: data.name,
      ownerId: data.ownerId ?? data.createdBy,
      adminId: data.adminId ?? data.ownerId ?? data.admin ?? data.createdBy,
      inviteCode: data.inviteCode,
      members,
      createdAt: data.createdAt?.toDate() ?? new Date(),
    } as Group
  } catch (error: any) {
    console.error('joinGroupByCode ERROR:', error?.code, error?.message, error)
    throw error
  }
}

export function subscribeToUserGroups(
  userId: string,
  callback: (groups: Group[]) => void
): () => void {
  const q = query(
    collection(db, 'groups'),
    where('members', 'array-contains', userId)
  )

  return onSnapshot(q, (snap) => {
    const groups: Group[] = snap.docs.map((d) => {
      const data = d.data()
      return {
        id: d.id,
        name: data.name,
        ownerId: data.ownerId,
        adminId: data.adminId ?? data.ownerId ?? data.admin ?? data.createdBy,
        inviteCode: data.inviteCode,
        members: data.members ?? [],
        createdAt: data.createdAt?.toDate() ?? new Date(),
        memberCount: data.members?.length ?? 0,
      }
    })
    callback(groups)
  }, (error) => {
    console.error('subscribeToUserGroups error:', error)
  })
}

// ─── REALTIME LOCATION (Firebase RTDB) ───────────────────────────────────────

export function publishLocation(
  userId: string,
  groupId: string,
  lat: number,
  lng: number
): void {
  const locationRef = ref(rtdb, `groupLocations/${groupId}/${userId}`)
  set(locationRef, {
    userId,
    groupId,
    lat,
    lng,
    lastUpdated: Date.now(),
  })
}

export function clearLocation(userId: string, groupId: string): void {
  const locationRef = ref(rtdb, `groupLocations/${groupId}/${userId}`)
  remove(locationRef)
}

export function subscribeToGroupLocations(
  groupId: string,
  callback: (locations: Record<string, { lat: number; lng: number; lastUpdated: number }>) => void
): () => void {
  const locationRef = ref(rtdb, `groupLocations/${groupId}`)
  const unsub = onValue(locationRef, (snapshot) => {
    callback(snapshot.val() ?? {})
  })
  return () => unsub()
}

// ─── ALERTS ───────────────────────────────────────────────────────────────────

export async function sendEmergencyAlert(
  userId: string,
  userName: string,
  groupId: string,
  lat: number,
  lng: number
): Promise<void> {
  await addDoc(collection(db, 'alerts'), {
    groupId,
    userId,
    userName,
    location: { lat, lng },
    timestamp: serverTimestamp(),
    type: 'emergency',
  })
}

// ─── GROUP ADMIN ─────────────────────────────────────────────────────────────

export async function removeMemberFromGroup(groupId: string, memberId: string): Promise<void> {
  const docRef = doc(db, 'groups', groupId)
  await updateDoc(docRef, { members: arrayRemove(memberId) })
}

export async function closeGroup(groupId: string): Promise<void> {
  try {
    await deleteDoc(doc(db, 'groups', groupId))
  } catch (error: any) {
    throw error
  }
  await Promise.allSettled([
    remove(ref(rtdb, `groupLocations/${groupId}`)),
    remove(ref(rtdb, `groupChats/${groupId}`)),
    remove(ref(rtdb, `emergencies/${groupId}`)),
  ])
}

export async function promoteToAdmin(groupId: string, newAdminId: string): Promise<void> {
  const docRef = doc(db, 'groups', groupId)
  await updateDoc(docRef, { adminId: newAdminId })
}

// ─── GROUP CHAT (RTDB) ────────────────────────────────────────────────────────

export interface ChatMessage {
  id: string
  userId: string
  userName: string
  text: string
  timestamp: number
  emergency?: boolean
  type?: string
}

export async function sendChatMessage(
  groupId: string,
  userId: string,
  userName: string,
  text: string
): Promise<void> {
  const messagesRef = ref(rtdb, `groupChats/${groupId}/messages`)
  const newRef = push(messagesRef)
  await set(newRef, { userId, userName, text, timestamp: Date.now() })
}

export function subscribeToGroupChat(
  groupId: string,
  callback: (messages: ChatMessage[]) => void
): () => void {
  const messagesRef = ref(rtdb, `groupChats/${groupId}/messages`)
  const limited = rtdbQuery(messagesRef, limitToLast(100))
  const unsub = onValue(limited, (snapshot) => {
    const data = snapshot.val() ?? {}
    const messages: ChatMessage[] = Object.entries(data)
      .map(([id, val]: [string, any]) => ({ id, userId: val.userId, userName: val.userName, text: val.text, timestamp: val.timestamp }))
      .sort((a, b) => a.timestamp - b.timestamp)
    callback(messages)
  })
  return () => unsub()
}

// ─── EMERGENCY CONTACTS ───────────────────────────────────────────────────────

export async function getEmergencyContacts(uid: string): Promise<EmergencyContacts | null> {
  const q = query(collection(db, 'users'), where('id', '==', uid))
  const snap = await getDocs(q)
  if (snap.empty) return null
  const data = snap.docs[0].data()
  return (data.emergencyContacts as EmergencyContacts) ?? null
}

export async function saveEmergencyContacts(uid: string, contacts: EmergencyContacts): Promise<void> {
  const q = query(collection(db, 'users'), where('id', '==', uid))
  const snap = await getDocs(q)
  if (!snap.empty) {
    await updateDoc(snap.docs[0].ref, { emergencyContacts: contacts })
  }
}

// ─── REFERRAL ─────────────────────────────────────────────────────────────────

// Generates a short, unique code in ZIVO-XXXXX format (10 chars total)
export function generateReferralCode(name: string, uid: string): string {
  // 5 alphanumeric chars from uid — always unique and URL-safe, never too long
  const part = uid.replace(/[^a-zA-Z0-9]/g, '').slice(0, 5).toUpperCase().padEnd(5, '0')
  return `ZIVO-${part}`
}

// Returns the user's referral code, migrating old RS-* format to ZIVO-* on the fly
export async function getReferralCode(uid: string): Promise<string> {
  const q = query(collection(db, 'users'), where('id', '==', uid))
  const snap = await getDocs(q)
  if (snap.empty) return `ZIVO-${uid.slice(0, 5).toUpperCase().padEnd(5, '0')}`
  const data = snap.docs[0].data()
  // Return if already in new ZIVO- format
  if (data.referralCode && (data.referralCode as string).startsWith('ZIVO-')) {
    // Ensure it's indexed in the public collection (idempotent)
    await indexReferralCode(data.referralCode as string, uid)
    return data.referralCode as string
  }
  // Migrate RS-* → ZIVO-* (or generate fresh if missing)
  const code = generateReferralCode(data.name ?? uid, uid)
  await updateDoc(snap.docs[0].ref, { referralCode: code, referralCredits: data.referralCredits ?? 0, referralCreditsPaid: data.referralCreditsPaid ?? 0 })
  await indexReferralCode(code, uid)
  return code
}

export interface ReferralDetail {
  id: string
  referredName: string
  status: 'pending' | 'confirmed' | 'cancelled' | 'invalid'
  commissionAmount: number
  createdAt: Date
  month1PaidAt: Date | null
  month2PaidAt: Date | null
  commissionPaidAt: Date | null
}

// Indexes a referral code in the public referralCodes collection so unauthenticated
// users can validate it during signup (users collection requires auth to read).
async function indexReferralCode(code: string, uid: string): Promise<void> {
  try {
    await setDoc(doc(db, 'referralCodes', code), { uid })
  } catch {
    // Non-critical: validation falls back to users collection for authenticated callers
  }
}

export async function validateReferralCode(code: string): Promise<string | null> {
  const normalized = code.trim().toUpperCase()
  const makeTimeout = () => new Promise<never>((_, reject) =>
    setTimeout(() => reject(new Error('timeout')), 10000)
  )
  try {
    // Primary: referralCodes collection is publicly readable (no auth required)
    const indexDocRef = doc(db, 'referralCodes', normalized)
    const indexSnap = await Promise.race([getDoc(indexDocRef), makeTimeout()])
    if (indexSnap.exists()) {
      const data = indexSnap.data() as { uid: string }
      return data.uid
    }

    // Fallback: query users directly (only works if caller is authenticated)
    const q = query(collection(db, 'users'), where('referralCode', '==', normalized))
    const usersSnap = await Promise.race([getDocs(q), makeTimeout()])
    if (usersSnap.empty) return null
    const uid = String(usersSnap.docs[0].data().id)
    // Lazily populate the public index so future unauthenticated lookups succeed
    await indexReferralCode(normalized, uid)
    return uid
  } catch {
    return null
  }
}

// Returns { code, credits, creditsPaid, confirmedCount, pendingCount }
export async function getUserReferralData(uid: string): Promise<{
  code: string
  credits: number
  creditsPaid: number
  confirmedCount: number
  pendingCount: number
}> {
  const q = query(collection(db, 'users'), where('id', '==', uid))
  const snap = await getDocs(q)
  if (snap.empty) {
    // Doc not yet propagated — code is always deterministic from uid (name param unused)
    const fallbackCode = generateReferralCode('', uid)
    indexReferralCode(fallbackCode, uid).catch(() => {})
    return { code: fallbackCode, credits: 0, creditsPaid: 0, confirmedCount: 0, pendingCount: 0 }
  }
  const data = snap.docs[0].data()
  let code = data.referralCode as string | undefined
  if (!code || !code.startsWith('ZIVO-')) {
    code = generateReferralCode(data.name ?? uid, uid)
    await updateDoc(snap.docs[0].ref, { referralCode: code })
  }
  await indexReferralCode(code, uid)

  const refSnap = await getDocs(
    query(collection(db, 'referrals'), where('referrerId', '==', uid))
  )
  const confirmedCount = refSnap.docs.filter(d =>
    ['confirmed', 'credited', 'paid'].includes(d.data().status)
  ).length
  const pendingCount = refSnap.docs.filter(d =>
    ['signed_up', 'pending'].includes(d.data().status)
  ).length

  return {
    code,
    credits: data.referralCredits ?? 0,
    creditsPaid: data.referralCreditsPaid ?? 0,
    confirmedCount,
    pendingCount,
  }
}

// Apply a referral with anti-fraud checks; returns error string or null on success.
// Any user (Free or Pro) can refer others — no Pro gate.
// Credit is only paid when the referred user pays their 2nd Pro month (manual admin step).
async function getUserDocByUid(uid: string): Promise<{ ref: any; data: any } | null> {
  // Primary: direct lookup by doc ID (new format — doc ID == uid)
  try {
    const d = await getDoc(doc(db, 'users', uid))
    if (d.exists()) return { ref: d.ref, data: d.data() }
  } catch { /* non-blocking */ }
  // Fallback: query by 'id' field (old format — doc ID is random, 'id' field == uid)
  const snap = await getDocs(query(collection(db, 'users'), where('id', '==', uid)))
  if (!snap.empty) return { ref: snap.docs[0].ref, data: snap.docs[0].data() }
  return null
}

export async function applyReferral(
  referrerId: string,
  referredId: string,
  referredName: string,
  codeUsed?: string
): Promise<string | null> {
  if (referrerId === referredId) return 'auto-referral'

  // Only the referred user's doc is strictly required (anti-duplicate check)
  // Referrer doc is optional — if not found we still record the referral
  const [referredResult, referrerResult] = await Promise.all([
    getUserDocByUid(referredId),
    getUserDocByUid(referrerId),
  ])

  if (!referredResult) return 'user-not-found'

  // Referred user can only be referred once
  if (referredResult.data.referredBy) return 'already-referred'

  const code = codeUsed ?? referrerResult?.data?.referralCode ?? ''

  // Always create the referral record — regardless of whether referrer doc was found
  await addDoc(collection(db, 'referrals'), {
    referrerId,
    referredId,
    referredName,
    code,
    status: 'signed_up',
    commissionAmount: 5.00,
    createdAt: serverTimestamp(),
    month1PaidAt: null,
    month2PaidAt: null,
    commissionPaidAt: null,
  })

  // Stamp referred user doc (own doc — permitted)
  await updateDoc(referredResult.ref, {
    referredBy: referrerId,
    referredByCode: code,
  })

  return null
}

export async function getDetailedReferrals(uid: string): Promise<{
  referrals: ReferralDetail[]
  credits: number
  creditsPaid: number
}> {
  const [refSnap, userSnap] = await Promise.all([
    getDocs(query(collection(db, 'referrals'), where('referrerId', '==', uid))),
    getDocs(query(collection(db, 'users'), where('id', '==', uid))),
  ])

  const referrals: ReferralDetail[] = refSnap.docs.map(d => {
    const data = d.data()
    // Map legacy 'paid' status to 'confirmed'
    const status: ReferralDetail['status'] =
      data.status === 'paid' ? 'confirmed' :
      data.status === 'confirmed' ? 'confirmed' :
      data.status === 'cancelled' ? 'cancelled' :
      data.status === 'invalid' ? 'invalid' : 'pending'
    return {
      id: d.id,
      referredName: data.referredName ?? 'Rider',
      status,
      commissionAmount: data.commissionAmount ?? data.amount ?? 3.00,
      createdAt: data.createdAt?.toDate() ?? new Date(),
      month1PaidAt: data.month1PaidAt?.toDate() ?? null,
      month2PaidAt: data.month2PaidAt?.toDate() ?? null,
      commissionPaidAt: data.commissionPaidAt?.toDate() ?? data.paidAt?.toDate() ?? null,
    }
  })
  referrals.sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime())

  const userData = userSnap.empty ? {} : userSnap.docs[0].data()
  return {
    referrals,
    credits: userData.referralCredits ?? 0,
    creditsPaid: userData.referralCreditsPaid ?? 0,
  }
}

// MVP: marks credits as claimed; real payout via Revolut is manual for now
export async function claimReferralCredits(uid: string, amount: number): Promise<void> {
  const q = query(collection(db, 'users'), where('id', '==', uid))
  const snap = await getDocs(q)
  if (snap.empty) return
  await updateDoc(snap.docs[0].ref, {
    referralCredits: 0,
    referralCreditsPaid: increment(amount),
  })
  // Log the claim request for manual processing
  await addDoc(collection(db, 'creditClaims'), {
    uid,
    amount,
    requestedAt: serverTimestamp(),
    status: 'pending',
  })
}

export async function getReferralStats(uid: string): Promise<{
  direct: number
  indirect: number
  earnings: number
  pending: number
  referrals: Array<{
    id: string; referredName: string; status: string
    amount: number; level: number; createdAt: Date
  }>
}> {
  const q = query(collection(db, 'referrals'), where('referrerId', '==', uid))
  const snap = await getDocs(q)
  let direct = 0, indirect = 0, earnings = 0, pending = 0
  const referrals: any[] = []
  snap.docs.forEach(d => {
    const data = d.data()
    if ((data.level ?? 1) === 1) direct++; else indirect++
    if (data.status === 'paid' || data.status === 'confirmed') earnings += (data.commissionAmount ?? data.amount ?? 3)
    else if (data.status === 'pending') pending += (data.commissionAmount ?? data.amount ?? 3)
    referrals.push({
      id: d.id,
      referredName: data.referredName ?? 'Rider',
      status: data.status,
      amount: data.commissionAmount ?? data.amount ?? 3,
      level: data.level ?? 1,
      createdAt: data.createdAt?.toDate() ?? new Date(),
    })
  })
  referrals.sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime())
  return { direct, indirect, earnings, pending, referrals }
}

// ─── RIDER ID ─────────────────────────────────────────────────────────────────

export function generateRiderID(uid: string): string {
  return 'RS-' + uid.slice(0, 6).toUpperCase()
}

export async function getRiderID(uid: string): Promise<string> {
  const q = query(collection(db, 'users'), where('id', '==', uid))
  const snap = await getDocs(q)
  if (!snap.empty) {
    const data = snap.docs[0].data()
    if (data.riderId) return data.riderId
    const riderId = generateRiderID(uid)
    await updateDoc(snap.docs[0].ref, { riderId })
    return riderId
  }
  return generateRiderID(uid)
}

// ─── FEEDBACK ─────────────────────────────────────────────────────────────────

export async function submitFeedback(
  userId: string,
  tipo: string,
  mensagem: string
): Promise<void> {
  await addDoc(collection(db, 'feedback'), {
    userId,
    tipo,
    mensagem,
    timestamp: serverTimestamp(),
    appVersion: '0.2.0',
  })
}

// ─── GLOBAL RIDER PRESENCE (RTDB) ────────────────────────────────────────────

export function publishGlobalPresence(
  userId: string,
  userName: string,
  lat: number,
  lng: number
): void {
  const presenceRef = ref(rtdb, `riderPresence/${userId}`)
  set(presenceRef, {
    userId,
    userName,
    lat,
    lng,
    lastUpdated: Date.now(),
    online: true,
  })
}

export function clearGlobalPresence(userId: string): void {
  const presenceRef = ref(rtdb, `riderPresence/${userId}`)
  remove(presenceRef)
}

export function subscribeToGlobalPresence(
  callback: (riders: Array<{ userId: string; userName: string; lat: number; lng: number; lastUpdated: number }>) => void
): () => void {
  const presenceRef = ref(rtdb, `riderPresence`)
  const unsub = onValue(presenceRef, (snapshot) => {
    const data = snapshot.val() ?? {}
    const FIVE_MIN = 5 * 60 * 1000
    const riders = Object.values(data as Record<string, any>)
      .filter((r: any) => r?.lat && r?.lng && Date.now() - r.lastUpdated < FIVE_MIN)
    callback(riders as Array<{ userId: string; userName: string; lat: number; lng: number; lastUpdated: number }>)
  })
  return () => unsub()
}

// ─── SERVICES ─────────────────────────────────────────────────────────────────

export async function seedTestService(): Promise<void> {
  try {
    const q = query(collection(db, 'services'), where('name', '==', 'Mecânica Mauricio'))
    const snap = await getDocs(q)
    if (!snap.empty) return
    await addDoc(collection(db, 'services'), {
      name: 'Mecânica Mauricio',
      type: 'mechanic',
      vehicle: 'both',
      phone: '+353830923481',
      area: 'Dublin City Centre',
      description: 'Reparação de bicicletas e motos. Serviço de emergência 24h.',
      rating: 5.0,
      responseTime: '~10 min',
      status: 'approved',
      ownerId: 'kXNpNTLYe5P55PhI8K4VrZSahOC2',
      available: true,
      createdAt: serverTimestamp(),
    })
    console.log('[Services] Seeded Mecânica Mauricio')
  } catch (e) {
    console.warn('[Services] Seed failed:', e)
  }
}

export async function getOwnedService(userId: string): Promise<{ id: string } | null> {
  try {
    const q = query(collection(db, 'services'), where('ownerId', '==', userId))
    const snap = await getDocs(q)
    const approved = snap.docs.find(d => d.data().status === 'approved')
    if (!approved) return null
    return { id: approved.id }
  } catch {
    return null
  }
}

export function publishServicePresence(serviceId: string, userId: string): void {
  set(ref(rtdb, `servicePresence/${serviceId}`), {
    online: true,
    userId,
    lastSeen: Date.now(),
  })
}

export function clearServicePresence(serviceId: string): void {
  set(ref(rtdb, `servicePresence/${serviceId}`), { online: false })
}

export function subscribeToGroupAlerts(
  groupId: string,
  callback: (alerts: Alert[]) => void
): () => void {
  const cutoff = new Date()
  cutoff.setHours(cutoff.getHours() - 1)

  const q = query(
    collection(db, 'alerts'),
    where('groupId', '==', groupId),
    where('timestamp', '>=', Timestamp.fromDate(cutoff)),
    orderBy('timestamp', 'desc')
  )

  return onSnapshot(q, (snap) => {
    const alerts: Alert[] = snap.docs.map((d) => {
      const data = d.data()
      return {
        id: d.id,
        groupId: data.groupId,
        userId: data.userId,
        userName: data.userName,
        location: data.location,
        timestamp: data.timestamp?.toDate() ?? new Date(),
        type: 'emergency',
        message: data.message,
      }
    })
    callback(alerts)
  })
}

// ─── SERVICE PROVIDERS ───────────────────────────────────────────────────────

export interface ServiceProvider {
  id: string
  name: string
  lat: number
  lng: number
  serviceType: string
  status: 'pending' | 'approved' | 'rejected'
  requestedBy: string
  contact: string
  needsRealCoords?: boolean
  createdAt?: Date
}

export async function requestServiceProvider(data: Omit<ServiceProvider, 'id' | 'status' | 'createdAt'>): Promise<void> {
  await addDoc(collection(db, 'service_providers'), {
    ...data,
    status: 'pending',
    createdAt: serverTimestamp(),
  })
}

export async function getApprovedServiceProviders(): Promise<ServiceProvider[]> {
  const q = query(collection(db, 'service_providers'), where('status', '==', 'approved'))
  const snap = await getDocs(q)
  return snap.docs.map(d => ({ id: d.id, ...d.data() } as ServiceProvider))
}

export async function approveServiceProvider(id: string): Promise<void> {
  await updateDoc(doc(db, 'service_providers', id), { status: 'approved', approvedAt: serverTimestamp() })
}

export async function rejectServiceProvider(id: string): Promise<void> {
  await updateDoc(doc(db, 'service_providers', id), { status: 'rejected' })
}

// Spire (Dublin city centre) used as placeholder for providers without verified coords
const SPIRE = { lat: 53.3498, lng: -6.2603 }

export async function seedServiceProviders(): Promise<void> {
  const snap = await getDocs(collection(db, 'service_providers'))
  if (snap.size > 0) return
  const providers: Omit<ServiceProvider, 'id' | 'createdAt'>[] = [
    {
      name: 'Spire Bikes',
      ...SPIRE,
      serviceType: 'Reparação e venda de e-bikes',
      status: 'approved',
      requestedBy: 'admin',
      contact: 'Dublin City Centre',
      needsRealCoords: false,
    },
    {
      name: '7 Bikes',
      ...SPIRE,
      serviceType: 'Reparação de bicicletas e e-bikes',
      status: 'approved',
      requestedBy: 'admin',
      contact: 'Dublin',
      needsRealCoords: true,
    },
    {
      name: 'E-Bike House',
      ...SPIRE,
      serviceType: 'Venda e reparação de e-bikes',
      status: 'approved',
      requestedBy: 'admin',
      contact: 'Dublin',
      needsRealCoords: true,
    },
  ]
  for (const p of providers) {
    await addDoc(collection(db, 'service_providers'), { ...p, createdAt: serverTimestamp() })
  }
}

// Coordinates obtained via Mapbox Geocoding API on 2026-05-29
// checkCoords: true = precision is district-level only or Eircode discrepancy noted
export async function migrateServiceProvidersV2(): Promise<void> {
  const FLAG = 'sp_v2_2026_05_29'
  const flagRef = doc(db, 'migrations', FLAG)
  const flagSnap = await getDoc(flagRef)
  if (flagSnap.exists()) return  // already migrated

  // Delete ALL existing service_providers (removes placeholders + old incorrect data)
  const existingSnap = await getDocs(collection(db, 'service_providers'))
  for (const d of existingSnap.docs) {
    await deleteDoc(d.ref)
  }

  const providers = [
    {
      name: 'Seven eBike',
      lat: 53.35012,
      lng: -6.261801,
      address: '10 Henry Pl, North City, Dublin',
      eircode: 'D01 WD50',
      serviceType: 'ebike_shop',
      status: 'approved',
      requestedBy: 'admin',
      contact: 'D01 WD50',
      needsRealCoords: false,
      checkCoords: false,
    },
    {
      name: 'E-Bike House',
      lat: 53.356418,
      lng: -6.265522,
      address: '1c Blessington Ct, Phibsborough, Dublin',
      eircode: 'D07 FK70',
      serviceType: 'ebike_shop',
      status: 'approved',
      requestedBy: 'admin',
      contact: 'D07 FK70',
      needsRealCoords: false,
      checkCoords: true,  // Eircode discrepancy: public sources show FKC7, owner confirmed FK70
    },
    {
      name: 'Edim Bikes',
      lat: 53.343354,
      lng: -6.275082,
      address: 'Dublin 8',
      eircode: 'D08 N620',
      serviceType: 'bike_shop',
      status: 'approved',
      requestedBy: 'admin',
      contact: 'D08 N620',
      needsRealCoords: false,
      checkCoords: true,  // Geocoding returned district-level only (D08); specific address not verified
    },
    {
      name: "Gaucho's Shop",
      lat: 53.349819,
      lng: -6.260128,
      address: 'Dublin 1',
      eircode: 'D01 X5K7',
      serviceType: 'bike_shop',
      status: 'approved',
      requestedBy: 'admin',
      contact: 'D01 X5K7',
      needsRealCoords: false,
      checkCoords: true,  // Geocoding returned district-level only (D01); specific address not verified
    },
  ]

  for (const p of providers) {
    await addDoc(collection(db, 'service_providers'), { ...p, createdAt: serverTimestamp() })
  }

  await setDoc(flagRef, { completedAt: serverTimestamp(), version: FLAG })
}

// Stamps source: 'admin_manual' + isPermanent: true on any risk_zone that looks manual but is missing the field.
// Prevents stale zones without source from being accidentally deleted by auto-cleanup logic.
export async function migrateManualZonesSource(): Promise<void> {
  const FLAG = 'manual_zones_source_v1'
  const flagRef = doc(db, 'migrations', FLAG)
  const flagSnap = await getDoc(flagRef)
  if (flagSnap.exists()) return

  const snap = await getDocs(collection(db, 'risk_zones'))
  for (const d of snap.docs) {
    const data = d.data()
    // A zone is considered manual if: no source, OR zoneType is 'manual', OR isPermanent is true, OR ID starts with MANUAL-
    const looksManual =
      !data.source ||
      data.zoneType === 'manual' ||
      data.isPermanent === true ||
      d.id.startsWith('MANUAL-')
    if (looksManual && data.source !== 'auto_clustering' && data.zoneType !== 'auto') {
      await updateDoc(d.ref, {
        source: 'admin_manual',
        isPermanent: true,
        canBeRemovedByReports: false,
      })
    }
  }

  await setDoc(flagRef, { completedAt: serverTimestamp(), version: FLAG })
}

// Coordinates updated via Mapbox Geocoding API on 2026-05-29 (pass 2 — more precise addresses)
export async function migrateServiceProvidersV3(): Promise<void> {
  const FLAG = 'sp_v3_2026_05_29'
  const flagRef = doc(db, 'migrations', FLAG)
  const flagSnap = await getDoc(flagRef)
  if (flagSnap.exists()) return

  const updates: { name: string; lat: number; lng: number; address: string; eircode: string; checkCoords: boolean }[] = [
    {
      name: 'Seven eBike',
      lat: 53.35012,
      lng: -6.261801,
      address: '10 Henry Place, North City, Dublin 1',
      eircode: 'D01 WD50',
      checkCoords: true, // Relevance 0.833, specific address confirmed but side-of-street not guaranteed
    },
    {
      name: 'Edim Bikes',
      lat: 53.330966,
      lng: -6.270813,
      address: '34 Avenue Road, Portobello, Dublin 8',
      eircode: 'D08 N620',
      checkCoords: false, // Relevance 0.787, "34 Avenue Road, Dublin, D08 N620" — precise match
    },
    {
      name: "Gaucho's Shop",
      lat: 53.348873,
      lng: -6.258953,
      address: '15 Sackville Place, North City, Dublin 1',
      eircode: 'D01 X5K7',
      checkCoords: false, // Relevance 0.694, "15 Sackville Place, Dublin, D01 X5K7" — specific match
    },
  ]

  for (const u of updates) {
    const snap = await getDocs(query(collection(db, 'service_providers'), where('name', '==', u.name)))
    for (const d of snap.docs) {
      await updateDoc(d.ref, {
        lat: u.lat,
        lng: u.lng,
        address: u.address,
        eircode: u.eircode,
        checkCoords: u.checkCoords,
        needsRealCoords: false,
      })
    }
  }

  await setDoc(flagRef, { completedAt: serverTimestamp(), version: FLAG })
}

// ─── PARTNERS ────────────────────────────────────────────────────────────────

export interface Partner {
  id: string
  name: string
  lat?: number
  lng?: number
  offer: string
  category: string
  description?: string
  emoji?: string
  color?: string
  mapboxQuery?: string  // when set, locations are fetched dynamically from Mapbox
}

export async function getPartners(): Promise<Partner[]> {
  const snap = await getDocs(collection(db, 'partners'))
  return snap.docs.map(d => ({ id: d.id, ...d.data() } as Partner))
}

export async function seedPartners(): Promise<void> {
  const snap = await getDocs(collection(db, 'partners'))

  const newDefaults = [
    {
      name: "McDonald's",
      offer: 'Refeição grátis com survey (mcdfoodforthoughts.com)',
      category: 'food',
      description: 'Completa o survey em mcdfoodforthoughts.com e recebe código para refeição grátis (Glasnevin, Drumcondra, Wexford St).',
      emoji: '🍟',
      color: '#ef4444',
      mapboxQuery: "McDonald's",
    },
    {
      name: 'Yeeros',
      offer: '15% OFF para riders ZIVO',
      category: 'food',
      description: 'Desconto exclusivo para riders. Mostra o teu Rider ID no balcão ou cola ao encomendar online.',
      emoji: '🥙',
      color: '#f59e0b',
      mapboxQuery: 'Yeeros',
    },
  ]

  if (snap.size === 0) {
    // Fresh seed
    for (const p of newDefaults) {
      await addDoc(collection(db, 'partners'), { ...p, createdAt: serverTimestamp() })
    }
    return
  }

  // Migrate existing records that don't yet have mapboxQuery
  for (const d of snap.docs) {
    const data = d.data()
    if (!data.mapboxQuery) {
      const name: string = data.name ?? ''
      const match = newDefaults.find(nd =>
        name.toLowerCase().includes(nd.name.toLowerCase().split("'")[0].toLowerCase())
      )
      if (match) {
        await updateDoc(d.ref, {
          mapboxQuery: match.mapboxQuery,
          offer: match.offer,
          lat: null,
          lng: null,
        })
      }
    }
  }
}
