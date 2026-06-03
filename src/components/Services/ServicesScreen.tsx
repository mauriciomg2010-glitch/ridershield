// src/components/Services/ServicesScreen.tsx
'use client'
import { useState, useEffect } from 'react'
import {
  collection, query, where, onSnapshot, addDoc, serverTimestamp,
} from 'firebase/firestore'
import { ref, set, onValue } from 'firebase/database'
import { db, rtdb } from '@/lib/firebase'
import { useStore } from '@/lib/store'
import { useLang } from '@/contexts/LangContext'
import toast from 'react-hot-toast'

type ServiceFilter = 'all' | 'mechanic' | 'rescue' | 'hospitals'
type ServiceType = 'mechanic' | 'rescue'
type VehicleType = 'bike' | 'moto' | 'both'

interface Hospital {
  name: string; address: string; phone: string; mapsUrl: string
  category: 'ae' | 'urgent' | 'pharmacy'
}
const HOSPITALS: Hospital[] = [
  { name: "St James's Hospital", address: "James's St, Dublin 8", phone: '+353 1 410 3000', mapsUrl: 'https://maps.google.com/?q=St+James+Hospital+Dublin', category: 'ae' },
  { name: 'Beaumont Hospital', address: 'Beaumont Rd, Dublin 9', phone: '+353 1 809 3000', mapsUrl: 'https://maps.google.com/?q=Beaumont+Hospital+Dublin', category: 'ae' },
  { name: 'Mater University Hospital', address: 'Eccles St, Dublin 7', phone: '+353 1 803 2000', mapsUrl: 'https://maps.google.com/?q=Mater+Hospital+Dublin', category: 'ae' },
  { name: 'Tallaght University Hospital', address: 'Tallaght, Dublin 24', phone: '+353 1 414 2000', mapsUrl: 'https://maps.google.com/?q=Tallaght+University+Hospital', category: 'ae' },
  { name: "St Vincent's University Hospital", address: 'Elm Park, Dublin 4', phone: '+353 1 221 4000', mapsUrl: 'https://maps.google.com/?q=St+Vincents+University+Hospital+Dublin', category: 'ae' },
  { name: 'Connolly Hospital Blanchardstown', address: 'Mill Rd, Blanchardstown, Dublin 15', phone: '+353 1 646 5000', mapsUrl: 'https://maps.google.com/?q=Connolly+Hospital+Blanchardstown', category: 'ae' },
  { name: 'Centric Health Urgent Care — Smithfield', address: 'Smithfield, Dublin 7', phone: '+353 1 485 3500', mapsUrl: 'https://maps.google.com/?q=Centric+Health+Smithfield+Dublin', category: 'urgent' },
  { name: 'Nexus Health — City Centre', address: '14 Merrion Sq N, Dublin 2', phone: '+353 1 661 0515', mapsUrl: 'https://maps.google.com/?q=Nexus+Health+Dublin', category: 'urgent' },
  { name: 'Dublin Doc (out of hours GP)', address: 'Various locations', phone: '1800 228 333', mapsUrl: 'https://maps.google.com/?q=DublinDoc', category: 'urgent' },
  { name: 'Boots Pharmacy — Jervis Centre', address: 'Jervis St, Dublin 1', phone: '+353 1 878 5425', mapsUrl: 'https://maps.google.com/?q=Boots+Pharmacy+Jervis+Dublin', category: 'pharmacy' },
  { name: "O'Brien's Pharmacy — Baggot St", address: '55 Baggot St Lower, Dublin 2', phone: '+353 1 676 0567', mapsUrl: "https://maps.google.com/?q=OBriens+Pharmacy+Baggot+Street", category: 'pharmacy' },
  { name: "Hickey's Pharmacy — O'Connell St", address: "55 O'Connell St, Dublin 1", phone: '+353 1 873 0427', mapsUrl: 'https://maps.google.com/?q=Hickeys+Pharmacy+OConnell+Street', category: 'pharmacy' },
]
const HOSP_CATEGORY = {
  ae:       { label: '🔴 A&E 24h',       color: '#ef4444', bg: 'rgba(239,68,68,0.12)' },
  urgent:   { label: '🟡 Urgent Care',   color: '#f59e0b', bg: 'rgba(245,158,11,0.12)' },
  pharmacy: { label: '🟢 Farmácia 24h',  color: '#22c55e', bg: 'rgba(34,197,94,0.12)' },
}

