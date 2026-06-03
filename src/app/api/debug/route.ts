import { NextResponse } from 'next/server'

export const dynamic = 'force-dynamic'

export async function GET() {
  const apiKey = process.env.NEXT_PUBLIC_FIREBASE_API_KEY ?? ''
  const authDomain = process.env.NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN ?? ''
  const projectId = process.env.NEXT_PUBLIC_FIREBASE_PROJECT_ID ?? ''

  return NextResponse.json({
    apiKey_preview: apiKey ? `${apiKey.slice(0, 8)}...${apiKey.slice(-4)}` : 'MISSING',
    apiKey_length: apiKey.length,
    apiKey_lastCharCode: apiKey.charCodeAt(apiKey.length - 1),
    authDomain,
    projectId,
    nodeEnv: process.env.NODE_ENV,
  })
}
