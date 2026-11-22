// Destino que chega de fora (Partilhar do Android, colar, botão "Colar destino"):
// link do Google Maps (curto ou longo), coordenadas, Eircode ou morada em texto.
import { findMapsUrl, isShortMapsUrl, destinoDeUrlGoogle, textoParaPesquisa, DestinoLink } from '@/lib/mapsLink'
import { normalizeEircode, lookupEircode } from '@/lib/eircode'

export async function resolverDestino(text: string): Promise<DestinoLink | null> {
  const t = (text || '').trim()
  if (!t) return null
  const c = t.match(/^\s*(-?\d{1,2}\.\d+)\s*,\s*(-?\d{1,3}\.\d+)\s*$/)
  if (c) return { lat: +c[1], lng: +c[2] }
  const url = findMapsUrl(t)
  if (url) {
    const local = isShortMapsUrl(url) ? null : destinoDeUrlGoogle(url)
    if (local) return local
    try {
      const r = await fetch(`/api/resolve-maps?u=${encodeURIComponent(url)}`)
      if (r.ok) {
        const d = await r.json()
        if (typeof d?.lat === 'number' || typeof d?.query === 'string') return d
      }
    } catch {}
    // link não lido: tenta o texto que veio junto (nome + morada)
    const resto = textoParaPesquisa(t)
    return resto.length >= 4 ? { query: resto } : null
  }
  const eir = t.match(/\b([AC-FHKNPRTV-Y]\d{2}|D6W)\s?[0-9AC-FHKNPRTV-Y]{4}\b/i)
  if (eir && normalizeEircode(eir[0])) {
    try { const r = await lookupEircode(eir[0]); if (r) return { lat: r.lat, lng: r.lng, label: r.label } } catch {}
  }
  const q = textoParaPesquisa(t)
  return q.length >= 4 ? { query: q } : null
}
