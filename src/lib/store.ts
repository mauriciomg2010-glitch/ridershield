// src/lib/store.ts
import { create } from 'zustand'
import { User, Incident, Group, Alert, EmergencyContacts } from '@/types'

interface AppState {
  user: User | null
  incidents: Incident[]
  groups: Group[]
  activeGroup: Group | null
  alerts: Alert[]
  isSharingLocation: boolean
  currentLocation: { lat: number; lng: number } | null
  emergencyContacts: EmergencyContacts | null
  activeGroupId: string | null

  setUser: (user: User | null) => void
  setIncidents: (incidents: Incident[]) => void
  addIncident: (incident: Incident) => void
  setGroups: (groups: Group[]) => void
  addGroup: (group: Group) => void
  setActiveGroup: (group: Group | null) => void
  addAlert: (alert: Alert) => void
  setAlerts: (alerts: Alert[]) => void
  toggleLocationSharing: () => void
  setIsSharingLocation: (v: boolean) => void
  setCurrentLocation: (loc: { lat: number; lng: number } | null) => void
  setEmergencyContacts: (c: EmergencyContacts | null) => void
  setActiveGroupId: (id: string | null) => void
}

export const useStore = create<AppState>((set) => ({
  user: null,
  incidents: [],
  groups: [],
  activeGroup: null,
  alerts: [],
  isSharingLocation: false,
  currentLocation: null,
  emergencyContacts: null,
  activeGroupId: null,

  setUser: (user) => set({ user, ...(user === null ? { emergencyContacts: null } : {}) }),
  setIncidents: (incidents) => set({ incidents }),
  addIncident: (incident) =>
    set((state) => ({ incidents: [incident, ...state.incidents] })),
  setGroups: (groups) => set({ groups }),
  addGroup: (group) =>
    set((state) => ({ groups: [group, ...state.groups] })),
  setActiveGroup: (activeGroup) => set({ activeGroup }),
  addAlert: (alert) =>
    set((state) => ({ alerts: [alert, ...state.alerts] })),
  setAlerts: (alerts) => set({ alerts }),
  toggleLocationSharing: () =>
    set((state) => ({ isSharingLocation: !state.isSharingLocation })),
  setIsSharingLocation: (isSharingLocation: boolean) => set({ isSharingLocation }),
  setCurrentLocation: (currentLocation) => set({ currentLocation }),
  setEmergencyContacts: (emergencyContacts) => set({ emergencyContacts }),
  setActiveGroupId: (activeGroupId) => set({ activeGroupId }),
}))
