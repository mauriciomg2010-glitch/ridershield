// src/components/Safety/SafetyScreen.tsx
'use client'
import { useState } from 'react'
import { useStore } from '@/lib/store'
import { useLang } from '@/contexts/LangContext'
import toast from 'react-hot-toast'

interface ZoneSuggestion {
  id: string; name: string; description: string; type: string; votes: number
}

function FullModal({ onClose, title, children }: { onClose: () => void; title: string; children: React.ReactNode }) {
  return (
    <div className="fixed inset-0 z-[500] flex flex-col" style={{ background: 'var(--surface)' }}>
      <div className="flex items-center justify-between px-5 pt-14 pb-4 border-b flex-shrink-0" style={{ borderColor: 'var(--border)' }}>
        <h2 className="text-xl font-bold" style={{ color: 'var(--text)' }}>{title}</h2>
        <button onClick={onClose} className="w-9 h-9 rounded-full flex items-center justify-center text-lg" style={{ background: 'var(--card)', color: 'var(--muted)' }}>✕</button>
      </div>
      <div className="flex-1 overflow-y-auto px-5 py-4">
        {children}
        <div style={{ height: '100px' }} />
      </div>
    </div>
  )
}

export default function SafetyScreen() {
  const currentLocation = useStore((s) => s.currentLocation)
  const { t } = useLang()
  const [showSuggest, setShowSuggest] = useState(false)
  const [suggestions, setSuggestions] = useState<ZoneSuggestion[]>([
    { id: 'sg1', name: 'Cloverhill Road', description: 'Multiple riders report being followed here at night. Avoid after 22:00.', type: 'suspicious_activity', votes: 3 },
    { id: 'sg2', name: 'Blanchardstown Centre back car park', description: '2 bikes stolen in past month. No CCTV coverage in north corner.', type: 'theft', votes: 7 },
    { id: 'sg3', name: 'Tallaght Hospital car park', description: 'Scooter theft reported. Well-lit but isolated at night.', type: 'theft', votes: 4 },
  ])
  const [form, setForm] = useState({ name: '', description: '', type: 'theft' })
  const [voted, setVoted] = useState<Set<string>>(new Set())
  const [showInsurance, setShowInsurance] = useState(false)
  const [insuranceTab, setInsuranceTab] = useState<'ebike' | 'moto' | 'car'>('ebike')

  function openSuggest() {
    if (currentLocation && !form.name) {
      setForm(f => ({ ...f, name: `${currentLocation.lat.toFixed(4)}, ${currentLocation.lng.toFixed(4)}` }))
    }
    setShowSuggest(true)
  }

  function handleSuggest() {
    if (!form.name || !form.description) return toast.error('Fill in location name and description')
    const newSug: ZoneSuggestion = { id: Date.now().toString(), name: form.name, description: form.description, type: form.type, votes: 1 }
    setSuggestions([newSug, ...suggestions])
    setForm({ name: '', description: '', type: 'theft' })
    setShowSuggest(false)
    toast.success('Suggestion submitted! Community can now vote.')
  }

  function handleVote(id: string) {
    if (voted.has(id)) return toast.error('Already voted!')
    setSuggestions(suggestions.map((s) => s.id === id ? { ...s, votes: s.votes + 1 } : s))
    setVoted(new Set([...voted, id]))
    toast.success('Vote counted! ▲')
  }

  return (
    <div className="flex flex-col h-full pb-20" style={{ background: 'var(--bg)' }}>
      <div className="px-5 pt-14 pb-4 border-b" style={{ background: 'var(--surface)', borderColor: 'var(--border)' }}>
        <h1 className="text-2xl font-bold" style={{ color: 'var(--text)' }}>{t('safety_hub')}</h1>
        <p className="text-sm mt-0.5" style={{ color: 'var(--muted)' }}>{t('safety_hub_desc')}</p>
      </div>

      <div className="flex-1 overflow-y-auto px-5 py-4 space-y-5">

        {/* Insurance Banner */}
        <div
          className="relative rounded-xl overflow-hidden cursor-pointer"
          style={{ border: '1px solid var(--border)' }}
          onClick={() => window.open('https://bikmo.com/ie/?utm_source=chatgpt.com', '_blank')}
        >
          <img
            src="/images/Publicidade_INSURANCE.png"
            alt="Insurance — Sponsored"
            style={{ width: '100%', display: 'block', borderRadius: '12px' }}
          />
          <span style={{
            position: 'absolute', top: '8px', right: '8px',
            background: 'rgba(0,0,0,0.55)', color: 'white',
            fontSize: '10px', padding: '2px 8px', borderRadius: '20px',
            backdropFilter: 'blur(4px)',
          }}>
            {t('sponsored')}
          </span>
        </div>

        {/* Seguradoras button */}
        <button
          onClick={() => { setShowInsurance(true); setInsuranceTab('ebike') }}
          className="w-full flex items-center gap-3 rounded-2xl px-5 py-4"
          style={{ background: 'rgba(45,111,232,0.08)', border: '1px solid rgba(45,111,232,0.25)' }}
        >
          <span style={{ fontSize: 24 }}>🛡️</span>
          <div className="flex-1 text-left">
            <p className="font-bold text-sm" style={{ color: '#93c5fd' }}>Seguradoras</p>
            <p className="text-xs" style={{ color: 'var(--muted)' }}>E-Bike · Moto · Carro — comparar planos</p>
          </div>
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="#4f8ef7" strokeWidth="2">
            <polyline points="9 18 15 12 9 6" />
          </svg>
        </button>

        {/* E-Bike Laws */}
        <div>
          <p className="text-sm font-bold mb-1" style={{ color: 'var(--text)' }}>⚖️ {t('ebike_laws_title')}</p>
          <p className="text-xs mb-3" style={{ color: 'var(--muted)' }}>{t('ebike_laws_subtitle')}</p>
          <div className="space-y-2">
            {([
              { icon: '📋', color: '#059669', titleKey: 'card1_title', subtitle: 'Gov.ie — Official Irish Government legislation', url: 'https://www.gov.ie/en/department-of-transport/publications/e-bikes/' },
              { icon: '⚠️', color: '#d97706', titleKey: 'card2_title', subtitle: 'RSA — Road Safety Authority Ireland', url: 'https://www.rsa.ie/road-safety/road-users/special-purpose-vehicles/powered-personal-transportation' },
              { icon: '🚨', color: '#dc2626', titleKey: 'card3_title', subtitle: 'Official notice — Garda Síochána', url: 'https://www.garda.ie/en/crime-prevention/crimecall-on-rte/crimecall-episodes/2026/23-february/roads-policing-message-dangers-and-illegal-use-of-scramblers-e-scooters-and-e-bikes-in-ireland.html' },
            ] as const).map((card) => (
              <button
                key={card.url}
                onClick={() => window.open(card.url, '_blank')}
                className="w-full text-left"
                style={{
                  background: 'var(--card)',
                  borderWidth: '1px 1px 1px 4px',
                  borderStyle: 'solid',
                  borderColor: `var(--border) var(--border) var(--border) ${card.color}`,
                  borderRadius: '10px',
                  padding: '14px 16px',
                  display: 'flex',
                  alignItems: 'center',
                  gap: '12px',
                }}
              >
                <span style={{ fontSize: '20px', flexShrink: 0 }}>{card.icon}</span>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <p className="font-bold text-sm" style={{ color: 'var(--text)' }}>{t(card.titleKey)}</p>
                  <p className="text-xs mt-0.5" style={{ color: 'var(--muted)' }}>{card.subtitle}</p>
                  <p className="text-xs mt-1.5 font-medium" style={{ color: card.color }}>Tap to read →</p>
                </div>
                <span style={{ color: 'var(--muted)', flexShrink: 0, fontSize: '16px' }}>›</span>
              </button>
            ))}
          </div>
        </div>

        {/* Community Suggestions */}
        <div>
          <div className="flex items-center justify-between mb-3">
            <p className="text-sm font-bold" style={{ color: 'var(--text)' }}>📍 {t('community_suggestions')}</p>
            <button onClick={openSuggest} className="text-xs font-semibold px-3 py-1.5 rounded-lg"
              style={{ color: '#4f8ef7', border: '1px solid rgba(45,111,232,0.3)' }}>+ {t('suggest_area')}</button>
          </div>
          <p className="text-xs mb-3" style={{ color: 'var(--muted)' }}>Community-reported areas not yet on the official map. Vote to escalate to admin.</p>
          <div className="space-y-2">
            {suggestions.sort((a, b) => b.votes - a.votes).map((s) => (
              <div key={s.id} className="rounded-2xl p-4 flex items-start gap-3" style={{ background: 'var(--card)', border: '1px solid var(--border)' }}>
                <div className="flex-1">
                  <h4 className="font-bold text-sm" style={{ color: 'var(--text)' }}>{s.name}</h4>
                  <p className="text-xs mt-1" style={{ color: 'var(--muted)' }}>{s.description}</p>
                  <span className="text-xs mt-1 inline-block px-2 py-0.5 rounded-full" style={{ background: 'rgba(239,68,68,0.1)', color: '#f87171' }}>{s.type.replace('_', ' ')}</span>
                </div>
                <button onClick={() => handleVote(s.id)}
                  className="flex flex-col items-center gap-0.5 px-3 py-2 rounded-xl flex-shrink-0"
                  style={{ background: voted.has(s.id) ? 'rgba(45,111,232,0.2)' : 'rgba(45,111,232,0.1)', border: `1px solid ${voted.has(s.id) ? '#2d6fe8' : 'rgba(45,111,232,0.2)'}` }}>
                  <span className="text-base" style={{ color: voted.has(s.id) ? '#2d6fe8' : '#4f8ef7' }}>▲</span>
                  <span className="text-xs font-bold" style={{ color: '#4f8ef7' }}>{s.votes}</span>
                </button>
              </div>
            ))}
          </div>
        </div>

        {/* Bike & Moto Security */}
        <div className="rounded-2xl overflow-hidden" style={{ background: '#1a0a2e', border: '1px solid #4c1d95' }}>
          <div className="px-4 pt-4 pb-3" style={{ borderBottom: '1px solid rgba(76,29,149,0.5)' }}>
            <p className="font-bold text-sm" style={{ color: '#c4b5fd' }}>🔒 {t('bike_moto_security')}</p>
            <p className="text-xs mt-0.5" style={{ color: '#2d6fe8' }}>{t('tips_vehicle_safe')}</p>
          </div>
          <div className="p-4">
            <p className="text-xs font-semibold mb-2" style={{ color: '#93c5fd' }}>⚡ {t('anti_theft_tips')}</p>
            {[t('tips_vehicle_tip1'), t('tips_vehicle_tip2'), t('tips_vehicle_tip3'), t('tips_vehicle_tip4'), t('tips_vehicle_tip5')].map((tip, i) => (
              <div key={i} className="flex gap-2 mb-2">
                <span style={{ color: '#4f8ef7' }}>•</span>
                <p className="text-xs" style={{ color: '#c4b5fd' }}>{tip}</p>
              </div>
            ))}
          </div>
        </div>

      </div>

      {/* Insurance Modal */}
      {showInsurance && (
        <FullModal onClose={() => setShowInsurance(false)} title="🛡️ Seguradoras">
          {/* Tabs */}
          <div className="flex gap-2 mb-5">
            {([
              { id: 'ebike', label: '🚲 E-Bike' },
              { id: 'moto',  label: '🏍️ Moto' },
              { id: 'car',   label: '🚗 Carro' },
            ] as { id: typeof insuranceTab; label: string }[]).map(tab => (
              <button key={tab.id} onClick={() => setInsuranceTab(tab.id)}
                className="flex-1 py-2.5 rounded-xl text-sm font-bold"
                style={{ background: insuranceTab === tab.id ? '#2d6fe8' : 'var(--card)', color: insuranceTab === tab.id ? 'white' : 'var(--muted)', border: `1px solid ${insuranceTab === tab.id ? '#2d6fe8' : 'var(--border)'}` }}>
                {tab.label}
              </button>
            ))}
          </div>

          <div className="space-y-3">
            {insuranceTab === 'ebike' && ([
              { name: 'Bikmo Ireland', desc: 'Seguro específico para e-bikes. Cobre furto, danos acidentais e bateria. A partir de ~€150/ano.', url: 'https://bikmo.com/ie', btn: 'Ver planos →' },
              { name: 'Qover Bike Insurance', desc: 'Seguro flexível para bikes e e-bikes. Sem depreciação nos primeiros 3 anos. A partir de €5/mês.', url: 'https://bike.qover.com/en-ie', btn: 'Ver planos →' },
              { name: 'Ucompare — Bicycle Insurance', desc: 'Comparador de seguros de bicicleta. Compara múltiplas seguradoras ao mesmo tempo.', url: 'https://ucompare.ie/bicycle-insurance', btn: 'Comparar →' },
            ] as { name: string; desc: string; url: string; btn: string; phone?: string }[]).map(ins => (
              <InsuranceCard key={ins.name} {...ins} color="#4f8ef7" />
            ))}
            {insuranceTab === 'moto' && ([
              { name: 'AXA Ireland — Motorbike', desc: 'Maior seguradora de motos em Ireland. Plano Bikecare (mopeds/50cc) e Easirider (motos completas). Desconto 40% se tiveres carro na AXA.', url: 'https://www.axa.ie/motorbike-insurance', phone: '1890 24 7 365', btn: 'Pedir orçamento →' },
              { name: 'Carole Nash Ireland', desc: 'Especialistas em motos desde 1999. Cobre todos os tipos. Até €130,000 em despesas legais. Breakdown assistance na EU.', url: 'https://www.carolenash.ie/motorbike-insurance', phone: '1800 818 751', btn: 'Pedir orçamento →' },
              { name: 'Principal Insurance', desc: 'Broker que compara múltiplas seguradoras. Ideal para motos clássicas, custom e scooters. Sem limite em modificações legais.', url: 'https://www.principalinsurance.ie', btn: 'Comparar →' },
            ] as { name: string; desc: string; url: string; btn: string; phone?: string }[]).map(ins => (
              <InsuranceCard key={ins.name} {...ins} color="#f97316" />
            ))}
            {insuranceTab === 'car' && ([
              { name: 'AXA Car Insurance', desc: 'Líder em Ireland. Totalmente online. Desconto de até 60% por anos sem sinistros.', url: 'https://www.axa.ie/car-insurance', btn: 'Pedir orçamento →' },
              { name: 'Liberty Insurance', desc: 'Segunda maior seguradora de carros em Ireland. Forte em Dublin. Boas avaliações de clientes.', url: 'https://www.libertyinsurance.ie', btn: 'Pedir orçamento →' },
              { name: 'Paddy Compare', desc: 'Comparador irlandês. Compara AXA, Liberty, Allianz e mais numa só pesquisa.', url: 'https://www.paddycompare.ie/car-insurance', btn: 'Comparar →' },
            ] as { name: string; desc: string; url: string; btn: string; phone?: string }[]).map(ins => (
              <InsuranceCard key={ins.name} {...ins} color="#22c55e" />
            ))}
          </div>

          {/* Disclaimer */}
          <div className="mt-6 rounded-xl px-4 py-3 text-center"
            style={{ background: 'rgba(255,255,255,0.04)', border: '1px solid var(--border)' }}>
            <p className="text-xs leading-relaxed" style={{ color: 'var(--muted)' }}>
              ZIVO não é um intermediário de seguros.<br />
              Os links redirecionam para os sites oficiais das seguradoras.
            </p>
          </div>
        </FullModal>
      )}

      {/* Suggest Zone Modal */}
      {showSuggest && (
        <FullModal onClose={() => setShowSuggest(false)} title={t('suggest_area')}>
          <p className="text-sm mb-4" style={{ color: 'var(--muted)' }}>{t('know_dangerous')}</p>
          {currentLocation && (
            <div className="rounded-xl p-3 mb-4 flex items-center gap-2" style={{ background: 'rgba(34,197,94,0.1)', border: '1px solid rgba(34,197,94,0.2)' }}>
              <span className="text-green-400">📍</span>
              <p className="text-xs" style={{ color: '#4ade80' }}>GPS: {currentLocation.lat.toFixed(4)}, {currentLocation.lng.toFixed(4)}</p>
            </div>
          )}
          <div className="space-y-4">
            <div>
              <label className="text-xs font-semibold uppercase tracking-wide block mb-1.5" style={{ color: 'var(--muted)' }}>{t('location_name_label')} *</label>
              <input value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })}
                placeholder={t('location_placeholder_gps')}
                className="w-full rounded-xl px-4 py-3 text-sm focus:outline-none"
                style={{ background: 'var(--card)', border: '1px solid var(--border)', color: 'var(--text)' }} />
            </div>
            <div>
              <label className="text-xs font-semibold uppercase tracking-wide block mb-1.5" style={{ color: 'var(--muted)' }}>{t('risk_type')}</label>
              <div className="grid grid-cols-2 gap-2">
                {['theft', 'robbery', 'aggression', 'suspicious_activity'].map((riskType) => (
                  <button key={riskType} onClick={() => setForm({ ...form, type: riskType })}
                    className="py-2.5 rounded-xl text-xs font-semibold"
                    style={{ background: form.type === riskType ? '#2d6fe8' : 'var(--card)', color: form.type === riskType ? 'white' : 'var(--muted)', border: `1px solid ${form.type === riskType ? '#2d6fe8' : 'var(--border)'}` }}>
                    {riskType === 'theft' ? t('theft') : riskType === 'robbery' ? t('robbery') : riskType === 'aggression' ? t('aggression_risk') : t('suspicious')}
                  </button>
                ))}
              </div>
            </div>
            <div>
              <label className="text-xs font-semibold uppercase tracking-wide block mb-1.5" style={{ color: 'var(--muted)' }}>{t('description_optional')} *</label>
              <textarea value={form.description} onChange={(e) => setForm({ ...form, description: e.target.value })}
                placeholder={t('describe_area')} rows={4}
                className="w-full rounded-xl px-4 py-3 text-sm focus:outline-none resize-none"
                style={{ background: 'var(--card)', border: '1px solid var(--border)', color: 'var(--text)' }} />
            </div>
            <button onClick={handleSuggest} className="w-full text-white font-bold py-4 rounded-xl" style={{ background: 'linear-gradient(135deg, #4f8ef7 0%, #1a5fd4 100%)' }}>
              📍 {t('submit_suggestion')}
            </button>
          </div>
        </FullModal>
      )}
    </div>
  )
}

function InsuranceCard({ name, desc, url, btn, phone, color }: { name: string; desc: string; url: string; btn: string; phone?: string; color: string }) {
  return (
    <div className="rounded-2xl p-4" style={{ background: 'var(--card)', border: `1px solid ${color}30` }}>
      <div className="flex items-start justify-between gap-2 mb-2">
        <h3 className="font-bold text-sm leading-snug" style={{ color: 'var(--text)' }}>{name}</h3>
      </div>
      <p className="text-xs mb-3 leading-relaxed" style={{ color: 'var(--muted)' }}>{desc}</p>
      {phone && (
        <p className="text-xs mb-3 font-mono" style={{ color: 'var(--muted)' }}>📞 {phone}</p>
      )}
      <button
        onClick={() => window.open(url, '_blank')}
        className="w-full py-2.5 rounded-xl text-sm font-bold"
        style={{ background: `${color}18`, color, border: `1px solid ${color}40` }}>
        {btn}
      </button>
    </div>
  )
}
