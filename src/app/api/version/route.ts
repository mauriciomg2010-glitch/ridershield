import { NextResponse } from 'next/server'
export const runtime = 'edge'
export const dynamic = 'force-dynamic'
// versão publicada agora (commit) — a app compara com a sua e atualiza-se sozinha
export function GET() {
  return NextResponse.json({ v: process.env.VERCEL_GIT_COMMIT_SHA ?? 'dev' }, { headers: { 'Cache-Control': 'no-store' } })
}
