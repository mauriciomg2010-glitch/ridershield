// src/app/page.tsx
'use client'
import { useState, useEffect, useRef } from 'react'
import { useAuth } from '@/contexts/AuthContext'
import { useStore } from '@/lib/store'
import { useGeolocation } from '@/hooks/useGeolocation'
import { getDemoInfo } from '@/lib/demo'
import { getEmergencyContacts, saveEmergencyContacts, clearLocation, clearGlobalPresence, seedTestService, getOwnedService, publishServicePresence, clearServicePresence, seedPartners, seedServiceProviders, migrateServiceProvidersV2, migrateServiceProvidersV3, migrateManualZonesSource } from '@/lib/firestore'
// firebase/firestore direct imports removed — all Firestore access goes through src/lib/firestore.ts
import { EmergencyContacts } from '@/types'
import AuthScreen from '@/components/Auth/AuthScreen'
import BottomNav, { Tab } from '@/components/Layout/BottomNav'
import ReportModal from '@/components/Report/ReportModal'
import GroupsScreen from '@/components/Groups/GroupsScreen'
import ServicesScreen from '@/components/Services/ServicesScreen'
import EarningsScreen from '@/components/Earnings/EarningsScreen'
import SafetyScreen from '@/components/Safety/SafetyScreen'
import FeedbackButton from '@/components/Feedback/FeedbackButton'
import BetaBanner from '@/components/Layout/BetaBanner'
import SideMenu from '@/components/Layout/SideMenu'
import SOSModal from '@/components/Layout/SOSModal'
import PartnersScreen from '@/components/Partners/PartnersScreen'
import ServiceRequestsScreen from '@/components/Services/ServiceRequestsScreen'
import MyServicesScreen from '@/components/Services/MyServicesScreen'
import MechanicAlertOverlay from '@/components/Services/MechanicAlertOverlay'
import OnboardingScreen from '@/components/Onboarding/OnboardingScreen'
import UpgradeScreen from '@/components/Upgrade/UpgradeScreen'
import ShiftBar from '@/components/Shift/ShiftBar'
import { useShift } from '@/contexts/ShiftContext'
import MapSearchBar from '@/components/Map/MapSearchBar'
import dynamic from 'next/dynamic'
import SafeBoundary from '@/components/SafeBoundary'
import GroupSosListener from '@/components/Groups/GroupSosListener'

const SHOW_DEMO_BANNER = false

const CATEGORIES = [
  { key: 'charging',  label: 'Recarga',    icon: '🔋', query: 'ev charging station' },
  { key: 'mechanic',  label: 'Mecânico',   icon: '🔧', query: 'bicycle repair' },
  { key: 'cafe',      label: 'Pausa',      icon: '☕', query: 'cafe coffee' },
  { key: 'hospital',  label: 'Emergência', icon: '🏥', query: 'hospital' },
  { key: 'partners',  label: 'Parceiros',  icon: '🤝', query: '' },
] as const

const MapView = dynamic(() => import('@/components/Map/MapView'), {
  ssr: false,
  loading: () => (
    <div className="flex-1 flex items-center justify-center" style={{background:'var(--bg)'}}>
      <div className="text-center">
        <div className="w-10 h-10 border-2 border-t-transparent rounded-full animate-spin mx-auto mb-3" style={{borderColor:'#d97706',borderTopColor:'transparent'}} />
        <p className="text-sm" style={{color:'var(--muted)'}}>Loading map…</p>
      </div>
    </div>
  ),
})

