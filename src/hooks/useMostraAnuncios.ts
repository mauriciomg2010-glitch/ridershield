'use client'
import { useEffect, useState } from 'react'
import { useStore } from '@/lib/store'
import { mostraAnuncios } from '@/lib/ads'

/** true se este utilizador deve ver anúncios (plano Free, ou admin com "Ver como Free"). */
export function useMostraAnuncios(): boolean {
  const user = useStore(s => s.user)
  const [v, setV] = useState(() => mostraAnuncios(user))
  useEffect(() => {
    setV(mostraAnuncios(user))
    const f = () => setV(mostraAnuncios(useStore.getState().user))
    window.addEventListener('zivo-ads-pref', f)
    return () => window.removeEventListener('zivo-ads-pref', f)
  }, [user?.isPremium, user?.id])
  return v
}
