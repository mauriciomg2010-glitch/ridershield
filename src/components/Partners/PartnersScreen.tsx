// src/components/Partners/PartnersScreen.tsx
'use client'
import { useState, useEffect } from 'react'
import { useLang } from '@/contexts/LangContext'
import { getPartners, Partner } from '@/lib/firestore'

export default function PartnersScreen() {
  const { t } = useLang()
  const [partners, setPartners] = useState<Partner[]>([])
  const [loading, setLoading] = useState(true)
  const [expanded, setExpanded] = useState<string | null>(null)

  useEffect(() => {
    getPartners()
      .then(setPartners)
      .catch(() => setPartners([]))
      .finally(() => setLoading(false))
  }, [])

  return (
    <div className="flex flex-col min-h-full pb-24" style={{ background: 'var(--bg)' }}>
      <div className="px-5 pt-8 pb-4" style={{ background: 'var(--surface)', borderBottom: '1px solid var(--border)' }}>
        <h1 className="text-xl font-bold" style={{ color: 'var(--text)' }}>🤝 {t('partners')}</h1>
        <p className="text-sm mt-1" style={{ color: 'var(--muted)' }}>{t('partners_desc')}</p>
      </div>

      <div className="px-4 py-4 space-y-4">
        {loading ? (
          <div className="flex justify-center py-12">
            <div className="w-8 h-8 border-2 border-t-transparent rounded-full animate-spin" style={{ borderColor: '#2d6fe8', borderTopColor: 'transparent' }} />
          </div>
        ) : partners.length === 0 ? (
          <div className="rounded-2xl p-8 text-center" style={{ background: 'var(--surface)', border: '1px dashed var(--border)' }}>
            <p className="text-2xl mb-2">🤝</p>
            <p className="text-sm font-semibold" style={{ color: 'var(--text)' }}>Em breve</p>
            <p className="text-xs mt-1" style={{ color: 'var(--muted)' }}>Parceiros exclusivos para riders</p>
          </div>
        ) : (
          partners.map(p => {
            const color = p.color ?? '#2d6fe8'
            return (
              <div key={p.id} className="rounded-2xl overflow-hidden"
                style={{ background: 'var(--surface)', border: `1px solid ${color}50` }}>

                {/* Card header */}
                <div className="px-5 py-4 flex items-center gap-3"
                  style={{ borderBottom: `1px solid ${color}20` }}>
                  <div className="w-12 h-12 rounded-xl flex items-center justify-center text-2xl flex-shrink-0"
                    style={{ background: `${color}20` }}>
                    {p.emoji ?? '🤝'}
                  </div>
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 flex-wrap">
                      <h3 className="font-bold text-base" style={{ color: 'var(--text)' }}>{p.name}</h3>
                      <span className="text-xs font-bold px-2 py-0.5 rounded-full flex-shrink-0"
                        style={{ background: `${color}20`, color }}>
                        {p.offer}
                      </span>
                    </div>
                    <span className="text-xs font-semibold" style={{ color }}>🤝 {t('ridershield_partner')}</span>
                  </div>
                </div>

                {/* Description */}
                {p.description && (
                  <div className="px-5 pt-3">
                    <p className="text-sm leading-relaxed" style={{ color: 'var(--muted)' }}>{p.description}</p>
                  </div>
                )}

                {/* Offer badge */}
                <div className="px-5 py-4">
                  <div className="rounded-xl px-4 py-3 text-sm font-semibold text-center"
                    style={{ background: `${color}15`, border: `1px solid ${color}30`, color }}>
                    {p.offer}
                  </div>
                </div>
              </div>
            )
          })
        )}

        {/* More coming soon */}
        {!loading && (
          <div className="rounded-2xl p-5 text-center"
            style={{ background: 'var(--surface)', border: '1px dashed var(--border)' }}>
            <p className="text-2xl mb-2">🔜</p>
            <p className="text-sm font-semibold" style={{ color: 'var(--text)' }}>{t('more_partners_coming')}</p>
            <p className="text-xs mt-1" style={{ color: 'var(--muted)' }}>{t('more_partners_desc')}</p>
          </div>
        )}
      </div>
    </div>
  )
}
