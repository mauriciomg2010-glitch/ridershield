// src/components/Services/MechanicAlertOverlay.tsx
'use client'
import { useState, useEffect, useRef } from 'react'
import {
  collection, query, where, onSnapshot, updateDoc, doc, serverTimestamp,
} from 'firebase/firestore'
import { ref, onValue, set } from 'firebase/database'
import { db, rtdb } from '@/lib/firebase'
import { useStore } from '@/lib/store'
import toast from 'react-hot-toast'

const REQUEST_TYPE_LABELS: Record<string, string> = {
  mechanic_local:    '🔧 Avaria / Manutenção',
  mechanic_workshop: '🏭 Preciso de oficina',
  rescue:            '🚐 Resgate com van',
  accident:          '🚨 Acidente',
}

interface AlertData {
  requestId: string
  riderName: string
  type: string
  description: string
  lat: number | null
  lng: number | null
  timestamp: number
}

interface Props {
  onNavigate: (tab: string) => void
}

function haversineKm(lat1: number, lng1: number, lat2: number, lng2: number): number {
  const R = 6371
  const dLat = (lat2 - lat1) * Math.PI / 180
  const dLon = (lng2 - lng1) * Math.PI / 180
  const a = Math.sin(dLat / 2) ** 2 + Math.cos(lat1 * Math.PI / 180) * Math.cos(lat2 * Math.PI / 180) * Math.sin(dLon / 2) ** 2
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a))
}

