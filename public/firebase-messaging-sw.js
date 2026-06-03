// firebase-messaging-sw.js — FCM background message handler
// This file MUST be at the root of /public and named exactly firebase-messaging-sw.js

importScripts('https://www.gstatic.com/firebasejs/10.12.2/firebase-app-compat.js')
importScripts('https://www.gstatic.com/firebasejs/10.12.2/firebase-messaging-compat.js')

firebase.initializeApp({
  apiKey: 'AIzaSyCSZbbxxdJF6F5N4dDISkp1QQIbW9lNNW8',
  authDomain: 'ridershield-dfe8b.firebaseapp.com',
  projectId: 'ridershield-dfe8b',
  storageBucket: 'ridershield-dfe8b.firebasestorage.app',
  messagingSenderId: '237570293718',
  appId: '1:237570293718:web:0ba2953b1f013d2958ee77',
  databaseURL: 'https://ridershield-dfe8b-default-rtdb.europe-west1.firebasedatabase.app',
})

const messaging = firebase.messaging()

messaging.onBackgroundMessage((payload) => {
  const title = payload.notification?.title || '🚨 RiderShield Alert'
  const body = payload.notification?.body || 'A rider needs help!'
  const icon = '/icons/icon-192x192.png'

  self.registration.showNotification(title, {
    body,
    icon,
    badge: '/icons/icon-72x72.png',
    vibrate: [300, 100, 300, 100, 300],
    requireInteraction: true,
    data: payload.data || {},
    actions: [
      { action: 'open', title: 'Open App' },
    ],
  })
})

self.addEventListener('notificationclick', (event) => {
  event.notification.close()
  const url = event.notification.data?.link || 'https://ridershield.vercel.app/groups'
  event.waitUntil(clients.openWindow(url))
})