interface Service {
  id: string; name: string; type: 'mechanic' | 'rescue'; vehicle: VehicleType
  phone: string; area: string; description: string; available: boolean
  rating: number; responseTime: string; ownerId?: string; supportsWorkshop?: boolean
}

type ServiceRequestType = 'mechanic_local' | 'mechanic_workshop' | 'rescue' | 'accident'
const REQUEST_TYPES: Record<ServiceRequestType, { icon: string; label: string; sublabel: string; color: string; bg: string }> = {
  mechanic_local:    { icon: '🔧', label: 'Avaria / Manutenção',  sublabel: 'Mecânico local',       color: '#4f8ef7', bg: 'rgba(79,142,247,0.12)'  },
  mechanic_workshop: { icon: '🏭', label: 'Preciso de oficina',   sublabel: 'Mecânico com oficina',  color: '#f59e0b', bg: 'rgba(245,158,11,0.12)'  },
  rescue:            { icon: '🚐', label: 'Resgate com van',       sublabel: 'Transportar bicicleta', color: '#22c55e', bg: 'rgba(34,197,94,0.12)'   },
  accident:          { icon: '🚨', label: 'Tive um acidente',      sublabel: 'Emergência — 112',      color: '#ef4444', bg: 'rgba(239,68,68,0.12)'   },
}

const ADMIN_WA = '353830923481'

function FullModal({ onClose, title, children }: { onClose: () => void; title: string; children: React.ReactNode }) {
  return (
    <div className="fixed inset-0 z-[500]" style={{ background: 'var(--surface)' }}>
      <div className="flex items-center justify-between px-5 pt-14 pb-4 border-b" style={{ borderColor: 'var(--border)' }}>
        <h2 className="text-xl font-bold" style={{ color: 'var(--text)' }}>{title}</h2>
        <button onClick={onClose} className="w-9 h-9 rounded-full flex items-center justify-center text-lg" style={{ background: 'var(--card)', color: 'var(--muted)' }}>✕</button>
      </div>
      <div className="overflow-y-auto px-5 py-4" style={{ height: 'calc(100vh - 120px)' }}>
        {children}
        <div style={{ height: '100px' }} />
      </div>
    </div>
  )
}

