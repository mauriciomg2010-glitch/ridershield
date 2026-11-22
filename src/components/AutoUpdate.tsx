'use client'
// Atualiza a app sozinha quando há versão nova publicada.
// No iPhone a app do ecrã inicial fica suspensa com o código antigo; "fechar e abrir" não chega.
// Verifica ao voltar ao ecrã e a cada 10 min; nunca recarrega a meio de uma navegação.
import { useEffect } from 'react'

const MINHA = process.env.NEXT_PUBLIC_BUILD_SHA || 'dev'

export default function AutoUpdate() {
  useEffect(() => {
    if (MINHA === 'dev') return
    let aVer = false
    const verificar = async () => {
      if (aVer || document.visibilityState !== 'visible') return
      aVer = true
      try {
        const r = await fetch('/api/version', { cache: 'no-store' })
        const { v } = await r.json()
        const navegando = (window as any).__zivoNavegando === true
        if (v && v !== 'dev' && v !== MINHA && !navegando) window.location.reload()
      } catch {} finally { aVer = false }
    }
    verificar()
    document.addEventListener('visibilitychange', verificar)
    const t = setInterval(verificar, 10 * 60 * 1000)
    return () => { document.removeEventListener('visibilitychange', verificar); clearInterval(t) }
  }, [])
  return null
}