export default function MechanicAlertOverlay({ onNavigate }: Props) {
  const user = useStore((s) => s.user)
  const currentLocation = useStore((s) => s.currentLocation)
  const [myServiceId, setMyServiceId] = useState<string | null>(null)
  const isAvailableRef = useRef(false)
  const [alert, setAlert] = useState<AlertData | null>(null)
  const [accepting, setAccepting] = useState(false)
  const audioCtxRef = useRef<AudioContext | null>(null)
  const bipIntervalRef = useRef<ReturnType<typeof setInterval> | null>(null)

  function playBip() {
    try {
      if (!audioCtxRef.current) {
        audioCtxRef.current = new (window.AudioContext || (window as any).webkitAudioContext)()
      }
      const ctx = audioCtxRef.current
      if (ctx.state === 'suspended') ctx.resume().catch(() => {})
      const osc = ctx.createOscillator()
      const gain = ctx.createGain()
      osc.connect(gain)
      gain.connect(ctx.destination)
      osc.frequency.value = 880
      osc.type = 'sine'
      gain.gain.setValueAtTime(0.6, ctx.currentTime)
      gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + 0.15)
      osc.start(ctx.currentTime)
      osc.stop(ctx.currentTime + 0.15)
    } catch {}
  }

  function startBip() {
    playBip()
    bipIntervalRef.current = setInterval(playBip, 800)
  }

  function stopBip() {
    if (bipIntervalRef.current) { clearInterval(bipIntervalRef.current); bipIntervalRef.current = null }
    if (audioCtxRef.current) { audioCtxRef.current.close().catch(() => {}); audioCtxRef.current = null }
  }

  // Subscribe to user's approved service to get ID + availability
  useEffect(() => {
    if (!user?.id) return
    const q = query(
      collection(db, 'services'),
      where('ownerId', '==', user.id),
      where('status', '==', 'approved')
    )
    const unsub = onSnapshot(q, (snap) => {
      if (snap.empty) {
        setMyServiceId(null)
        isAvailableRef.current = false
        return
      }
      const svc = snap.docs[0]
      setMyServiceId(svc.id)
      isAvailableRef.current = svc.data().available === true
    }, () => {})
    return () => unsub()
  }, [user?.id])

  // Subscribe to RTDB alert node for this service
  useEffect(() => {
    if (!myServiceId) return
    const alertRef = ref(rtdb, `serviceAlerts/${myServiceId}/request`)
    const unsub = onValue(alertRef, (snap) => {
      const data = snap.val()
      if (!data?.active) { setAlert(null); return }
      if (data.timestamp < Date.now() - 30000) { setAlert(null); return }
      if (data.riderId === user?.id) { setAlert(null); return }
      setAlert({
        requestId: data.requestId ?? '',
        riderName: data.riderName ?? 'Rider',
        type: data.requestType ?? '',
        description: data.description ?? '',
        lat: data.lat ?? null,
        lng: data.lng ?? null,
        timestamp: data.timestamp,
      })
      if (isAvailableRef.current) {
        startBip()
        navigator.vibrate?.([500, 200, 500, 200, 500])
      }
    })
    return () => unsub()
  }, [myServiceId, user?.id])

  useEffect(() => { return () => stopBip() }, [])

  async function handleAccept() {
    if (!alert || !user?.id || !myServiceId) return
    setAccepting(true)
    stopBip()
    try {
      await set(ref(rtdb, `serviceAlerts/${myServiceId}/request`), { active: false })
      if (alert.requestId) {
        await updateDoc(doc(db, 'helpRequests', alert.requestId), {
          status: 'accepted',
          respondedBy: user.id,
          respondedAt: serverTimestamp(),
        })
      }
      setAlert(null)
      toast.success('✅ Pedido aceite!')
      onNavigate('my-services')
    } catch {
      toast.error('Erro ao aceitar pedido')
    } finally {
      setAccepting(false)
    }
  }

  function handleIgnore() {
    stopBip()
    if (myServiceId) {
      set(ref(rtdb, `serviceAlerts/${myServiceId}/request`), { active: false }).catch(() => {})
    }
    setAlert(null)
  }

  if (!alert) return null

  const distKm = alert.lat && alert.lng && currentLocation
    ? haversineKm(currentLocation.lat, currentLocation.lng, alert.lat, alert.lng).toFixed(1)
    : null

  return (
    <>
      <style>{`
        @keyframes mechRedPulse {
          0%, 100% { background: #7f1d1d; }
          50% { background: #dc2626; }
        }
      `}</style>
      <div style={{
        position: 'fixed', inset: 0, zIndex: 9000,
        display: 'flex', flexDirection: 'column',
        alignItems: 'center', justifyContent: 'center',
        padding: '24px 20px',
        animation: 'mechRedPulse 0.8s ease-in-out infinite',
      }}>
        <p style={{ fontSize: 56, textAlign: 'center', marginBottom: 12 }}>🆘</p>
        <p style={{ fontSize: 28, fontWeight: 900, color: 'white', textAlign: 'center', marginBottom: 12, letterSpacing: 1 }}>
          PEDIDO DE AJUDA
        </p>
        <p style={{ fontSize: 18, fontWeight: 700, color: 'white', textAlign: 'center', marginBottom: 6 }}>
          🏍️ {alert.riderName}
        </p>
        <p style={{ fontSize: 18, fontWeight: 600, color: 'rgba(255,255,255,0.85)', textAlign: 'center', marginBottom: 6 }}>
          {REQUEST_TYPE_LABELS[alert.type] ?? alert.type}
        </p>
        {alert.description ? (
          <p style={{ fontSize: 14, color: 'rgba(255,255,255,0.7)', textAlign: 'center', marginBottom: 8 }}>
            {alert.description}
          </p>
        ) : null}
        {distKm ? (
          <p style={{ fontSize: 14, color: 'rgba(255,255,255,0.7)', textAlign: 'center', marginBottom: 28 }}>
            📍 {distKm} km de distância
          </p>
        ) : alert.lat && alert.lng ? (
          <p style={{ fontSize: 14, color: 'rgba(255,255,255,0.7)', textAlign: 'center', marginBottom: 28 }}>
            📍 {alert.lat.toFixed(4)}, {alert.lng.toFixed(4)}
          </p>
        ) : (
          <div style={{ marginBottom: 28 }} />
        )}
        <div style={{ display: 'flex', gap: 12, width: '100%', maxWidth: 360 }}>
          <button
            onClick={handleIgnore}
            style={{
              flex: 1, padding: '18px', borderRadius: 14,
              background: 'rgba(0,0,0,0.35)',
              border: '1px solid rgba(255,255,255,0.25)',
              color: 'white', fontSize: 16, fontWeight: 700, cursor: 'pointer',
            }}
          >
            ❌ Ignorar
          </button>
          <button
            onClick={handleAccept}
            disabled={accepting}
            style={{
              flex: 1, padding: '18px', borderRadius: 14,
              background: accepting ? 'rgba(34,197,94,0.3)' : 'rgba(34,197,94,0.5)',
              border: '2px solid rgba(34,197,94,0.8)',
              color: 'white', fontSize: 16, fontWeight: 700,
              cursor: accepting ? 'not-allowed' : 'pointer',
              opacity: accepting ? 0.7 : 1,
            }}
          >
            {accepting ? 'A aceitar…' : '✅ Aceitar'}
          </button>
        </div>
      </div>
    </>
  )
}