export default function ServicesScreen() {
  const user = useStore((s) => s.user)
  const currentLocation = useStore((s) => s.currentLocation)
  const emergencyContacts = useStore((s) => s.emergencyContacts)

  const [filter, setFilter] = useState<ServiceFilter>('all')
  const [showHelp, setShowHelp] = useState(false)
  const [showRegister, setShowRegister] = useState(false)
  const [selectedService, setSelectedService] = useState<Service | null>(null)
  const [selectedRequestType, setSelectedRequestType] = useState<ServiceRequestType | null>(null)
  const [helpDescription, setHelpDescription] = useState('')
  const [helpGps, setHelpGps] = useState<{ lat: number; lng: number } | null>(null)
  const [helpGpsLoading, setHelpGpsLoading] = useState(false)
  const [services, setServices] = useState<Service[]>([])
  const [servicePresenceMap, setServicePresenceMap] = useState<Record<string, boolean>>({})
  const [submitting, setSubmitting] = useState(false)
  const [form, setForm] = useState({
    type: 'mechanic' as ServiceType, vehicle: 'bike' as VehicleType,
    phone: '', area: '', description: '',
  })
  const { t } = useLang()

  // Load approved services from Firestore (includes ownerId for owner detection)
  useEffect(() => {
    const q = query(collection(db, 'services'), where('status', '==', 'approved'))
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
            available: data.available ?? true,
            rating: data.rating ?? 0,
            responseTime: data.responseTime ?? 'N/A',
            ownerId: data.ownerId ?? undefined,
            supportsWorkshop: data.supportsWorkshop ?? false,
          }
        })
      )
    }, () => {})
    return () => unsub()
  }, [])

  // Subscribe to service presence for all service cards
  useEffect(() => {
    const presRef = ref(rtdb, 'servicePresence')
    const unsub = onValue(presRef, (snap) => {
      const data = snap.val() ?? {}
      const map: Record<string, boolean> = {}
      Object.entries(data).forEach(([id, val]: [string, any]) => {
        map[id] = val?.online === true
      })
      setServicePresenceMap(map)
    })
    return () => unsub()
  }, [])

  // Get GPS when help modal opens
  useEffect(() => {
    if (!showHelp) { setHelpGps(null); setHelpGpsLoading(false); return }
    setHelpGpsLoading(true)
    navigator.geolocation.getCurrentPosition(
      (pos) => {
        setHelpGps({ lat: pos.coords.latitude, lng: pos.coords.longitude })
        setHelpGpsLoading(false)
      },
      () => {
        if (currentLocation) setHelpGps(currentLocation)
        setHelpGpsLoading(false)
      },
      { timeout: 8000, maximumAge: 30000 }
    )
  }, [showHelp])

  const filtered = services.filter((s) => filter === 'all' || filter === 'hospitals' || s.type === filter)

  function getServiceOnline(service: Service): boolean {
    return service.id in servicePresenceMap ? servicePresenceMap[service.id] : service.available
  }

  async function handleCall(s: Service) {
    const timeStr = new Date().toLocaleTimeString('en-IE', { hour: '2-digit', minute: '2-digit' })
    let locationStr = 'Localização não disponível'
    try {
      const pos = await new Promise<GeolocationPosition>((resolve, reject) =>
        navigator.geolocation.getCurrentPosition(resolve, reject, { timeout: 5000, maximumAge: 30000 })
      )
      locationStr = `https://maps.google.com/?q=${pos.coords.latitude.toFixed(6)},${pos.coords.longitude.toFixed(6)}`
    } catch {
      if (currentLocation) {
        locationStr = `https://maps.google.com/?q=${currentLocation.lat.toFixed(6)},${currentLocation.lng.toFixed(6)}`
      }
    }
    const msg = [
      '🛡️ *ZIVO — Pedido de Ajuda*', '',
      `🏍️ Rider: ${user?.name ?? 'Rider'}`,
      `📍 Localização: ${locationStr}`,
      `🔧 Serviço solicitado: ${s.name}`,
      `⏰ Hora: ${timeStr}`,
      `📱 Contacto: ${user?.email ?? ''}`, '',
      '_Enviado automaticamente pelo ZIVO_',
    ].join('\n')
    window.open(`https://wa.me/${ADMIN_WA}?text=${encodeURIComponent(msg)}`, '_blank')
    setTimeout(() => { window.open(`tel:${s.phone}`) }, 1000)
  }

  async function handleRegister() {
    if (!form.phone || !form.area) return toast.error('Preenche todos os campos obrigatórios')
    if (!user?.id) return toast.error('Não autenticado')
    const serviceName = `${form.type === 'rescue' ? 'Rescue' : 'Mecânico'} - ${user.name || user.email}`
    setSubmitting(true)
    try {
      await addDoc(collection(db, 'services'), {
        name: serviceName, type: form.type, vehicle: form.vehicle,
        phone: form.phone, area: form.area, description: form.description ?? '',
        status: 'pending', available: false, rating: 0, responseTime: 'N/A',
        submittedAt: serverTimestamp(), submittedBy: user.id, ownerId: user.id,
        approvedAt: null, approvedBy: null,
      })
      const timeStr = new Date().toLocaleTimeString('en-IE', { hour: '2-digit', minute: '2-digit' })
      const vehicleLabel = form.vehicle === 'bike' ? 'Bike' : form.vehicle === 'moto' ? 'Moto' : 'Bike + Moto'
      const msg = [
        '📋 *Nova Solicitação de Serviço — ZIVO*', '',
        `🔧 Nome: ${serviceName}`, `🏷️ Tipo: ${form.type}`, `🚲 Veículo: ${vehicleLabel}`,
        `📍 Área: ${form.area}`, `📞 Telefone: ${form.phone}`,
        `📝 Descrição: ${form.description || 'N/A'}`, `⏰ Submetido: ${timeStr}`, '',
        '_Acede ao app para aprovar ou rejeitar_',
      ].join('\n')
      window.open(`https://wa.me/${ADMIN_WA}?text=${encodeURIComponent(msg)}`, '_blank')
      setForm({ type: 'mechanic', vehicle: 'bike', phone: '', area: '', description: '' })
      toast.success('✅ Solicitação enviada! Aguarda aprovação.')
      setShowRegister(false)
    } catch (e) {
      console.error('[handleRegister] Error completo:', JSON.stringify(e))
      toast.error('Erro ao enviar solicitação')
    } finally {
      setSubmitting(false)
    }
  }

  function handleAccidentAlert() {
    const loc = helpGps || currentLocation
    const locationStr = loc ? `https://maps.google.com/?q=${loc.lat},${loc.lng}` : 'Localização não disponível'
    const timeStr = new Date().toLocaleTimeString('en-IE', { hour: '2-digit', minute: '2-digit' })
    const msg = [
      '🚨 *ACIDENTE — ZIVO*', '',
      `🏍️ Rider: ${user?.name ?? 'Rider'}`,
      `📍 Localização: ${locationStr}`,
      `⏰ Hora: ${timeStr}`,
      '_Rider teve um acidente. Contactar imediatamente._',
    ].join('\n')
    window.open(`https://wa.me/${ADMIN_WA}?text=${encodeURIComponent(msg)}`, '_blank')
  }

  async function handleSubmitHelp() {
    if (!selectedRequestType || selectedRequestType === 'accident') return
    const loc = helpGps || currentLocation
    const timeStr = new Date().toLocaleTimeString('en-IE', { hour: '2-digit', minute: '2-digit' })
    const locationStr = loc ? `https://maps.google.com/?q=${loc.lat},${loc.lng}` : 'Localização não disponível'
    const rtCfg = REQUEST_TYPES[selectedRequestType]

    // Filter matching services by request type
    let matchingServices = services.filter((s) => s.available)
    if (selectedRequestType === 'mechanic_local') {
      matchingServices = matchingServices.filter((s) => s.type === 'mechanic')
    } else if (selectedRequestType === 'mechanic_workshop') {
      const workshop = matchingServices.filter((s) => s.type === 'mechanic' && s.supportsWorkshop === true)
      matchingServices = workshop.length > 0 ? workshop : matchingServices.filter((s) => s.type === 'mechanic')
    } else if (selectedRequestType === 'rescue') {
      matchingServices = matchingServices.filter((s) => s.type === 'rescue')
    }

    try {
      const docRef = await addDoc(collection(db, 'helpRequests'), {
        riderId: user?.id ?? null,
        riderName: user?.name ?? 'Rider',
        requestType: selectedRequestType,
        description: helpDescription,
        location: loc ? { lat: loc.lat, lng: loc.lng } : null,
        status: 'pending',
        timestamp: serverTimestamp(),
        respondedBy: null,
      })
      // Write to each matching service's dedicated RTDB node
      await Promise.all(
        matchingServices.map((service) =>
          set(ref(rtdb, `serviceAlerts/${service.id}/request`), {
            active: true,
            requestId: docRef.id,
            riderId: user?.id ?? null,
            riderName: user?.name ?? 'Rider',
            requestType: selectedRequestType,
            description: helpDescription,
            lat: loc?.lat ?? null,
            lng: loc?.lng ?? null,
            timestamp: Date.now(),
          })
        )
      )
      const msg = [
        '🆘 *Pedido de Ajuda — ZIVO*', '',
        `🏍️ Rider: ${user?.name ?? 'Rider'}`,
        `🔧 Tipo: ${rtCfg.label}`,
        `📍 Localização: ${locationStr}`,
        `⏰ Hora: ${timeStr}`,
        `📋 ${matchingServices.length} serviço(s) alertado(s)`,
        '_Abre o ZIVO para responder_',
      ].join('\n')
      window.open(`https://wa.me/${ADMIN_WA}?text=${encodeURIComponent(msg)}`, '_blank')
      toast.success(`✅ Pedido enviado! ${matchingServices.length} mecânico(s) alertado(s).`)
      setShowHelp(false)
      setSelectedRequestType(null)
      setHelpDescription('')
    } catch (e) {
      console.error('[handleSubmitHelp] Error:', e)
      toast.error('Erro ao enviar pedido')
    }
  }

  return (
    <div className="flex flex-col h-full pb-20" style={{ background: 'var(--bg)' }}>
      <div className="px-5 pt-14 pb-4 border-b" style={{ background: 'var(--surface)', borderColor: 'var(--border)' }}>
        <div className="flex items-center justify-between mb-1">
          <h1 className="text-2xl font-bold" style={{ color: 'var(--text)' }}>{t('services_title')}</h1>
          <button onClick={() => setShowRegister(true)} className="text-xs font-semibold px-3 py-1.5 rounded-lg"
            style={{ color: '#4f8ef7', border: '1px solid rgba(45,111,232,0.3)' }}>+ {t('register_service')}</button>
        </div>
        <p className="text-sm mb-4" style={{ color: 'var(--muted)' }}>{t('services_desc')}</p>
        <button onClick={() => setShowHelp(true)} className="w-full font-bold py-3 rounded-xl flex items-center justify-center gap-2"
          style={{ background: 'rgba(239,68,68,0.15)', border: '1px solid rgba(239,68,68,0.3)', color: '#f87171' }}>
          <span className="text-lg">🆘</span> {t('i_need_help_now')}
        </button>
      </div>

      <div className="flex gap-2 px-5 py-3 border-b overflow-x-auto" style={{ borderColor: 'var(--border)' }}>
        {([
          { id: 'all', label: `🔧 ${t('all')}` },
          { id: 'mechanic', label: `🔩 ${t('mechanic')}` },
          { id: 'rescue', label: `🚑 ${t('rescue')}` },
          { id: 'hospitals', label: '🏥 Hospitais' },
        ] as { id: ServiceFilter; label: string }[]).map((f) => (
          <button key={f.id} onClick={() => setFilter(f.id)}
            className="px-4 py-1.5 rounded-xl text-xs font-semibold whitespace-nowrap transition-colors"
            style={{ background: filter === f.id ? '#2d6fe8' : 'var(--card)', color: filter === f.id ? 'white' : 'var(--muted)', border: `1px solid ${filter === f.id ? '#2d6fe8' : 'var(--border)'}` }}>
            {f.label}
          </button>
        ))}
      </div>

      <div className="flex-1 overflow-y-auto px-5 py-4 space-y-3">

        {/* Hospitals */}
        {filter === 'hospitals' && (
          <>
            {(['ae', 'urgent', 'pharmacy'] as const).map(cat => (
              <div key={cat}>
                <div className="flex items-center gap-2 mb-2 mt-2">
                  <span className="text-xs font-bold px-3 py-1 rounded-full"
                    style={{ background: HOSP_CATEGORY[cat].bg, color: HOSP_CATEGORY[cat].color }}>
                    {HOSP_CATEGORY[cat].label}
                  </span>
                </div>
                <div className="space-y-2">
                  {HOSPITALS.filter(h => h.category === cat).map(h => (
                    <div key={h.name} className="rounded-2xl p-4"
                      style={{ background: 'var(--card)', border: `1px solid ${HOSP_CATEGORY[cat].color}30` }}>
                      <div className="flex items-start justify-between gap-2 mb-1">
                        <h3 className="font-bold text-sm leading-snug" style={{ color: 'var(--text)' }}>{h.name}</h3>
                        <span className="text-xs font-bold px-2 py-0.5 rounded-full flex-shrink-0"
                          style={{ background: HOSP_CATEGORY[cat].bg, color: HOSP_CATEGORY[cat].color }}>
                          {cat === 'ae' ? '🔴 A&E' : cat === 'urgent' ? '🟡 Urgent' : '🟢'}
                        </span>
                      </div>
                      <p className="text-xs mb-3" style={{ color: 'var(--muted)' }}>📍 {h.address}</p>
                      <div className="flex gap-2">
                        <a href={`tel:${h.phone}`}
                          className="flex-1 py-2.5 rounded-xl text-xs font-bold text-center"
                          style={{ background: 'rgba(45,111,232,0.12)', color: '#4f8ef7', border: '1px solid rgba(45,111,232,0.25)', textDecoration: 'none' }}>
                          📞 Ligar
                        </a>
                        <button onClick={() => window.open(h.mapsUrl, '_blank')}
                          className="flex-1 py-2.5 rounded-xl text-xs font-bold"
                          style={{ background: 'rgba(34,197,94,0.1)', color: '#22c55e', border: '1px solid rgba(34,197,94,0.25)' }}>
                          🗺️ Como chegar
                        </button>
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            ))}
            <div style={{ height: 24 }} />
          </>
        )}

        {/* Services list with dynamic online status (FEATURE 5) */}
        {filter !== 'hospitals' && (<>
          {filtered.map((service) => {
            const isOnline = getServiceOnline(service)
            return (
              <div key={service.id} className="rounded-2xl p-4" style={{ background: 'var(--card)', border: '1px solid var(--border)' }}>
                <div className="flex items-start gap-2 mb-2">
                  <span className="text-base">{service.type === 'mechanic' ? '🔧' : '🚑'}</span>
                  <div className="flex-1">
                    <div className="flex items-center gap-2 flex-wrap">
                      <h3 className="font-bold text-sm" style={{ color: 'var(--text)' }}>{service.name}</h3>
                      <span className="text-xs px-2 py-0.5 rounded-full font-semibold"
                        style={{ background: isOnline ? 'rgba(34,197,94,0.15)' : 'var(--surface)', color: isOnline ? '#22c55e' : '#6b7280' }}>
                        {isOnline ? `● ${t('available')}` : '○ Offline'}
                      </span>
                    </div>
                    <p className="text-xs mt-0.5" style={{ color: 'var(--muted)' }}>📍 {service.area}</p>
                    <p className="text-xs mt-1" style={{ color: 'var(--text-dim)' }}>{service.description}</p>
                  </div>
                </div>
                <div className="flex items-center gap-3 mb-3">
                  <span className="text-xs text-yellow-400">★ {service.rating}</span>
                  <span className="text-xs" style={{ color: 'var(--text-dim)' }}>⏱ {service.responseTime}</span>
                  <span className="text-xs" style={{ color: 'var(--text-dim)' }}>{service.vehicle === 'bike' ? '🚲' : service.vehicle === 'moto' ? '🏍️' : '🚲🏍️'} {service.vehicle}</span>
                </div>
                <div className="flex gap-2">
                  <button onClick={() => handleCall(service)} disabled={!isOnline}
                    className="flex-1 text-white font-semibold py-2.5 rounded-xl text-sm disabled:opacity-50"
                    style={{ background: isOnline ? 'linear-gradient(135deg, #4f8ef7 0%, #1a5fd4 100%)' : 'var(--surface)', border: isOnline ? 'none' : '1px solid var(--border)', color: isOnline ? 'white' : 'var(--muted)' }}>
                    📞 {t('call')}
                  </button>
                  <button onClick={() => setSelectedService(service)}
                    className="px-4 py-2.5 rounded-xl text-sm" style={{ border: '1px solid var(--border)', color: 'var(--muted)' }}>
                    {t('info')}
                  </button>
                </div>
              </div>
            )
          })}

          <div className="rounded-2xl p-4 text-center" style={{ background: 'var(--surface)', border: '1px solid var(--border)' }}>
            <p className="text-sm font-semibold mb-1" style={{ color: 'var(--text)' }}>{t('are_you_mechanic')}</p>
            <p className="text-xs mb-3" style={{ color: 'var(--muted)' }}>{t('get_listed')}</p>
            <button onClick={() => setShowRegister(true)} className="font-semibold px-6 py-2 rounded-xl text-sm"
              style={{ background: 'rgba(45,111,232,0.1)', border: '1px solid rgba(45,111,232,0.3)', color: '#4f8ef7' }}>
              {t('register_service')}
            </button>
          </div>
        </>)}
      </div>

      {/* Help Modal */}
      {showHelp && (
        <FullModal onClose={() => { setShowHelp(false); setSelectedRequestType(null); setHelpDescription('') }} title="🆘 Pedir Ajuda">

          <p className="text-xs font-semibold uppercase tracking-widest mb-3" style={{ color: 'var(--muted)' }}>Tipo de ajuda</p>
          <div className="grid grid-cols-2 gap-3 mb-5">
            {(Object.entries(REQUEST_TYPES) as [ServiceRequestType, typeof REQUEST_TYPES[ServiceRequestType]][]).map(([type, cfg]) => (
              <button key={type}
                onClick={() => setSelectedRequestType(type)}
                className="py-4 px-3 rounded-xl text-left transition-all"
                style={{
                  background: selectedRequestType === type ? cfg.bg : 'var(--card)',
                  border: `2px solid ${selectedRequestType === type ? cfg.color : 'var(--border)'}`,
                  transform: selectedRequestType === type ? 'scale(1.02)' : 'scale(1)',
                }}>
                <p className="text-lg mb-0.5">{cfg.icon}</p>
                <p className="text-xs font-bold leading-snug" style={{ color: selectedRequestType === type ? cfg.color : 'var(--text)' }}>{cfg.label}</p>
                <p className="text-xs mt-0.5" style={{ color: 'var(--muted)' }}>{cfg.sublabel}</p>
              </button>
            ))}
          </div>

          {/* Accident: emergency panel */}
          {selectedRequestType === 'accident' && (
            <div className="space-y-3">
              <div className="rounded-xl p-4" style={{ background: 'rgba(239,68,68,0.08)', border: '1px solid rgba(239,68,68,0.25)' }}>
                <p className="text-sm font-bold mb-3" style={{ color: '#f87171' }}>🚨 Liga imediatamente</p>
                <a href={`tel:${emergencyContacts?.guardaNumber ?? '112'}`}
                  className="flex items-center justify-center gap-2 w-full py-3.5 rounded-xl text-base font-bold mb-2"
                  style={{ background: '#dc2626', color: 'white', textDecoration: 'none' }}>
                  🚨 Ligar {emergencyContacts?.guardaNumber ?? '112'}
                </a>
                {emergencyContacts?.contact1 && (
                  <a href={`tel:${emergencyContacts.contact1.phone}`}
                    className="flex items-center justify-center gap-2 w-full py-3 rounded-xl text-sm font-semibold mb-2"
                    style={{ background: 'rgba(239,68,68,0.15)', color: '#f87171', border: '1px solid rgba(239,68,68,0.3)', textDecoration: 'none' }}>
                    📞 {emergencyContacts.contact1.name} ({emergencyContacts.contact1.phone})
                  </a>
                )}
                {emergencyContacts?.contact2 && (
                  <a href={`tel:${emergencyContacts.contact2.phone}`}
                    className="flex items-center justify-center gap-2 w-full py-3 rounded-xl text-sm font-semibold"
                    style={{ background: 'rgba(239,68,68,0.15)', color: '#f87171', border: '1px solid rgba(239,68,68,0.3)', textDecoration: 'none' }}>
                    📞 {emergencyContacts.contact2.name} ({emergencyContacts.contact2.phone})
                  </a>
                )}
              </div>
              <button onClick={handleAccidentAlert}
                className="w-full py-3 rounded-xl text-sm font-semibold"
                style={{ background: 'rgba(251,191,36,0.1)', color: '#fbbf24', border: '1px solid rgba(251,191,36,0.3)' }}>
                📱 Notificar ZIVO via WhatsApp
              </button>
            </div>
          )}

          {/* Normal request: description + GPS + submit */}
          {selectedRequestType && selectedRequestType !== 'accident' && (
            <>
              <p className="text-xs font-semibold uppercase tracking-widest mb-2" style={{ color: 'var(--muted)' }}>Descrição (opcional)</p>
              <textarea
                value={helpDescription}
                onChange={(e) => setHelpDescription(e.target.value)}
                placeholder="Descreve o problema..."
                rows={3}
                className="w-full rounded-xl px-4 py-3 text-sm focus:outline-none mb-4 resize-none"
                style={{ background: 'var(--card)', border: '1px solid var(--border)', color: 'var(--text)' }}
              />
              <div className="rounded-xl p-3 mb-5 flex items-center gap-2"
                style={{ background: helpGps ? 'rgba(34,197,94,0.08)' : 'rgba(107,114,128,0.08)', border: `1px solid ${helpGps ? 'rgba(34,197,94,0.2)' : 'var(--border)'}` }}>
                {helpGpsLoading ? (
                  <>
                    <div className="w-3 h-3 border border-t-transparent rounded-full animate-spin flex-shrink-0" style={{ borderColor: 'var(--muted)' }} />
                    <span className="text-xs" style={{ color: 'var(--muted)' }}>⏳ A obter localização...</span>
                  </>
                ) : helpGps ? (
                  <span className="text-xs font-semibold" style={{ color: '#22c55e' }}>
                    📍 GPS: {helpGps.lat.toFixed(4)}, {helpGps.lng.toFixed(4)}
                  </span>
                ) : (
                  <span className="text-xs" style={{ color: 'var(--muted)' }}>📍 GPS não disponível</span>
                )}
              </div>
              <button onClick={handleSubmitHelp}
                className="w-full text-white font-bold py-4 rounded-xl text-base"
                style={{ background: '#dc2626' }}>
                🆘 Enviar Pedido de Ajuda
              </button>
            </>
          )}
        </FullModal>
      )}

      {/* Register Modal */}
      {showRegister && (
        <FullModal onClose={() => setShowRegister(false)} title={t('register_service')}>
          <div className="space-y-4">
            <div>
              <label className="text-xs font-semibold uppercase tracking-wide block mb-1.5" style={{ color: 'var(--muted)' }}>{t('type')} *</label>
              <div className="flex gap-2">
                {(['mechanic', 'rescue'] as const).map((svcType) => (
                  <button key={svcType} onClick={() => setForm({ ...form, type: svcType })}
                    className="flex-1 py-3 rounded-xl border text-sm font-semibold capitalize"
                    style={{ background: form.type === svcType ? '#2d6fe8' : 'var(--card)', color: form.type === svcType ? 'white' : 'var(--muted)', borderColor: form.type === svcType ? '#2d6fe8' : 'var(--border)' }}>
                    {svcType === 'mechanic' ? `🔧 ${t('mechanic')}` : `🚑 ${t('rescue')}`}
                  </button>
                ))}
              </div>
            </div>
            <div>
              <label className="text-xs font-semibold uppercase tracking-wide block mb-1.5" style={{ color: 'var(--muted)' }}>{t('vehicle')} *</label>
              <div className="flex gap-2">
                {(['bike', 'moto', 'both'] as const).map((v) => (
                  <button key={v} onClick={() => setForm({ ...form, vehicle: v })}
                    className="flex-1 py-3 rounded-xl border text-xs font-semibold"
                    style={{ background: form.vehicle === v ? '#2d6fe8' : 'var(--card)', color: form.vehicle === v ? 'white' : 'var(--muted)', borderColor: form.vehicle === v ? '#2d6fe8' : 'var(--border)' }}>
                    {v === 'bike' ? `🚲 ${t('bike')}` : v === 'moto' ? `🏍️ ${t('moto')}` : `🚲🏍️ ${t('both')}`}
                  </button>
                ))}
              </div>
            </div>
            <div>
              <label className="text-xs font-semibold uppercase tracking-wide block mb-1.5" style={{ color: 'var(--muted)' }}>{t('phone')} *</label>
              <input value={form.phone} onChange={(e) => setForm({ ...form, phone: e.target.value })} placeholder="+353 8X XXX XXXX" type="tel"
                className="w-full rounded-xl px-4 py-3 text-sm focus:outline-none"
                style={{ background: 'var(--card)', border: '1px solid var(--border)', color: 'var(--text)' }} />
            </div>
            <div>
              <label className="text-xs font-semibold uppercase tracking-wide block mb-1.5" style={{ color: 'var(--muted)' }}>{t('area')} *</label>
              <input value={form.area} onChange={(e) => setForm({ ...form, area: e.target.value })} placeholder="e.g. Dublin City Centre"
                className="w-full rounded-xl px-4 py-3 text-sm focus:outline-none"
                style={{ background: 'var(--card)', border: '1px solid var(--border)', color: 'var(--text)' }} />
            </div>
            <div>
              <label className="text-xs font-semibold uppercase tracking-wide block mb-1.5" style={{ color: 'var(--muted)' }}>{t('description')}</label>
              <input value={form.description} onChange={(e) => setForm({ ...form, description: e.target.value })} placeholder="What services do you offer?"
                className="w-full rounded-xl px-4 py-3 text-sm focus:outline-none"
                style={{ background: 'var(--card)', border: '1px solid var(--border)', color: 'var(--text)' }} />
            </div>
            <button onClick={handleRegister} disabled={submitting}
              className="w-full text-white font-bold py-4 rounded-xl text-base disabled:opacity-60"
              style={{ background: 'linear-gradient(135deg, #4f8ef7 0%, #1a5fd4 100%)' }}>
              {submitting ? 'A enviar…' : t('submit_registration')}
            </button>
          </div>
        </FullModal>
      )}

      {/* Service Info Modal */}
      {selectedService && (
        <FullModal onClose={() => setSelectedService(null)} title="Service Info">
          <div className="flex items-center gap-3 mb-4">
            <span className="text-3xl">{selectedService.type === 'mechanic' ? '🔧' : '🚑'}</span>
            <div>
              <h3 className="text-xl font-bold" style={{ color: 'var(--text)' }}>{selectedService.name}</h3>
              <p className="text-sm" style={{ color: 'var(--muted)' }}>{selectedService.area}</p>
            </div>
          </div>
          <p className="text-sm mb-5" style={{ color: 'var(--text-dim)' }}>{selectedService.description}</p>
          <div className="grid grid-cols-3 gap-3 mb-6">
            {[['★ ' + selectedService.rating, 'Rating'], [selectedService.responseTime, 'Response'], [selectedService.vehicle, 'Vehicle']].map(([val, label]) => (
              <div key={label} className="rounded-xl p-3 text-center" style={{ background: 'var(--card)' }}>
                <p className="text-sm font-bold" style={{ color: 'var(--text)' }}>{val}</p>
                <p className="text-xs" style={{ color: 'var(--muted)' }}>{label}</p>
              </div>
            ))}
          </div>
          <button onClick={() => handleCall(selectedService)} disabled={!getServiceOnline(selectedService)}
            className="w-full text-white font-bold py-4 rounded-xl text-base disabled:opacity-50"
            style={{ background: 'linear-gradient(135deg, #4f8ef7 0%, #1a5fd4 100%)' }}>
            📞 Call {selectedService.name}
          </button>
        </FullModal>
      )}
    </div>
  )
}
