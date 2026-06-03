// src/components/Layout/BottomNav.tsx
'use client'
import { useStore } from '@/lib/store'
import { useLang } from '@/contexts/LangContext'

export type Tab = 'map' | 'groups' | 'report' | 'services' | 'safety' | 'earnings' | 'profile' | 'partners' | 'service-requests' | 'my-services'

interface Props {
  activeTab: Tab
  onTabChange: (tab: Tab) => void
  onMenuClick: () => void
  onSOSClick: () => void
}

const IC = (active: boolean) => active ? '#f59e0b' : '#64748b'

export default function BottomNav({ activeTab, onTabChange, onMenuClick, onSOSClick }: Props) {
  const alerts = useStore((s) => s.alerts)
  const hasAlerts = alerts.some((a) => Date.now() - a.timestamp.getTime() < 5 * 60 * 1000)
  const { t } = useLang()

  return (
    <nav className="fixed bottom-0 left-0 right-0 z-50 safe-area-pb" style={{ background: 'var(--surface)', borderTop: '1px solid var(--border)' }}>
      <div className="flex items-center justify-around px-1 h-16">

        {/* Map */}
        <button onClick={() => onTabChange('map')}
          className="flex flex-col items-center justify-center gap-0.5 flex-1 h-full">
          <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke={IC(activeTab === 'map')} strokeWidth="2">
            <polygon points="3 6 9 3 15 6 21 3 21 18 15 21 9 18 3 21"/>
            <line x1="9" y1="3" x2="9" y2="18"/><line x1="15" y1="6" x2="15" y2="21"/>
          </svg>
          <span style={{ color: IC(activeTab === 'map'), fontSize: '10px', fontWeight: 500 }}>{t('map')}</span>
        </button>

        {/* Groups */}
        <button onClick={() => onTabChange('groups')}
          className="flex flex-col items-center justify-center gap-0.5 flex-1 h-full relative">
          {hasAlerts && <span className="absolute top-2 right-1/4 w-2 h-2 bg-red-500 rounded-full" />}
          <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke={IC(activeTab === 'groups')} strokeWidth="2">
            <path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2"/>
            <circle cx="9" cy="7" r="4"/>
            <path d="M23 21v-2a4 4 0 0 0-3-3.87"/><path d="M16 3.13a4 4 0 0 1 0 7.75"/>
          </svg>
          <span style={{ color: IC(activeTab === 'groups'), fontSize: '10px', fontWeight: 500 }}>{t('groups')}</span>
        </button>

        {/* SOS — red FAB (centre) */}
        <button onClick={onSOSClick} className="flex flex-col items-center justify-center" style={{ marginTop: '-16px' }}>
          <div
            className="active:scale-95 transition-transform"
            style={{
              width: 56, height: 56, borderRadius: '50%',
              background: '#8b0000',
              border: '2px solid #dc3545',
              display: 'flex', alignItems: 'center', justifyContent: 'center',
              animation: 'sosRingPulse 1.5s ease-in-out infinite',
            }}
          >
            <svg width="26" height="26" viewBox="0 0 24 24" fill="none">
              <path d="M12 2L3 7v5c0 5.25 3.75 10.15 9 11.35C17.25 22.15 21 17.25 21 12V7L12 2z" fill="white"/>
              <line x1="11" y1="7" x2="13" y2="17" stroke="#dc3545" strokeWidth="2" strokeLinecap="round"/>
            </svg>
          </div>
          <span style={{ color: '#dc3545', fontSize: '10px', fontWeight: 700, marginTop: 2 }}>SOS</span>
        </button>

        {/* Earnings */}
        <button onClick={() => onTabChange('earnings')}
          className="flex flex-col items-center justify-center gap-0.5 flex-1 h-full">
          <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke={IC(activeTab === 'earnings')} strokeWidth="2">
            <line x1="12" y1="1" x2="12" y2="23"/>
            <path d="M17 5H9.5a3.5 3.5 0 0 0 0 7h5a3.5 3.5 0 0 1 0 7H6"/>
          </svg>
          <span style={{ color: IC(activeTab === 'earnings'), fontSize: '10px', fontWeight: 500 }}>Ganhos</span>
        </button>

        {/* Menu (hamburger) */}
        <button onClick={onMenuClick}
          className="flex flex-col items-center justify-center gap-0.5 flex-1 h-full">
          <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="#64748b" strokeWidth="2">
            <line x1="3" y1="6" x2="21" y2="6"/>
            <line x1="3" y1="12" x2="21" y2="12"/>
            <line x1="3" y1="18" x2="21" y2="18"/>
          </svg>
          <span style={{ color: '#64748b', fontSize: '10px', fontWeight: 500 }}>Menu</span>
        </button>

      </div>
    </nav>
  )
}
