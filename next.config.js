/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  transpilePackages: ['mapbox-gl', 'react-map-gl'],
  env: {
    NEXT_PUBLIC_FIREBASE_API_KEY: 'AIzaSyCSZbbxxdJF6F5N4dDISkp1QQIbW9lNNW8',
    NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN: 'ridershield-dfe8b.firebaseapp.com',
    NEXT_PUBLIC_FIREBASE_PROJECT_ID: 'ridershield-dfe8b',
    NEXT_PUBLIC_FIREBASE_STORAGE_BUCKET: 'ridershield-dfe8b.firebasestorage.app',
    NEXT_PUBLIC_FIREBASE_MESSAGING_SENDER_ID: '237570293718',
    NEXT_PUBLIC_FIREBASE_APP_ID: '1:237570293718:web:0ba2953b1f013d2958ee77',
    NEXT_PUBLIC_FIREBASE_DATABASE_URL: 'https://ridershield-dfe8b-default-rtdb.europe-west1.firebasedatabase.app',
  },
  async headers() {
    return [
      {
        source: '/sw.js',
        headers: [
          { key: 'Cache-Control', value: 'public, max-age=0, must-revalidate' },
          { key: 'Service-Worker-Allowed', value: '/' },
        ],
      },
      {
        source: '/manifest.json',
        headers: [
          { key: 'Cache-Control', value: 'public, max-age=0, must-revalidate' },
        ],
      },
      {
        source: '/icons/:path*',
        headers: [
          { key: 'Cache-Control', value: 'public, max-age=31536000, immutable' },
        ],
      },
      {
        source: '/offline.html',
        headers: [
          { key: 'Cache-Control', value: 'public, max-age=3600' },
        ],
      },
      {
        source: '/firebase-messaging-sw.js',
        headers: [
          { key: 'Cache-Control', value: 'public, max-age=0, must-revalidate' },
          { key: 'Service-Worker-Allowed', value: '/' },
        ],
      },
    ]
  },
}

module.exports = nextConfig
