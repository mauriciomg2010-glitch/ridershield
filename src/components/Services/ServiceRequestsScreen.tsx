// src/components/Services/ServiceRequestsScreen.tsx
'use client'
import { useState, useEffect } from 'react'
import { collection, query, where, onSnapshot, updateDoc, doc, serverTimestamp, deleteDoc } from 'firebase/firestore'
import { db } from '@/lib/firebase'
import { useAuth } from '@/contexts/AuthContext'
import toast from 'react-hot-toast'

interface PendingService {
  id: string
  name: string
  type: 'mechanic' | 'rescue'
  vehicle: 'bike' | 'moto' | 'both'
  phone: string
  area: string
  description: string
  submittedAt: Date | null
}

interface ApprovedService {
  id: string
  name: string
  type: 'mechanic' | 'rescue'
  phone: string
  area: string
  description: string
  approvedAt: Date | null
}

interface Props {
  onBack: () => void
}

export default function ServiceRequestsScreen({ onBack }: Props) {
  const { firebaseUser } = useAuth()
  const [tab, setTab] = useState<'pending' | 'approved'>('pending')
  const [pending, setPending] = useState<PendingService[]>([])
  const [approved, setApproved] = useState<ApprovedService[]>([])
  const [loading, setLoading] = useState(true)
  const [deleting, setDeleting] = useState<string | null>(null)
  const [confirmDelete, setConfirmDelete] = useState<string | null>(null)

  useEffect(() => {
    const q = query(collection(db, 'services'), where('status', '==', 'pending'))
    const unsub = onSnapshot(q, (snap) => {
      setPending(
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
            submittedAt: data.submittedAt?.toDate?.() ?? null,
          }
        })
      )
      setLoading(false)
    }, () => setLoading(false))
    return () => unsub()
  }, [])

  useEffect(() => {
    const q = query(collection(db, 'services'), where('status', '==', 'approved'))
    const unsub = onSnapshot(q, (snap) => {
      setApproved(
        snap.docs.map((d) => {
          const data = d.data()
          return {
            id: d.id,
            name: data.name ?? '',
            type: data.type ?? 'mechanic',
            phone: data.phone ?? '',
            area: data.area ?? '',
            description: data.description ?? '',
            approvedAt: data.approvedAt?.toDate?.() ?? null,
          }
        })
      )
    }, () => {})
    return () => unsub()
  }, [])

  async function handleApprove(service: PendingService) {
    try {
      await updateDoc(doc(db, 'services', service.id), {
        status: 'approved',
        approvedAt: serverTimestamp(),
        approvedBy: firebaseUser?.uid ?? null,
        available: true,
      })
      toast.success('✅ Serviço aprovado e publicado!')
    } catch {
      toast.error('Erro ao aprovar serviço')
    }
  }

  async function handleDelete(serviceId: string) {
    setDeleting(serviceId)
    try {
      await deleteDoc(doc(db, 'services', serviceId))
      toast.success('🗑️ Serviço removido')
    } catch {
      toast.error('Erro ao remover serviço')
    } finally {
      setDeleting(null)
      setConfirmDelete(null)
    }
  }

  async function handleReject(service: PendingService) {
    try {
      await updateDoc(doc(db, 'services', service.id), {
        status: 'rejected',
        rejectedAt: serverTimestamp(),
        available: false,
      })
      toast.success('❌ Solicitação rejeitada')
    } catch {
      toast.error('Erro ao rejeitar')
    }
  }

  function timeAgo(date: Date | null): string {
    if (!date) return 'Desconhecido'
    const diffH = Math.floor((Date.now() - date.getTime()) / 3600000)
    if (diffH < 1) return 'há menos de 1 hora'
    if (diffH === 1) return 'há 1 hora'
    if (diffH < 24) return `há ${diffH} horas`
    const diffD = Math.floor(diffH / 24)
    return diffD === 1 ? 'há 1 dia' : `há ${diffD} dias`
  }

  return (
    <div className="flex flex-col h-full" style={{ background: 'var(--bg)' }}>
      {/* Header */}
      <div className="flex items-center gap-3 px-4 pt-14 pb-4 border-b flex-shrink-0"
        style={{ background: 'var(--surface)', borderColor: 'var(--border)' }}>
        <button onClick={onBack} className="p-2 -ml-2" style={{ color: 'var(--text)' }}>
          <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
            <polyline points="15 18 9 12 15 6" />
          </svg>
        </button>
        <div>
          <h1 className="text-xl font-bold" style={{ color: 'var(--text)' }}>📋 Gestão de Serviços</h1>
          <p className="text-xs" style={{ color: 'var(--muted)' }}>Aprova, rejeita ou remove serviços</p>
        </div>
      </div>

      {/* Tab switcher */}
      <div className="flex gap-2 px-4 py-3 border-b" style={{ borderColor: 'var(--border)', background: 'var(--surface)' }}>
        <button
          onClick={() => setTab('pending')}
          className="flex-1 py-2 rounded-xl text-xs font-bold"
          style={{ background: tab === 'pending' ? '#f59e0b' : 'var(--card)', color: tab === 'pending' ? 'white' : 'var(--muted)', border: `1px solid ${tab === 'pending' ? '#f59e0b' : 'var(--border)'}` }}>
          ⏳ Pendentes {pending.length > 0 ? `(${pending.length})` : ''}
        </button>
        <button
          onClick={() => setTab('approved')}
          className="flex-1 py-2 rounded-xl text-xs font-bold"
          style={{ background: tab === 'approved' ? '#22c55e' : 'var(--card)', color: tab === 'approved' ? 'white' : 'var(--muted)', border: `1px solid ${tab === 'approved' ? '#22c55e' : 'var(--border)'}` }}>
          ✅ Aprovados {approved.length > 0 ? `(${approved.length})` : ''}
        </button>
      </div>

      <div className="flex-1 overflow-y-auto px-4 py-4 space-y-3">

        {/* Pending tab */}
        {tab === 'pending' && (loading ? (
          <div className="flex items-center justify-center py-16">
            <div className="w-8 h-8 border-2 border-t-transparent rounded-full animate-spin"
              style={{ borderColor: '#2d6fe8', borderTopColor: 'transparent' }} />
          </div>
        ) : pending.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-16 text-center">
            <span className="text-5xl mb-4">📋</span>
            <p className="text-lg font-bold mb-2" style={{ color: 'var(--text)' }}>Sem solicitações pendentes</p>
            <p className="text-sm" style={{ color: 'var(--muted)' }}>Todos os serviços estão em dia!</p>
          </div>
        ) : (
          pending.map((service) => (
            <div key={service.id} className="rounded-2xl overflow-hidden"
              style={{ background: 'var(--card)', border: '1px solid var(--border)' }}>
              <div className="px-4 pt-4 pb-3">
                <div className="flex items-start justify-between gap-2 mb-2">
                  <div className="flex items-center gap-2">
                    <span className="text-base">{service.type === 'mechanic' ? '🔧' : '🚑'}</span>
                    <h3 className="font-bold text-sm" style={{ color: 'var(--text)' }}>{service.name}</h3>
                  </div>
                  <span className="text-xs font-bold px-2 py-0.5 rounded-full flex-shrink-0"
                    style={{ background: 'rgba(234,179,8,0.15)', color: '#ca8a04' }}>
                    PENDENTE
                  </span>
                </div>
                <div className="space-y-1">
                  <p className="text-xs" style={{ color: 'var(--muted)' }}>
                    📍 {service.area} · 📞 {service.phone}
                  </p>
                  <p className="text-xs" style={{ color: 'var(--muted)' }}>
                    🏷️ Tipo: {service.type === 'mechanic' ? 'Mechanic' : 'Rescue'}&nbsp;·&nbsp;
                    🚲 Veículo: {service.vehicle === 'bike' ? 'Bike' : service.vehicle === 'moto' ? 'Moto' : 'Both'}
                  </p>
                  {service.description && (
                    <p className="text-xs" style={{ color: 'var(--muted)' }}>📝 {service.description}</p>
                  )}
                  <p className="text-xs" style={{ color: 'var(--muted)' }}>
                    🕐 Submetido: {timeAgo(service.submittedAt)}
                  </p>
                </div>
              </div>
              <div className="flex border-t" style={{ borderColor: 'var(--border)' }}>
                <button
                  onClick={() => handleApprove(service)}
                  className="flex-1 py-3 text-sm font-bold flex items-center justify-center gap-1.5 active:opacity-70"
                  style={{ color: '#22c55e', borderRight: '1px solid var(--border)', background: 'rgba(34,197,94,0.05)' }}>
                  ✅ Aprovar
                </button>
                <button
                  onClick={() => handleReject(service)}
                  className="flex-1 py-3 text-sm font-bold flex items-center justify-center gap-1.5 active:opacity-70"
                  style={{ color: '#ef4444', background: 'rgba(239,68,68,0.05)' }}>
                  ❌ Rejeitar
                </button>
              </div>
            </div>
          ))
        ))}

        {/* Approved tab */}
        {tab === 'approved' && (approved.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-16 text-center">
            <span className="text-5xl mb-4">✅</span>
            <p className="text-lg font-bold mb-2" style={{ color: 'var(--text)' }}>Nenhum serviço aprovado</p>
          </div>
        ) : (
          approved.map((service) => (
            <div key={service.id} className="rounded-2xl overflow-hidden"
              style={{ background: 'var(--card)', border: '1px solid rgba(34,197,94,0.3)' }}>
              <div className="px-4 pt-4 pb-3">
                <div className="flex items-start justify-between gap-2 mb-2">
                  <div className="flex items-center gap-2">
                    <span className="text-base">{service.type === 'mechanic' ? '🔧' : '🚑'}</span>
                    <h3 className="font-bold text-sm" style={{ color: 'var(--text)' }}>{service.name}</h3>
                  </div>
                  <span className="text-xs font-bold px-2 py-0.5 rounded-full flex-shrink-0"
                    style={{ background: 'rgba(34,197,94,0.15)', color: '#22c55e' }}>
                    APROVADO
                  </span>
                </div>
                <div className="space-y-1">
                  <p className="text-xs" style={{ color: 'var(--muted)' }}>
                    📍 {service.area} · 📞 {service.phone}
                  </p>
                  {service.description && (
                    <p className="text-xs" style={{ color: 'var(--muted)' }}>📝 {service.description}</p>
                  )}
                  {service.approvedAt && (
                    <p className="text-xs" style={{ color: 'var(--muted)' }}>
                      ✅ Aprovado: {timeAgo(service.approvedAt)}
                    </p>
                  )}
                </div>
              </div>
              <div className="border-t px-4 py-3" style={{ borderColor: 'var(--border)' }}>
                {confirmDelete === service.id ? (
                  <div className="flex gap-2">
                    <button
                      onClick={() => setConfirmDelete(null)}
                      className="flex-1 py-2.5 rounded-xl text-xs font-bold"
                      style={{ background: 'var(--surface)', border: '1px solid var(--border)', color: 'var(--muted)' }}>
                      Cancelar
                    </button>
                    <button
                      onClick={() => handleDelete(service.id)}
                      disabled={deleting === service.id}
                      className="flex-1 py-2.5 rounded-xl text-xs font-bold disabled:opacity-50"
                      style={{ background: 'rgba(239,68,68,0.15)', border: '1px solid rgba(239,68,68,0.3)', color: '#ef4444' }}>
                      {deleting === service.id ? 'A remover…' : '🗑️ Confirmar remoção'}
                    </button>
                  </div>
                ) : (
                  <button
                    onClick={() => setConfirmDelete(service.id)}
                    className="w-full py-2.5 rounded-xl text-xs font-bold"
                    style={{ background: 'rgba(239,68,68,0.08)', border: '1px solid rgba(239,68,68,0.2)', color: '#ef4444' }}>
                    🗑️ Remover Serviço
                  </button>
                )}
              </div>
            </div>
          ))
        ))}

        <div style={{ height: 24 }} />
      </div>
    </div>
  )
}
