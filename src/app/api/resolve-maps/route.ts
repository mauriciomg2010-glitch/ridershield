// Abre um link curto do Google Maps (maps.app.goo.gl) e devolve o destino.
// Só segue redireções para domínios do Google (não serve para abrir outros sites).
import { NextRequest, NextResponse } from 'next/server'
import { destinoDeUrlGoogle } from '@/lib/mapsLink'

export const runtime = 'edge'

const PERMITIDO = /^(maps\.app\.goo\.gl|goo\.gl|(www\.|maps\.)?google\.[a-z.]+|consent\.google\.[a-z.]+)$/i

const EIRCODE_RE = /\b([AC-FHKNPRTV-Y]\d{2}|D6W)\s?([0-9AC-FHKNPRTV-Y]{4})\b/i

/** "Nome, morada, D24 RX94" → ponto exato pelo Eircode (HERE), quando há chave configurada. */
async function comEircode(req: NextRequest, d: any): Promise<any> {
  if (!d || typeof d.query !== 'string') return d
  const m = d.query.match(EIRCODE_RE)
  if (!m) return d
  try {
    const r = await fetch(new URL(`/api/eircode?code=${encodeURIComponent(m[1] + m[2])}`, req.url))
    if (r.ok) { const e = await r.json(); if (typeof e?.lat === 'number') return { lat: e.lat, lng: e.lng, label: d.query } }
  } catch {}
  return d
}

export async function GET(req: NextRequest) {
  const u = req.nextUrl.searchParams.get('u') ?? ''
  let atual: URL
  try { atual = new URL(u) } catch { return NextResponse.json({ erro: 'link inválido' }, { status: 400 }) }
  for (let i = 0; i < 6; i++) {
    if (atual.protocol !== 'https:' || !PERMITIDO.test(atual.hostname)) return NextResponse.json({ erro: 'link não é do Google Maps' }, { status: 400 })
    const d = destinoDeUrlGoogle(atual.href)
    if (d && !/goo\.gl$/i.test(atual.hostname)) return NextResponse.json(await comEircode(req, d), { headers: { 'Cache-Control': 's-maxage=86400' } })
    let r: Response
    try { r = await fetch(atual.href, { redirect: 'manual', headers: { 'User-Agent': 'Mozilla/5.0 (ZIVO)' } }) } catch { break }
    let loc = r.headers.get('location')
    if (!loc && r.ok) {
      // às vezes responde com uma página (redirecionamento por HTML/JS) em vez de 302
      const html = (await r.text()).slice(0, 200000).replace(/\\u0026/g, '&').replace(/&amp;/g, '&')
      const m = html.match(/https:\/\/(?:www\.)?google\.[a-z.]+\/maps\/[^"'\s<>\\]+/i)
      if (m) loc = m[0]
    }
    if (!loc) break
    try { atual = new URL(loc, atual) } catch { break }
  }
  const d = destinoDeUrlGoogle(atual.href)
  return d ? NextResponse.json(await comEircode(req, d)) : NextResponse.json({ erro: 'destino não encontrado no link' }, { status: 404 })
}
