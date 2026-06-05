// src/components/Map/MapView.tsx
'use client'
// Suppress debug logs in production (identified 65 console calls in codebase)
if (typeof window !== 'undefined' && process.env.NODE_ENV === 'production') {
  const noop = () => {}
  console.log = noop
  console.warn = noop
}
import { useEffect, useRef, useState, useCallback, useMemo } from 'react'
import Map, { Source, Layer, Marker } from 'react-map-gl/mapbox'
import type { MapRef } from 'react-map-gl/mapbox'
import 'mapbox-gl/dist/mapbox-gl.css'
import { useStore } from '@/lib/store'
import { subscribeToIncidents, subscribeToGlobalPresence, reportIncident } from '@/lib/firestore'
import { INCIDENT_TYPES as QUICK_REPORT_TYPES } from '@/data/incidentTypes'
import { useLang } from '@/contexts/LangContext'
import { useTheme } from '@/contexts/ThemeContext'
import { Incident, IncidentType } from '@/types'
import { formatDistanceToNow } from 'date-fns'
import { ref, onValue } from 'firebase/database'
import { rtdb, db } from '@/lib/firebase'
import { collection, onSnapshot, query, orderBy, getDocs, where } from 'firebase/firestore'
import LocationBottomSheet, { TappedLocation } from './LocationBottomSheet'
import TransportModeSelector, { ModeKey, getSavedMode, getProfileForMode, ZoneHit } from './TransportModeSelector'
import NavigationScreen from '@/components/Navigation/NavigationScreen'
import { ALL_ZONES, getRiskLevelActual, circleToPolygon, PERM_ZONE_COLORS, COUNTRY_FLAG, CITY_LABEL, PermanentZone } from '@/lib/permanentZones'
import toast from 'react-hot-toast'

const DUBLIN_LNG = -6.2603
const DUBLIN_LAT = 53.3498

const INCIDENT_COLORS: Record<IncidentType, string> = {
  assault_robbery: '#ef4444', bike_theft: '#f97316', physical_assault: '#fb923c',
  attempted_robbery: '#f59e0b', suspicious_activity: '#8b5cf6', road_hazard: '#10b981',
  no_entry_zone: '#dc2626', confirmed_safe: '#22c55e',
  // legacy
  robbery: '#ef4444', aggression: '#eab308', accident: '#60a5fa',
}
const INCIDENT_EMOJIS: Record<IncidentType, string> = {
  assault_robbery: '🔴', bike_theft: '🚲', physical_assault: '👊',
  attempted_robbery: '🟠', suspicious_activity: '👀', road_hazard: '🚧',
  no_entry_zone: '🚫', confirmed_safe: '✅',
  // legacy
  robbery: '🔴', aggression: '🟡', accident: '🔵',
}

export interface RiskZone {
  id: string; name: string; level: 'high' | 'medium' | 'low'; type: string; description?: string
  polygon: [number, number][]
}

interface WeatherData { icon: string; description: string; temp: number; windKph: number }
const WEATHER_ICONS: Record<string, string> = {
  Clear: '☀️', Clouds: '⛅', Rain: '🌧️', Drizzle: '🌦️',
  Thunderstorm: '⛈️', Snow: '❄️', Mist: '🌫️', Fog: '🌫️', Haze: '🌫️',
}

// Hardcoded zones cleared — map is clean by default.
// All zones come from Firestore (created via Admin ZoneEditor).
export const RISK_ZONES: RiskZone[] = []

const ZONE_COLORS = {
  high: { fill: '#ef4444', stroke: '#dc2626' },
  medium: { fill: '#f97316', stroke: '#ea580c' },
  low: { fill: '#eab308', stroke: '#ca8a04' },
}

const CAT_COLORS: Record<string, string> = {
  restaurant: '#FF5722', fuel: '#607D8B', supermarket: '#4CAF50',
  cafe: '#795548', hospital: '#F44336', mechanic: '#2196F3',
}

const zonesGeoJSON = {
  type: 'FeatureCollection' as const,
  features: RISK_ZONES.map(zone => ({
    type: 'Feature' as const,
    properties: { id: zone.id, name: zone.name, level: zone.level, type: zone.type, description: zone.description ?? '' },
    geometry: { type: 'Polygon' as const, coordinates: [zone.polygon.map(([lat, lng]) => [lng, lat])] },
  })),
}

// ─── Camera constants — tune here if rider position needs adjustment ──────────
const NAV_ZOOM    = 16.8  // zoom level during nav — lower = further back, more road ahead visible
const NAV_PITCH   = 62    // 3D tilt — Google Maps-style; try 65 for even more horizon
const NAV_RIDER_Y = 0.71  // screen Y of rider (0=top, 1=bottom); maps directly to % of screen height

// ---- Navigation helpers ----

// Zoom adapts to speed — low speed: close view; high speed: wide view ahead
function calcularZoomPorVelocidade(speedKmh: number): number {
  if (!speedKmh || speedKmh < 1) return 17.5   // stationary / very slow
  if (speedKmh < 5)              return 17.2   // walking
  if (speedKmh < 12)             return 17.0   // cycling
  if (speedKmh < 25)             return 16.5   // e-bike / slow scooter
  if (speedKmh < 50)             return 16.0   // scooter / motorcycle
  return 15.5                                  // fast — maximum road-ahead view
}

// Moves camera center AHEAD of rider (+ sign) so rider appears in lower third.
// The crucial sign fix: previous code used − which placed center BEHIND the rider,
// causing the rider to appear at the top of the pitched view.
function calcularCentroDeslocado(
  lat: number, lng: number, bearingDeg: number, zoom: number
): { lat: number; lng: number } {
  const H = typeof window !== 'undefined' ? window.innerHeight : 844
  const mpp = (156543.03392 * Math.cos((lat * Math.PI) / 180)) / Math.pow(2, zoom)
  const pitchCorrection = 1 / Math.cos(NAV_PITCH * Math.PI / 180)  // compensates perspective foreshortening; auto-updates with NAV_PITCH
  const offsetM = (H * NAV_RIDER_Y - H / 2) * mpp * pitchCorrection  // pixels below screen-centre → metres ahead
  const rad = (bearingDeg * Math.PI) / 180
  return {
    lat: lat + (offsetM / 111320) * Math.cos(rad),                               // + = ahead
    lng: lng + offsetM / (111320 * Math.cos((lat * Math.PI) / 180)) * Math.sin(rad),
  }
}

// Haversine distance between two {lat,lng} points — returns metres
function haversineDist(a: { lat: number; lng: number }, b: { lat: number; lng: number }): number {
  const R = 6371000
  const dLat = (b.lat - a.lat) * Math.PI / 180
  const dLng = (b.lng - a.lng) * Math.PI / 180
  const s = Math.sin(dLat / 2) ** 2 + Math.cos(a.lat * Math.PI / 180) * Math.cos(b.lat * Math.PI / 180) * Math.sin(dLng / 2) ** 2
  return R * 2 * Math.asin(Math.sqrt(s))
}

// Smooth heading with circular mean to avoid 359→1 jumps
function smoothHeading(history: number[], newHeading: number): number {
  history.push(newHeading)
  if (history.length > 5) history.shift()
  const sin = history.reduce((s, h) => s + Math.sin(h * Math.PI / 180), 0) / history.length
  const cos = history.reduce((c, h) => c + Math.cos(h * Math.PI / 180), 0) / history.length
  return (Math.atan2(sin, cos) * 180 / Math.PI + 360) % 360
}

function buildCongestionGeoJSON(coords: [number, number][], congestion: string[]): any {
  if (congestion.length === 0 || coords.length < 2) {
    return { type: 'FeatureCollection', features: [{ type: 'Feature', properties: { congestion: 'unknown' }, geometry: { type: 'LineString', coordinates: coords } }] }
  }
  const features: any[] = []
  let start = 0
  let level = congestion[0] || 'unknown'
  for (let i = 1; i < congestion.length; i++) {
    const next = congestion[i] || 'unknown'
    if (next !== level) {
      features.push({ type: 'Feature', properties: { congestion: level }, geometry: { type: 'LineString', coordinates: coords.slice(start, i + 1) } })
      start = i
      level = next
    }
  }
  features.push({ type: 'Feature', properties: { congestion: level }, geometry: { type: 'LineString', coordinates: coords.slice(start) } })
  return { type: 'FeatureCollection', features }
}

function distMeters(a: { lat: number; lng: number }, b: { lat: number; lng: number }): number {
  const R = 6371000
  const dLat = (b.lat - a.lat) * Math.PI / 180
  const dLng = (b.lng - a.lng) * Math.PI / 180
  const aa = Math.sin(dLat / 2) ** 2 + Math.cos(a.lat * Math.PI / 180) * Math.cos(b.lat * Math.PI / 180) * Math.sin(dLng / 2) ** 2
  return R * 2 * Math.atan2(Math.sqrt(aa), Math.sqrt(1 - aa))
}

function distToSegment(p: { lat: number; lng: number }, a: { lat: number; lng: number }, b: { lat: number; lng: number }): number {
  const dx = b.lng - a.lng, dy = b.lat - a.lat
  const len2 = dx * dx + dy * dy
  if (len2 === 0) return distMeters(p, a)
  const t = Math.max(0, Math.min(1, ((p.lng - a.lng) * dx + (p.lat - a.lat) * dy) / len2))
  return distMeters(p, { lat: a.lat + t * dy, lng: a.lng + t * dx })
}

function distToRouteMeters(pos: { lat: number; lng: number }, coords: [number, number][]): number {
  let min = Infinity
  for (let i = 0; i < coords.length - 1; i++) {
    const d = distToSegment(pos, { lat: coords[i][1], lng: coords[i][0] }, { lat: coords[i + 1][1], lng: coords[i + 1][0] })
    if (d < min) min = d
  }
  return min
}

function pointInPolygon(lat: number, lng: number, polygon: [number, number][]): boolean {
  let inside = false
  for (let i = 0, j = polygon.length - 1; i < polygon.length; j = i++) {
    const [ilat, ilng] = polygon[i], [jlat, jlng] = polygon[j]
    if ((ilng > lng) !== (jlng > lng) && lat < ((jlat - ilat) * (lng - ilng)) / (jlng - ilng) + ilat) inside = !inside
  }
  return inside
}

function routeCrossesHighRiskZone(coords: [number, number][], hour = new Date().getHours()): boolean {
  for (const [lng, lat] of coords) {
    for (const zone of RISK_ZONES)
      if (zone.level === 'high' && pointInPolygon(lat, lng, zone.polygon)) return true
    for (const pz of ALL_ZONES) {
      const level = getRiskLevelActual(pz, hour)
      if ((level === 'high' || level === 'critical') && distMeters({ lat, lng }, { lat: pz.lat, lng: pz.lng }) < pz.radius) return true
    }
  }
  return false
}

function polygonCentroid(polygon: [number, number][]): { lat: number; lng: number } {
  return {
    lat: polygon.reduce((s, p) => s + p[0], 0) / polygon.length,
    lng: polygon.reduce((s, p) => s + p[1], 0) / polygon.length,
  }
}

async function fetchRoute(
  origin: { lat: number; lng: number },
  dest: { lat: number; lng: number },
  profile: string
): Promise<any> {
  const token = process.env.NEXT_PUBLIC_MAPBOX_TOKEN
  const params = [
    'steps=true', 'voice_instructions=true', 'banner_instructions=true',
    'geometries=geojson', 'overview=full', 'language=pt',
    'annotations=congestion,duration,distance',
    'alternatives=true',
    'exclude=ferry',
    profile === 'cycling' ? 'continue_straight=false' : null,
    `access_token=${token}`,
  ].filter(Boolean).join('&')
  const url =
    `https://api.mapbox.com/directions/v5/mapbox/${profile}` +
    `/${origin.lng},${origin.lat};${dest.lng},${dest.lat}?${params}`
  const res = await fetch(url)
  const data = await res.json()
  return data.routes?.[0] ?? null
}

function parseCoordinates(text: string): { lat: number; lng: number } | null {
  const t = text.trim()
  // "53.3436, -6.4122" or "53.3436,-6.4122"
  const simple = t.match(/^(-?\d+\.?\d*)\s*,\s*(-?\d+\.?\d*)$/)
  if (simple) {
    const lat = parseFloat(simple[1]), lng = parseFloat(simple[2])
    if (lat >= -90 && lat <= 90 && lng >= -180 && lng <= 180) return { lat, lng }
  }
  // "53.3436° N, 6.4122° W"
  const dms = t.match(/(\d+\.?\d*)[°\s]+([NS])[,\s]+(\d+\.?\d*)[°\s]+([WE])/i)
  if (dms) {
    let lat = parseFloat(dms[1]), lng = parseFloat(dms[3])
    if (dms[2].toUpperCase() === 'S') lat = -lat
    if (dms[4].toUpperCase() === 'W') lng = -lng
    return { lat, lng }
  }
  return null
}

function getSearchIcon(featureType: string): string {
  if (featureType === 'poi') return '🏢'
  if (featureType === 'address') return '📍'
  if (featureType === 'street') return '🛣️'
  if (featureType === 'neighborhood' || featureType === 'place') return '🏙️'
  return '📍'
}

async function geocodeAddress(text: string, proximity: { lat: number; lng: number } | null): Promise<any> {
  const token = process.env.NEXT_PUBLIC_MAPBOX_TOKEN
  const encoded = encodeURIComponent(text)
  const prox = proximity ? `&proximity=${proximity.lng},${proximity.lat}` : ''
  const url = `https://api.mapbox.com/geocoding/v5/mapbox.places/${encoded}.json?access_token=${token}&country=ie${prox}`
  const res = await fetch(url)
  const data = await res.json()
  return data.features?.[0] ?? null
}

async function reverseGeocode(lat: number, lng: number): Promise<{ address?: string; name?: string }> {
  const token = process.env.NEXT_PUBLIC_MAPBOX_TOKEN
  const url = `https://api.mapbox.com/geocoding/v5/mapbox.places/${lng},${lat}.json?access_token=${token}&language=pt&types=address,neighborhood,locality,place`
  try {
    const res = await fetch(url)
    const data = await res.json()
    const feat = data.features?.[0]
    if (!feat) return {}
    return { name: feat.text, address: feat.place_name }
  } catch {
    return {}
  }
}

// ----

interface GroupMemberLocation { userId: string; name: string; lat: number; lng: number }
interface EmergencyData { lat: number; lng: number; userName: string; timestamp: number }
interface Props {
  groupMembers?: GroupMemberLocation[]
  currentUserId?: string
  groupId?: string
  onPanelChange?: (isOpen: boolean) => void
  followUserId?: string
  onFollowChange?: (uid: string | null) => void
  requestNavTo?: { lat: number; lng: number } | null
  onNavRequested?: () => void
  onNavigationChange?: (navigating: boolean) => void
  searchCategory?: { key: string; label: string; icon: string; query: string } | null
  onSOS?: () => void
  onModeSelectorChange?: (isOpen: boolean) => void
  workMode?: boolean
  onReport?: () => void
  onCategorySearching?: (loading: boolean) => void
  controlsTopOffset?: number
  externalReportOpen?: boolean
  isActive?: boolean
}

function RiderPin({ name, isEmergency = false }: { name: string; isEmergency?: boolean }) {
  const ring = isEmergency ? '#dc3545' : '#f59e0b'
  return (
    <div style={{ position: 'relative', textAlign: 'center', width: 52, userSelect: 'none', pointerEvents: 'none' }}>
      <div style={{
        width: 40, height: 40, borderRadius: '50%',
        background: 'linear-gradient(145deg, #b0c4de, #4a6a8a)',
        margin: '0 auto',
        display: 'flex', alignItems: 'center', justifyContent: 'center',
        border: `2px solid ${ring}`,
        boxShadow: `0 0 10px ${ring}60, 0 4px 12px rgba(0,0,0,0.5)`,
      }}>
        <svg width="20" height="20" viewBox="0 0 24 24" fill="none">
          <path d="M12 2L3 7v5c0 5.25 3.75 10.15 9 11.35C17.25 22.15 21 17.25 21 12V7L12 2z"
            fill="#1a2a4a" stroke={ring} strokeWidth="1.5"/>
          <line x1="11" y1="5" x2="13" y2="19" stroke={ring} strokeWidth="1.5" strokeLinecap="round"/>
        </svg>
      </div>
      <div style={{
        width: 0, height: 0,
        borderLeft: '7px solid transparent', borderRight: '7px solid transparent',
        borderTop: '10px solid #4a6a8a',
        margin: '-2px auto 0',
      }} />
      <div style={{
        width: 18, height: 6, borderRadius: '50%',
        background: ring,
        margin: '0 auto',
        boxShadow: `0 0 8px ${ring}, 0 0 16px ${ring}80`,
        animation: isEmergency ? 'pulseAmbarFast 0.5s ease-in-out infinite' : 'pulseAmbar 2s ease-in-out infinite',
      }} />
      <div style={{
        fontSize: 9, color: 'white', fontWeight: 700,
        background: 'rgba(10,14,26,0.9)',
        border: `1px solid ${ring}`,
        borderRadius: 4, padding: '1px 5px', marginTop: 2,
        whiteSpace: 'nowrap', display: 'inline-block',
      }}>{name}</div>
    </div>
  )
}

