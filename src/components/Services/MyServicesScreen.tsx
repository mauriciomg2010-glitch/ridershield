// src/components/Services/MyServicesScreen.tsx
'use client'
import { useState, useEffect } from 'react'
import {
  collection, query, where, onSnapshot, doc, updateDoc, increment,
} from 'firebase/firestore'
import { db } from '@/lib/firebase'
import { useStore } from '@/lib/store'
import { stopEmergencySound } from '@/lib/emergencySound'
import toast from 'react-hot-toast'

interface MyService {
  id: string
  name: string
  type: 'mechanic' | 'rescue'
  vehicle: string
  phone: string
  area: string
  description: string
  status: 'pending' | 'approved' | 'rejected'
  available: boolean
  rating: number
  completedJobs: number
}

interface AcceptedRequest {
  id: string
  riderName: string
  requestType: string
  description: string
  lat: number | null
  lng: number | null
}

interface Props {
  onBack: () => void
}

const STATUS_CONFIG = {
  pending:  { label: 'PENDENTE',  color: '#ca8a04', bg: 'rgba(234,179,8,0.15)',  border: 'rgba(234,179,8,0.3)' },
  approved: { label: 'APROVADO',  color: '#22c55e', bg: 'rgba(34,197,94,0.15)',  border: 'rgba(34,197,94,0.3)' },
  rejected: { label: 'REJEITADO', color: '#ef4444', bg: 'rgba(239,68,68,0.15)',  border: 'rgba(239,68,68,0.3)' },
}

const REQUEST_TYPE_LABELS: Record<string, string> = {
  mechanic_local:    '🔧 Avaria / Manutenção',
  mechanic_workshop: '🏭 Preciso de oficina',
  rescue:            '🚐 Resgate com van',
  accident:          '🚨 Acidente',
}

