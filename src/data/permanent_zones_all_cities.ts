// Permanent zones cleared — map is clean by default.
// All zones come from Firestore (created via Admin > ZoneEditor).

export interface ZoneEntry {
  id: string
  city: string
  country: string
  name: string
  zone: string
  lat: number
  lng: number
  radius: number
  riskLevel: 'low' | 'medium' | 'high' | 'critical'
  peakHours: number[]
  source: string
}

export const PERMANENT_ZONES: ZoneEntry[] = []
