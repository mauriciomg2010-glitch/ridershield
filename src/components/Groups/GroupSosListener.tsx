'use client'
// Ouve o SOS de TODOS os grupos do usuário, em qualquer tela do app.
//  • Toca o alarme quando chega um SOS novo (até 30 min).
//  • "Silenciar" só cala o som — o aviso FICA no ecrã (barra vermelha) até quem pediu ajuda
//    encerrar o chamado. Sair do grupo, trocar de aba ou fechar o app não apaga o aviso.
//  • "Ver no mapa" abre o mapa no ponto do amigo (posição ao vivo do grupo) pronto a navegar.
import { useEffect, useRef, useState } from 'react'
import { ref as rtdbRef, onValue } from 'firebase/database'
import { rtdb } from '@/lib/firebase'
import { useStore } from '@/lib/store'
import { subscribeToUserGroups } from '@/lib/firestore'
import { ensureAudioUnlocked, playEmergencySound, stopEmergencySound, vibrateEmergency } from '@/lib/emergencySound'
import { diag } from '@/lib/diagnostics'

const RING_MS = 30 * 60 * 1000          // só toca se o SOS for recente
const KEEP_MS = 12 * 60 * 60 * 1000     // aviso fica até 12 h (ou até o amigo encerrar)
const SILENCED_KEY = 'zivo_sos_silenced'

interface Sos {
  id: string; groupId: string; groupName: string; userId: string; userName: string
  timestamp: number; lat?: number; lng?: number
}

// compatibilidade com o GroupDetail (que ainda marca alertas dispensados)
export const dismissedSosIds = new Set<string>()

function lerSilenciados(): Set<string> {
  try { return new Set(JSON.parse(localStorage.getItem(SILENCED_KEY) ?? '[]')) } catch { return new Set() }
}
function gravarSilenciado(id: string) {
  try {
    const s = lerSilenciados(); s.add(id)
    localStorage.setItem(SILENCED_KEY, JSON.stringify([...s].slice(-50)))
  } catch {}
}

/** Silenciar um SOS a partir de outro ecrã (ex.: dentro do grupo). */
export function silenciarSosId(id: string) {
  gravarSilenciado(id)
  try { window.dispatchEvent(new Event('zivo-sos-silenced')) } catch {}
}

function haQuanto(ts: number) {
  const m = Math.max(1, Math.round((Date.now() - ts) / 60000))
  return m < 60 ? `há ${m} min` : `há ${Math.round(m / 60)} h`
}

/** Aviso falado uma vez (durante a navegação não toca a sirene, que atrapalha a condução). */
function falarAlerta(texto: string) {
  try {
    const ss = window.speechSynthesis
    if (!ss) return
    const u = new SpeechSynthesisUtterance(texto)
    u.lang = 'pt-BR'; u.rate = 1; u.volume = 1
    ss.speak(u)
  } catch {}
}

