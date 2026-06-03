// Permanent zones — city-wide risk areas based on historical public safety data.
// Language rule: NEVER use "favela" or "perigoso". Use "Zona de atenção", "Área com restrição de rota", etc.

export type RiskLevel = 'low' | 'medium' | 'high' | 'critical'

export interface PermanentZone {
  id: string
  city: string
  country: string
  name: string
  zone: string
  lat: number
  lng: number
  radius: number
  riskLevel: RiskLevel
  peakHours?: number[]
  source?: string
}

export { PERMANENT_ZONES as ALL_ZONES } from '@/data/permanent_zones_all_cities'

// Kept for backwards compat — Rio-only slice
import { PERMANENT_ZONES } from '@/data/permanent_zones_all_cities'
export const RIO_ZONES: PermanentZone[] = PERMANENT_ZONES.filter(z => z.city === 'rio-de-janeiro')

export function getRiskLevelActual(zone: PermanentZone, currentHour: number): RiskLevel {
  const base = zone.riskLevel
  const isPeak = zone.peakHours?.includes(currentHour) ?? false
  if (isPeak) {
    const elevate: Record<RiskLevel, RiskLevel> = { low: 'medium', medium: 'high', high: 'critical', critical: 'critical' }
    return elevate[base]
  }
  const reduce: Record<RiskLevel, RiskLevel> = { critical: 'high', high: 'medium', medium: 'low', low: 'low' }
  return reduce[base]
}

export function circleToPolygon(lat: number, lng: number, radiusM: number, steps = 32): number[][] {
  const coords: number[][] = []
  for (let i = 0; i <= steps; i++) {
    const angle = (i / steps) * 2 * Math.PI
    const dLat = (radiusM / 111320) * Math.cos(angle)
    const dLng = (radiusM / (111320 * Math.cos(lat * Math.PI / 180))) * Math.sin(angle)
    coords.push([lng + dLng, lat + dLat])
  }
  return coords
}

export const PERM_ZONE_COLORS: Record<RiskLevel, { fill: string; stroke: string }> = {
  low:      { fill: '#eab308', stroke: '#ca8a04' },
  medium:   { fill: '#f97316', stroke: '#ea580c' },
  high:     { fill: '#ef4444', stroke: '#dc2626' },
  critical: { fill: '#7c3aed', stroke: '#6d28d9' },
}

export const COUNTRY_FLAG: Record<string, string> = {
  ie: '🇮🇪',
  gb: '🇬🇧',
  es: '🇪🇸',
  br: '🇧🇷',
}

export const CITY_LABEL: Record<string, string> = {
  'dublin': 'Dublin',
  'cork': 'Cork',
  'limerick': 'Limerick',
  'galway': 'Galway',
  'london': 'Londres',
  'barcelona': 'Barcelona',
  'porto-alegre': 'Porto Alegre',
  'canoas': 'Canoas',
  'sapucaia-do-sul': 'Sapucaia do Sul',
  'alvorada': 'Alvorada',
  'viamao': 'Viamão',
  'florianopolis': 'Florianópolis',
  'palhoca': 'Palhoça',
  'sao-jose': 'São José',
  'biguacu': 'Biguaçu',
  'rio-de-janeiro': 'Rio de Janeiro',
}
