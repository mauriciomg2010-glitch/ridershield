// Abre um link curto do Google Maps (maps.app.goo.gl) e devolve o destino.
// Só segue redireções para domínios do Google (não serve para abrir outros sites).
import { NextRequest, NextResponse } from 'next/server'
import { destinoDeUrlGoogle } from '@/lib/mapsLink'

export const runtime = 'edge'

const PERMITIDO = /^(maps\.app\.goo\.gl|goo\.gl|(www\.|maps\.)?google\.[a-z.]+|consent\.google\.[a-z.]+)$/i

export async function GET(req: NextRequest) {
  const u = req.nextUrl.searchParams.get('u') ?? ''
  let atual: URL
  try { atual = new URL(u) } catch { return NextResponse.json({ erro: 'link inválido' }, { status: 400 }) }
  for (let i = 0; i < 6; i++) {
    if (atual.protocol !== 'https:' || !PERMITIDO.test(atual.hostname)) return NextResponse.json({ erro: 'link não é do Google Maps' }, { status: 400 })
    const d = destinoDeUrlGoogle(atual.href)
    if (d && !/goo\.gl$/i.test(atual.hostname)) return NextResponse.json(d, { headers: { 'Cache-Control': 's-maxage=86400' } })
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
  return d ? NextResponse.json(d) : NextResponse.json({ erro: 'destino não encontrado no link' }, { status: 404 })
}
