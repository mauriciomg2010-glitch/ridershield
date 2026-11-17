// GET /api/eircode?code=D24%20X4Y2 → { eircode, lat, lng, label }
// A chave da HERE fica só no servidor (variável HERE_API_KEY na Vercel).
import { NextRequest, NextResponse } from 'next/server'
import { normalizeEircode } from '@/lib/eircode'

export const runtime = 'edge'

export async function GET(req: NextRequest) {
  const code = normalizeEircode(req.nextUrl.searchParams.get('code') ?? '')
  if (!code) return NextResponse.json({ error: 'Eircode inválido' }, { status: 400 })
  const key = process.env.HERE_API_KEY
  if (!key) return NextResponse.json({ error: 'HERE_API_KEY não configurada' }, { status: 501 })

  const base = 'https://geocode.search.hereapi.com/v1/geocode'
  const tentativas = [
    `${base}?qq=${encodeURIComponent(`postalCode=${code};country=IRL`)}&limit=1&lang=en&apiKey=${encodeURIComponent(key)}`,
    `${base}?q=${encodeURIComponent(code)}&in=countryCode:IRL&limit=1&lang=en&apiKey=${encodeURIComponent(key)}`,
  ]
  try {
    let it: any = null
    for (const url of tentativas) {
      const r = await fetch(url)
      if (!r.ok) return NextResponse.json({ error: `HERE ${r.status}` }, { status: 502 })
      const j: any = await r.json()
      const cand = j?.items?.[0]
      const pcc = String(cand?.address?.postalCode ?? '').replace(/\s+/g, '').toUpperCase()
      if (cand?.position && pcc === code.replace(/\s+/g, '')) { it = cand; break }
    }
    // só aceita se a HERE devolveu o MESMO Eircode (não uma zona aproximada)
    if (!it) {
      return NextResponse.json({ error: 'não encontrado' }, { status: 404, headers: { 'Cache-Control': 'public, s-maxage=86400' } })
    }
    return NextResponse.json(
      { eircode: code, lat: it.position.lat, lng: it.position.lng, label: it.address?.label ?? it.title ?? code },
      { headers: { 'Cache-Control': 'public, s-maxage=2592000, stale-while-revalidate=86400' } },   // 30 dias
    )
  } catch {
    return NextResponse.json({ error: 'falha de rede' }, { status: 502 })
  }
}
