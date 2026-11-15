'use client'
// Ouve o SOS de TODOS os grupos do usuário, em qualquer tela do app (mapa, navegação, abas).
// Antes o alarme só tocava se o membro estivesse com a tela daquele grupo aberta.
import { useEffect, useRef, useState } from 'react'
import { ref as rtdbRef, onValue } from 'firebase/database'
import { rtdb } from '@/lib/firebase'
import { useStore } from '@/lib/store'
import { subscribeToUserGroups } from '@/lib/firestore'
import { ensureAudioUnlocked, playEmergencySound, stopEmergencySound, vibrateEmergency } from '@/lib/emergencySound'

const FRESH_MS = 30 * 60 * 1000   // SOS mais antigo que isso não toca (alerta esquecido ativo)

interface Sos { id: string; groupId: string; groupName: string; userId: string; userName: string }

export const dismissedSosIds = new Set<string>()

export default function GroupSosListener({ onOpenGroups }: { onOpenGroups?: () => void }) {
  const user = useStore(s => s.user)
  const [groups, setGroups] = useState<Array<{ id: string; name: string }>>([])
  const [active, setActive] = useState<Sos | null>(null)
  const activeRef = useRef<Sos | null>(null)

  useEffect(() => {
    if (!user?.id) { setGroups([]); return }
    return subscribeToUserGroups(user.id, gs => setGroups(gs.map(g => ({ id: g.id, name: g.name }))))
  }, [user?.id])

  const groupKey = groups.map(g => g.id).sort().join(',')
  useEffect(() => {
    if (!user?.id || !groups.length) return
    const unsubs = groups.map(g => onValue(rtdbRef(rtdb, `groupAlerts/${g.id}/sos`), async snap => {
      const d = snap.val()
      const cur = activeRef.current
      if (!d || !d.active) {
        if (cur?.groupId === g.id) { activeRef.current = null; setActive(null); stopEmergencySound() }
        return
      }
      if (d.userId === user.id) return                       // o próprio SOS não toca no aparelho de quem enviou
      if (!d.timestamp || Date.now() - d.timestamp > FRESH_MS) return
      const id = `${g.id}_${d.userId}_${d.timestamp}`
      if (dismissedSosIds.has(id) || cur?.id === id) return
      const sos = { id, groupId: g.id, groupName: g.name, userId: d.userId, userName: d.userName ?? 'Membro do grupo' }
      activeRef.current = sos
      setActive(sos)
      try { await ensureAudioUnlocked() } catch {}
      playEmergencySound()
      vibrateEmergency()
    }, () => { /* sem permissão / offline: não derruba o app */ }))
    return () => unsubs.forEach(u => u())
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [user?.id, groupKey])

  useEffect(() => () => stopEmergencySound(), [])

  if (!active) return null
  const dismiss = () => { dismissedSosIds.add(active.id); activeRef.current = null; setActive(null); stopEmergencySound() }
  return (
    <div style={{ position: 'fixed', left: 12, right: 12, top: 'calc(12px + env(safe-area-inset-top, 0px))', zIndex: 3000, background: '#b91c1c', color: 'white', borderRadius: 16, padding: '14px 16px', boxShadow: '0 8px 30px rgba(0,0,0,0.5)', animation: 'zoneAlertPulse 1.2s ease-in-out infinite' }}>
      <style>{`@keyframes zoneAlertPulse{0%,100%{box-shadow:0 0 0 0 rgba(239,68,68,.7)}50%{box-shadow:0 0 0 10px rgba(239,68,68,0)}}`}</style>
      <div style={{ fontWeight: 900, fontSize: 16 }}>🚨 EMERGÊNCIA — {active.userName}</div>
      <div style={{ fontSize: 13, opacity: 0.9, marginTop: 2 }}>precisa de ajuda · grupo {active.groupName}</div>
      <div style={{ display: 'flex', gap: 8, marginTop: 10 }}>
        <button onClick={dismiss} style={{ flex: 1, background: 'white', color: '#b91c1c', border: 'none', borderRadius: 10, padding: '10px 0', fontWeight: 800 }}>Parar alarme</button>
        {onOpenGroups && <button onClick={() => { dismiss(); onOpenGroups() }} style={{ flex: 1, background: 'rgba(255,255,255,0.2)', color: 'white', border: '1px solid rgba(255,255,255,0.5)', borderRadius: 10, padding: '10px 0', fontWeight: 800 }}>Abrir grupo</button>}
      </div>
    </div>
  )
}
