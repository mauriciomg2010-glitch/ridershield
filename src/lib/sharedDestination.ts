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
        if (typeof d?.lat === 'number') return d
        // O Google costuma devolver "Nome, morada, Dublin 24, D24 RX94": o Eircode dá o ponto exato
        if (typeof d?.query === 'string') return (await porEircode(d.query)) ?? d
      }
    } catch {}
    // link não lido: tenta o texto que veio junto (nome + morada)
    const resto = textoParaPesquisa(t)
    return resto.length >= 4 ? { query: resto } : null
  }
  const e = await porEircode(t)
  if (e) return e
  const q = textoParaPesquisa(t)
  return q.length >= 4 ? { query: q } : null
}

/** Eircode dentro de um texto → coordenadas exatas (null se não houver ou não for encontrado). */
async function porEircode(texto: string): Promise<DestinoLink | null> {
  const eir = texto.match(/\b([AC-FHKNPRTV-Y]\d{2}|D6W)\s?[0-9AC-FHKNPRTV-Y]{4}\b/i)
  if (!eir || !normalizeEircode(eir[0])) return null
  try { const r = await lookupEircode(eir[0]); if (r) return { lat: r.lat, lng: r.lng, label: texto } } catch {}
  return null
}

/** Versões da morada para pesquisar quando a completa falha (sem o nome do sítio, sem "Unit…"). */
export function variantesMorada(q: string): string[] {
  const partes = q.split(',').map(p => p.trim()).filter(Boolean)
  const semUnit = partes.filter(p => !/^(unit|apt|apartment|flat|suite)\b/i.test(p))
  const v = [q, semUnit.join(', '), semUnit.slice(1).join(', '), partes.slice(-3).join(', ')]
  return [...new Set(v.filter(x => x.length >= 4))]
}
