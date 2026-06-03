import { NextRequest, NextResponse } from 'next/server'

// Uses the FCM Legacy HTTP API (server key from Firebase Console → Project Settings → Cloud Messaging)
export async function POST(req: NextRequest) {
  const { tokens, userName, groupId } = await req.json()

  if (!tokens?.length) {
    return NextResponse.json({ error: 'No tokens' }, { status: 400 })
  }

  const serverKey = process.env.FCM_SERVER_KEY
  if (!serverKey) {
    return NextResponse.json({ error: 'FCM not configured' }, { status: 500 })
  }

  try {
    const res = await fetch('https://fcm.googleapis.com/fcm/send', {
      method: 'POST',
      headers: {
        Authorization: `key=${serverKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        registration_ids: tokens,
        notification: {
          title: '🚨 Emergency Alert',
          body: `${userName} needs immediate help! Open the app now.`,
          icon: '/icons/icon-192x192.png',
          badge: '/icons/icon-72x72.png',
        },
        data: {
          type: 'emergency',
          groupId,
          userName,
          url: '/groups',
        },
        webpush: {
          notification: {
            requireInteraction: true,
            tag: 'emergency',
            renotify: true,
            vibrate: [300, 100, 300, 100, 300, 100, 300],
          },
          fcmOptions: {
            link: 'https://ridershield.vercel.app/groups',
          },
        },
      }),
    })

    const data = await res.json()
    const succeeded = tokens.length - (data.failure ?? 0)
    return NextResponse.json({ sent: succeeded, total: tokens.length, fcm: data })
  } catch (err: any) {
    return NextResponse.json({ error: err.message }, { status: 500 })
  }
}
