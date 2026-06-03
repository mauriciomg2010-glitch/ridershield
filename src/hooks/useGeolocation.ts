// src/hooks/useGeolocation.ts
import { useEffect, useRef, useState } from 'react'
import { useStore } from '@/lib/store'
import { publishLocation, clearLocation, publishGlobalPresence, clearGlobalPresence } from '@/lib/firestore'

interface UseGeolocationOptions {
  groupId?: string
  userId?: string
  enabled?: boolean
}

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

  // Publish to GROUP when enabled and inside a group
  useEffect(() => {
    if (!enabled || !groupId || !userId || !currentLocation) return
    publishLocation(userId, groupId, currentLocation.lat, currentLocation.lng)
  }, [enabled, groupId, userId, currentLocation])

  // Publish GLOBAL PRESENCE when enabled — no group required
  useEffect(() => {
    if (!enabled || !userId || !currentLocation || !user?.name) return
    publishGlobalPresence(userId, user.name, currentLocation.lat, currentLocation.lng)
  }, [enabled, userId, currentLocation, user?.name])

  // Force immediate publish when enabled transitions false→true
  useEffect(() => {
    if (enabled && !prevEnabledRef.current) {
      const state = useStore.getState()
      const loc = state.currentLocation
      const u = state.user
      if (loc && userId) {
        if (groupId) publishLocation(userId, groupId, loc.lat, loc.lng)
        if (u?.name) publishGlobalPresence(userId, u.name, loc.lat, loc.lng)
      }
    }
    prevEnabledRef.current = enabled
  }, [enabled, groupId, userId])

  // Backup interval — fresh GPS fix every 15s when visible and enabled
  useEffect(() => {
    if (!enabled || !userId) return
    const interval = setInterval(() => {
      if (document.visibilityState !== 'visible') return
      navigator.geolocation.getCurrentPosition(
        (pos) => {
          const loc = { lat: pos.coords.latitude, lng: pos.coords.longitude }
          setCurrentLocation(loc)
          if (groupId) publishLocation(userId, groupId, loc.lat, loc.lng)
          const u = useStore.getState().user
          if (u?.name) publishGlobalPresence(userId, u.name, loc.lat, loc.lng)
        },
        null,
        { enableHighAccuracy: true, maximumAge: 10000 }
      )
    }, 15000)
    return () => clearInterval(interval)
  }, [enabled, groupId, userId, setCurrentLocation])

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
