// src/types/index.ts

export type IncidentType =
  // current types
  | 'assault_robbery'
  | 'bike_theft'
  | 'physical_assault'
  | 'attempted_robbery'
  | 'suspicious_activity'
  | 'road_hazard'
  | 'no_entry_zone'
  | 'confirmed_safe'
  // legacy (kept for backward compat with existing Firestore docs)
  | 'robbery'
  | 'aggression'
  | 'accident'

export interface User {
  id: string
  name: string
  email: string
  isPremium: boolean
  isAdmin?: boolean
  isSuperAdmin?: boolean
  adminLevel?: 'super' | 'editor' | null
  currentLocation?: { lat: number; lng: number }
  sharingLocation: boolean
  createdAt: Date
}

export interface Incident {
  id: string
  type: IncidentType
  location: { lat: number; lng: number }
  description?: string
  timestamp: Date
  userId: string
  userName?: string
  upvotes: number
}

export interface Group {
  id: string
  name: string
  ownerId: string
  adminId?: string
  inviteCode: string
  members: string[]
  memberNames?: Record<string, string>
  createdAt: Date
  memberCount?: number
}

export interface GroupMember {
  userId: string
  name: string
  lat: number
  lng: number
  lastUpdated: Date
  isSharing: boolean
}

export interface Alert {
  id: string
  groupId: string
  userId: string
  userName: string
  location: { lat: number; lng: number }
  timestamp: Date
  type: 'emergency'
  message?: string
}

export interface LocationUpdate {
  userId: string
  groupId: string
  lat: number
  lng: number
  lastUpdated: number
}

export interface EmergencyContact {
  name: string
  phone: string
}

export interface EmergencyContacts {
  contact1: EmergencyContact
  contact2?: EmergencyContact
  guardaNumber: '112' | '999'
}

export interface Referral {
  id: string
  referrerId: string
  referredId: string
  referredName?: string
  level: 1 | 2
  status: 'pending' | 'paid' | 'cancelled'
  amount: number
  createdAt: Date
  paidAt?: Date
}
