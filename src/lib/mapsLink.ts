// src/lib/mapsLink.ts — destino a partir de um link do Google Maps (partilhado/copiado).
// Uso hoje (versão web): Deliveroo → "Direcionar" → Google Maps → Partilhar/Copiar link → ZIVO.

export type LatLng = { lat: number; lng: number }
export type DestinoLink = { lat: number; lng: number; label?: string } | { query: string }

const ok = (lat: number, lng: number) => isFinite(lat) && isFinite(lng) && Math.abs(lat) <= 90 && Math.abs(lng) <= 180 && !(lat === 0 && lng === 0)

/** Primeiro link do Google Maps dentro de um texto partilhado ("Nome\nMorada\nhttps://maps.app.goo.gl/…"). */
export function findMapsUrl(text: string): string | null {
  const m = text.match(/https?:\/\/(?:maps\.app\.goo\.gl|goo\.gl\/maps|(?:www\.|maps\.)?google\.[a-z.]+\/maps|maps\.google\.[a-z.]+)[^\s]*/i)
  return m ? m[0].replace(/[).,]+$/, '') : null
}

/** Link curto que precisa de ser aberto no servidor para saber o destino. */
export const isShortMapsUrl = (u: string) => /^https?:\/\/(maps\.app\.goo\.gl|goo\.gl\/maps)\//i.test(u)

/**
 * Lê o destino de um link longo do Google Maps.
 * Ordem: coordenadas exatas do sítio (!3d…!4d…), destino de direções, q=/ll=, @centro do mapa,
 * e por fim o texto (nome/morada) para pesquisar.
 */
export function destinoDeUrlGoogle(raw: string): DestinoLink | null {
  let url: URL
  try { url = new URL(raw) } catch { return null }
  // página de consentimento da UE: o destino verdadeiro vem em ?continue=
  if (/consent\.google\./i.test(url.hostname) && url.searchParams.get('continue')) return destinoDeUrlGoogle(url.searchParams.get('continue')!)
  const full = decodeURIComponent(url.href)
  let m = full.match(/!3d(-?\d+\.\d+)!4d(-?\d+\.\d+)/g)
  if (m) {   // o último par é o do sítio escolhido
    const last = m[m.length - 1].match(/!3d(-?\d+\.\d+)!4d(-?\d+\.\d+)/)!
    const lat = +last[1], lng = +last[2]
    if (ok(lat, lng)) return { lat, lng, label: labelDoCaminho(url) }
  }
  const sp = url.searchParams
  const param = sp.get('destination') ?? sp.get('daddr') ?? sp.get('q') ?? sp.get('query') ?? sp.get('ll')
  if (param) {
    const c = param.match(/^\s*(-?\d+\.\d+)\s*,\s*(-?\d+\.\d+)\s*$/)
    if (c && ok(+c[1], +c[2])) return { lat: +c[1], lng: +c[2] }
    if (param.trim()) return { query: param.trim() }
  }
  // /maps/dir/origem/destino/… → último troço do caminho
  const dir = url.pathname.match(/\/maps\/dir\/(.+)/)
  if (dir) {
    const partes = dir[1].split('/').filter(p => p && !p.startsWith('@') && !p.startsWith('data='))
    const ult = partes[partes.length - 1]
    if (ult) {
      const t = decodeURIComponent(ult.replace(/\+/g, ' '))
      const c = t.match(/^(-?\d+\.\d+),\s*(-?\d+\.\d+)$/)
      if (c && ok(+c[1], +c[2])) return { lat: +c[1], lng: +c[2] }
      return { query: t }
    }
  }
  const lbl = labelDoCaminho(url)
  m = full.match(/@(-?\d+\.\d+),(-?\d+\.\d+)/)
  if (m && ok(+m[1], +m[2]) && !lbl) return { lat: +m[1], lng: +m[2] }
  if (lbl) {
    // /maps/place/Nome/@lat,lng → usa a pesquisa pelo nome, com o @ como reserva
    if (m && ok(+m[1], +m[2])) return { lat: +m[1], lng: +m[2], label: lbl }
    return { query: lbl }
  }
  const c = full.match(/\/maps\/search\/(-?\d+\.\d+),\+?(-?\d+\.\d+)/)
  if (c && ok(+c[1], +c[2])) return { lat: +c[1], lng: +c[2] }
  return null
}

function labelDoCaminho(url: URL): string | undefined {
  const p = url.pathname.match(/\/maps\/(?:place|search)\/([^/@]+)/)
  if (!p) return undefined
  const t = decodeURIComponent(p[1].replace(/\+/g, ' ')).trim()
  return t && !/^-?\d+\.\d+,\s*-?\d+\.\d+$/.test(t) ? t : undefined
}

/** Texto partilhado sem link (ex.: "Supermac's, Main St, Tallaght, Dublin 24") → linha para pesquisar. */
export function textoParaPesquisa(text: string): string {
  return text.replace(/https?:\/\/\S+/g, '').split('\n').map(l => l.trim()).filter(Boolean).join(', ').slice(0, 200)
}
