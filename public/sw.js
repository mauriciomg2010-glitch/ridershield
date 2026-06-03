const CACHE_NAME = 'ridershield-v3'
const DATA_CACHE = 'ridershield-data-v3'
const TILES_CACHE = 'ridershield-tiles-v3'

const PRECACHE_URLS = [
  '/',
  '/map',
  '/report',
  '/groups',
  '/earnings',
  '/safety-hub',
  '/services',
  '/emergency',
  '/manifest.json',
  '/offline.html',
]

const NETWORK_FIRST_PATTERNS = [
  '/api/',
  'firebasedatabase.app',
  'firestore.googleapis.com',
  'identitytoolkit.googleapis.com',
]

const CACHE_FIRST_PATTERNS = [
  '/_next/static/',
  '/icons/',
]

const CACHE_FIRST_EXTENSIONS = ['.png', '.jpg', '.jpeg', '.svg', '.css', '.woff2', '.woff', '.ttf']

const TILES_PATTERNS = ['cartodb', 'cartocdn']

self.addEventListener('install', (event) => {
  self.skipWaiting()
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) =>
      cache.addAll(PRECACHE_URLS).catch(() => {})
    )
  )
})

self.addEventListener('activate', (event) => {
  const allowedCaches = [CACHE_NAME, DATA_CACHE, TILES_CACHE]
  event.waitUntil(
    Promise.all([
      clients.claim(),
      caches.keys().then((keys) =>
        Promise.all(
          keys.filter((k) => !allowedCaches.includes(k)).map((k) => caches.delete(k))
        )
      ),
    ])
  )
})

function matchesPatterns(url, patterns) {
  return patterns.some((p) => url.includes(p))
}

function matchesExtensions(url, exts) {
  return exts.some((ext) => url.split('?')[0].endsWith(ext))
}

async function networkFirst(request, cacheName = DATA_CACHE) {
  try {
    const response = await fetch(request)
    // Cache API only supports GET — never attempt to cache other methods
    if (response.ok && request.method === 'GET') {
      const cache = await caches.open(cacheName)
      try { await cache.put(request, response.clone()) } catch { /* non-critical */ }
    }
    return response
  } catch {
    // For non-GET (POST/PUT/DELETE): no cached fallback, surface the network error
    if (request.method !== 'GET') {
      return new Response(JSON.stringify({ error: 'Network error' }), {
        status: 503, headers: { 'Content-Type': 'application/json' },
      })
    }
    const cached = await caches.match(request)
    if (cached) return cached
    if (request.mode === 'navigate') {
      return caches.match('/offline.html')
    }
    return new Response('Offline', { status: 503 })
  }
}

async function cacheFirst(request, cacheName = CACHE_NAME) {
  // Only cache GET — pass other methods straight through to network
  if (request.method !== 'GET') return fetch(request)
  const cached = await caches.match(request)
  if (cached) return cached
  try {
    const response = await fetch(request)
    if (response.ok) {
      const cache = await caches.open(cacheName)
      try { await cache.put(request, response.clone()) } catch { /* non-critical */ }
    }
    return response
  } catch {
    return new Response('Offline', { status: 503 })
  }
}

self.addEventListener('fetch', (event) => {
  const { request } = event
  const url = request.url

  // Never intercept non-GET requests — Cache API doesn't support them.
  // POST/PUT/DELETE (Firebase writes, Firestore mutations) go directly to network.
  if (request.method !== 'GET') return

  if (matchesPatterns(url, TILES_PATTERNS)) {
    event.respondWith(cacheFirst(request, TILES_CACHE))
    return
  }

  if (matchesPatterns(url, NETWORK_FIRST_PATTERNS)) {
    event.respondWith(networkFirst(request, DATA_CACHE))
    return
  }

  if (matchesPatterns(url, CACHE_FIRST_PATTERNS) || matchesExtensions(url, CACHE_FIRST_EXTENSIONS)) {
    event.respondWith(cacheFirst(request, CACHE_NAME))
    return
  }

  event.respondWith(networkFirst(request, DATA_CACHE))
})

// Allow the page to trigger immediate activation (skips the waiting phase)
self.addEventListener('message', (event) => {
  if (event.data?.type === 'SKIP_WAITING') self.skipWaiting()
})

self.addEventListener('push', (event) => {
  const data = event.data ? event.data.json() : {}
  const title = data.title || 'RiderShield'
  const options = {
    body: data.body || 'New notification',
    icon: '/icons/icon-192x192.png',
    badge: '/icons/icon-96x96.png',
    data: data.url ? { url: data.url } : {},
  }
  event.waitUntil(self.registration.showNotification(title, options))
})

self.addEventListener('notificationclick', (event) => {
  event.notification.close()
  const url = event.notification.data?.url || '/'
  event.waitUntil(clients.openWindow(url))
})
