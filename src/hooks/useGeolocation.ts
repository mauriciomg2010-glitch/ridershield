// src/hooks/useGeolocation.ts
import { useEffect, useRef, useState } from 'react'
import { useStore } from '@/lib/store'
import { publishLocation, clearLocation, publishGlobalPresence, clearGlobalPresence } from '@/lib/firestore'

interface UseGeolocationOptions {
  groupId?: string
  userId?: string
  enabled?: boolean
}

// Haversine distance in metres — used by publish throttle
function metersBetween(a: { lat: number; lng: number }, b: { lat: number; lng: number }): number {
  const R = 6371000
  const dLat = (b.lat - a.lat) * Math.PI / 180
  const dLng = (b.lng - a.lng) * Math.PI / 180
  const aa = Math.sin(dLat / 2) ** 2 + Math.cos(a.lat * Math.PI / 180) * Math.cos(b.lat * Math.PI / 180) * Math.sin(dLng / 2) ** 2
  return R * 2 * Math.atan2(Math.sqrt(aa), Math.sqrt(1 - aa))
}

const PUBLISH_MIN_METRES = 15   // skip write if rider moved less than this
const PUBLISH_MIN_MS     = 5000 // always write at least once every 5 s regardless of distance

const GEO_OPTIONS: PositionOptions = {
  enableHighAccuracy: true,
  timeout: 2000,
  maximumAge: 0,
}

export function useGeolocation({
  groupId,
  userId,
  enabled = false,
}: UseGeolocationOptions = {}) {
  const setCurrentLocation = useStore((s) => s.setCurrentLocation)
  const currentLocation = useStore((s) => s.currentLocation)
  const user = useStore((s) => s.user)
  const [error, setError] = useState<string | null>(null)
  const [heading, setHeading] = useState<number | null>(null)
  const [speed, setSpeed] = useState<number | null>(null)
  const watchIdRef = useRef<number | null>(null)
  const prevEnabledRef = useRef(false)
  const lastGroupPublishRef    = useRef<{ lat: number; lng: number; time: number } | null>(null)
  const lastPresencePublishRef = useRef<{ lat: number; lng: number; time: number } | null>(null)

  // Continuous GPS tracking via watchPosition (always runs to keep currentLocation fresh)
  useEffect(() => {
    if (!navigator.geolocation) {
      setError('Geolocation not supported')
      return
    }
    watchIdRef.current = navigator.geolocation.watchPosition(
      (pos) => {
        setCurrentLocation({ lat: pos.coords.latitude, lng: pos.coords.longitude })
        setHeading(pos.coords.heading ?? null)
        setSpeed(pos.coords.speed ?? null)
        setError(null)
      },
      () => setError('Location access denied'),
      GEO_OPTIONS
    )
    return () => {
      if (watchIdRef.current !== null) {
        navigator.geolocation.clearWatch(watchIdRef.current)
        watchIdRef.current = null
      }
    }
  }, [setCurrentLocation])

  // Restart watchPosition when app returns to foreground (iOS/Android background fix)
  useEffect(() => {
    if (!navigator.geolocation) return
    const handleVisibilityChange = () => {
      if (document.visibilityState !== 'visible') return
      if (watchIdRef.current !== null) {
        navigator.geolocation.clearWatch(watchIdRef.current)
      }
      watchIdRef.current = navigator.geolocation.watchPosition(
        (pos) => {
          setCurrentLocation({ lat: pos.coords.latitude, lng: pos.coords.longitude })
          setHeading(pos.coords.heading ?? null)
          setSpeed(pos.coords.speed ?? null)
          setError(null)
        },
        null,
        GEO_OPTIONS
      )
      navigator.geolocation.getCurrentPosition(
        (pos) => setCurrentLocation({ lat: pos.coords.latitude, lng: pos.coords.longitude }),
        null,
        { enableHighAccuracy: true, maximumAge: 10000 }
      )
    }
    document.addEventListener('visibilitychange', handleVisibilityChange)
    return () => document.removeEventListener('visibilitychange', handleVisibilityChange)
  }, [setCurrentLocation])

  // Publish to GROUP — throttled: write only when rider moved >= 15 m OR >= 5 s elapsed
  useEffect(() => {
    if (!enabled || !groupId || !userId || !currentLocation) return
    const now = Date.now()
    const last = lastGroupPublishRef.current
    if (last && metersBetween(last, currentLocation) < PUBLISH_MIN_METRES && now - last.time < PUBLISH_MIN_MS) return
    lastGroupPublishRef.current = { lat: currentLocation.lat, lng: currentLocation.lng, time: now }
    publishLocation(userId, groupId, currentLocation.lat, currentLocation.lng)
  }, [enabled, groupId, userId, currentLocation])

  // Publish GLOBAL PRESENCE — throttled: same 15 m / 5 s rule
  useEffect(() => {
    if (!enabled || !userId || !currentLocation || !user?.name) return
    const now = Date.now()
    const last = lastPresencePublishRef.current
    if (last && metersBetween(last, currentLocation) < PUBLISH_MIN_METRES && now - last.time < PUBLISH_MIN_MS) return
    lastPresencePublishRef.current = { lat: currentLocation.lat, lng: currentLocation.lng, time: now }
    publishGlobalPresence(userId, user.name, currentLocation.lat, currentLocation.lng)
  }, [enabled, userId, currentLocation, user?.name])

  // Force immediate publish when enabled transitions false→true (updates refs to avoid double-write)
  useEffect(() => {
    if (enabled && !prevEnabledRef.current) {
      const state = useStore.getState()
      const loc = state.currentLocation
      const u = state.user
      if (loc && userId) {
        const now = Date.now()
        if (groupId) {
          publishLocation(userId, groupId, loc.lat, loc.lng)
          lastGroupPublishRef.current = { lat: loc.lat, lng: loc.lng, time: now }
        }
        if (u?.name) {
          publishGlobalPresence(userId, u.name, loc.lat, loc.lng)
          lastPresencePublishRef.current = { lat: loc.lat, lng: loc.lng, time: now }
        }
      }
    }
    prevEnabledRef.current = enabled
  }, [enabled, groupId, userId])

  // Clear group location when sharing stops or group changes
  useEffect(() => {
    if (!enabled || !groupId || !userId) return
    return () => clearLocation(userId, groupId)
  }, [enabled, groupId, userId])

  // Clear global presence when sharing stops
  useEffect(() => {
    if (!enabled || !userId) return
    return () => clearGlobalPresence(userId)
  }, [enabled, userId])

  return { currentLocation, heading, speed, error }
}