export default function Home() {
  const { firebaseUser, loading } = useAuth()
  const { isActive: isShiftActive } = useShift()
  const user = useStore((s) => s.user)
  const setUser = useStore((s) => s.setUser)
  const setEmergencyContacts = useStore((s) => s.setEmergencyContacts)
  const isSharingLocation = useStore((s) => s.isSharingLocation)
  const setIsSharingLocation = useStore((s) => s.setIsSharingLocation)
  const activeGroupId = useStore((s) => s.activeGroupId)
  const currentLocation = useStore((s) => s.currentLocation)
  const [activeTab, setActiveTab] = useState<Tab>('map')
  const [showReport, setShowReport] = useState(false)
  const [reportLocation, setReportLocation] = useState<{ lat: number; lng: number; timestamp?: number } | null>(null)
  const [showFeedback, setShowFeedback] = useState(false)
  const [showSideMenu, setShowSideMenu] = useState(false)
  const [showSOS, setShowSOS] = useState(false)
  const [showOnboarding, setShowOnboarding] = useState(false)
  const [demoInfo, setDemoInfo] = useState({ isDemo: false, daysLeft: 0 })
  const [isNavigating, setIsNavigating] = useState(false)
  const [isModeSelector, setIsModeSelector] = useState(false)
  const [searchDest, setSearchDest] = useState<{ lat: number; lng: number } | null>(null)
  const [activeSearchCategory, setActiveSearchCategory] = useState<typeof CATEGORIES[number] | null>(null)
  const [categoryLoading, setCategoryLoading] = useState(false)
  const [showUpgradeScreen, setShowUpgradeScreen] = useState(false)

  useGeolocation({
    groupId: activeGroupId || undefined,
    userId: user?.id,
    enabled: isSharingLocation,
  })

  const ADMIN_UID = 'kXNpNTLYe5P55PhI8K4VrZSahOC2'
  const ADMIN_SEED: EmergencyContacts = {
    contact1: { name: 'Daiane', phone: '+353830923483' },
    contact2: { name: 'Thiago', phone: '+353830923679' },
    guardaNumber: '112',
  }

  // NOTE: One-time zone cleanup (mapaClearedV2) was permanently removed.
  // It used localStorage as guard, which failed on new devices/browsers and wiped ALL zones.

  // Show onboarding on first login
  useEffect(() => {
    if (firebaseUser?.uid && user) {
      if (!localStorage.getItem(`ridershield_onboarding_${firebaseUser.uid}`)) {
        setShowOnboarding(true)
      }
    }
  }, [firebaseUser?.uid, user?.id])

  // Load emergency contacts; seed admin defaults if none exist
  useEffect(() => {
    if (!firebaseUser?.uid) return
    getEmergencyContacts(firebaseUser.uid).then(async (contacts) => {
      if (contacts) {
        setEmergencyContacts(contacts)
      } else if (firebaseUser.uid === ADMIN_UID) {
        await saveEmergencyContacts(firebaseUser.uid, ADMIN_SEED)
        setEmergencyContacts(ADMIN_SEED)
      } else {
        setEmergencyContacts(null)
      }
    })
  }, [firebaseUser?.uid])

  // Clear location on page unload
  useEffect(() => {
    if (!user?.id || !isSharingLocation || !activeGroupId) return
    const cleanup = () => { clearLocation(user.id, activeGroupId); clearGlobalPresence(user.id) }
    window.addEventListener('beforeunload', cleanup)
    return () => window.removeEventListener('beforeunload', cleanup)
  }, [user?.id, activeGroupId, isSharingLocation])

  // Initialize location sharing from localStorage — default enabled on first use (MELHORIA 5)
  useEffect(() => {
    if (!user?.id) return
    const saved = localStorage.getItem('locationSharing')
    if (saved === null) {
      setIsSharingLocation(true)
      localStorage.setItem('locationSharing', 'true')
    } else {
      setIsSharingLocation(saved === 'true')
    }
  }, [user?.id])

  // Apply demo mode — unlock premium for 15 days
  useEffect(() => {
    const info = getDemoInfo()
    setDemoInfo(info)
    if (info.isDemo && user && !user.isPremium) {
      setUser({ ...user, isPremium: true })
    }
  }, [user?.id])

  // Seed / migrate collections once on mount
  useEffect(() => {
    seedPartners().catch(() => {})
    seedServiceProviders().catch(() => {})
    migrateServiceProvidersV2().catch(() => {})
    migrateServiceProvidersV3().catch(() => {})
    migrateManualZonesSource().catch(() => {})  // stamps source:'admin_manual' on legacy manual zones
  }, [])

  // Seed test service (admin only, once) + publish service owner presence
  useEffect(() => {
    if (!user?.id) return
    if (firebaseUser?.uid === ADMIN_UID) {
      seedTestService()
    }
    getOwnedService(user.id).then((owned) => {
      if (!owned) return
      publishServicePresence(owned.id, user.id)
      const cleanup = () => clearServicePresence(owned.id)
      window.addEventListener('beforeunload', cleanup)
      // Store cleanup ref on window to avoid duplicate listeners across re-renders
      ;(window as any).__svcPresenceCleanup = cleanup
    })
    return () => {
      const cleanup = (window as any).__svcPresenceCleanup
      if (cleanup) window.removeEventListener('beforeunload', cleanup)
    }
  }, [user?.id])

  if (loading) {
    return (
      <div style={{ position: 'fixed', inset: 0, background: '#0a0e1a', display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', zIndex: 9999 }}>
        {/* Radial glow */}
        <div style={{ position: 'absolute', width: 320, height: 320, borderRadius: '50%', background: 'radial-gradient(circle, rgba(245,158,11,0.12) 0%, transparent 70%)', pointerEvents: 'none' }} />
        {/* Shield logo with glow */}
        <div style={{ position: 'relative', marginBottom: 28 }}>
          <div style={{ position: 'absolute', inset: -20, borderRadius: '50%', background: 'radial-gradient(circle, rgba(245,158,11,0.22) 0%, transparent 70%)', filter: 'blur(14px)', pointerEvents: 'none' }} />
          <img src="/icons/icon-zivo.svg" alt="ZIVO" width={112} height={112} style={{ position: 'relative', borderRadius: 28 }} />
        </div>
        <h1 style={{ fontSize: 52, fontWeight: 900, color: 'white', letterSpacing: -2, margin: 0, lineHeight: 1 }}>ZIVO</h1>
        <p style={{ fontSize: 15, color: 'rgba(255,255,255,0.45)', marginTop: 10, letterSpacing: 1.5, textTransform: 'uppercase', fontWeight: 500 }}>Ride smart. Go home.</p>
        <div className="animate-spin" style={{ marginTop: 52, width: 28, height: 28, borderRadius: '50%', border: '2.5px solid rgba(245,158,11,0.25)', borderTopColor: '#f59e0b' }} />
      </div>
    )
  }

  if (!firebaseUser || !user) return <AuthScreen />

  return (
    <div className="flex flex-col h-full" style={{background:'var(--bg)'}}>
      <BetaBanner onFeedback={() => setShowFeedback(true)} />
      <ShiftBar />

      {/* Demo banner */}
      {SHOW_DEMO_BANNER && demoInfo.isDemo && (
        <div className="flex items-center justify-center gap-2 px-4 py-1.5 text-xs font-semibold flex-shrink-0"
          style={{background:'rgba(245,158,11,0.15)',borderBottom:'1px solid rgba(245,158,11,0.2)',color:'#93c5fd'}}>
          🎉 Demo Mode — All features unlocked · {demoInfo.daysLeft} days remaining
        </div>
      )}

      <div className="flex-1 overflow-hidden relative">
        {/* Map always fills the entire container — no z-index when on map tab so internal controls at z-[400] are above the search overlay at z-[200] */}
        <div className={`absolute inset-0 ${activeTab==='map'?'':'z-0 pointer-events-none'}`}>
          <SafeBoundary name="mapa" fallback={(reset) => (
            <div style={{ position: 'absolute', inset: 0, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: 12, background: 'var(--bg, #0a0e1a)', color: 'var(--text, #fff)' }}>
              <div style={{ fontSize: 15, fontWeight: 700 }}>O mapa encontrou um problema</div>
              <button onClick={reset} style={{ background: '#d97706', color: 'white', border: 'none', borderRadius: 12, padding: '10px 20px', fontWeight: 700 }}>Recarregar mapa</button>
            </div>
          )}>
          <MapView
            currentUserId={firebaseUser?.uid}
            requestNavTo={searchDest}
            onNavRequested={() => setSearchDest(null)}
            onNavigationChange={setIsNavigating}
            onModeSelectorChange={setIsModeSelector}
            searchCategory={activeSearchCategory}
            onCategorySearching={setCategoryLoading}
            onSOS={() => setShowSOS(true)}
            workMode={isShiftActive}
            onReport={() => { setReportLocation(currentLocation ? { ...currentLocation, timestamp: Date.now() } : null); setShowReport(true) }}
            controlsTopOffset={activeSearchCategory ? 104 : 66}
            externalReportOpen={showReport}
            isActive={activeTab === 'map'}
          />
          </SafeBoundary>
        </div>

        {/* Floating search bar + category chips — z-[500] so the MapSearchBar full-screen overlay (fixed, z=2000 within this context) paints above MapView controls at z-[400] */}
        {activeTab === 'map' && !isNavigating && (
          <div className="absolute z-[500] pointer-events-none" style={{ top: 8, left: 12, right: 12 }}>
            <div className="pointer-events-auto">
              <MapSearchBar
                onPlaceSelected={(lat, lng) => setSearchDest({ lat, lng })}
                userLocation={currentLocation ?? undefined}
              />
            </div>
            {/* Categorias agora ficam no menu lateral (☰) — aqui só aparece a busca ativa, para limpar */}
            {activeSearchCategory && (
              <div className="pointer-events-auto" style={{ marginTop: 8 }}>
                <button
                  onClick={() => setActiveSearchCategory(null)}
                  style={{ display: 'inline-flex', alignItems: 'center', gap: 6, padding: '6px 12px', borderRadius: 20, fontSize: 12, fontWeight: 700, background: '#f59e0b', color: '#0a0e1a', border: 'none', boxShadow: '0 2px 10px rgba(0,0,0,0.35)' }}
                >
                  {categoryLoading
                    ? <span style={{ display: 'inline-block', width: 12, height: 12, borderRadius: '50%', border: '2px solid rgba(0,0,0,0.3)', borderTopColor: '#0a0e1a', animation: 'spin 0.7s linear infinite' }} />
                    : <span>{activeSearchCategory.icon}</span>}
                  {activeSearchCategory.label} ✕
                </button>
              </div>
            )}
          </div>
        )}

        {activeTab==='groups' && <div className="absolute inset-0 z-10 overflow-y-auto"><SafeBoundary name="aba"><GroupsScreen /></SafeBoundary></div>}
        {activeTab==='services' && <div className="absolute inset-0 z-10 overflow-y-auto"><SafeBoundary name="aba"><ServicesScreen /></SafeBoundary></div>}
        {activeTab==='safety' && <div className="absolute inset-0 z-10 overflow-y-auto"><SafeBoundary name="aba"><SafetyScreen /></SafeBoundary></div>}
        {activeTab==='earnings' && <div className="absolute inset-0 z-10 overflow-y-auto"><SafeBoundary name="aba"><EarningsScreen /></SafeBoundary></div>}
        {activeTab==='partners' && <div className="absolute inset-0 z-10 overflow-y-auto"><SafeBoundary name="aba"><PartnersScreen /></SafeBoundary></div>}
        {activeTab==='service-requests' && <div className="absolute inset-0 z-10 overflow-y-auto"><SafeBoundary name="aba"><ServiceRequestsScreen onBack={() => setActiveTab('map' as Tab)} /></SafeBoundary></div>}
        {activeTab==='my-services' && <div className="absolute inset-0 z-10 overflow-y-auto"><SafeBoundary name="aba"><MyServicesScreen onBack={() => setActiveTab('map' as Tab)} /></SafeBoundary></div>}
      </div>

      {!isNavigating && !isModeSelector && (
        <BottomNav activeTab={activeTab}
          onTabChange={setActiveTab}
          onMenuClick={()=>setShowSideMenu(true)}
          onSOSClick={()=>setShowSOS(true)} />
      )}
      <SafeBoundary name="sobreposicoes">
      {showUpgradeScreen && <UpgradeScreen onClose={() => setShowUpgradeScreen(false)} />}
      {showReport && <ReportModal onClose={() => setShowReport(false)} initialLocation={reportLocation} />}
      {user && <MechanicAlertOverlay onNavigate={(tab) => setActiveTab(tab as Tab)} />}
      {user && <GroupSosListener onOpenGroups={() => setActiveTab('groups' as Tab)} />}
      </SafeBoundary>
      {showSOS && <SOSModal onClose={()=>setShowSOS(false)} />}
      <SafeBoundary name="feedback-menu">
      <FeedbackButton open={showFeedback} onOpen={() => setShowFeedback(true)} onClose={() => setShowFeedback(false)} />
      <SideMenu open={showSideMenu} onClose={() => setShowSideMenu(false)}
        categories={CATEGORIES}
        activeCategoryKey={activeSearchCategory?.key ?? null}
        onCategory={(cat) => { setActiveTab('map' as Tab); setActiveSearchCategory(prev => prev?.key === cat.key ? null : (CATEGORIES.find(c => c.key === cat.key) ?? null)) }}
        onNavigate={(tab) => {
        if (tab === 'upgrade') { setShowUpgradeScreen(true) } else { setActiveTab(tab as Tab) }
      }} />
      </SafeBoundary>
      {showOnboarding && (
        <OnboardingScreen onComplete={() => {
          localStorage.setItem(`ridershield_onboarding_${firebaseUser.uid}`, '1')
          setShowOnboarding(false)
        }} />
      )}
    </div>
  )
}
