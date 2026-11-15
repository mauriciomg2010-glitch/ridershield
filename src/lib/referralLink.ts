// src/lib/referralLink.ts
// Guarda o código de indicação que vem no link partilhado (?ref=ZIVO-XXXX)
// para preencher o cadastro mesmo que a pessoa só crie a conta mais tarde.
const KEY = 'zivo_pending_ref'
const MAX_AGE_MS = 30 * 24 * 3600 * 1000

export function normalizeReferralCode(raw: string | null | undefined): string | null {
  if (!raw) return null
  const code = raw.trim().toUpperCase().replace(/\s+/g, '')
  return /^[A-Z0-9-]{6,24}$/.test(code) ? code : null
}

/** Lê ?ref= da URL, guarda no aparelho e limpa a URL. Devolve o código pendente (se houver). */
export function captureReferralFromUrl(): string | null {
  if (typeof window === 'undefined') return null
  try {
    const url = new URL(window.location.href)
    const fromUrl = normalizeReferralCode(url.searchParams.get('ref'))
    if (fromUrl) {
      try { localStorage.setItem(KEY, JSON.stringify({ code: fromUrl, at: Date.now() })) } catch {}
      url.searchParams.delete('ref')
      window.history.replaceState({}, '', url.toString())
      return fromUrl
    }
  } catch {}
  return getPendingReferral()
}

export function getPendingReferral(): string | null {
  try {
    const raw = localStorage.getItem(KEY)
    if (!raw) return null
    const { code, at } = JSON.parse(raw)
    if (!code || Date.now() - Number(at) > MAX_AGE_MS) { localStorage.removeItem(KEY); return null }
    return normalizeReferralCode(code)
  } catch { return null }
}

export function clearPendingReferral() {
  try { localStorage.removeItem(KEY) } catch {}
}