export default function MyServicesScreen({ onBack }: Props) {
  const user = useStore((s) => s.user)
  const [services, setServices] = useState<MyService[]>([])
  const [acceptedRequests, setAcceptedRequests] = useState<AcceptedRequest[]>([])
  const [toggling, setToggling] = useState<string | null>(null)
  const [completing, setCompleting] = useState<string | null>(null)

  useEffect(() => {
    if (!user?.id) return
    const q = query(collection(db, 'services'), where('ownerId', '==', user.id))
    const unsub = onSnapshot(q, (snap) => {
      setServices(
        snap.docs.map((d) => {
          const data = d.data()
          return {
            id: d.id,
            name: data.name ?? '',
            type: data.type ?? 'mechanic',
            vehicle: data.vehicle ?? 'bike',
            phone: data.phone ?? '',
            area: data.area ?? '',
            description: data.description ?? '',
            status: (data.status ?? 'pending') as MyService['status'],
            available: data.available ?? false,
            rating: data.rating ?? 0,
            completedJobs: data.completedJobs ?? 0,
          }
        })
      )
    }, () => {})
    return () => unsub()
  }, [user?.id])

  // Subscribe to accepted help requests for this user
  useEffect(() => {
    if (!user?.id) return
    const q = query(collection(db, 'helpRequests'), where('respondedBy', '==', user.id))
    const unsub = onSnapshot(q, (snap) => {
      setAcceptedRequests(
        snap.docs
          .filter((d) => d.data().status === 'accepted')
          .map((d) => {
            const data = d.data()
            return {
              id: d.id,
              riderName: data.riderName ?? 'Rider',
              requestType: data.requestType ?? data.type ?? '',
              description: data.description ?? '',
              lat: data.location?.lat ?? null,
              lng: data.location?.lng ?? null,
            }
          })
      )
    }, () => {})
    return () => unsub()
  }, [user?.id])

  async function toggleAvailability(service: MyService) {
    setToggling(service.id)
    try {
      await updateDoc(doc(db, 'services', service.id), { available: !service.available })
    } catch (e) {
      console.error('[MyServices] toggleAvailability:', e)
      toast.error('Erro ao atualizar disponibilidade')
    } finally {
      setToggling(null)
    }
  }

  async function markComplete(requestId: string) {
    const myApprovedService = services.find((s) => s.status === 'approved')
    setCompleting(requestId)
    try {
      await updateDoc(doc(db, 'helpRequests', requestId), { status: 'completed' })
      if (myApprovedService) {
        await updateDoc(doc(db, 'services', myApprovedService.id), {
          completedJobs: increment(1),
        })
      }
      stopEmergencySound()
      toast.success('✅ Serviço marcado como concluído!')
    } catch (e) {
      console.error('[MyServices] markComplete:', e)
      toast.error('Erro ao marcar como concluído')
    } finally {
      setCompleting(null)
    }
  }

  const totalCompleted = services.reduce((sum, s) => sum + s.completedJobs, 0)
  const bestRating = services.filter((s) => s.rating > 0).reduce((max, s) => Math.max(max, s.rating), 0)
  const initials = user?.name
    ? user.name.split(' ').map((w: string) => w[0]).slice(0, 2).join('').toUpperCase()
    : '?'

  return (
    <div className="flex flex-col h-full pb-20" style={{ background: 'var(--bg)' }}>
      {/* Header */}
      <div className="flex items-center gap-2 px-4 pt-14 pb-4 border-b"
        style={{ background: 'var(--surface)', borderColor: 'var(--border)' }}>
        <button onClick={onBack} className="p-2 -ml-2" style={{ color: 'var(--text)' }}>
          <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
            <polyline points="15 18 9 12 15 6" />
          </svg>
        </button>
        <h1 className="text-xl font-bold" style={{ color: 'var(--text)' }}>🔩 Os Meus Serviços</h1>
      </div>

      <div className="flex-1 overflow-y-auto px-5 py-4 space-y-4">

        {/* Profile card */}
        <div className="rounded-2xl p-4 flex items-center gap-4"
          style={{ background: 'var(--card)', border: '1px solid var(--border)' }}>
          <div style={{
            width: 56, height: 56, borderRadius: '50%', flexShrink: 0,
            background: 'linear-gradient(135deg, #7c3aed, #4f46e5)',
            display: 'flex', alignItems: 'center', justifyContent: 'center',
            color: 'white', fontSize: '20px', fontWeight: 700,
          }}>{initials}</div>
          <div className="flex-1 min-w-0">
            <p className="font-bold text-base truncate" style={{ color: 'var(--text)' }}>{user?.name}</p>
            <p className="text-xs truncate" style={{ color: 'var(--muted)' }}>{user?.email}</p>
          </div>
          <div className="text-right flex-shrink-0">
            {bestRating > 0 && (
              <p className="text-sm font-bold" style={{ color: '#fbbf24' }}>★ {bestRating.toFixed(1)}</p>
            )}
            <p className="text-xs" style={{ color: 'var(--muted)' }}>
              🔧 {totalCompleted} {totalCompleted === 1 ? 'serviço' : 'serviços'}
            </p>
          </div>
        </div>

        {/* Empty state */}
        {services.length === 0 && (
          <div className="text-center py-12">
            <p className="text-4xl mb-3">🔩</p>
            <p className="text-sm font-semibold" style={{ color: 'var(--text)' }}>Nenhum serviço registado</p>
            <p className="text-xs mt-1" style={{ color: 'var(--muted)' }}>
              Regista o teu serviço no separador Serviços
            </p>
          </div>
        )}

        {/* Service cards */}
        {services.map((service) => {
          const cfg = STATUS_CONFIG[service.status] ?? STATUS_CONFIG.pending
          return (
            <div key={service.id} className="rounded-2xl p-4"
              style={{ background: 'var(--card)', border: `1px solid ${cfg.border}` }}>

              {/* Card header */}
              <div className="flex items-start justify-between gap-2 mb-3">
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2 flex-wrap">
                    <span className="text-base">{service.type === 'mechanic' ? '🔧' : '🚑'}</span>
                    <h3 className="font-bold text-sm" style={{ color: 'var(--text)' }}>{service.name}</h3>
                  </div>
                  <p className="text-xs mt-0.5" style={{ color: 'var(--muted)' }}>
                    📍 {service.area} · 📞 {service.phone}
                  </p>
                  {service.description ? (
                    <p className="text-xs mt-0.5" style={{ color: 'var(--muted)' }}>{service.description}</p>
                  ) : null}
                </div>
                <span className="text-xs font-bold px-2 py-1 rounded-full flex-shrink-0"
                  style={{ background: cfg.bg, color: cfg.color, border: `1px solid ${cfg.border}` }}>
                  {cfg.label}
                </span>
              </div>

              {/* Stats row (approved only) */}
              {service.status === 'approved' && (
                <div className="flex gap-3 mb-3">
                  <div className="flex-1 rounded-xl p-2.5 text-center"
                    style={{ background: 'var(--surface)', border: '1px solid var(--border)' }}>
                    <p className="text-sm font-bold" style={{ color: '#fbbf24' }}>
                      {service.rating > 0 ? `★ ${service.rating.toFixed(1)}` : '—'}
                    </p>
                    <p className="text-xs" style={{ color: 'var(--muted)' }}>Nota</p>
                  </div>
                  <div className="flex-1 rounded-xl p-2.5 text-center"
                    style={{ background: 'var(--surface)', border: '1px solid var(--border)' }}>
                    <p className="text-sm font-bold" style={{ color: 'var(--text)' }}>{service.completedJobs}</p>
                    <p className="text-xs" style={{ color: 'var(--muted)' }}>Concluídos</p>
                  </div>
                  <div className="flex-1 rounded-xl p-2.5 text-center"
                    style={{ background: 'var(--surface)', border: '1px solid var(--border)' }}>
                    <p className="text-sm font-bold" style={{ color: service.available ? '#22c55e' : '#6b7280' }}>
                      {service.available ? 'Online' : 'Offline'}
                    </p>
                    <p className="text-xs" style={{ color: 'var(--muted)' }}>Estado</p>
                  </div>
                </div>
              )}

              {/* Online/offline toggle (approved) */}
              {service.status === 'approved' && (
                <div className="flex items-center justify-between rounded-xl px-4 py-3"
                  style={{ background: 'var(--surface)', border: '1px solid var(--border)' }}>
                  <div>
                    <p className="text-sm font-semibold"
                      style={{ color: service.available ? '#22c55e' : 'var(--muted)' }}>
                      {service.available ? '● Disponível para riders' : '○ Não visível para riders'}
                    </p>
                  </div>
                  <button
                    onClick={() => toggleAvailability(service)}
                    disabled={toggling === service.id}
                    className="w-12 h-6 rounded-full relative transition-colors disabled:opacity-50"
                    style={{ background: service.available ? '#22c55e' : '#6b7280', flexShrink: 0 }}>
                    <div className="w-4 h-4 bg-white rounded-full absolute top-1 transition-all shadow"
                      style={{ left: service.available ? '24px' : '4px' }} />
                  </button>
                </div>
              )}

              {service.status === 'pending' && (
                <div className="mt-1 rounded-xl px-4 py-2.5"
                  style={{ background: 'rgba(234,179,8,0.08)', border: '1px solid rgba(234,179,8,0.2)' }}>
                  <p className="text-xs" style={{ color: '#ca8a04' }}>⏳ A aguardar aprovação do admin</p>
                </div>
              )}

              {service.status === 'rejected' && (
                <div className="mt-1 rounded-xl px-4 py-2.5"
                  style={{ background: 'rgba(239,68,68,0.08)', border: '1px solid rgba(239,68,68,0.2)' }}>
                  <p className="text-xs" style={{ color: '#ef4444' }}>❌ Solicitação rejeitada</p>
                </div>
              )}
            </div>
          )
        })}

        {/* Accepted requests */}
        {acceptedRequests.length > 0 && (
          <div>
            <p className="text-xs font-semibold uppercase tracking-widest mb-2"
              style={{ color: 'var(--muted)' }}>
              Pedidos Aceites
            </p>
            <div className="space-y-2">
              {acceptedRequests.map((req) => (
                <div key={req.id} className="rounded-2xl p-4"
                  style={{ background: 'var(--card)', border: '1px solid rgba(34,197,94,0.3)' }}>
                  <div className="flex items-start justify-between gap-2 mb-3">
                    <div>
                      <p className="text-sm font-bold" style={{ color: 'var(--text)' }}>
                        🏍️ {req.riderName}
                      </p>
                      <p className="text-xs mt-0.5" style={{ color: 'var(--muted)' }}>
                        {REQUEST_TYPE_LABELS[req.requestType] ?? req.requestType}
                      </p>
                      {req.description ? (
                        <p className="text-xs mt-0.5" style={{ color: 'var(--muted)' }}>{req.description}</p>
                      ) : null}
                    </div>
                    {req.lat && req.lng && (
                      <button
                        onClick={() => window.open(`https://maps.google.com/?q=${req.lat},${req.lng}`, '_blank')}
                        className="text-xs px-2 py-1 rounded-lg flex-shrink-0"
                        style={{ background: 'rgba(45,111,232,0.12)', color: '#4f8ef7', border: '1px solid rgba(45,111,232,0.25)' }}>
                        🗺️ Ver
                      </button>
                    )}
                  </div>
                  <button
                    onClick={() => markComplete(req.id)}
                    disabled={completing === req.id}
                    className="w-full py-3 rounded-xl text-sm font-bold disabled:opacity-50"
                    style={{ background: 'rgba(34,197,94,0.12)', color: '#22c55e', border: '1px solid rgba(34,197,94,0.3)' }}>
                    {completing === req.id ? 'A guardar…' : '✅ Marcar como Concluído'}
                  </button>
                </div>
              ))}
            </div>
          </div>
        )}
      </div>
    </div>
  )
}