export default function MapView({ groupMembers = [], currentUserId, groupId, onPanelChange, followUserId, onFollowChange, requestNavTo, onNavRequested, onNavigationChange, searchCategory = null, onSOS, onModeSelectorChange, workMode = false, onReport, onCategorySearching, controlsTopOffset = 12, externalReportOpen = false, isActive = true }: Props) {
  const { t } = useLang()
  const { theme } = useTheme()
  const mapUser = useStore((s) => s.user)
  const mapRef = useRef<MapRef>(null)
  const [selectedIncident, setSelectedIncident] = useState<Incident | null>(null)
  const [selectedZone, setSelectedZone] = useState<RiskZone | null>(null)
  const [timeFilter, setTimeFilter] = useState<6 | 12 | 24>(24)
  const [showHeatmap, setShowHeatmap] = useState(false)
  const [showZones, setShowZones] = useState(() => {
    if (typeof window === 'undefined') return true
    const saved = localStorage.getItem('showZones')
    return saved === null ? true : JSON.parse(saved)
  })
  const [firestoreZones, setFirestoreZones] = useState<any[]>([])
  const [legendCollapsed, setLegendCollapsed] = useState(true)
  const [autoFollow, setAutoFollow] = useState(true)
  const [emergencies, setEmergencies] = useState<Record<string, EmergencyData>>({})
  const autoFollowRef = useRef(true)
  const firstFixRef = useRef(false)
  const tapTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const [weather, setWeather] = useState<WeatherData | null>(null)
  const [weatherFading, setWeatherFading] = useState(false)
  const weatherFetchedRef = useRef(false)
  const [globalRiders, setGlobalRiders] = useState<Array<{ userId: string; userName: string; lat: number; lng: number; lastUpdated: number }>>([])
  const [nearbyNavRiders, setNearbyNavRiders] = useState<Array<{ userId: string; lat: number; lng: number }>>([])
  const prevFollowPosRef = useRef<{ lat: number; lng: number } | null>(null)

  // Bottom sheet + mode selector
  const [tappedLocation, setTappedLocation] = useState<TappedLocation | null>(null)
  const [pendingNavDest, setPendingNavDest] = useState<{ lat: number; lng: number } | null>(null)
  const [showModeSelector, setShowModeSelector] = useState(false)

  // Navigation
  const [isNavigating, setIsNavigating] = useState(false)
  const [navDest, setNavDest] = useState<{ lat: number; lng: number } | null>(null)
  const [routeGeoJSON, setRouteGeoJSON] = useState<any>(null)
  const [navSteps, setNavSteps] = useState<any[]>([])
  const [currentStepIdx, setCurrentStepIdx] = useState(0)
  const [distToNext, setDistToNext] = useState(0)
  const [remainingDist, setRemainingDist] = useState(0)
  const [navEta, setNavEta] = useState(0)
  const [routeProfile, setRouteProfile] = useState<string>(() => getProfileForMode(getSavedMode()))
  const [navModeKey, setNavModeKey] = useState<string>(getSavedMode)
  const [navBearing, setNavBearing] = useState(0)
  const [riskOnRoute, setRiskOnRoute] = useState(false)
  const [isRecalculating, setIsRecalculating] = useState(false)
  const [northLocked, setNorthLocked] = useState(false)
  const [hasArrived, setHasArrived] = useState(false)
  const [navTotalDist, setNavTotalDist] = useState(0)
  const [navSpeed, setNavSpeed] = useState(0)
  const [routeCongestion, setRouteCongestion] = useState<string[]>([])
  const [heading, setHeading] = useState(0)
  const [compassActive, setCompassActive] = useState(false)
  const speedPrevRef = useRef<{ lat: number; lng: number; time: number } | null>(null)
  const navRefreshRef = useRef<{ dest: { lat: number; lng: number } | null; profile: string; loc: { lat: number; lng: number } | null }>({ dest: null, profile: '', loc: null })
  const handleOrientationRef = useRef<((e: Event) => void) | null>(null)
  const compassFiredAbsoluteRef = useRef(false)
  const [showCategorySheet, setShowCategorySheet] = useState(false)
  const [altRoutes, setAltRoutes] = useState<any[]>([])
  const [selectedAltIdx, setSelectedAltIdx] = useState(0)
  const [showTraffic, setShowTraffic] = useState(() => {
    if (typeof window === 'undefined') return false
    return localStorage.getItem('showTraffic') === 'true'
  })
  const [showTrafficLegend, setShowTrafficLegend] = useState(true)
  const [navMapFree, setNavMapFree] = useState(false)
  const [showReCenter, setShowReCenter] = useState(false)
  const [mapBearing, setMapBearing] = useState(0)
  const [showQuickReport, setShowQuickReport] = useState(false)
  const [quickReporting, setQuickReporting] = useState(false)
  const [smoothedPos, setSmoothedPos] = useState<{ lat: number; lng: number } | null>(null)
  const [smoothedHeading, setSmoothedHeading] = useState(0)
  // Frozen position captured at the moment the report button is pressed
  const [frozenReportPos, setFrozenReportPos] = useState<{ lat: number; lng: number; timestamp: number; heading: number; speed: number } | null>(null)
  const [toastNav, setToastNav] = useState<string | null>(null)
  const [showSearchArea, setShowSearchArea] = useState(false)
  const [currentZoom, setCurrentZoom] = useState(14)
  const [categoryPins, setCategoryPins] = useState<Array<{ lat: number; lng: number; name: string; category: string; icon: string; catKey: string; address?: string }>>([])
  const categoryReqRef = useRef(0)
  const [categorySearchLoading, setCategorySearchLoading] = useState(false)
  const [showZonesModal, setShowZonesModal] = useState(false)
  const [selectedPermZone, setSelectedPermZone] = useState<PermanentZone | null>(null)
  const [currentHour, setCurrentHour] = useState(() => new Date().getHours())
  const [safeRouteData, setSafeRouteData] = useState<any | null>(null)
  const [activeRouteZones, setActiveRouteZones] = useState<any[]>([])
  const [zoneAlert, setZoneAlert] = useState<{ zone: any; dist: number } | null>(null)
  const alertedZonesRef = useRef<Set<string>>(new Set())
  const zoneAlertTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  // Nav alternative routes (preserved across mode-selector close)
  const [navAltRoutes, setNavAltRoutes] = useState<any[]>([])
  const [navRouteIdx, setNavRouteIdx] = useState(0)
  const [showNavAlts, setShowNavAlts] = useState(false)

  // Fast ref — avoids stale closure in RAF/callbacks needing to know nav state
  const navegandoRef = useRef(false)
  // Immediate ref — set synchronously on first touch so RAF stops easeTo before React re-renders
  const navMapFreeRef = useRef(false)

  // RAF smooth-animation refs (replace dead reckoning)
  const posAtualRef = useRef({ lat: 0, lng: 0 })
  const posAlvoRef = useRef({ lat: 0, lng: 0 })
  const headingAtualRef = useRef(0)
  const rafIdRef = useRef<number | null>(null)
  const lastRafTsRef = useRef(0)
  const lastSetPosRef = useRef({ lat: 0, lng: 0 })
  const rafNavStateRef = useRef({ isNavigating: false, navMapFree: false, navBearing: 0, northLocked: false, compassActive: false, heading: 0, navSpeed: 0 })
  const headingHistoryRef = useRef<number[]>([])
  const altRoutesRef = useRef<any[]>([])
  const selectedAltIdxRef = useRef(0)
  // Timer ref for snap animations (re-center / route switch / nav start).
  // Stored so any new gesture can cancel it before it fires navMapFreeRef = false.
  const snapTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  // Search
  const [showSearch, setShowSearch] = useState(false)
  const [searchText, setSearchText] = useState('')
  const [searchSuggestions, setSearchSuggestions] = useState<any[]>([])
  const [searchLoading, setSearchLoading] = useState(false)
  const [navError, setNavError] = useState<string | null>(null)
  const sessionTokenRef = useRef('')


  // Sync mutable refs so closures always see latest values
  altRoutesRef.current = altRoutes
  // Keep rafNavStateRef current so the RAF loop reads live values without stale closures
  rafNavStateRef.current = { isNavigating, navMapFree, navBearing, northLocked, compassActive, heading, navSpeed }
  navegandoRef.current = isNavigating
  selectedAltIdxRef.current = selectedAltIdx

  const incidents = useStore((s) => s.incidents)
  const setIncidents = useStore((s) => s.setIncidents)
  const currentLocation = useStore((s) => s.currentLocation)

  const mapStyle = 'mapbox://styles/mapbox/streets-v12'

  // Persist shield (zones) preference
  useEffect(() => {
    localStorage.setItem('showZones', JSON.stringify(showZones))
  }, [showZones])

  // 24h cutoff — stable reference so the effect doesn't restart on every render
  const incidentCutoff = useMemo(() => new Date(Date.now() - 24 * 3600 * 1000), [])

  // Subscribe to incidents only while the map tab is visible — saves Firestore reads on other tabs
  useEffect(() => {
    if (!isActive) return
    setIncidents([])
    return subscribeToIncidents(setIncidents, incidentCutoff)
  }, [isActive, setIncidents, incidentCutoff])

  // Subscribe to Firestore risk_zones — when shield is on OR zones modal is open, and not navigating
  useEffect(() => {
    if ((!showZones && !showZonesModal) || isNavigating) return
    const unsub = onSnapshot(
      query(collection(db, 'risk_zones'), orderBy('createdAt', 'desc')),
      snap => setFirestoreZones(snap.docs.map(d => ({ id: d.id, ...d.data() })))
    )
    return unsub
  }, [showZones, showZonesModal, isNavigating])

  const filteredIncidents = useMemo(
    () => incidents.filter(i => i.timestamp.getTime() > Date.now() - timeFilter * 3600000),
    [incidents, timeFilter]
  )

  const incidentsGeoJSON = useMemo(() => ({
    type: 'FeatureCollection' as const,
    features: filteredIncidents.map(inc => ({
      type: 'Feature' as const,
      properties: { id: inc.id, type: inc.type, description: inc.description ?? '', userName: inc.userName ?? 'Anonymous' },
      geometry: { type: 'Point' as const, coordinates: [inc.location.lng, inc.location.lat] },
    })),
  }), [filteredIncidents])

  // Normalise polygon coords — handles both legacy [lng,lat] arrays and new {lng,lat} objects
  function normCoords(raw: any[]): number[][] {
    return raw.map(p => Array.isArray(p) ? p as number[] : [p.lng, p.lat])
  }

  // GeoJSON from Firestore risk_zones (manual zones saved via ZoneEditor)
  const firestoreZonesGeoJSON = useMemo(() => ({
    type: 'FeatureCollection' as const,
    features: firestoreZones.flatMap(z => {
      const level = z.riskLevel ?? 'medium'
      // polygon type — stored as [{lng,lat}] objects (or legacy [[lng,lat]] arrays)
      if (z.polygon && z.polygon.length >= 3) {
        const coords = normCoords(z.polygon)
        return [{
          type: 'Feature' as const,
          properties: { id: z.id, level, name: z.areaName ?? z.id },
          geometry: { type: 'Polygon' as const, coordinates: [coords] },
        }]
      }
      // point/radius type: draw circle
      if (z.lat && z.lng) {
        const poly = circleToPolygon(z.lat, z.lng, z.radius ?? 200)
        return [{
          type: 'Feature' as const,
          properties: { id: z.id, level, name: z.areaName ?? z.id },
          geometry: { type: 'Polygon' as const, coordinates: [poly.map((p: number[]) => [p[1], p[0]])] },
        }]
      }
      return []
    }),
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }), [firestoreZones])

  const routeCongestionGeoJSON = useMemo(() => {
    if (!routeGeoJSON?.coordinates) return null
    return buildCongestionGeoJSON(routeGeoJSON.coordinates, routeCongestion)
  }, [routeGeoJSON, routeCongestion])

  // Keep currentHour in sync (updates at the top of each hour)
  useEffect(() => {
    const tick = () => setCurrentHour(new Date().getHours())
    const msUntilNextHour = (60 - new Date().getMinutes()) * 60000 - new Date().getSeconds() * 1000
    const t = setTimeout(() => { tick(); const i = setInterval(tick, 3600000); return () => clearInterval(i) }, msUntilNextHour)
    return () => clearTimeout(t)
  }, [])

  // Show permanent zones within 200 km of user; skip recompute during navigation
  const visiblePermZones = useMemo(() => {
    if (isNavigating || ALL_ZONES.length === 0) return []
    if (!currentLocation) return ALL_ZONES.filter(z => z.country === 'ie')
    return ALL_ZONES.filter(z => distMeters(currentLocation, { lat: z.lat, lng: z.lng }) < 200000)
  }, [currentLocation, isNavigating])

  const permanentZonesGeoJSON = useMemo(() => ({
    type: 'FeatureCollection' as const,
    features: visiblePermZones.map(zone => {
      const level = getRiskLevelActual(zone, currentHour)
      return {
        type: 'Feature' as const,
        properties: { id: zone.id, name: zone.name, level, riskLevel: zone.riskLevel },
        geometry: { type: 'Polygon' as const, coordinates: [circleToPolygon(zone.lat, zone.lng, zone.radius)] },
      }
    }),
  }), [visiblePermZones, currentHour])

  // Auto-follow (disabled during navigation)
  useEffect(() => {
    if (isNavigating) return
    if (!currentLocation || !autoFollowRef.current) return
    const center: [number, number] = [currentLocation.lng, currentLocation.lat]
    if (!firstFixRef.current) {
      mapRef.current?.flyTo({ center, zoom: 14, pitch: 0, duration: 1000 })
      firstFixRef.current = true
    } else {
      mapRef.current?.easeTo({ center, pitch: 0, duration: 500 })
    }
  }, [currentLocation, isNavigating])

  // Sync GPS target position for RAF interpolation
  useEffect(() => {
    if (!currentLocation) return
    posAlvoRef.current = { lat: currentLocation.lat, lng: currentLocation.lng }
    if (posAtualRef.current.lat === 0) {
      posAtualRef.current = { lat: currentLocation.lat, lng: currentLocation.lng }
    }
    // When not navigating, RAF is stopped — update smoothedPos directly from GPS
    if (!isNavigating) {
      posAtualRef.current = { lat: currentLocation.lat, lng: currentLocation.lng }
      setSmoothedPos(currentLocation)
    }
  }, [currentLocation, isNavigating])

  // RAF loop — 60fps during navigation, stopped completely when idle
  // Restarts when isNavigating changes to true
  useEffect(() => {
    if (!isNavigating) {
      // Stop RAF when not navigating — saves significant CPU/battery
      if (rafIdRef.current) { cancelAnimationFrame(rafIdRef.current); rafIdRef.current = null }
      return
    }
    // Start/restart RAF when navigation begins
    lastRafTsRef.current = 0
    const animar = (ts: number) => {
      const delta = lastRafTsRef.current ? Math.min(ts - lastRafTsRef.current, 100) : 16
      lastRafTsRef.current = ts
      const nav = rafNavStateRef.current
      {}

      // Lerp position toward GPS target (0.08 = smooth & responsive)
      const fator = (delta / 100) * 0.08
      const newLat = posAtualRef.current.lat + (posAlvoRef.current.lat - posAtualRef.current.lat) * fator
      const newLng = posAtualRef.current.lng + (posAlvoRef.current.lng - posAtualRef.current.lng) * fator
      posAtualRef.current = { lat: newLat, lng: newLng }

      // Lerp heading (circular shortest-path interpolation)
      const targetH = nav.northLocked ? 0 : (nav.compassActive ? nav.heading : nav.navBearing)
      let diffH = targetH - headingAtualRef.current
      if (diffH > 180) diffH -= 360
      if (diffH < -180) diffH += 360
      headingAtualRef.current = (headingAtualRef.current + diffH * fator * 2 + 360) % 360

      // Update React state only when position has actually moved (avoids 60fps renders while stationary)
      const moved =
        Math.abs(newLat - lastSetPosRef.current.lat) > 1e-6 ||
        Math.abs(newLng - lastSetPosRef.current.lng) > 1e-6
      if (moved && posAtualRef.current.lat !== 0) {
        lastSetPosRef.current = { lat: newLat, lng: newLng }
        setSmoothedPos({ lat: newLat, lng: newLng })
      }
      // Only update heading state when it changed > 1° — prevents 60fps re-renders
      if (nav.isNavigating) {
        setSmoothedHeading(prev => {
          let diff = Math.abs(headingAtualRef.current - prev)
          if (diff > 180) diff = 360 - diff
          return diff > 1 ? headingAtualRef.current : prev
        })
      }

      // Update navigation camera — heading-up 3D view (Google Maps / Waze style).
      // bearing = rider heading (road ahead always at top); pitch = 45 for depth perspective.
      // duration=300ms: fast enough to track without lag, smooth enough to not jitter.
      if (nav.isNavigating && !navMapFreeRef.current) {
        const zoom = calcularZoomPorVelocidade(nav.navSpeed)
        const heading = headingAtualRef.current
        const { lat: cLat, lng: cLng } = calcularCentroDeslocado(newLat, newLng, heading, zoom)
        mapRef.current?.easeTo({
          center: [cLng, cLat],
          bearing: heading,
          pitch: NAV_PITCH,
          zoom,
          duration: 300,
        })
      }

      rafIdRef.current = requestAnimationFrame(animar)
    }
    rafIdRef.current = requestAnimationFrame(animar)
    return () => { if (rafIdRef.current) { cancelAnimationFrame(rafIdRef.current); rafIdRef.current = null } }
  }, [isNavigating])  // restart loop when navigation state changes

  // Step advancement + bearing + auto-recalculate
  useEffect(() => {
    if (!isNavigating || !currentLocation || navSteps.length === 0) return
    const step = navSteps[currentStepIdx]
    if (!step) return
    const [sLng, sLat] = step.maneuver.location
    const dist = distMeters(currentLocation, { lat: sLat, lng: sLng })
    setDistToNext(Math.round(dist))
    if (dist < 25 && currentStepIdx < navSteps.length - 1) {
      const nextStep = navSteps[currentStepIdx + 1]
      const bearingBefore = nextStep?.maneuver?.bearing_before
      const riderHeading = northLocked ? heading : navBearing
      if (bearingBefore !== undefined && navSpeed > 3) {
        let bearingDiff = Math.abs(bearingBefore - riderHeading)
        if (bearingDiff > 180) bearingDiff = 360 - bearingDiff
        if (bearingDiff <= 150) setCurrentStepIdx(i => i + 1)
        // else: instruction would send rider wrong way — skip until heading aligns
      } else {
        setCurrentStepIdx(i => i + 1)
      }
    }
    const remaining = navSteps.slice(currentStepIdx).reduce((s: number, st: any) => s + (st.distance ?? 0), 0)
    setRemainingDist(remaining)
    setNavEta(Math.round(navSteps.slice(currentStepIdx).reduce((s: number, st: any) => s + (st.duration ?? 0), 0) / 60))
    if (!northLocked && typeof step.maneuver?.bearing_after === 'number') setNavBearing(step.maneuver.bearing_after)
    // Auto-recalculate >50m off-route
    if (routeGeoJSON?.coordinates && navDest && !isRecalculating) {
      const offDist = distToRouteMeters(currentLocation, routeGeoJSON.coordinates)
      if (offDist > 40) {
        setIsRecalculating(true)
        fetchRoute(currentLocation, navDest, routeProfile)
          .then(route => {
            if (route) {
              setRouteGeoJSON(route.geometry)
              setRouteCongestion(route.legs?.[0]?.annotation?.congestion ?? [])
              setNavSteps(route.legs?.[0]?.steps ?? [])
              setCurrentStepIdx(0)
              setRemainingDist(route.distance)
              setNavEta(Math.round(route.duration / 60))
              setRiskOnRoute(routeCrossesHighRiskZone(route.geometry.coordinates))
            }
          })
          .catch(() => {})
          .finally(() => setIsRecalculating(false))
      }
    }
  }, [currentLocation, isNavigating, navSteps, currentStepIdx, routeGeoJSON, navDest, routeProfile, isRecalculating, northLocked])

  // Arrived detection — triggers when < 20m remaining and last step reached
  useEffect(() => {
    if (!isNavigating || hasArrived) return
    if (remainingDist > 0 && remainingDist < 20) {
      setHasArrived(true)
      mapRef.current?.easeTo({ pitch: 0, bearing: 0, duration: 600, easing: (t: number) => t })
    }
  }, [remainingDist, isNavigating, hasArrived])

  // Reset arrived state when navigation starts or is cancelled
  useEffect(() => {
    if (!isNavigating) setHasArrived(false)
  }, [isNavigating])

  // Emergency markers from RTDB
  useEffect(() => {
    if (!groupId) return
    const emergRef = ref(rtdb, `emergencies/${groupId}`)
    return onValue(emergRef, (snapshot) => {
      const data: Record<string, any> = snapshot.val() ?? {}
      const THIRTY_MIN = 30 * 60 * 1000
      const active: Record<string, EmergencyData> = {}
      Object.entries(data).forEach(([uid, emerg]: [string, any]) => {
        if (!emerg?.active || !emerg.lat || !emerg.lng) return
        if (Date.now() - emerg.timestamp > THIRTY_MIN) return
        active[uid] = { lat: emerg.lat, lng: emerg.lng, userName: emerg.userName, timestamp: emerg.timestamp }
      })
      setEmergencies(active)
    })
  }, [groupId])

  // Weather — skip during navigation
  useEffect(() => {
    if (!currentLocation || weatherFetchedRef.current || isNavigating) return
    const key = process.env.NEXT_PUBLIC_WEATHER_KEY
    if (!key || key === 'YOUR_OPENWEATHERMAP_KEY_HERE') return
    weatherFetchedRef.current = true
    fetch(`https://api.openweathermap.org/data/2.5/weather?lat=${currentLocation.lat}&lon=${currentLocation.lng}&appid=${key}&units=metric`)
      .then(r => r.json())
      .then(data => {
        const main = data.weather?.[0]?.main ?? 'Clear'
        const desc = (data.weather?.[0]?.description ?? '') as string
        const temp = Math.round(data.main?.temp ?? 0)
        const windKph = Math.round((data.wind?.speed ?? 0) * 3.6)
        setWeather({ icon: WEATHER_ICONS[main] ?? '🌡️', description: desc.charAt(0).toUpperCase() + desc.slice(1), temp, windKph })
        setWeatherFading(false)
        setTimeout(() => setWeatherFading(true), 4400)
        setTimeout(() => setWeather(null), 5200)
      })
      .catch(() => {})
  }, [currentLocation])

  // Pause global presence during navigation — other riders' GPS updates cause unnecessary re-renders
  useEffect(() => {
    if (isNavigating) return
    return subscribeToGlobalPresence(setGlobalRiders)
  }, [isNavigating])

  // During navigation: subscribe to nearby riders and render them as small dots (Waze style).
  // Runs only while navigating; cleans up on cancel. Filters by 2.5 km radius, max 20 riders.
  useEffect(() => {
    if (!isNavigating) { setNearbyNavRiders([]); return }

    const FIVE_MIN = 5 * 60 * 1000
    const MAX_DIST = 2500  // metres — 2.5 km radius
    const MIN_MOVE = 50    // re-filter when rider has moved > 50 m

    let cachedData: Record<string, any> = {}
    let lastFilterPos = { lat: 0, lng: 0 }

    const doFilter = () => {
      const pos = posAtualRef.current.lat !== 0 ? posAtualRef.current : null
      if (!pos) return
      const groupIds = new Set([...groupMembers.map(m => m.userId), currentUserId].filter(Boolean) as string[])
      type R = { userId: string; lat: number; lng: number; dist: number }
      const filtered: R[] = Object.values(cachedData)
        .filter((r: any) => r?.lat && r?.lng && !groupIds.has(r.userId) && Date.now() - r.lastUpdated < FIVE_MIN)
        .map((r: any): R => ({ userId: r.userId, lat: r.lat, lng: r.lng, dist: haversineDist(pos, { lat: r.lat, lng: r.lng }) }))
        .filter(r => r.dist < MAX_DIST)
        .sort((a, b) => a.dist - b.dist)
        .slice(0, 20)
      setNearbyNavRiders(filtered.map(({ userId, lat, lng }) => ({ userId, lat, lng })))
      lastFilterPos = { ...pos }
    }

    const unsub = onValue(ref(rtdb, 'riderPresence'), (snap) => {
      cachedData = snap.val() ?? {}
      doFilter()
    })

    // Re-filter every 5 s — catches user movement without waiting for a remote RTDB update
    const interval = setInterval(() => {
      const pos = posAtualRef.current.lat !== 0 ? posAtualRef.current : null
      if (pos && haversineDist(pos, lastFilterPos) > MIN_MOVE) doFilter()
    }, 5000)

    return () => { unsub(); clearInterval(interval); setNearbyNavRiders([]) }
  }, [isNavigating, currentUserId, groupMembers])

  useEffect(() => {
    if (!followUserId) { prevFollowPosRef.current = null; return }
    const m = groupMembers.find(m => m.userId === followUserId)
    if (!m) return
    const prev = prevFollowPosRef.current
    if (prev && prev.lat === m.lat && prev.lng === m.lng) return
    prevFollowPosRef.current = { lat: m.lat, lng: m.lng }
    mapRef.current?.flyTo({ center: [m.lng, m.lat], zoom: 16, duration: 600 })
  }, [followUserId, groupMembers])

  const applyRoute = useCallback((route: any) => {
    setRouteGeoJSON(route.geometry)
    setRouteCongestion(route.legs?.[0]?.annotation?.congestion ?? [])
    setNavSteps(route.legs?.[0]?.steps ?? [])
    setCurrentStepIdx(0)
    setRemainingDist(route.distance)
    setNavEta(Math.round(route.duration / 60))
    setRiskOnRoute(routeCrossesHighRiskZone(route.geometry.coordinates))
  }, [])

  const startCompass = useCallback(async () => {
    if (handleOrientationRef.current) {
      window.removeEventListener('deviceorientationabsolute', handleOrientationRef.current, true)
      window.removeEventListener('deviceorientation', handleOrientationRef.current, true)
    }
    compassFiredAbsoluteRef.current = false

    const handler = (event: Event) => {
      const e = event as any
      if (e.type === 'deviceorientationabsolute') compassFiredAbsoluteRef.current = true
      if (e.type === 'deviceorientation' && compassFiredAbsoluteRef.current) return
      let direction = 0
      if (e.webkitCompassHeading != null) {
        direction = e.webkitCompassHeading
      } else if (e.alpha != null) {
        direction = 360 - e.alpha
      } else {
        return
      }
      const smoothed = Math.round(smoothHeading(headingHistoryRef.current, direction))
      setHeading(prev => {
        const diff = Math.abs(smoothed - prev)
        if (Math.min(diff, 360 - diff) < 3) return prev
        return smoothed
      })
    }

    handleOrientationRef.current = handler

    const DOE = DeviceOrientationEvent as any
    if (typeof DOE.requestPermission === 'function') {
      try {
        const permission = await DOE.requestPermission()
        if (permission !== 'granted') return
      } catch {
        return
      }
    }

    window.addEventListener('deviceorientationabsolute', handler, true)
    window.addEventListener('deviceorientation', handler, true)
    setCompassActive(true)
  }, [])

  const stopCompass = useCallback(() => {
    if (handleOrientationRef.current) {
      window.removeEventListener('deviceorientationabsolute', handleOrientationRef.current, true)
      window.removeEventListener('deviceorientation', handleOrientationRef.current, true)
      handleOrientationRef.current = null
    }
    compassFiredAbsoluteRef.current = false
    setCompassActive(false)
    setHeading(0)
  }, [])

  const startNavigation = useCallback(async (dest: { lat: number; lng: number }, profile?: string, preloadedRoute?: any) => {
    if (!currentLocation) return
    const p = profile ?? routeProfile
    setNavError(null)
    try {
      const route = preloadedRoute ?? await fetchRoute(currentLocation, dest, p)
      if (!route) { setNavError('Rota não encontrada'); return }
      // Dismiss any focused input to prevent iOS shake-to-undo dialog during navigation
      if (typeof document !== 'undefined') (document.activeElement as HTMLElement)?.blur()
      setNavDest(dest)
      applyRoute(route)
      setNavTotalDist(route.distance)
      setIsNavigating(true)
      navMapFreeRef.current = true  // pause RAF so the flyTo intro plays uninterrupted
      setNavMapFree(false)
      setShowReCenter(false)
      // Turn off traffic layer — it's extremely heavy and unnecessary during navigation
      // (route congestion is already shown via the route line's congestion annotation)
      setShowTraffic(false)
      setShowNavAlts(false)
      // Preserve all alternative routes for mid-nav switching
      setNavAltRoutes(altRoutesRef.current)
      setNavRouteIdx(selectedAltIdxRef.current)
      startCompass()
      setTappedLocation(null)
      setShowModeSelector(false)
      setPendingNavDest(null)
      autoFollowRef.current = false
      setAutoFollow(false)
      setSelectedIncident(null)
      setSelectedZone(null)
      onPanelChange?.(false)
      const { lat: cLat, lng: cLng } = calcularCentroDeslocado(currentLocation.lat, currentLocation.lng, navBearing, NAV_ZOOM)
      mapRef.current?.flyTo({
        center: [cLng, cLat],
        pitch: NAV_PITCH, zoom: NAV_ZOOM, bearing: navBearing, duration: 800,
      })
      if (snapTimerRef.current !== null) clearTimeout(snapTimerRef.current)
      snapTimerRef.current = setTimeout(() => {
        snapTimerRef.current = null
        const s = rafNavStateRef.current
        headingAtualRef.current = s.northLocked ? 0 : (s.compassActive ? s.heading : s.navBearing)
        navMapFreeRef.current = false
      }, 800)
    } catch {
      setNavError('Erro ao calcular rota')
    }
  }, [currentLocation, routeProfile, navBearing, onPanelChange, applyRoute, startCompass])

  const cancelNavigation = useCallback(() => {
    // Capture pre-restore state before clearing
    const restoreDest = navDest
    const restoreRoutes = navAltRoutes
    const restoreRouteIdx = navRouteIdx

    stopCompass()
    setIsNavigating(false)
    setNavTotalDist(0)
    setNavSpeed(0)
    speedPrevRef.current = null
    setNavDest(null)
    setRouteGeoJSON(null)
    setRouteCongestion([])
    setNavSteps([])
    setCurrentStepIdx(0)
    setRiskOnRoute(false)
    setNavError(null)
    setIsRecalculating(false)
    setNorthLocked(false)
    navMapFreeRef.current = false
    setNavMapFree(false)
    setShowReCenter(false)
    setNavAltRoutes([])
    setNavRouteIdx(0)
    setShowNavAlts(false)
    headingHistoryRef.current = []
    setTappedLocation(null)
    setSelectedPermZone(null)

    if (restoreDest && restoreRoutes.length > 0) {
      // Restore pre-navigation view: reopen mode selector with saved routes + fitBounds
      setPendingNavDest(restoreDest)
      setAltRoutes(restoreRoutes)
      setSelectedAltIdx(restoreRouteIdx)
      setSafeRouteData(null)
      setShowModeSelector(true)
      autoFollowRef.current = false
      setAutoFollow(false)
      const allCoords = restoreRoutes.flatMap((r: any) => r.geometry.coordinates as [number, number][])
      const lngs = allCoords.map((c: number[]) => c[0])
      const lats = allCoords.map((c: number[]) => c[1])
      mapRef.current?.fitBounds(
        [[Math.min(...lngs), Math.min(...lats)], [Math.max(...lngs), Math.max(...lats)]],
        { padding: { top: 80, bottom: 420, left: 40, right: 40 }, duration: 800, maxZoom: 15 }
      )
    } else {
      mapRef.current?.easeTo({ pitch: 0, bearing: 0, zoom: 14, duration: 800, easing: (t: number) => t })
      autoFollowRef.current = true
      setAutoFollow(true)
    }
  }, [navDest, navAltRoutes, navRouteIdx, stopCompass])

  const switchNavRoute = useCallback((idx: number) => {
    const route = navAltRoutes[idx]
    if (!route) return
    applyRoute(route)
    setNavTotalDist(route.distance)
    setNavRouteIdx(idx)
    setShowNavAlts(false)
    lastRafTsRef.current = 0
    // Prime headingAtualRef to the live heading so re-center snaps to the correct bearing
    const s = rafNavStateRef.current
    headingAtualRef.current = s.northLocked ? 0 : (s.compassActive ? s.heading : s.navBearing)
    // Keep camera free — user stays in the zoomed-out/exploring view they were in.
    // RAF stays paused; re-center is the only way back to follow mode.
    navMapFreeRef.current = true
    setNavMapFree(true)
    setShowReCenter(true)
  }, [navAltRoutes, applyRoute])

  const goToCoords = useCallback((lat: number, lng: number) => {
    setShowSearch(false)
    setSearchText('')
    setSearchSuggestions([])
    setNavError(null)
    mapRef.current?.flyTo({ center: [lng, lat], zoom: 15, duration: 800 })
    setTappedLocation({ lat, lng, loading: true })
    reverseGeocode(lat, lng)
      .then(result => setTappedLocation(prev => prev ? { ...prev, ...result, loading: false } : null))
      .catch(() => setTappedLocation(prev => prev ? { ...prev, loading: false } : null))
  }, [])

  const suggestPlaces = useCallback(async (text: string) => {
    if (text.length < 2) { setSearchSuggestions([]); return }
    const token = process.env.NEXT_PUBLIC_MAPBOX_TOKEN
    const prox = currentLocation ? `&proximity=${currentLocation.lng},${currentLocation.lat}` : ''
    const url = `https://api.mapbox.com/search/searchbox/v1/suggest?q=${encodeURIComponent(text)}&language=pt&country=ie${prox}&types=poi,address,place,neighborhood,street&limit=6&session_token=${sessionTokenRef.current}&access_token=${token}`
    try {
      const res = await fetch(url)
      const data = await res.json()
      setSearchSuggestions(data.suggestions ?? [])
    } catch {
      setSearchSuggestions([])
    }
  }, [currentLocation])

  const retrievePlace = useCallback(async (mapboxId: string) => {
    const token = process.env.NEXT_PUBLIC_MAPBOX_TOKEN
    const url = `https://api.mapbox.com/search/searchbox/v1/retrieve/${mapboxId}?session_token=${sessionTokenRef.current}&access_token=${token}`
    const res = await fetch(url)
    const data = await res.json()
    return data.features?.[0] ?? null
  }, [])

  const selectSuggestion = useCallback(async (suggestion: any) => {
    setSearchLoading(true)
    setSearchSuggestions([])
    try {
      const feat = await retrievePlace(suggestion.mapbox_id)
      if (!feat) { setNavError('Não foi possível obter detalhes'); setSearchLoading(false); return }
      const [lng, lat] = feat.geometry.coordinates
      setShowSearch(false)
      setSearchText('')
      setSearchLoading(false)
      mapRef.current?.flyTo({ center: [lng, lat], zoom: 15, duration: 800 })
      setPendingNavDest({ lat, lng })
      setShowModeSelector(true)
    } catch {
      setNavError('Erro ao obter detalhes')
      setSearchLoading(false)
    }
  }, [retrievePlace])

  const handlePaste = useCallback((e: React.ClipboardEvent<HTMLInputElement>) => {
    const text = e.clipboardData.getData('text').trim()
    // Coordinates
    const coords = parseCoordinates(text)
    if (coords) { e.preventDefault(); goToCoords(coords.lat, coords.lng); return }
    // Google Maps URL with @lat,lng
    if (text.includes('google.com/maps') || text.includes('maps.app.goo.gl')) {
      const m = text.match(/@(-?\d+\.?\d+),(-?\d+\.?\d+)/)
      if (m) { e.preventDefault(); goToCoords(parseFloat(m[1]), parseFloat(m[2])); return }
    }
    // Plain text — let paste happen, suggestions will fire via debounce
  }, [goToCoords])

  const handleSearch = useCallback(async () => {
    if (searchSuggestions.length > 0) { selectSuggestion(searchSuggestions[0]); return }
    if (!searchText.trim()) return
    setSearchLoading(true)
    setNavError(null)
    try {
      const feat = await geocodeAddress(searchText, currentLocation ?? null)
      if (!feat) { setNavError('Endereço não encontrado'); setSearchLoading(false); return }
      const [lng, lat] = feat.geometry.coordinates
      setShowSearch(false)
      setSearchText('')
      setSearchLoading(false)
      setPendingNavDest({ lat, lng })
      setShowModeSelector(true)
    } catch {
      setNavError('Erro na pesquisa')
      setSearchLoading(false)
    }
  }, [searchText, searchSuggestions, currentLocation, selectSuggestion])

  // Debounced suggestions on text change
  useEffect(() => {
    if (!showSearch || !searchText) { if (!searchText) setSearchSuggestions([]); return }
    const timer = setTimeout(() => suggestPlaces(searchText), 250)
    return () => clearTimeout(timer)
  }, [searchText, showSearch, suggestPlaces])

  const handleRoutesLoaded = useCallback((routes: any[]) => {
    setAltRoutes(routes)
    setSelectedAltIdx(0)
    // Re-evaluate risk any time routes change (catches mode switches: moto→bike→walk)
    if (routes.length > 0) {
      setRiskOnRoute(routeCrossesHighRiskZone(routes[0].geometry.coordinates))
    }
    if (routes.length === 0 || !mapRef.current) return
    const allCoords = routes.flatMap((r: any) => r.geometry.coordinates as [number, number][])
    const lngs = allCoords.map((c: number[]) => c[0])
    const lats = allCoords.map((c: number[]) => c[1])
    mapRef.current.fitBounds(
      [[Math.min(...lngs), Math.min(...lats)], [Math.max(...lngs), Math.max(...lats)]],
      { padding: { top: 80, bottom: 420, left: 40, right: 40 }, duration: 800, maxZoom: 15 }
    )
  }, [])

  const handleRouteSelected = useCallback((idx: number) => {
    setSelectedAltIdx(idx)
  }, [])

  const handleSafeRouteReady = useCallback((safe: any | null, zones: ZoneHit[]) => {
    setSafeRouteData(safe)
    setActiveRouteZones(zones)
    // Extend fitBounds to include safe route geometry if available
    if (safe && mapRef.current) {
      const allCoords: [number, number][] = [
        ...(altRoutes[0]?.geometry?.coordinates ?? []),
        ...safe.geometry.coordinates,
      ]
      if (allCoords.length > 0) {
        const lngs = allCoords.map(c => c[0])
        const lats = allCoords.map(c => c[1])
        mapRef.current.fitBounds(
          [[Math.min(...lngs), Math.min(...lats)], [Math.max(...lngs), Math.max(...lats)]],
          { padding: { top: 80, bottom: 460, left: 40, right: 40 }, duration: 600, maxZoom: 16 }
        )
      }
    }
  }, [altRoutes])

  const handleMapClick = useCallback((e: any) => {
    if (isNavigating || showModeSelector) return
    const features: any[] = e.features ?? []
    if (features.length === 0) {
      setSelectedIncident(null)
      setSelectedZone(null)
      onPanelChange?.(false)
      if (!showModeSelector) {
        if (tapTimerRef.current) clearTimeout(tapTimerRef.current)
        const { lat, lng } = e.lngLat
        tapTimerRef.current = setTimeout(() => {
          tapTimerRef.current = null
          setTappedLocation({ lat, lng, loading: true })
          reverseGeocode(lat, lng)
            .then(result => setTappedLocation(prev => prev ? { ...prev, ...result, loading: false } : null))
            .catch(() => setTappedLocation(prev => prev ? { ...prev, loading: false } : null))
        }, 450)
      }
      return
    }
    const feat = features[0]
    if (feat.layer?.id === 'incidents-circle') {
      const inc = filteredIncidents.find(i => i.id === feat.properties?.id)
      if (inc) { setSelectedIncident(inc); setSelectedZone(null); setTappedLocation(null); onPanelChange?.(true) }
    } else if (feat.layer?.id === 'poi-label') {
      const coords = feat.geometry?.coordinates
      const lng = coords ? coords[0] : e.lngLat.lng
      const lat = coords ? coords[1] : e.lngLat.lat
      const name = feat.properties?.name
      const category = feat.properties?.category_en || feat.properties?.category || feat.properties?.type || ''
      setSelectedIncident(null)
      setSelectedZone(null)
      setTappedLocation({ lat, lng, name, category, loading: false })
    }
    // Zone fill layers are not interactive — their center pins handle clicks via React Markers
  }, [filteredIncidents, onPanelChange, isNavigating, showModeSelector, currentHour])

  const interactiveLayerIds = useMemo(() => {
    const ids: string[] = ['poi-label']
    if (!showHeatmap) ids.push('incidents-circle')
    return ids
  }, [showHeatmap])

  const zoneCount = useMemo(() => {
    const c = { high: 0, medium: 0, low: 0 }
    RISK_ZONES.forEach(z => c[z.level]++)
    return c
  }, [])

  // GPS speed estimation from position deltas
  useEffect(() => {
    if (!isNavigating || !currentLocation) {
      if (!isNavigating) { speedPrevRef.current = null; setNavSpeed(0) }
      return
    }
    const now = Date.now()
    const prev = speedPrevRef.current
    if (prev) {
      const dt = (now - prev.time) / 1000
      if (dt >= 1 && dt < 30) {
        setNavSpeed(Math.round((distMeters(prev, currentLocation) / dt) * 3.6))
      }
      if (dt >= 1) speedPrevRef.current = { ...currentLocation, time: now }
    } else {
      speedPrevRef.current = { ...currentLocation, time: now }
    }
  }, [currentLocation, isNavigating])

  // Zone proximity alerts during navigation (fast route with zones)
  useEffect(() => {
    if (!isNavigating || !riskOnRoute || !currentLocation || activeRouteZones.length === 0) return
    for (const zona of activeRouteZones) {
      if (alertedZonesRef.current.has(zona.id)) continue
      const dist = distMeters(currentLocation, { lat: zona.lat, lng: zona.lng })
      if (dist < 400) {
        alertedZonesRef.current.add(zona.id)
        setZoneAlert({ zone: zona, dist: Math.round(dist) })
        if (zoneAlertTimerRef.current) clearTimeout(zoneAlertTimerRef.current)
        zoneAlertTimerRef.current = setTimeout(() => setZoneAlert(null), 9000)
      }
    }
  }, [currentLocation, isNavigating, riskOnRoute, activeRouteZones])

  // Clear alert refs when navigation ends
  useEffect(() => {
    if (!isNavigating) { alertedZonesRef.current = new Set(); setZoneAlert(null) }
  }, [isNavigating])

  // Refresh congestion data every 60s during navigation
  navRefreshRef.current = { dest: navDest, profile: routeProfile, loc: currentLocation }
  useEffect(() => {
    if (!isNavigating) return
    const interval = setInterval(async () => {
      const { dest, profile, loc } = navRefreshRef.current
      if (!dest || !loc) return
      try {
        const route = await fetchRoute(loc, dest, profile)
        if (route) {
          setRouteCongestion(route.legs?.[0]?.annotation?.congestion ?? [])
          setRouteGeoJSON(route.geometry)
        }
      } catch {}
    }, 60000)
    return () => clearInterval(interval)
  }, [isNavigating])

  // Show category sheet when new pins arrive
  useEffect(() => {
    if (categoryPins.length > 0) setShowCategorySheet(true)
    else setShowCategorySheet(false)
  }, [categoryPins])

  const handleToggleNorth = useCallback(() => {
    setNorthLocked(n => {
      const next = !n
      if (next) {
        // Snap map to North immediately — don't wait for RAF lerp
        headingAtualRef.current = 0
        mapRef.current?.easeTo({ bearing: 0, duration: 300, easing: (t: number) => t })
      }
      return next
    })
  }, [])

  const CATEGORY_SUGGEST_TERMS: Record<string, string> = {
    charging: 'ev charging station electric vehicle',
    cafe: 'cafe coffee',
    hospital: 'hospital emergency clinic urgent care',
  }

  const searchServiceProvidersFromFirestore = useCallback(async () => {
    setCategorySearchLoading(true)
    onCategorySearching?.(true)
    try {
      const snap = await getDocs(query(collection(db, 'service_providers'), where('status', '==', 'approved')))
      const pins = snap.docs
        .map(d => {
          const p = d.data()
          return {
            lat: p.lat as number,
            lng: p.lng as number,
            name: p.name as string,
            category: 'Mecânicos',
            icon: '🔧',
            catKey: 'mechanic',
            address: p.contact ?? p.serviceType ?? '',
          }
        })
        .filter(p => p.lat && p.lng)
      setCategoryPins(pins)
      setShowSearchArea(false)
      if (pins.length > 0 && mapRef.current) {
        const lngs = pins.map(p => p.lng)
        const lats = pins.map(p => p.lat)
        mapRef.current.fitBounds(
          [[Math.min(...lngs), Math.min(...lats)], [Math.max(...lngs), Math.max(...lats)]],
          { padding: 80, maxZoom: 17, duration: 800 }
        )
      }
    } catch {
      setCategoryPins([])
    } finally {
      setCategorySearchLoading(false)
      onCategorySearching?.(false)
    }
  }, [onCategorySearching])

  const searchPartnersFromFirestore = useCallback(async () => {
    setCategorySearchLoading(true)
    onCategorySearching?.(true)
    try {
      const snap = await getDocs(collection(db, 'partners'))
      const partners = snap.docs.map(d => ({ id: d.id, ...d.data() } as { id: string; name?: string; lat?: number; lng?: number; offer?: string; emoji?: string; mapboxQuery?: string }))
      const token = process.env.NEXT_PUBLIC_MAPBOX_TOKEN
      // Dublin bounding box — ensures city-wide coverage regardless of rider position
      const DUBLIN_BBOX = '-6.49,53.23,-6.06,53.55'
      const allPins: Array<{ lat: number; lng: number; name: string; category: string; icon: string; catKey: string; address: string }> = []
      const seen = new Set<string>()  // deduplicate by rounded coords

      const addPin = (lat: number, lng: number, name: string, icon: string, offer: string, addr: string) => {
        const key = `${lat.toFixed(3)}_${lng.toFixed(3)}`
        if (seen.has(key)) return
        seen.add(key)
        allPins.push({ lat, lng, name, category: 'Parceiros', icon, catKey: 'partners', address: addr })
      }

      for (const p of partners) {
        if (p.mapboxQuery) {
          const icon = (p.emoji as string) ?? '🤝'
          const offerText = (p.offer as string) ?? ''

          // Strategy 1: Mapbox Search Box suggest (proximity-ranked, good for autocomplete)
          const sessionToken = crypto.randomUUID()
          const sbParams = new URLSearchParams({
            q: p.mapboxQuery as string,
            language: 'en',
            country: 'ie',
            types: 'poi',
            limit: '10',
            bbox: DUBLIN_BBOX,
            session_token: sessionToken,
            access_token: token ?? '',
          })
          try {
            const res = await fetch(`https://api.mapbox.com/search/searchbox/v1/suggest?${sbParams}`)
            const data = await res.json()
            const suggestions: any[] = data.suggestions ?? []
            await Promise.all(suggestions.map(async (sug) => {
              if (!sug.mapbox_id) return
              try {
                const rRes = await fetch(`https://api.mapbox.com/search/searchbox/v1/retrieve/${sug.mapbox_id}?session_token=${sessionToken}&access_token=${token}`)
                const rData = await rRes.json()
                const feat = rData.features?.[0]
                if (!feat?.geometry?.coordinates) return
                const [lng, lat] = feat.geometry.coordinates
                const addr = feat.properties?.full_address || feat.properties?.place_formatted || sug.full_address || ''
                addPin(lat, lng, sug.name || (p.name as string), icon, offerText, `${offerText}${addr ? ' · ' + addr : ''}`)
              } catch { /* skip */ }
            }))
          } catch { /* fall through to strategy 2 */ }

          // Strategy 2: Geocoding V5 with Dublin bbox (better city-wide coverage)
          try {
            const gcUrl = `https://api.mapbox.com/geocoding/v5/mapbox.places/${encodeURIComponent(p.mapboxQuery as string)}.json?country=ie&bbox=${DUBLIN_BBOX}&limit=10&types=poi&access_token=${token}`
            const gcRes = await fetch(gcUrl)
            const gcData = await gcRes.json()
            for (const feat of (gcData.features ?? [])) {
              const [lng, lat] = feat.center
              const addr = feat.place_name ?? ''
              addPin(lat, lng, feat.text || (p.name as string), icon, offerText, `${offerText}${addr ? ' · ' + addr : ''}`)
            }
          } catch { /* skip */ }

        } else if (p.lat && p.lng) {
          allPins.push({
            lat: p.lat as number, lng: p.lng as number,
            name: p.name as string,
            category: 'Parceiros',
            icon: (p.emoji as string) ?? '🤝',
            catKey: 'partners',
            address: (p.offer as string) ?? '',
          })
        }
      }

      setCategoryPins(allPins)
      setShowSearchArea(false)
      if (allPins.length > 0 && mapRef.current) {
        const lngs = allPins.map(p => p.lng)
        const lats = allPins.map(p => p.lat)
        mapRef.current.fitBounds(
          [[Math.min(...lngs), Math.min(...lats)], [Math.max(...lngs), Math.max(...lats)]],
          { padding: 60, maxZoom: 17, duration: 800 }
        )
      }
    } catch {
      setCategoryPins([])
    } finally {
      setCategorySearchLoading(false)
      onCategorySearching?.(false)
    }
  }, [onCategorySearching])

  const doSearchInArea = useCallback(async (query: string, label: string, icon: string, catKey: string) => {
    const map = mapRef.current
    if (!map) return
    const center = map.getCenter()
    const bounds = map.getBounds()
    if (!center || !bounds) return
    const token = process.env.NEXT_PUBLIC_MAPBOX_TOKEN
    const myId = ++categoryReqRef.current
    setCategorySearchLoading(true)
    onCategorySearching?.(true)
    const sessionToken = crypto.randomUUID()
    const searchQuery = CATEGORY_SUGGEST_TERMS[catKey] ?? query
    const params = new URLSearchParams({
      q: searchQuery,
      language: 'en',
      country: 'ie',
      proximity: `${center.lng},${center.lat}`,
      bbox: [bounds.getWest(), bounds.getSouth(), bounds.getEast(), bounds.getNorth()].join(','),
      types: 'poi',
      limit: '20',
      session_token: sessionToken,
      access_token: token ?? '',
    })
    try {
      const res = await fetch(`https://api.mapbox.com/search/searchbox/v1/suggest?${params}`)
      const data = await res.json()
      const suggestions: any[] = data.suggestions ?? []
      if (categoryReqRef.current !== myId) return
      // Retrieve coordinates for each suggestion in parallel
      const pinResults = await Promise.all(
        suggestions.map(async (sug: any) => {
          if (!sug.mapbox_id) return null
          try {
            const rRes = await fetch(
              `https://api.mapbox.com/search/searchbox/v1/retrieve/${sug.mapbox_id}?session_token=${sessionToken}&access_token=${token}`
            )
            const rData = await rRes.json()
            const feat = rData.features?.[0]
            if (!feat?.geometry?.coordinates) return null
            const [lng, lat] = feat.geometry.coordinates
            return {
              lat, lng,
              name: sug.name || '',
              category: label,
              icon,
              catKey,
              address: feat.properties?.full_address || feat.properties?.place_formatted || sug.full_address || '',
            }
          } catch {
            return null
          }
        })
      )
      if (categoryReqRef.current !== myId) return
      const pins = pinResults.filter(Boolean) as Array<{ lat: number; lng: number; name: string; category: string; icon: string; catKey: string; address: string }>
      setCategoryPins(pins)
      setShowSearchArea(false)
      if (pins.length > 0) {
        const lngs = pins.map(p => p.lng)
        const lats = pins.map(p => p.lat)
        mapRef.current?.fitBounds(
          [[Math.min(...lngs), Math.min(...lats)], [Math.max(...lngs), Math.max(...lats)]],
          { padding: 60, maxZoom: 17, duration: 800 }
        )
      }
    } catch {
      if (categoryReqRef.current === myId) setCategoryPins([])
    } finally {
      if (categoryReqRef.current === myId) { setCategorySearchLoading(false); onCategorySearching?.(false) }
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [onCategorySearching])

  // React to category chip selection from page.tsx
  useEffect(() => {
    if (!searchCategory) {
      setCategoryPins([])
      setShowSearchArea(false)
      return
    }
    if (searchCategory.key === 'partners') { searchPartnersFromFirestore(); return }
    if (searchCategory.key === 'mechanic') { searchServiceProvidersFromFirestore(); return }
    doSearchInArea(searchCategory.query, searchCategory.label, searchCategory.icon, searchCategory.key)
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [searchCategory?.key])

  useEffect(() => {
    if (!requestNavTo) return
    const { lat, lng } = requestNavTo
    mapRef.current?.flyTo({ center: [lng, lat], zoom: 15, duration: 800 })
    setPendingNavDest({ lat, lng })
    setShowModeSelector(true)
    setTappedLocation(null)
    onNavRequested?.()
  }, [requestNavTo, onNavRequested])

  useEffect(() => {
    onNavigationChange?.(isNavigating)
  }, [isNavigating, onNavigationChange])

  useEffect(() => {
    onModeSelectorChange?.(showModeSelector)
  }, [showModeSelector, onModeSelectorChange])

  // Reset camera to top-down when mode selector opens
  useEffect(() => {
    if (showModeSelector && !isNavigating && mapRef.current) {
      mapRef.current.easeTo({ pitch: 0, bearing: 0, duration: 600, easing: (t: number) => t })
    }
  }, [showModeSelector, isNavigating])

  // Clear alt routes when mode selector closes
  useEffect(() => {
    if (!showModeSelector) {
      setAltRoutes([])
      setSelectedAltIdx(0)
    }
  }, [showModeSelector])

  const followedMember = followUserId ? groupMembers.find(m => m.userId === followUserId) ?? null : null
  const currentStep = navSteps[currentStepIdx]

  return (
    <div className="relative w-full h-full">
      <Map
        ref={mapRef}
        initialViewState={{ longitude: DUBLIN_LNG, latitude: DUBLIN_LAT, zoom: 14 }}
        style={{ width: '100%', height: '100%' }}
        mapStyle={mapStyle}
        mapboxAccessToken={process.env.NEXT_PUBLIC_MAPBOX_TOKEN}
        onClick={handleMapClick}
        onTouchStart={() => {
          // Cancel any pending snap-timer so it doesn't resume RAF mid-gesture
          if (snapTimerRef.current !== null) {
            clearTimeout(snapTimerRef.current)
            snapTimerRef.current = null
            // Snap was in progress — keep map free and show re-center
            if (navegandoRef.current) { setShowReCenter(true) }
            return
          }
          // Set ref synchronously on first touch so the RAF stops easeTo before React re-renders
          if (navegandoRef.current && !navMapFreeRef.current) {
            navMapFreeRef.current = true
            setNavMapFree(true)
            setShowReCenter(true)
          }
        }}
        onDragStart={() => {
          if (snapTimerRef.current !== null) { clearTimeout(snapTimerRef.current); snapTimerRef.current = null }
          if (!isNavigating) { autoFollowRef.current = false; setAutoFollow(false) }
          if (isNavigating) { navMapFreeRef.current = true; setNavMapFree(true); setShowReCenter(true) }
          if (tapTimerRef.current) { clearTimeout(tapTimerRef.current); tapTimerRef.current = null }
          setTappedLocation(null)
        }}
        onZoomStart={(e: any) => {
          if (e.originalEvent && snapTimerRef.current !== null) { clearTimeout(snapTimerRef.current); snapTimerRef.current = null }
          if (isNavigating && e.originalEvent) { navMapFreeRef.current = true; setNavMapFree(true); setShowReCenter(true) }
        }}
        onZoomEnd={(e: any) => {
          const z = mapRef.current?.getZoom() ?? 14
          setCurrentZoom(z)
          if (isNavigating && e.originalEvent) setShowNavAlts(z < 14.5)
        }}
        onMoveEnd={(e: any) => {
          if (searchCategory && !isNavigating && e.originalEvent) setShowSearchArea(true)
          setMapBearing(mapRef.current?.getBearing() ?? 0)
        }}
        onRotateEnd={() => { setMapBearing(mapRef.current?.getBearing() ?? 0) }}
        interactiveLayerIds={interactiveLayerIds}
      >

        {/* Traffic layer — only when user explicitly toggles it (never auto-enabled during nav: tiles are heavy) */}
        {showTraffic && (
          <Source id="mapbox-traffic" type="vector" url="mapbox://mapbox.mapbox-traffic-v1">
            <Layer
              id="traffic-layer"
              type="line"
              source-layer="traffic"
              filter={[
                'step', ['zoom'],
                ['in', ['get', 'class'], ['literal', ['motorway', 'trunk']]],
                12,
                ['in', ['get', 'class'], ['literal', ['motorway', 'trunk', 'primary']]],
                14,
                ['in', ['get', 'class'], ['literal', ['motorway', 'trunk', 'primary', 'secondary']]],
              ] as any}
              layout={{ 'line-join': 'round', 'line-cap': 'round' }}
              paint={{
                'line-width': [
                  'interpolate', ['linear'], ['zoom'],
                  10, ['match', ['get', 'class'], ['motorway', 'trunk'], 3, 'primary', 2, 1.5],
                  14, ['match', ['get', 'class'], ['motorway', 'trunk'], 5, 'primary', 4, 3],
                  17, ['match', ['get', 'class'], ['motorway', 'trunk'], 8, 'primary', 6, 5],
                ],
                'line-color': ['match', ['get', 'congestion'],
                  'low', '#00c853',
                  'moderate', '#ffab00',
                  'heavy', '#ff6d00',
                  'severe', '#d50000',
                  '#aaaaaa',
                ],
                'line-opacity': [
                  'interpolate', ['linear'], ['zoom'],
                  10, 0.8,
                  14, 0.9,
                  17, 1.0,
                ],
              } as any}
            />
          </Source>
        )}

        {/* Risk Zones — dimmed 13-14, full at 15+ */}
        {showZones && currentZoom >= 13 && (
          <Source id="zones" type="geojson" data={zonesGeoJSON}>
            <Layer id="zones-fill" type="fill" paint={{
              'fill-color': ['match', ['get', 'level'], 'high', '#ef4444', 'medium', '#f97316', '#eab308'],
              'fill-opacity': currentZoom >= 15 ? 0.22 : 0.10,
            }} />
            <Layer id="zones-line" type="line" paint={{
              'line-color': ['match', ['get', 'level'], 'high', '#dc2626', 'medium', '#ea580c', '#ca8a04'],
              'line-width': 2,
              'line-opacity': currentZoom >= 15 ? 0.55 : 0.25,
            }} />
            <Layer id="zone-labels" type="symbol" layout={{
              'text-field': ['get', 'name'], 'text-size': 10,
              'text-font': ['DIN Offc Pro Medium', 'Arial Unicode MS Bold'],
              'text-anchor': 'center', 'text-max-width': 8,
            }} paint={{
              'text-color': ['match', ['get', 'level'], 'high', '#ef4444', 'medium', '#f97316', '#eab308'],
              'text-halo-color': 'rgba(0,0,0,0.9)', 'text-halo-width': 1.5,
            }} />
          </Source>
        )}

        {/* Permanent zones — zoom-gated */}
        {showZones && currentZoom >= 13 && <Source id="perm-zones" type="geojson" data={permanentZonesGeoJSON}>
          <Layer id="perm-zones-fill" type="fill" paint={{
            'fill-color': ['match', ['get', 'level'],
              'critical', '#ef4444',
              'high', '#ef4444',
              'medium', '#f97316',
              '#eab308',
            ],
            'fill-opacity': currentZoom >= 15 ? 0.18 : 0.08,
          }} />
          <Layer id="perm-zones-line" type="line" paint={{
            'line-color': ['match', ['get', 'level'],
              'critical', '#dc2626',
              'high', '#dc2626',
              'medium', '#ea580c',
              '#ca8a04',
            ],
            'line-width': 1.5,
            'line-opacity': currentZoom >= 15 ? 0.55 : 0.25,
            'line-dasharray': [3, 2],
          }} />
          <Layer id="perm-zones-labels" type="symbol" layout={{
            'text-field': ['get', 'name'], 'text-size': 10,
            'text-font': ['DIN Offc Pro Medium', 'Arial Unicode MS Bold'],
            'text-anchor': 'center', 'text-max-width': 8,
          }} paint={{
            'text-color': ['match', ['get', 'level'],
              'critical', '#f87171',
              'high', '#f87171',
              'medium', '#fb923c',
              '#fbbf24',
            ],
            'text-halo-color': 'rgba(0,0,0,0.9)', 'text-halo-width': 1.5,
          }} />
        </Source>}

        {/* Firestore risk_zones — manual zones, zoom-gated */}
        {showZones && currentZoom >= 13 && firestoreZonesGeoJSON.features.length > 0 && (
          <Source id="fs-zones" type="geojson" data={firestoreZonesGeoJSON}>
            <Layer id="fs-zones-fill" type="fill" paint={{
              'fill-color': ['match', ['get', 'level'],
                'critical', '#ef4444', 'high', '#ef4444', 'medium', '#f97316', '#eab308'],
              'fill-opacity': 0.2,
            }} />
            <Layer id="fs-zones-line" type="line" paint={{
              'line-color': ['match', ['get', 'level'],
                'critical', '#dc2626', 'high', '#dc2626', 'medium', '#ea580c', '#ca8a04'],
              'line-width': 2,
              'line-opacity': 0.55,
            }} />
          </Source>
        )}
        {showZones && firestoreZones.filter(z => z.lat && z.lng).map(z => {
          const level = z.riskLevel ?? 'medium'
          const emoji = level === 'critical' ? '🔴' : level === 'high' ? '🔴' : level === 'medium' ? '🟠' : '🟡'
          const borderColor = level === 'critical' || level === 'high' ? '#ef4444' : level === 'medium' ? '#f97316' : '#eab308'
          return (
            <Marker key={`pin-fs-${z.id}`} longitude={z.lng} latitude={z.lat} anchor="bottom">
              <div
                onClick={(e) => {
                  e.stopPropagation()
                  setSelectedPermZone({ id: z.id, name: z.areaName ?? z.id, lat: z.lat, lng: z.lng, radius: z.radius ?? 200, zone: 'manual', country: 'ie', riskLevel: level, peakHours: z.peakHours ?? [], notes: z.notes ?? '' } as any)
                  setSelectedZone(null); setSelectedIncident(null); setTappedLocation(null); onPanelChange?.(true)
                }}
                style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', cursor: 'pointer', filter: 'drop-shadow(0 2px 4px rgba(0,0,0,0.4))' }}
              >
                <div style={{ width: 28, height: 28, borderRadius: '50%', background: 'var(--surface)', border: `2px solid ${borderColor}`, display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 13 }}>
                  {emoji}
                </div>
                <div style={{ width: 0, height: 0, borderLeft: '4px solid transparent', borderRight: '4px solid transparent', borderTop: `6px solid ${borderColor}` }} />
              </div>
            </Marker>
          )
        })}

        {/* Zone center pins — ONLY clickable element of each zone (fills are visual-only) */}
        {showZones && !isNavigating && visiblePermZones.map(pz => {
          const level = getRiskLevelActual(pz, currentHour)
          const emoji = level === 'critical' ? '🔴' : level === 'high' ? '🔴' : level === 'medium' ? '🟠' : '🟡'
          const borderColor = level === 'critical' || level === 'high' ? '#ef4444' : PERM_ZONE_COLORS[level]?.fill ?? '#f97316'
          return (
            <Marker key={`pin-pz-${pz.id}`} longitude={pz.lng} latitude={pz.lat} anchor="bottom">
              <div
                onClick={(e) => {
                  e.stopPropagation()
                  setSelectedPermZone(pz)
                  setSelectedZone(null)
                  setSelectedIncident(null)
                  setTappedLocation(null)
                  onPanelChange?.(true)
                }}
                style={{
                  display: 'flex', flexDirection: 'column', alignItems: 'center',
                  cursor: 'pointer', filter: 'drop-shadow(0 2px 4px rgba(0,0,0,0.4))',
                }}
              >
                <div style={{
                  width: 28, height: 28, borderRadius: '50%',
                  background: 'var(--surface)', border: `2px solid ${borderColor}`,
                  display: 'flex', alignItems: 'center', justifyContent: 'center',
                  fontSize: 13,
                }}>
                  {emoji}
                </div>
                <div style={{ width: 0, height: 0, borderLeft: '4px solid transparent', borderRight: '4px solid transparent', borderTop: `6px solid ${borderColor}` }} />
              </div>
            </Marker>
          )
        })}
        {showZones && !isNavigating && RISK_ZONES.map(z => {
          const centroid = polygonCentroid(z.polygon)
          const emoji = z.level === 'high' ? '🟠' : z.level === 'medium' ? '🟡' : '🟢'
          const borderColor = ZONE_COLORS[z.level]?.stroke ?? '#f97316'
          return (
            <Marker key={`pin-z-${z.id}`} longitude={centroid.lng} latitude={centroid.lat} anchor="bottom">
              <div
                onClick={(e) => {
                  e.stopPropagation()
                  setSelectedZone(z)
                  setSelectedIncident(null)
                  setTappedLocation(null)
                  setSelectedPermZone(null)
                  onPanelChange?.(true)
                }}
                style={{
                  display: 'flex', flexDirection: 'column', alignItems: 'center',
                  cursor: 'pointer', filter: 'drop-shadow(0 2px 4px rgba(0,0,0,0.4))',
                }}
              >
                <div style={{
                  width: 28, height: 28, borderRadius: '50%',
                  background: 'var(--surface)', border: `2px solid ${borderColor}`,
                  display: 'flex', alignItems: 'center', justifyContent: 'center',
                  fontSize: 13,
                }}>
                  {emoji}
                </div>
                <div style={{ width: 0, height: 0, borderLeft: '4px solid transparent', borderRight: '4px solid transparent', borderTop: `6px solid ${borderColor}` }} />
              </div>
            </Marker>
          )
        })}

        {/* Alternative routes — shown when mode selector is open */}
        {showModeSelector && altRoutes.map((route, i) => {
          const isSel = i === selectedAltIdx
          return (
            <Source key={`alt-${i}`} id={`alt-route-${i}`} type="geojson"
              data={{ type: 'Feature', geometry: route.geometry, properties: {} }}>
              <Layer id={`alt-casing-${i}`} type="line"
                layout={{ 'line-cap': 'round', 'line-join': 'round' }}
                paint={{
                  'line-color': isSel ? '#1a3a6e' : '#666666',
                  'line-width': isSel ? 10 : 7,
                  'line-opacity': isSel ? 1 : 0.45,
                }} />
              <Layer id={`alt-line-${i}`} type="line"
                layout={{ 'line-cap': 'round', 'line-join': 'round' }}
                paint={{
                  'line-color': isSel ? '#4f8ef7' : '#aaaaaa',
                  'line-width': isSel ? 6 : 4,
                  'line-opacity': isSel ? 1 : 0.6,
                }} />
            </Source>
          )
        })}

        {/* Safe route — green, shown when mode selector is open and zones found */}
        {showModeSelector && safeRouteData && (
          <Source id="safe-route" type="geojson"
            data={{ type: 'Feature', geometry: safeRouteData.geometry, properties: {} }}>
            <Layer id="safe-route-casing" type="line"
              layout={{ 'line-cap': 'round', 'line-join': 'round' }}
              paint={{ 'line-color': '#0a4a2a', 'line-width': 11, 'line-opacity': 0.9 }} />
            <Layer id="safe-route-line" type="line"
              layout={{ 'line-cap': 'round', 'line-join': 'round' }}
              paint={{ 'line-color': '#1a9c5b', 'line-width': 7 }} />
          </Source>
        )}

        {/* Safe route midpoint label */}
        {showModeSelector && safeRouteData && (() => {
          const coords: [number, number][] = safeRouteData.geometry.coordinates
          const mid = coords[Math.floor(coords.length / 2)]
          return (
            <Marker longitude={mid[0]} latitude={mid[1]} anchor="center">
              <div style={{
                background: '#1a6b4a', color: 'white',
                padding: '5px 12px', borderRadius: 16,
                fontSize: 12, fontWeight: 800,
                boxShadow: '0 2px 8px rgba(0,0,0,0.35)',
                pointerEvents: 'none', whiteSpace: 'nowrap',
              }}>
                🛡️ {Math.ceil(safeRouteData.duration / 60)} min
              </div>
            </Marker>
          )
        })()}

        {/* Alt route midpoint labels (selectable) */}
        {showModeSelector && altRoutes.map((route, i) => {
          const coords: [number, number][] = route.geometry.coordinates
          const mid = coords[Math.floor(coords.length / 2)]
          const isSel = i === selectedAltIdx
          return (
            <Marker key={`alt-lbl-${i}`} longitude={mid[0]} latitude={mid[1]} anchor="center">
              <div
                onClick={() => { setSelectedAltIdx(i); handleRouteSelected(i) }}
                style={{
                  background: isSel ? '#1a56db' : 'white',
                  color: isSel ? 'white' : '#333',
                  border: isSel ? 'none' : '1px solid #ccc',
                  padding: '5px 10px', borderRadius: 20,
                  fontWeight: 700, fontSize: 13,
                  boxShadow: '0 2px 8px rgba(0,0,0,0.25)',
                  cursor: 'pointer', whiteSpace: 'nowrap',
                  pointerEvents: 'auto',
                }}
              >
                {Math.ceil(route.duration / 60)} min
              </div>
            </Marker>
          )
        })}

        {/* Route line — congestion-colored with neon glow */}
        {routeCongestionGeoJSON && (
          <Source id="route" type="geojson" data={routeCongestionGeoJSON}>
            {/* Outer glow — wide blurred layer behind casing */}
            <Layer id="route-line-glow" type="line"
              layout={{ 'line-cap': 'round', 'line-join': 'round' }}
              paint={{ 'line-color': '#4f8ef7', 'line-width': 22, 'line-opacity': 0.12, 'line-blur': 8 }} />
            <Layer id="route-line-casing" type="line"
              layout={{ 'line-cap': 'round', 'line-join': 'round' }}
              paint={{ 'line-color': '#0d2151', 'line-width': 10, 'line-opacity': 0.75 }} />
            <Layer id="route-line" type="line"
              layout={{ 'line-cap': 'round', 'line-join': 'round' }}
              paint={{
                'line-color': ['match', ['get', 'congestion'],
                  'low', '#00e676',
                  'moderate', '#ffab00',
                  'heavy', '#ff6d00',
                  'severe', '#d50000',
                  '#4f8ef7',
                ] as any,
                'line-width': 6,
              }} />
          </Source>
        )}

        {/* Incidents */}
        <Source id="incidents" type="geojson" data={incidentsGeoJSON}>
          {showHeatmap ? (
            <Layer id="incidents-heat" type="heatmap" paint={{
              'heatmap-weight': 0.8, 'heatmap-radius': 35,
              'heatmap-color': ['interpolate', ['linear'], ['heatmap-density'],
                0, 'rgba(0,0,0,0)', 0.4, '#3b82f6', 0.65, '#f97316', 1, '#ef4444'],
              'heatmap-opacity': 0.8,
            }} />
          ) : (
            <Layer id="incidents-circle" type="circle" paint={{
              'circle-color': ['match', ['get', 'type'],
                'robbery', '#ef4444', 'attempted_robbery', '#f97316',
                'aggression', '#eab308', 'suspicious_activity', '#93c5fd',
                'accident', '#60a5fa', 'road_hazard', '#34d399', '#6b7280'],
              'circle-radius': 8, 'circle-stroke-width': 2,
              'circle-stroke-color': 'white', 'circle-opacity': 0.9,
            }} />
          )}
        </Source>

        {/* Destination marker — bounces on appear */}
        {navDest && (
          <Marker longitude={navDest.lng} latitude={navDest.lat} anchor="bottom">
            <div style={{ textAlign: 'center', pointerEvents: 'none', animation: 'pinBounce 0.55s ease-out' }}>
              <div style={{ fontSize: 30, filter: 'drop-shadow(0 3px 8px rgba(0,0,0,0.5))' }}>📍</div>
            </div>
          </Marker>
        )}

        {/* Tapped location pin (pending) */}
        {tappedLocation && !isNavigating && (
          <Marker longitude={tappedLocation.lng} latitude={tappedLocation.lat} anchor="bottom">
            <div style={{ fontSize: 26, filter: 'drop-shadow(0 2px 6px rgba(0,0,0,0.6))', pointerEvents: 'none', opacity: 0.9 }}>📍</div>
          </Marker>
        )}

        {/* Pending nav dest pin (mode selector open) */}
        {pendingNavDest && showModeSelector && (
          <Marker longitude={pendingNavDest.lng} latitude={pendingNavDest.lat} anchor="bottom">
            <div style={{ fontSize: 28, filter: 'drop-shadow(0 2px 6px rgba(0,0,0,0.6))', pointerEvents: 'none' }}>📍</div>
          </Marker>
        )}

        {/* User location — uses smoothedPos for butter-smooth 60fps movement */}
        {(smoothedPos ?? currentLocation) && (
          <Marker longitude={(smoothedPos ?? currentLocation)!.lng} latitude={(smoothedPos ?? currentLocation)!.lat} anchor={isNavigating ? 'center' : 'bottom'}>
            {isNavigating ? (
              <div style={{
                width: 48, height: 48,
                filter: 'drop-shadow(0 3px 6px rgba(0,0,0,0.4))',
                transform: northLocked ? `rotate(${smoothedHeading}deg)` : 'rotate(0deg)',
                pointerEvents: 'none',
              }}>
                <svg width="48" height="48" viewBox="0 0 48 48">
                  <polygon points="24,4 38,40 24,33 10,40" fill="#f59e0b" stroke="rgba(0,0,0,0.3)" strokeWidth="1.5" strokeLinejoin="round"/>
                </svg>
              </div>
            ) : (
              <RiderPin name="Eu" />
            )}
          </Marker>
        )}

        {/* Group member markers */}
        {groupMembers.filter(m => m.userId !== currentUserId).map(member => (
          <Marker key={member.userId} longitude={member.lng} latitude={member.lat} anchor="bottom"
            onClick={onFollowChange ? (e) => {
              e.originalEvent.stopPropagation()
              const next = member.userId === followUserId ? null : member.userId
              onFollowChange(next)
              if (next) { autoFollowRef.current = false; setAutoFollow(false) }
            } : undefined}
          >
            <div style={{ pointerEvents: onFollowChange ? 'auto' : 'none', cursor: onFollowChange ? 'pointer' : 'default' }}>
              <RiderPin name={member.name} />
            </div>
          </Marker>
        ))}

        {/* Emergency markers */}
        {Object.entries(emergencies).map(([uid, em]) => (
          <Marker key={uid} longitude={em.lng} latitude={em.lat} anchor="center">
            <div style={{ fontSize: 28, filter: 'drop-shadow(0 2px 4px rgba(0,0,0,0.5))', pointerEvents: 'none' }}>🚨</div>
          </Marker>
        ))}

        {/* Nearby riders during navigation — Waze-style small circle dots, no labels.
            minzoom=15 hides them automatically on zoom out; opacity 0.85 keeps route visible. */}
        {isNavigating && (
          <Source
            id="nav-riders"
            type="geojson"
            data={{
              type: 'FeatureCollection',
              features: nearbyNavRiders.map(r => ({
                type: 'Feature' as const,
                properties: { uid: r.userId },
                geometry: { type: 'Point' as const, coordinates: [r.lng, r.lat] },
              })),
            }}
          >
            <Layer
              id="nav-riders-dots"
              type="circle"
              minzoom={15}
              paint={{
                'circle-radius': 5,
                'circle-color': '#4f8ef7',
                'circle-opacity': 0.85,
                'circle-stroke-width': 1.5,
                'circle-stroke-color': '#ffffff',
              }}
            />
          </Source>
        )}

        {/* Global rider presence — hidden below zoom 15 (Waze-style clean map) */}
        {currentZoom >= 15 && (() => {
          const groupIds = new Set([...groupMembers.map(m => m.userId), currentUserId].filter(Boolean) as string[])
          return globalRiders.filter(r => !groupIds.has(r.userId)).map(rider => (
            <Marker key={`gp_${rider.userId}`} longitude={rider.lng} latitude={rider.lat} anchor="center">
              <div style={{
                width: 20, height: 20, borderRadius: '50%',
                background: '#f59e0b',
                border: '2px solid white',
                boxShadow: '0 1px 4px rgba(0,0,0,0.45)',
                pointerEvents: 'none',
              }} />
            </Marker>
          ))
        })()}

        {/* Category search pins — tap opens info sheet, not auto-navigation */}
        {categoryPins.map((pin, i) => {
          const color = CAT_COLORS[pin.catKey] ?? '#2d6fe8'
          return (
            <Marker key={`cat_${i}`} longitude={pin.lng} latitude={pin.lat} anchor="bottom">
              <div
                onClick={(e) => {
                  e.stopPropagation()
                  setTappedLocation({ lat: pin.lat, lng: pin.lng, name: pin.name, address: pin.address, loading: false })
                }}
                style={{ textAlign: 'center', cursor: 'pointer' }}
              >
                <div style={{
                  width: 32, height: 32, borderRadius: '50%',
                  background: color, border: '2px solid white',
                  boxShadow: '0 2px 6px rgba(0,0,0,0.4)',
                  display: 'flex', alignItems: 'center', justifyContent: 'center',
                  fontSize: 16,
                }}>{pin.icon}</div>
                <div style={{
                  fontSize: 9, fontWeight: 700, color: 'white',
                  background: color, borderRadius: 4,
                  padding: '1px 5px', whiteSpace: 'nowrap',
                  maxWidth: 80, overflow: 'hidden', textOverflow: 'ellipsis',
                  marginTop: 2,
                }}>{pin.name}</div>
              </div>
            </Marker>
          )
        })}

        {/* Nav alternative routes — gray lines when zoomed out during navigation */}
        {isNavigating && showNavAlts && navAltRoutes.map((route, i) => {
          if (i === navRouteIdx) return null
          return (
            <Source key={`nav-alt-${i}`} id={`nav-alt-${i}`} type="geojson"
              data={{ type: 'Feature', geometry: route.geometry, properties: {} }}>
              <Layer id={`nav-alt-casing-${i}`} type="line"
                layout={{ 'line-cap': 'round', 'line-join': 'round' }}
                paint={{ 'line-color': '#555', 'line-width': 7, 'line-opacity': 0.4 }} />
              <Layer id={`nav-alt-line-${i}`} type="line"
                layout={{ 'line-cap': 'round', 'line-join': 'round' }}
                paint={{ 'line-color': '#aaa', 'line-width': 5, 'line-opacity': 0.6 }} />
            </Source>
          )
        })}
        {isNavigating && showNavAlts && navAltRoutes.map((route, i) => {
          if (i === navRouteIdx) return null
          const coords: [number, number][] = route.geometry.coordinates
          const mid = coords[Math.floor(coords.length / 2)]
          return (
            <Marker key={`nav-alt-lbl-${i}`} longitude={mid[0]} latitude={mid[1]} anchor="center">
              <div
                onClick={() => switchNavRoute(i)}
                style={{
                  background: 'white', color: '#333',
                  border: '1px solid #ccc',
                  padding: '5px 12px', borderRadius: 20,
                  fontWeight: 700, fontSize: 13,
                  boxShadow: '0 2px 8px rgba(0,0,0,0.3)',
                  cursor: 'pointer', whiteSpace: 'nowrap',
                  pointerEvents: 'auto',
                }}
              >
                {Math.ceil(route.duration / 60)} min · {(route.distance / 1000).toFixed(1)} km
              </div>
            </Marker>
          )
        })}
      </Map>

      {/* Transport mode selector (full-screen overlay) */}
      {showModeSelector && pendingNavDest && currentLocation && (
        <TransportModeSelector
          destination={pendingNavDest}
          origin={currentLocation}
          selectedRouteIdx={selectedAltIdx}
          onRoutesLoaded={handleRoutesLoaded}
          onRouteSelected={handleRouteSelected}
          onSafeRouteReady={handleSafeRouteReady}
          onConfirm={(profile, modeKey, route) => {
            setRouteProfile(profile)
            setNavModeKey(modeKey)
            setShowModeSelector(false)
            setSafeRouteData(null)
            startNavigation(pendingNavDest, profile, route)
          }}
          onClose={() => { setShowModeSelector(false); setPendingNavDest(null); setSafeRouteData(null); setActiveRouteZones([]) }}
        />
      )}

      {/* Location bottom sheet — tap or long press result */}
      {tappedLocation && !isNavigating && !showModeSelector && (
        <LocationBottomSheet
          location={tappedLocation}
          riderLocation={currentLocation ?? undefined}
          onNavigate={() => {
            const dest = { lat: tappedLocation.lat, lng: tappedLocation.lng }
            setPendingNavDest(dest)
            setTappedLocation(null)
            setShowModeSelector(true)
          }}
          onClose={() => setTappedLocation(null)}
        />
      )}

      {/* Arrived overlay */}
      {hasArrived && (
        <div style={{
          position: 'absolute', inset: 0, zIndex: 500,
          display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center',
          background: 'rgba(0,0,0,0.55)', backdropFilter: 'blur(4px)',
        }}>
          <div style={{
            background: '#0d1117', border: '2px solid #10b981', borderRadius: 24,
            padding: '36px 32px', maxWidth: 320, width: '90%', textAlign: 'center',
            boxShadow: '0 8px 32px rgba(0,0,0,0.5)',
          }}>
            <div style={{ fontSize: 52, marginBottom: 12 }}>📍</div>
            <h2 style={{ color: '#10b981', fontSize: 22, fontWeight: 800, margin: '0 0 8px' }}>Chegou ao destino!</h2>
            <p style={{ color: '#9ca3af', fontSize: 14, margin: '0 0 28px' }}>
              {navTotalDist > 0 ? `${(navTotalDist / 1000).toFixed(1)} km percorridos` : 'Entrega concluída'}
            </p>
            <button
              onClick={cancelNavigation}
              style={{
                width: '100%', padding: '14px', background: '#10b981', border: 'none',
                color: '#fff', borderRadius: 14, fontSize: 16, fontWeight: 800, cursor: 'pointer',
                marginBottom: 10,
              }}
            >
              ✓ Confirmar Entrega
            </button>
            <button
              onClick={() => setHasArrived(false)}
              style={{
                width: '100%', padding: '10px', background: 'transparent', border: '1px solid rgba(255,255,255,0.15)',
                color: '#9ca3af', borderRadius: 14, fontSize: 14, cursor: 'pointer',
              }}
            >
              Continuar navegando
            </button>
          </div>
        </div>
      )}

      {/* Navigation overlay (banner + voice + bottom bar) */}
      <NavigationScreen
        isNavigating={isNavigating}
        currentStep={currentStep}
        nextStep={navSteps[currentStepIdx + 1]}
        distToNext={distToNext}
        remainingDist={remainingDist}
        navEta={navEta}
        riskOnRoute={riskOnRoute}
        navModeKey={navModeKey}
        isRecalculating={isRecalculating}
        onCancel={cancelNavigation}
        northLocked={northLocked}
        navBearing={navBearing}
        onToggleNorth={handleToggleNorth}
        onSOS={onSOS}
        onReport={onReport}
        totalDist={navTotalDist}
        speed={navSpeed}
        heading={heading}
        hideControls={showQuickReport || externalReportOpen}
      />

      {/* Floating report button — outside navigation, right side */}
      {!isNavigating && onReport && (
        <button
          onClick={onReport}
          className="absolute z-[500]"
          style={{
            right: 12, bottom: 88,
            width: 64, height: 64, borderRadius: '50%',
            background: '#f59e0b',
            border: '2px solid #f59e0b',
            display: 'flex', alignItems: 'center', justifyContent: 'center',
            boxShadow: '0 0 20px rgba(245,158,11,0.55), 0 2px 12px rgba(0,0,0,0.4)',
            cursor: 'pointer', fontSize: 30,
          }}
          title="Reportar incidente"
        >
          ⚠️
        </button>
      )}

      {/* Follow rider badge */}
      {followedMember && !isNavigating && (
        <div className="absolute z-[500] flex justify-center pointer-events-none"
          style={{ top: 0, left: 0, right: 0, padding: '8px 12px' }}>
          <div className="flex items-center gap-2 px-3 py-1.5 rounded-full shadow-lg pointer-events-auto"
            style={{ background: 'rgba(245,158,11,0.92)', color: 'white', fontSize: 12, fontWeight: 700, backdropFilter: 'blur(4px)', whiteSpace: 'nowrap' }}>
            <div className="w-1.5 h-1.5 rounded-full bg-white animate-pulse flex-shrink-0" />
            A seguir {followedMember.name}
            <button onClick={() => onFollowChange?.(null)}
              style={{ background: 'rgba(255,255,255,0.3)', border: 'none', color: 'white', width: 18, height: 18, borderRadius: '50%', display: 'flex', alignItems: 'center', justifyContent: 'center', cursor: 'pointer', fontSize: 10, flexShrink: 0, padding: 0 }}>
              ✕
            </button>
          </div>
        </div>
      )}

      {/* Controls — top bar (hidden during nav and in work mode) */}
      {!isNavigating && !workMode && (
        <div className="absolute left-3 right-3 z-[500] flex items-center gap-2" style={{ top: controlsTopOffset }}>
          <button onClick={() => setShowZonesModal(true)}
            className="px-3 py-2 text-xs font-semibold rounded-xl shadow-lg transition-colors"
            style={{ background: showZones ? 'rgba(239,68,68,0.2)' : 'var(--surface)', color: showZones ? '#f87171' : 'var(--muted)', border: `1px solid ${showZones ? 'rgba(239,68,68,0.4)' : 'var(--border)'}` }}>
            🚨 Zones
          </button>
          <button
            onClick={() => {
              const next = !showTraffic
              setShowTraffic(next)
              if (typeof window !== 'undefined') localStorage.setItem('showTraffic', next.toString())
              if (next) setShowTrafficLegend(true)
            }}
            className="px-3 py-2 text-xs font-semibold rounded-xl shadow-lg transition-colors"
            style={{
              background: showTraffic ? 'rgba(0,200,83,0.15)' : 'var(--surface)',
              color: showTraffic ? '#00c853' : 'var(--muted)',
              border: `1px solid ${showTraffic ? 'rgba(0,200,83,0.4)' : 'var(--border)'}`,
            }}>
            🚦
          </button>
          <button
            onClick={() => setShowZones((z: boolean) => !z)}
            className="px-3 py-2 text-xs font-semibold rounded-xl shadow-lg transition-colors"
            style={{
              background: showZones ? 'rgba(239,68,68,0.2)' : 'var(--surface)',
              color: showZones ? '#f87171' : 'var(--muted)',
              border: `1px solid ${showZones ? 'rgba(239,68,68,0.4)' : 'var(--border)'}`,
            }}>
            🛡️
          </button>
          <button
            onClick={() => {
              if (filteredIncidents.length === 0) return
              const lngs = filteredIncidents.slice(0, 20).map(i => i.location.lng)
              const lats = filteredIncidents.slice(0, 20).map(i => i.location.lat)
              mapRef.current?.fitBounds([[Math.min(...lngs), Math.min(...lats)], [Math.max(...lngs), Math.max(...lats)]], { padding: 40, maxZoom: 15 })
            }}
            className="rounded-xl px-3 py-2 shadow-lg transition-colors"
            style={{ background: 'var(--surface)', border: `1px solid ${filteredIncidents.length > 0 ? '#2d6fe8' : 'var(--border)'}`, cursor: filteredIncidents.length > 0 ? 'pointer' : 'default' }}>
            <span className="text-xs font-semibold" style={{ color: filteredIncidents.length > 0 ? '#4f8ef7' : 'var(--muted)' }}>
              {filteredIncidents.length} reports {filteredIncidents.length > 0 ? '→' : ''}
            </span>
          </button>
          {/* Compass — inline at end of controls row, aligned right */}
          <button
            onClick={() => { mapRef.current?.easeTo({ bearing: 0, duration: 300 }); setMapBearing(0) }}
            style={{
              marginLeft: 'auto', flexShrink: 0,
              width: 36, height: 36, borderRadius: '50%',
              background: '#111827',
              border: `2px solid ${mapBearing !== 0 ? '#f59e0b' : 'rgba(245,158,11,0.4)'}`,
              display: 'flex', alignItems: 'center', justifyContent: 'center',
              cursor: 'pointer',
              boxShadow: mapBearing !== 0
                ? '0 0 12px rgba(245,158,11,0.5), 0 2px 8px rgba(0,0,0,0.5)'
                : '0 2px 8px rgba(0,0,0,0.4)',
              padding: 0,
              transition: 'box-shadow 0.2s, border-color 0.2s',
            }}
            title="Alinhar norte"
          >
            <svg width="20" height="20" viewBox="0 0 24 24"
              style={{ transform: `rotate(${-mapBearing}deg)`, transition: 'transform 0.15s linear' }}>
              <polygon points="12,2 16,12 12,10 8,12" fill="#f59e0b" />
              <polygon points="12,22 16,12 12,14 8,12" fill="#94a3b8" />
            </svg>
          </button>
        </div>
      )}

      {/* Zones full-screen page */}
      {showZonesModal && (
        <div style={{
          position: 'fixed', inset: 0, zIndex: 900,
          background: 'var(--surface)',
          display: 'flex', flexDirection: 'column',
          overflow: 'hidden',
        }}>
          {/* Fixed header */}
          <div style={{
            flexShrink: 0,
            padding: '16px 16px 12px',
            paddingTop: 'max(16px, env(safe-area-inset-top))',
            borderBottom: '1px solid var(--border)',
            display: 'flex', alignItems: 'center', justifyContent: 'space-between',
          }}>
            <h2 style={{ fontSize: 17, fontWeight: 800, color: 'var(--text)', margin: 0 }}>🚨 Zonas de Risco</h2>
            <button onClick={() => setShowZonesModal(false)}
              style={{ background: 'none', border: 'none', color: 'var(--muted)', cursor: 'pointer', fontSize: 22, padding: '4px 8px', lineHeight: 1 }}>✕</button>
          </div>

          {/* Fixed filter row */}
          <div style={{
            flexShrink: 0,
            padding: '10px 12px',
            borderBottom: '1px solid var(--border)',
            display: 'flex', gap: 8, overflowX: 'auto', scrollbarWidth: 'none',
          } as React.CSSProperties}>
            {([6, 12, 24] as const).map(h => (
              <button key={h} onClick={() => setTimeFilter(h)}
                style={{
                  flexShrink: 0, padding: '7px 14px', borderRadius: 20, fontSize: 12, fontWeight: 700,
                  background: timeFilter === h ? '#2d6fe8' : 'var(--card)',
                  color: timeFilter === h ? 'white' : 'var(--muted)',
                  border: `1px solid ${timeFilter === h ? '#2d6fe8' : 'var(--border)'}`,
                  cursor: 'pointer',
                }}>
                {h}h
              </button>
            ))}
            <button onClick={() => setShowHeatmap(!showHeatmap)}
              style={{
                flexShrink: 0, padding: '7px 14px', borderRadius: 20, fontSize: 12, fontWeight: 700,
                background: showHeatmap ? '#2d6fe8' : 'var(--card)',
                color: showHeatmap ? 'white' : 'var(--muted)',
                border: `1px solid ${showHeatmap ? '#2d6fe8' : 'var(--border)'}`,
                cursor: 'pointer',
              }}>
              🔥 Calor
            </button>
            <button onClick={() => setShowZones(!showZones)}
              style={{
                flexShrink: 0, padding: '7px 14px', borderRadius: 20, fontSize: 12, fontWeight: 700,
                background: showZones ? 'rgba(239,68,68,0.2)' : 'var(--card)',
                color: showZones ? '#f87171' : 'var(--muted)',
                border: `1px solid ${showZones ? 'rgba(239,68,68,0.4)' : 'var(--border)'}`,
                cursor: 'pointer',
              }}>
              🚨 Mostrar Zonas
            </button>
          </div>

          {/* Scrollable content */}
          <div style={{
            flex: 1, overflowY: 'auto', WebkitOverflowScrolling: 'touch', padding: '16px',
          } as React.CSSProperties}>

            {/* Stats row — firestoreZones is the live Firestore data; RISK_ZONES is always empty */}
            <div style={{ display: 'flex', gap: 8, marginBottom: 16 }}>
              {[
                { count: firestoreZones.filter(z => (z.riskLevel ?? 'medium') === 'high' || (z.riskLevel ?? 'medium') === 'critical').length, label: 'Alto/Crítico', color: '#ef4444', bg: 'rgba(239,68,68,0.08)', border: 'rgba(239,68,68,0.2)' },
                { count: firestoreZones.filter(z => (z.riskLevel ?? 'medium') === 'medium').length, label: 'Médio', color: '#f97316', bg: 'rgba(249,115,22,0.08)', border: 'rgba(249,115,22,0.2)' },
                { count: firestoreZones.filter(z => (z.riskLevel ?? 'medium') === 'low').length, label: 'Baixo', color: '#eab308', bg: 'rgba(234,179,8,0.08)', border: 'rgba(234,179,8,0.2)' },
                { count: ALL_ZONES.length + firestoreZones.length, label: 'Total zonas', color: '#a78bfa', bg: 'rgba(124,58,237,0.08)', border: 'rgba(124,58,237,0.2)' },
              ].map(({ count, label, color, bg, border }) => (
                <div key={label} style={{ flex: 1, background: bg, border: `1px solid ${border}`, borderRadius: 10, padding: '10px 4px', textAlign: 'center' }}>
                  <div style={{ fontSize: 20, fontWeight: 800, color }}>{count}</div>
                  <div style={{ fontSize: 10, color: 'var(--muted)', marginTop: 2, lineHeight: 1.2 }}>{label}</div>
                </div>
              ))}
            </div>

            {/* Zones by level */}
            {(['critical', 'high', 'medium', 'low'] as const).map(level => {
              const levelZones = firestoreZones.filter(z => (z.riskLevel ?? 'medium') === level)
              if (levelZones.length === 0) return null
              const meta = {
                critical: { color: '#7c3aed', border: 'rgba(124,58,237,0.2)', bg: 'rgba(124,58,237,0.06)', label: 'CRÍTICO' },
                high: { color: '#ef4444', border: 'rgba(239,68,68,0.2)', bg: 'rgba(239,68,68,0.06)', label: 'ALTO RISCO' },
                medium: { color: '#f97316', border: 'rgba(249,115,22,0.2)', bg: 'rgba(249,115,22,0.06)', label: 'MÉDIO RISCO' },
                low: { color: '#eab308', border: 'rgba(234,179,8,0.2)', bg: 'rgba(234,179,8,0.06)', label: 'BAIXO RISCO' },
              }[level]
              return (
                <div key={level} style={{ marginBottom: 16 }}>
                  <p style={{ fontSize: 11, fontWeight: 700, color: meta.color, textTransform: 'uppercase', letterSpacing: 0.5, marginBottom: 8 }}>
                    {meta.label} · {levelZones.length} zona{levelZones.length !== 1 ? 's' : ''}
                  </p>
                  <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                    {levelZones.map(zone => (
                      <div key={zone.id} style={{ background: meta.bg, border: `1px solid ${meta.border}`, borderRadius: 10, padding: '10px 12px' }}>
                        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                          <div style={{ width: 8, height: 8, borderRadius: '50%', background: meta.color, flexShrink: 0 }} />
                          <span style={{ fontSize: 13, fontWeight: 700, color: 'var(--text)', flex: 1 }}>{zone.areaName ?? zone.id}</span>
                          <span style={{ fontSize: 10, color: meta.color, fontWeight: 600, textTransform: 'capitalize' }}>{zone.zoneType ?? 'manual'}</span>
                        </div>
                        {zone.notes && (
                          <p style={{ fontSize: 11, color: 'var(--muted)', margin: 0, paddingLeft: 16, lineHeight: 1.4, marginTop: 4 }}>{zone.notes}</p>
                        )}
                      </div>
                    ))}
                  </div>
                </div>
              )
            })}

            {/* Permanent zones by city */}
            {(() => {
              const cityKeys = [...new Set(ALL_ZONES.map(z => `${z.country}|${z.city}`))]
              return cityKeys.map(key => {
                const [country, city] = key.split('|')
                const cityZones = ALL_ZONES.filter(z => z.city === city)
                const flag = COUNTRY_FLAG[country] ?? '🌍'
                const label = CITY_LABEL[city] ?? city
                return (
                  <div key={key} style={{ marginTop: 8, marginBottom: 8 }}>
                    <p style={{ fontSize: 11, fontWeight: 700, color: 'var(--muted)', textTransform: 'uppercase', letterSpacing: 0.5, marginBottom: 8 }}>
                      {flag} {label} · {cityZones.length} zona{cityZones.length !== 1 ? 's' : ''} monitorizadas
                    </p>
                    <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                      {cityZones.map(zone => {
                        const level = getRiskLevelActual(zone, currentHour)
                        const colors = PERM_ZONE_COLORS[level]
                        const levelLabel = { low: 'Baixo', medium: 'Médio', high: 'Alto', critical: 'Crítico' }[level]
                        return (
                          <div key={zone.id} style={{ background: `${colors.fill}18`, border: `1px solid ${colors.fill}44`, borderRadius: 10, padding: '10px 12px' }}>
                            <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                              <div style={{ width: 8, height: 8, borderRadius: '50%', background: colors.fill, flexShrink: 0 }} />
                              <span style={{ fontSize: 13, fontWeight: 700, color: 'var(--text)', flex: 1 }}>{zone.name}</span>
                              <span style={{ fontSize: 10, fontWeight: 700, color: colors.fill }}>{levelLabel} · {zone.zone}</span>
                            </div>
                            <p style={{ fontSize: 11, color: 'var(--muted)', margin: '4px 0 0', paddingLeft: 16, lineHeight: 1.4 }}>
                              Zona de atenção · Área monitorizada com restrição de rota
                            </p>
                          </div>
                        )
                      })}
                    </div>
                  </div>
                )
              })
            })()}

            <div style={{ paddingBottom: 24 }} />
          </div>
        </div>
      )}

      {/* Selected permanent zone popup */}
      {selectedPermZone && !isNavigating && (() => {
        const level = getRiskLevelActual(selectedPermZone, currentHour)
        const colors = PERM_ZONE_COLORS[level]
        const levelLabel = { low: 'Baixo risco', medium: 'Risco médio', high: 'Alto risco', critical: 'Risco crítico' }[level]
        return (
          <div style={{
            position: 'absolute', bottom: 90, left: 12, right: 12, zIndex: 500,
            background: 'var(--surface)', borderRadius: 14,
            border: `1px solid ${colors.fill}55`,
            boxShadow: '0 4px 24px rgba(0,0,0,0.5)',
            padding: '14px 16px',
          }}>
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 8 }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                <div style={{ width: 10, height: 10, borderRadius: '50%', background: colors.fill }} />
                <span style={{ fontSize: 15, fontWeight: 800, color: 'var(--text)' }}>{selectedPermZone.name}</span>
              </div>
              <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                <span style={{ fontSize: 11, fontWeight: 700, color: colors.fill, background: `${colors.fill}22`, padding: '2px 8px', borderRadius: 10 }}>{levelLabel}</span>
                <button onClick={() => setSelectedPermZone(null)} style={{ background: 'none', border: 'none', color: 'var(--muted)', cursor: 'pointer', fontSize: 18, lineHeight: 1, padding: 0 }}>✕</button>
              </div>
            </div>
            <p style={{ fontSize: 12, color: 'var(--muted)', margin: 0, lineHeight: 1.5 }}>
              Esta área tem restrição de rota baseada em dados históricos de segurança pública. O ZIVO ajusta automaticamente o percurso para maximizar a tua segurança.
            </p>
            <p style={{ fontSize: 11, color: 'var(--muted)', margin: '6px 0 0', opacity: 0.7 }}>
              Zona de atenção · {selectedPermZone.zone} · Área monitorizada
            </p>
          </div>
        )
      })()}

      {/* Zone proximity alert — shown during navigation on fast route */}
      {zoneAlert && isNavigating && (
        <div style={{
          position: 'fixed', top: 110, left: 12, right: 12, zIndex: 2000,
          background: zoneAlert.zone.riskLevel === 'critical' ? '#4c1d95' :
                      zoneAlert.zone.riskLevel === 'high' ? '#7f1d1d' : '#7c2d12',
          color: 'white', borderRadius: 14,
          padding: '12px 16px',
          display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12,
          boxShadow: '0 4px 20px rgba(0,0,0,0.5)',
          animation: 'slideDown 0.2s ease-out',
        }}>
          <div style={{ flex: 1, minWidth: 0 }}>
            <div style={{ fontWeight: 800, fontSize: 14, marginBottom: 2 }}>
              ⚠️ Zona de atenção a {zoneAlert.dist}m
            </div>
            <div style={{ fontSize: 12, opacity: 0.9, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
              {zoneAlert.zone.name} · {zoneAlert.zone.zone}
            </div>
          </div>
          <div style={{ display: 'flex', gap: 8, flexShrink: 0 }}>
            <button
              onClick={() => {
                setZoneAlert(null)
                if (navDest) startNavigation(navDest, routeProfile)
              }}
              style={{
                background: 'white',
                color: zoneAlert.zone.riskLevel === 'critical' ? '#4c1d95' :
                       zoneAlert.zone.riskLevel === 'high' ? '#7f1d1d' : '#7c2d12',
                border: 'none', borderRadius: 8,
                padding: '7px 12px', fontSize: 12, fontWeight: 800, cursor: 'pointer',
              }}>
              Desviar
            </button>
            <button onClick={() => setZoneAlert(null)} style={{ background: 'rgba(255,255,255,0.2)', border: 'none', borderRadius: 8, padding: '7px 10px', color: 'white', cursor: 'pointer', fontSize: 14, lineHeight: 1 }}>✕</button>
          </div>
        </div>
      )}

      {/* Search overlay — autocomplete */}
      {showSearch && (
        <div className="absolute z-[600]" style={{ top: 0, left: 0, right: 0 }}>
          <div style={{
            background: 'var(--surface)',
            borderRadius: '0 0 18px 18px',
            border: '1px solid var(--border)',
            boxShadow: '0 8px 32px rgba(0,0,0,0.55)',
          }}>
            {/* Input row */}
            <div style={{ display: 'flex', gap: 8, padding: '12px 12px 10px', alignItems: 'center' }}>
              <span style={{ fontSize: 16, flexShrink: 0, color: 'var(--muted)' }}>🔍</span>
              <input
                autoFocus
                value={searchText}
                onChange={e => setSearchText(e.target.value)}
                onPaste={handlePaste}
                onKeyDown={e => e.key === 'Enter' && handleSearch()}
                placeholder="Para onde vais?"
                style={{ flex: 1, background: 'transparent', border: 'none', color: 'var(--text)', fontSize: 15, outline: 'none', fontWeight: 500 }}
              />
              {searchText && (
                <button
                  onClick={() => { setSearchText(''); setSearchSuggestions([]) }}
                  style={{ background: 'var(--bg)', border: '1px solid var(--border)', borderRadius: 8, padding: '4px 8px', color: 'var(--muted)', cursor: 'pointer', fontSize: 12, flexShrink: 0 }}>
                  ✕
                </button>
              )}
              <button
                onClick={() => { setShowSearch(false); setSearchText(''); setNavError(null); setSearchSuggestions([]) }}
                style={{ background: 'var(--bg)', border: '1px solid var(--border)', borderRadius: 8, padding: '6px 10px', color: 'var(--muted)', cursor: 'pointer', fontSize: 13, flexShrink: 0 }}>
                Cancelar
              </button>
            </div>

            {/* Suggestions list */}
            {searchSuggestions.length > 0 && (
              <div style={{ borderTop: '1px solid var(--border)', paddingBottom: 4 }}>
                {searchSuggestions.map((s, i) => (
                  <button
                    key={i}
                    onClick={() => selectSuggestion(s)}
                    style={{
                      width: '100%', display: 'flex', alignItems: 'center', gap: 10,
                      padding: '10px 14px', background: 'transparent', border: 'none',
                      cursor: 'pointer', textAlign: 'left',
                      borderBottom: i < searchSuggestions.length - 1 ? '1px solid rgba(255,255,255,0.04)' : 'none',
                    }}>
                    <span style={{ fontSize: 18, flexShrink: 0 }}>{getSearchIcon(s.feature_type)}</span>
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <div style={{ fontSize: 13, fontWeight: 700, color: 'var(--text)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                        {s.name}
                      </div>
                      <div style={{ fontSize: 11, color: 'var(--muted)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', marginTop: 1 }}>
                        {s.full_address || s.place_formatted || s.address || ''}
                      </div>
                    </div>
                  </button>
                ))}
              </div>
            )}

            {searchLoading && (
              <div style={{ padding: '10px 16px', textAlign: 'center', fontSize: 12, color: 'var(--muted)', borderTop: '1px solid var(--border)' }}>
                A pesquisar...
              </div>
            )}
            {navError && (
              <p style={{ color: '#f87171', fontSize: 12, padding: '0 14px 10px', margin: 0, borderTop: '1px solid var(--border)', paddingTop: 8 }}>{navError}</p>
            )}
          </div>
        </div>
      )}

      {/* Weather banner */}
      {weather && !isNavigating && (
        <div onClick={() => window.open('https://weather.com', '_blank')} className="absolute z-[450] cursor-pointer"
          style={{
            top: '56px', left: '12px', right: '12px',
            background: 'var(--surface)', border: '1px solid var(--border)',
            borderRadius: '12px', padding: '9px 14px',
            display: 'flex', alignItems: 'center', gap: '8px',
            boxShadow: '0 2px 16px rgba(0,0,0,0.35)',
            opacity: weatherFading ? 0 : 1, transition: 'opacity 0.7s ease',
            pointerEvents: weatherFading ? 'none' : 'auto',
          }}>
          <span style={{ fontSize: 22, flexShrink: 0 }}>{weather.icon}</span>
          <span style={{ flex: 1, fontSize: 13, fontWeight: 600, color: 'var(--text)' }}>
            {weather.description} · {weather.temp}°C · Vento {weather.windKph}km/h
          </span>
          <span style={{ fontSize: 11, color: 'var(--muted)', flexShrink: 0, whiteSpace: 'nowrap' }}>Toca para ver mais →</span>
        </div>
      )}

      {/* Traffic legend */}
      {showTraffic && showTrafficLegend && (
        <div
          onClick={() => setShowTrafficLegend(false)}
          className="absolute z-[400] rounded-xl shadow-lg cursor-pointer"
          style={{
            bottom: isNavigating ? '92px' : '136px',
            left: '12px',
            background: 'var(--surface)',
            border: '1px solid var(--border)',
            padding: '8px 12px',
          }}
        >
          <div style={{ fontSize: 11, fontWeight: 700, color: 'var(--muted)', marginBottom: 6 }}>🚦 Trânsito</div>
          {[
            { label: 'Livre', color: '#00c853' },
            { label: 'Moderado', color: '#ffab00' },
            { label: 'Pesado', color: '#ff6d00' },
            { label: 'Congestionado', color: '#d50000' },
          ].map(({ label, color }) => (
            <div key={label} style={{ display: 'flex', alignItems: 'center', gap: 7, marginBottom: 4 }}>
              <div style={{ width: 8, height: 8, borderRadius: '50%', background: color, flexShrink: 0 }} />
              <span style={{ fontSize: 11, color: 'var(--muted)' }}>{label}</span>
            </div>
          ))}
        </div>
      )}

      {/* Category results sheet */}
      {showCategorySheet && categoryPins.length > 0 && !isNavigating && !tappedLocation && (
        <div className="absolute z-[550]" style={{ bottom: '80px', left: '12px', right: '12px', animation: 'slideUp 0.22s ease-out' }}>
          <div style={{ background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: 16, overflow: 'hidden', boxShadow: '0 8px 32px rgba(0,0,0,0.4)' }}>
            {/* Sheet header */}
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '10px 14px 8px', borderBottom: '1px solid var(--border)' }}>
              <span style={{ fontSize: 12, fontWeight: 700, color: 'var(--muted)', textTransform: 'uppercase', letterSpacing: 0.4 }}>
                {categoryPins[0].category} · {categoryPins.length} resultados
              </span>
              <button onClick={() => setShowCategorySheet(false)}
                style={{ background: 'none', border: 'none', color: 'var(--muted)', cursor: 'pointer', fontSize: 14, padding: '2px 4px' }}>✕</button>
            </div>
            {/* Results list */}
            <div style={{ maxHeight: '36vh', overflowY: 'auto', WebkitOverflowScrolling: 'touch' } as React.CSSProperties}>
              {categoryPins.map((pin, i) => (
                <div key={i} style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '10px 14px', borderBottom: i < categoryPins.length - 1 ? '1px solid rgba(255,255,255,0.05)' : 'none' }}>
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ fontSize: 13, fontWeight: 700, color: 'var(--text)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{pin.name}</div>
                    <div style={{ fontSize: 11, color: 'var(--muted)', marginTop: 2 }}>
                      {currentLocation ? `${Math.round(distMeters(currentLocation, pin))}m` : ''}
                      {pin.address ? ` · ${pin.address.split(',')[0]}` : ''}
                    </div>
                  </div>
                  <button
                    onClick={() => { setPendingNavDest({ lat: pin.lat, lng: pin.lng }); setTappedLocation(null); setShowModeSelector(true) }}
                    style={{ background: '#2d6fe8', border: 'none', borderRadius: 10, padding: '7px 13px', color: 'white', fontWeight: 700, fontSize: 11, cursor: 'pointer', flexShrink: 0 }}>
                    Navegar
                  </button>
                </div>
              ))}
            </div>
          </div>
        </div>
      )}

      {/* Legend */}
      {!isNavigating && (
        <div className="absolute z-[400] rounded-xl shadow-lg overflow-hidden"
          style={{ bottom: '88px', left: '12px', background: 'var(--surface)', border: '1px solid var(--border)', maxWidth: '165px' }}>
          <button onClick={() => setLegendCollapsed(!legendCollapsed)}
            className="flex items-center justify-between w-full px-3 py-2"
            style={{ borderBottom: legendCollapsed ? 'none' : '1px solid var(--border)' }}>
            <p className="text-xs font-bold uppercase tracking-wide" style={{ color: 'var(--muted)' }}>{t('legend')}</p>
            <span className="text-xs" style={{ color: 'var(--muted)' }}>{legendCollapsed ? '▼' : '▲'}</span>
          </button>
          {!legendCollapsed && (
            <div className="p-2">
              {showZones && (
                <div className="mb-2 pb-2" style={{ borderBottom: '1px solid var(--border)' }}>
                  <p className="text-xs mb-1 font-semibold" style={{ color: 'var(--muted)' }}>{t('risk_zones')}</p>
                  {(['high', 'medium', 'low'] as const).map((level) => (
                    <div key={level} className="flex items-center gap-1.5 mb-1">
                      <div className="w-3 h-3 rounded-sm border flex-shrink-0"
                        style={{ background: ZONE_COLORS[level].fill + '44', borderColor: ZONE_COLORS[level].stroke }} />
                      <span className="text-xs capitalize" style={{ color: 'var(--muted)' }}>{level} ({zoneCount[level]})</span>
                    </div>
                  ))}
                </div>
              )}
              {(Object.keys(INCIDENT_COLORS) as IncidentType[]).slice(0, 4).map((type) => (
                <div key={type} className="flex items-center gap-1.5 mb-1">
                  <div className="w-2.5 h-2.5 rounded-full flex-shrink-0" style={{ background: INCIDENT_COLORS[type] }} />
                  <span className="text-xs truncate" style={{ color: 'var(--muted)' }}>{t(type)}</span>
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      {/* Zone info popup */}
      {selectedZone && !isNavigating && (
        <div className="absolute rounded-2xl shadow-2xl"
          style={{ bottom: '8px', left: '12px', right: '12px', zIndex: 1001, background: 'var(--surface)', border: '1px solid rgba(239,68,68,0.3)', paddingBottom: '80px' }}>
          <div className="flex items-start justify-between p-4 pb-2">
            <div>
              <div className="flex items-center gap-2 mb-1">
                <div className="w-3 h-3 rounded-sm border"
                  style={{ background: ZONE_COLORS[selectedZone.level].fill + '66', borderColor: ZONE_COLORS[selectedZone.level].stroke }} />
                <span className="text-xs font-bold uppercase tracking-wide" style={{ color: ZONE_COLORS[selectedZone.level].fill }}>
                  {t(selectedZone.level)} {t('risk')} · {t(selectedZone.type)}
                </span>
              </div>
              <h3 className="font-bold text-base" style={{ color: 'var(--text)' }}>{selectedZone.name}</h3>
            </div>
            <button onClick={() => { setSelectedZone(null); onPanelChange?.(false) }} className="text-lg p-1" style={{ color: 'var(--muted)' }}>✕</button>
          </div>
          <div className="px-4 pb-3">
            <p className="text-sm" style={{ color: 'var(--muted)' }}>{t(selectedZone.id + '_desc')}</p>
            <p className="text-xs mt-2" style={{ color: 'var(--muted)' }}>{t('visible_all_riders')}</p>
            {currentLocation && (
              <button
                onClick={() => {
                  const dest = polygonCentroid(selectedZone.polygon)
                  setPendingNavDest(dest)
                  setSelectedZone(null)
                  setShowModeSelector(true)
                  onPanelChange?.(false)
                }}
                style={{ marginTop: 10, background: '#2d6fe8', border: 'none', borderRadius: 10, padding: '9px 18px', color: 'white', fontWeight: 700, fontSize: 13, cursor: 'pointer', width: '100%' }}>
                🧭 Navegar até aqui
              </button>
            )}
          </div>
        </div>
      )}

      {/* Auto-follow indicator */}
      {autoFollow && currentLocation && !isNavigating && (
        <div className="absolute z-[400] flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-semibold pointer-events-none"
          style={{ bottom: '212px', right: '12px', background: 'rgba(45,111,232,0.88)', color: 'white', backdropFilter: 'blur(4px)' }}>
          <div className="w-1.5 h-1.5 rounded-full bg-white animate-pulse flex-shrink-0" />
          A seguir
        </div>
      )}

      {/* GPS re-center / Compass — shown based on nav state */}
      {!isNavigating && (
        <button
          onClick={() => {
            autoFollowRef.current = true; setAutoFollow(true)
            if (currentLocation) mapRef.current?.flyTo({ center: [currentLocation.lng, currentLocation.lat], zoom: 16, duration: 800 })
          }}
          className="absolute z-[400] w-11 h-11 rounded-full flex items-center justify-center text-xl shadow-lg transition-opacity"
          style={{
            bottom: '160px', right: '12px',
            background: autoFollow ? '#2d6fe8' : 'var(--surface)',
            border: `2px solid ${autoFollow ? '#2d6fe8' : 'var(--border)'}`,
            opacity: currentLocation ? 1 : 0.4,
          }}>
          🎯
        </button>
      )}

      {/* Compass moved into controls bar above — no standalone button needed */}

      {/* Re-center button — hidden while any report panel is open */}
      {showReCenter && isNavigating && currentLocation && !showQuickReport && !externalReportOpen && (
        <button
          className="absolute z-[600]"
          onClick={() => {
            // Cancel any previous snap timer before starting a new one
            if (snapTimerRef.current !== null) { clearTimeout(snapTimerRef.current); snapTimerRef.current = null }
            // Keep navMapFreeRef = true during snap so RAF doesn't cancel the animation.
            // navMapFreeRef is set to false by snapTimerRef after 160ms (once animation completes).
            navMapFreeRef.current = true
            setNavMapFree(false)
            setShowReCenter(false)
            // Force headingAtualRef to the live heading NOW so snap and RAF resume use the same value
            const { northLocked: nl, compassActive: ca, heading: ch, navBearing: nb } = rafNavStateRef.current
            const liveHeading = nl ? 0 : (ca ? ch : nb)
            headingAtualRef.current = liveHeading
            const rcHeading = liveHeading
            const rcZoom = calcularZoomPorVelocidade(navSpeed)
            const pos = posAtualRef.current.lat !== 0 ? posAtualRef.current : currentLocation
            const { lat: rcLat, lng: rcLng } = calcularCentroDeslocado(pos.lat, pos.lng, rcHeading, rcZoom)
            mapRef.current?.stop()
            mapRef.current?.easeTo({
              center: [rcLng, rcLat],
              bearing: rcHeading,
              pitch: NAV_PITCH,
              zoom: rcZoom,
              duration: 150,
            })
            snapTimerRef.current = setTimeout(() => {
              snapTimerRef.current = null
              // Re-sync headingAtualRef to current heading so RAF resumes from the right bearing
              const s = rafNavStateRef.current
              headingAtualRef.current = s.northLocked ? 0 : (s.compassActive ? s.heading : s.navBearing)
              navMapFreeRef.current = false
            }, 160)
          }}
          style={{
            bottom: 128, left: 16,
            background: 'var(--surface)', border: '1px solid var(--border)',
            borderRadius: 24, padding: '10px 18px',
            boxShadow: '0 2px 12px rgba(0,0,0,0.35)',
            display: 'flex', alignItems: 'center', gap: 8,
            fontSize: 14, fontWeight: 700,
            color: '#1a56db', cursor: 'pointer',
          }}
        >
          <svg width="16" height="16" viewBox="0 0 24 24" fill="#1a56db">
            <polygon points="12,2 22,22 12,17 2,22" />
          </svg>
          Re-center
        </button>
      )}

      {/* Quick report button removed — report accessible via NavigationScreen side panel */}

      {/* Quick report sheet — 1-tap during navigation */}
      {showQuickReport && isNavigating && (
        <div className="absolute inset-0 z-[800] flex flex-col justify-end">
          <div
            className="absolute inset-0 bg-black/50"
            onClick={() => { setShowQuickReport(false); setFrozenReportPos(null) }}
          />
          <div
            className="relative rounded-t-3xl overflow-hidden"
            style={{
              background: 'var(--surface)',
              borderTop: '1px solid var(--border)',
              paddingBottom: 'env(safe-area-inset-bottom, 20px)',
              animation: 'slideUp 0.22s ease-out',
            }}
          >
            <div className="flex justify-center pt-3 pb-2">
              <div className="w-10 h-1 rounded-full" style={{ background: 'var(--border)' }} />
            </div>
            <div className="px-5 pb-4">
              <div className="flex items-center justify-between mb-4">
                <h3 className="text-base font-bold" style={{ color: 'var(--text)' }}>
                  ⚠️ Reportar incidente
                </h3>
                <button onClick={() => { setShowQuickReport(false); setFrozenReportPos(null) }} style={{ color: 'var(--muted)' }}>
                  <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                    <line x1="18" y1="6" x2="6" y2="18" /><line x1="6" y1="6" x2="18" y2="18" />
                  </svg>
                </button>
              </div>
              {/* Show frozen position for user confirmation */}
              {frozenReportPos && (
                <div className="mb-3 px-3 py-2 rounded-xl text-xs" style={{ background: 'rgba(34,197,94,0.1)', border: '1px solid rgba(34,197,94,0.25)', color: '#4ade80' }}>
                  📍 Local congelado ao tocar — {new Date(frozenReportPos.timestamp).toLocaleTimeString('pt-PT', { hour: '2-digit', minute: '2-digit', second: '2-digit' })}
                </div>
              )}
              <div className="grid grid-cols-3 gap-2">
                {QUICK_REPORT_TYPES.filter(qt => !qt.isUnique && qt.id !== 'no_entry_zone').map((qt) => (
                  <button
                    key={qt.id}
                    disabled={quickReporting}
                    onClick={async () => {
                      if (!mapUser) return
                      // Use FROZEN position captured at button-press time
                      const reportLat = frozenReportPos?.lat ?? posAtualRef.current.lat ?? currentLocation?.lat
                      const reportLng = frozenReportPos?.lng ?? posAtualRef.current.lng ?? currentLocation?.lng
                      if (!reportLat || !reportLng) return
                      setQuickReporting(true)
                      try {
                        await reportIncident(
                          mapUser.id,
                          mapUser.name,
                          qt.id as import('@/types').IncidentType,
                          reportLat,
                          reportLng,
                          { initialScore: qt.initialScore, mapWeight: qt.mapWeight, affectsMap: qt.affectsMap }
                        )
                        setShowQuickReport(false)
                        setFrozenReportPos(null)
                        setToastNav(`${qt.emoji} Reportado: ${qt.label}`)
                        setTimeout(() => setToastNav(null), 2000)
                      } catch {
                        setToastNav('Erro ao reportar')
                        setTimeout(() => setToastNav(null), 2000)
                      } finally {
                        setQuickReporting(false)
                      }
                    }}
                    className="flex flex-col items-center justify-center py-3 rounded-xl border text-center transition-all active:scale-95 disabled:opacity-40"
                    style={{ background: 'var(--card)', borderColor: qt.color + '44' }}
                  >
                    <span className="text-2xl mb-1">{qt.emoji}</span>
                    <span className="text-xs font-semibold leading-tight" style={{ color: 'var(--text)' }}>{qt.label}</span>
                  </button>
                ))}
              </div>
              <p className="text-xs text-center mt-3" style={{ color: 'var(--muted)' }}>
                1 toque — a navegação não é interrompida
              </p>
            </div>
          </div>
        </div>
      )}

      {/* In-navigation toast — non-blocking, disappears in 2s */}
      {toastNav && (
        <div
          style={{
            position: 'fixed', top: 120, left: '50%', transform: 'translateX(-50%)',
            background: 'rgba(0,0,0,0.75)', color: 'white',
            padding: '8px 20px', borderRadius: 20,
            fontSize: 13, fontWeight: 600, zIndex: 3000,
            pointerEvents: 'none', whiteSpace: 'nowrap',
          }}
        >
          {toastNav}
        </div>
      )}

      {/* "Pesquisar nesta área" — appears when map is moved with active category */}
      {showSearchArea && searchCategory && !isNavigating && (
        <div className="absolute z-[500]" style={{ top: 10, left: '50%', transform: 'translateX(-50%)' }}>
          <button
            onClick={() => {
              if (searchCategory.key === 'partners') { searchPartnersFromFirestore(); return }
              if (searchCategory.key === 'mechanic') { searchServiceProvidersFromFirestore(); return }
              doSearchInArea(searchCategory.query, searchCategory.label, searchCategory.icon, searchCategory.key)
            }}
            style={{
              background: 'var(--surface)', border: '1px solid var(--border)',
              borderRadius: 24, padding: '10px 20px',
              boxShadow: '0 2px 12px rgba(0,0,0,0.25)',
              fontSize: 14, fontWeight: 700, color: 'var(--text)',
              cursor: 'pointer', whiteSpace: 'nowrap',
              display: 'flex', alignItems: 'center', gap: 8,
            }}
          >
            🔍 Pesquisar nesta área
          </button>
        </div>
      )}

      {/* Incident info popup */}
      {selectedIncident && !isNavigating && (
        <div className="absolute rounded-2xl shadow-2xl"
          style={{ bottom: '8px', left: '12px', right: '12px', zIndex: 1001, background: 'var(--surface)', border: '1px solid var(--border)', paddingBottom: '80px' }}>
          <div className="flex items-start justify-between p-4 pb-2">
            <div>
              <span className="inline-block text-xs font-bold px-2 py-0.5 rounded-full mb-1"
                style={{ background: INCIDENT_COLORS[selectedIncident.type] + '33', color: INCIDENT_COLORS[selectedIncident.type] }}>
                {INCIDENT_EMOJIS[selectedIncident.type]} {t(selectedIncident.type)}
              </span>
              <p className="text-xs" style={{ color: 'var(--muted)' }}>{formatDistanceToNow(selectedIncident.timestamp, { addSuffix: true })}</p>
            </div>
            <button onClick={() => { setSelectedIncident(null); onPanelChange?.(false) }} className="text-lg p-1" style={{ color: 'var(--muted)' }}>✕</button>
          </div>
          <div className="px-4 pb-3">
            {selectedIncident.description && <p className="text-sm" style={{ color: 'var(--text)' }}>{selectedIncident.description}</p>}
            <p className="text-xs mt-1" style={{ color: 'var(--muted)' }}>Reported by {selectedIncident.userName || 'Anonymous'}</p>
            {currentLocation && (
              <button
                onClick={() => {
                  const dest = { lat: selectedIncident.location.lat, lng: selectedIncident.location.lng }
                  setPendingNavDest(dest)
                  setSelectedIncident(null)
                  setShowModeSelector(true)
                  onPanelChange?.(false)
                }}
                style={{ marginTop: 10, background: '#2d6fe8', border: 'none', borderRadius: 10, padding: '9px 18px', color: 'white', fontWeight: 700, fontSize: 13, cursor: 'pointer', width: '100%' }}>
                🧭 Navegar até aqui
              </button>
            )}
          </div>
        </div>
      )}
    </div>
  )
}