export default function GroupSosListener({ onOpenGroups, onShowOnMap, navegando = false, onIrAjudar }: {
  /** o rider está a navegar: alerta discreto (voz 1×, vibração, cartão) em vez da sirene */
  navegando?: boolean
  /** troca o destino da navegação para a posição do amigo */
  onIrAjudar?: (p: { lat: number; lng: number }) => void
  onOpenGroups?: () => void
  onShowOnMap?: (p: { lat: number; lng: number }) => void
}) {
  const user = useStore(s => s.user)
  const [groups, setGroups] = useState<Array<{ id: string; name: string }>>([])
  const [alerts, setAlerts] = useState<Record<string, Sos>>({})          // por grupo
  const [silenced, setSilenced] = useState<Set<string>>(() => (typeof window === 'undefined' ? new Set() : lerSilenciados()))
  const [livePos, setLivePos] = useState<Record<string, { lat: number; lng: number }>>({})
  const ringingRef = useRef<string | null>(null)
  const [, tick] = useState(0)

  useEffect(() => {
    if (!user?.id) { setGroups([]); return }
    return subscribeToUserGroups(user.id, gs => setGroups(gs.map(g => ({ id: g.id, name: g.name }))))
  }, [user?.id])

  const groupKey = groups.map(g => g.id).sort().join(',')
  useEffect(() => {
    if (!user?.id || !groups.length) return
    const unsubs = groups.map(g => onValue(rtdbRef(rtdb, `groupAlerts/${g.id}/sos`), snap => {
      const d = snap.val()
      setAlerts(prev => {
        const next = { ...prev }
        if (!d || !d.active || d.userId === user.id || !d.timestamp || Date.now() - d.timestamp > KEEP_MS) {
          if (next[g.id]) diag('sos', { fase: 'encerrado', grupo: g.id })
          delete next[g.id]
        } else {
          next[g.id] = {
            id: `${g.id}_${d.userId}_${d.timestamp}`, groupId: g.id, groupName: g.name,
            userId: d.userId, userName: d.userName ?? 'Membro do grupo', timestamp: d.timestamp,
            lat: typeof d.lat === 'number' ? d.lat : undefined, lng: typeof d.lng === 'number' ? d.lng : undefined,
          }
        }
        return next
      })
    }, () => { /* sem permissão / offline: não derruba o app */ }))
    return () => unsubs.forEach(u => u())
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [user?.id, groupKey])

  // posição ao vivo de quem pediu ajuda (partilha do grupo)
  const alertKey = Object.values(alerts).map(a => `${a.groupId}/${a.userId}`).sort().join(',')
  useEffect(() => {
    const list = Object.values(alerts)
    const unsubs = list.map(a => onValue(rtdbRef(rtdb, `groupLocations/${a.groupId}/${a.userId}`), snap => {
      const v = snap.val()
      if (v && Number.isFinite(v.lat) && Number.isFinite(v.lng)) setLivePos(p => ({ ...p, [a.id]: { lat: v.lat, lng: v.lng } }))
    }, () => {}))
    return () => unsubs.forEach(u => u())
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [alertKey])

  // som: toca enquanto houver um SOS recente não silenciado
  const lista = Object.values(alerts).sort((a, b) => b.timestamp - a.timestamp)
  const tocando = lista.find(a => !silenced.has(a.id) && !dismissedSosIds.has(a.id) && Date.now() - a.timestamp < RING_MS) ?? null
  const [adiados, setAdiados] = useState<Set<string>>(new Set())   // "Depois da entrega" (só durante a navegação)
  const faladoRef = useRef<string | null>(null)
  useEffect(() => {
    if (tocando && navegando) {
      // a navegar: sem sirene. Voz uma vez + vibração; o cartão vermelho fica no ecrã
      if (ringingRef.current) { ringingRef.current = null; stopEmergencySound() }
      if (faladoRef.current !== tocando.id) {
        faladoRef.current = tocando.id
        diag('sos', { fase: 'aviso-navegacao', de: tocando.userName })
        try { navigator.vibrate?.([400, 150, 400, 150, 400]) } catch {}
        falarAlerta(`Alerta do grupo. ${tocando.userName} precisa de ajuda.`)
      }
    } else if (tocando && ringingRef.current !== tocando.id) {
      // fora da navegação (ou acabou a entrega e o pedido continua ativo): alarme completo
      ringingRef.current = tocando.id
      diag('sos', { fase: 'tocar', de: tocando.userName })
      ensureAudioUnlocked().catch(() => {}).finally(() => { playEmergencySound(); vibrateEmergency() })
    } else if (!tocando && ringingRef.current) {
      ringingRef.current = null
      stopEmergencySound()
    }
  }, [tocando?.id, navegando])  // eslint-disable-line react-hooks/exhaustive-deps
  // ao acabar a navegação, os pedidos adiados voltam a aparecer em grande
  useEffect(() => { if (!navegando) setAdiados(new Set()) }, [navegando])

  useEffect(() => { const t = setInterval(() => tick(x => x + 1), 30_000); return () => clearInterval(t) }, [])
  useEffect(() => {
    const f = () => setSilenced(lerSilenciados())
    window.addEventListener('zivo-sos-silenced', f)
    return () => window.removeEventListener('zivo-sos-silenced', f)
  }, [])
  useEffect(() => () => stopEmergencySound(), [])

  if (!lista.length) return null

  const silenciar = (a: Sos) => {
    gravarSilenciado(a.id)
    setSilenced(s => new Set(s).add(a.id))
    diag('sos', { fase: 'silenciado', de: a.userName })
  }
  const posDe = (a: Sos) => livePos[a.id] ?? (a.lat != null && a.lng != null ? { lat: a.lat, lng: a.lng } : null)
  const verNoMapa = (a: Sos) => {
    const p = posDe(a)
    if (p && onShowOnMap) onShowOnMap(p)
    else onOpenGroups?.()
  }

  // ── a navegar: cartão vermelho por cima da barra de baixo (não tapa a próxima manobra) ──
  if (navegando && tocando && !adiados.has(tocando.id)) {
    const p = posDe(tocando)
    return (
      <div style={{ position: 'fixed', left: 10, right: 10, bottom: 'calc(100px + env(safe-area-inset-bottom, 0px))', zIndex: 3000, background: '#b91c1c', color: 'white', borderRadius: 16, padding: '12px 14px', boxShadow: '0 8px 26px rgba(0,0,0,0.45)', animation: 'sosPulse 1.2s ease-in-out infinite' }}>
        <style>{`@keyframes sosPulse{0%,100%{box-shadow:0 0 0 0 rgba(239,68,68,.7)}50%{box-shadow:0 0 0 10px rgba(239,68,68,0)}}`}</style>
        <div style={{ fontWeight: 900, fontSize: 16 }}>🚨 {tocando.userName} precisa de ajuda</div>
        <div style={{ fontSize: 12, opacity: 0.9, marginTop: 2 }}>grupo {tocando.groupName} · {haQuanto(tocando.timestamp)}</div>
        <div style={{ display: 'flex', gap: 8, marginTop: 10 }}>
          {p && onIrAjudar && (
            <button onClick={() => { silenciar(tocando); diag('sos', { fase: 'ir-ajudar', de: tocando.userName }); onIrAjudar(p) }}
              style={{ flex: 1.2, background: 'white', color: '#b91c1c', border: 'none', borderRadius: 11, padding: '10px 0', fontWeight: 900, fontSize: 14 }}>
              🧭 Ir ajudar
            </button>
          )}
          <button onClick={() => { setAdiados(s => new Set(s).add(tocando.id)); diag('sos', { fase: 'depois-da-entrega', de: tocando.userName }) }}
            style={{ flex: 1, background: 'rgba(255,255,255,0.18)', color: 'white', border: '1px solid rgba(255,255,255,0.6)', borderRadius: 11, padding: '10px 0', fontWeight: 800, fontSize: 14 }}>
            Depois da entrega
          </button>
        </div>
      </div>
    )
  }

  // ── a navegar e adiado: etiqueta vermelha pequena (lembra sem atrapalhar) ──
  if (navegando) {
    const a = lista[0]
    return (
      <div style={{ position: 'fixed', left: 12, bottom: 'calc(100px + env(safe-area-inset-bottom, 0px))', zIndex: 2999, background: '#b91c1c', color: 'white', borderRadius: 20, padding: '6px 12px', fontSize: 12, fontWeight: 800, boxShadow: '0 3px 10px rgba(0,0,0,0.35)', pointerEvents: 'none' }}>
        🚨 {a.userName} precisa de ajuda{lista.length > 1 ? ` (+${lista.length - 1})` : ''}
      </div>
    )
  }

  // ── alarme a tocar: cartão grande ──
  if (tocando) {
    const p = posDe(tocando)
    return (
      <div style={{ position: 'fixed', left: 12, right: 12, top: 'calc(12px + env(safe-area-inset-top, 0px))', zIndex: 3000, background: '#b91c1c', color: 'white', borderRadius: 18, padding: '16px', boxShadow: '0 8px 30px rgba(0,0,0,0.5)', animation: 'sosPulse 1.2s ease-in-out infinite' }}>
        <style>{`@keyframes sosPulse{0%,100%{box-shadow:0 0 0 0 rgba(239,68,68,.7)}50%{box-shadow:0 0 0 10px rgba(239,68,68,0)}}`}</style>
        <div style={{ fontWeight: 900, fontSize: 18 }}>🚨 {tocando.userName} precisa de ajuda</div>
        <div style={{ fontSize: 13, opacity: 0.9, marginTop: 3 }}>grupo {tocando.groupName} · {haQuanto(tocando.timestamp)}</div>
        <div style={{ display: 'flex', gap: 8, marginTop: 12 }}>
          <button onClick={() => { silenciar(tocando); verNoMapa(tocando) }}
            style={{ flex: 1.3, background: 'white', color: '#b91c1c', border: 'none', borderRadius: 12, padding: '12px 0', fontWeight: 900, fontSize: 15 }}>
            📍 {p ? 'Ver no mapa' : 'Abrir grupo'}
          </button>
          <button onClick={() => silenciar(tocando)}
            style={{ flex: 1, background: 'rgba(255,255,255,0.18)', color: 'white', border: '1px solid rgba(255,255,255,0.6)', borderRadius: 12, padding: '12px 0', fontWeight: 800, fontSize: 15 }}>
            🔕 Silenciar
          </button>
        </div>
        <div style={{ fontSize: 11, opacity: 0.85, marginTop: 8 }}>Silenciar só cala o som — o aviso fica até {tocando.userName} encerrar o pedido.</div>
      </div>
    )
  }

  // ── silenciado: barra fina persistente (não deixa esquecer o amigo) ──
  const a = lista[0]
  return (
    <button onClick={() => verNoMapa(a)}
      style={{ position: 'fixed', left: 10, right: 10, top: 'calc(6px + env(safe-area-inset-top, 0px))', zIndex: 2999, background: '#b91c1c', color: 'white', border: 'none', borderRadius: 12, padding: '8px 12px', display: 'flex', alignItems: 'center', gap: 8, boxShadow: '0 4px 14px rgba(0,0,0,0.35)', textAlign: 'left' }}>
      <span style={{ fontSize: 16 }}>🚨</span>
      <span style={{ flex: 1, fontSize: 13, fontWeight: 700 }}>
        {a.userName} precisa de ajuda{lista.length > 1 ? ` (+${lista.length - 1})` : ''} · {haQuanto(a.timestamp)}
      </span>
      <span style={{ fontSize: 12, fontWeight: 800, background: 'white', color: '#b91c1c', borderRadius: 8, padding: '4px 8px' }}>Ver no mapa</span>
    </button>
  )
}
