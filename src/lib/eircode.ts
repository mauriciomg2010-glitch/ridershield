// src/lib/eircode.ts
// Eircode (Irlanda): "D24 X4Y2" → endereço exato. O Mapbox só conhece a zona (D24);
// o código completo vem da HERE (que licencia a base oficial) pela rota /api/eircode.

// Formato oficial: chave de rota (letra + 2 dígitos, ou D6W) + 4 caracteres do conjunto permitido
const SET = '[0-9AC-FHKNPRTV-Y]'
const RE_FULL = new RegExp(`^\\s*((?:[AC-FHKNPRTV-Y]\\d{2})|D6W)\\s*(${SET}{4})\\s*$`, 'i')
const RE_KEY = /^\s*((?:[AC-FHKNPRTV-Y]\d{2})|D6W)\s*$/i

/** "d24x4y2" → "D24 X4Y2"; null se não for um Eircode completo. */
export function normalizeEircode(q: string): string | null {
  const m = q.match(RE_FULL)
  return m ? `${m[1].toUpperCase()} ${m[2].toUpperCase()}` : null
}

/** Só a chave de rota (ex.: "D24") — o Mapbox resolve como zona. */
export function isEircodeRoutingKey(q: string): boolean {
  return RE_KEY.test(q)
}

export interface EircodeResult { eircode: string; lat: number; lng: number; label: string }

const cache = new Map<string, EircodeResult | null>()

/** Procura o Eircode completo. Devolve null se não existir; lança erro se o serviço não estiver configurado. */
export async function lookupEircode(q: string): Promise<EircodeResult | null> {
  const code = normalizeEircode(q)
  if (!code) return null
  if (cache.has(code)) return cache.get(code)!
  const res = await fetch(`/api/eircode?code=${encodeURIComponent(code)}`)
  if (res.status === 501) throw new Error('eircode-nao-configurado')
  if (!res.ok) { cache.set(code, null); return null }
  const data = await res.json()
  const out = data && Number.isFinite(data.lat) && Number.isFinite(data.lng) ? data as EircodeResult : null
  cache.set(code, out)
  return out
}
