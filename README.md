# 🛡️ RiderShield

**Safety & real-time coordination platform for delivery riders in Dublin, Ireland.**

RiderShield is a mobile-first SaaS web app where Deliveroo, Just Eat, and Uber Eats riders can:
- View a live safety map with crowdsourced incident reports
- Create or join private rider groups
- Share live location within groups (premium)
- Send emergency alerts to group members (premium)

---

## 📁 Project Structure

```
ridershield/
├── src/
│   ├── app/
│   │   ├── layout.tsx          # Root layout, providers
│   │   ├── page.tsx            # App shell & tab routing
│   │   └── globals.css         # Global styles + Leaflet overrides
│   ├── components/
│   │   ├── Auth/
│   │   │   └── AuthScreen.tsx  # Login + signup UI
│   │   ├── Layout/
│   │   │   └── BottomNav.tsx   # Mobile bottom navigation
│   │   ├── Map/
│   │   │   └── MapView.tsx     # Leaflet map, markers, heatmap
│   │   ├── Report/
│   │   │   └── ReportModal.tsx # Incident reporting modal
│   │   ├── Groups/
│   │   │   ├── GroupsScreen.tsx  # Group list, create, join
│   │   │   └── GroupDetail.tsx   # Group map + emergency button
│   │   └── Profile/
│   │       └── ProfileScreen.tsx # User info + subscription
│   ├── contexts/
│   │   └── AuthContext.tsx     # Firebase auth context
│   ├── hooks/
│   │   └── useGeolocation.ts   # GPS + location publishing
│   ├── lib/
│   │   ├── firebase.ts         # Firebase app init
│   │   ├── firestore.ts        # All DB operations (service layer)
│   │   └── store.ts            # Zustand global state
│   └── types/
│       └── index.ts            # TypeScript types
├── public/
│   └── manifest.json           # PWA manifest
├── firestore.rules             # Firestore security rules
├── firestore.indexes.json      # Firestore composite indexes
├── database.rules.json         # Realtime DB rules (location sharing)
├── firebase.json               # Firebase CLI config
├── vercel.json                 # Vercel deployment config
└── .env.local.example          # Environment variables template
```

---

## 🚀 Local Setup

### Prerequisites
- Node.js 18+
- A Firebase project (free Spark plan works for MVP)

### Step 1 — Clone & Install

```bash
git clone <your-repo>
cd ridershield
npm install
```

### Step 2 — Firebase Project Setup

1. Go to [Firebase Console](https://console.firebase.google.com) → **Create Project**
2. Enable these services:
   - **Authentication** → Email/Password
   - **Firestore Database** → Start in test mode (update rules later)
   - **Realtime Database** → Create (choose Europe West region)
3. Go to **Project Settings → Your apps → Add web app**
4. Copy the config values

### Step 3 — Environment Variables

```bash
cp .env.local.example .env.local
```

Fill in `.env.local` with your Firebase values:

```env
NEXT_PUBLIC_FIREBASE_API_KEY=AIza...
NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN=your-project.firebaseapp.com
NEXT_PUBLIC_FIREBASE_PROJECT_ID=your-project-id
NEXT_PUBLIC_FIREBASE_STORAGE_BUCKET=your-project.appspot.com
NEXT_PUBLIC_FIREBASE_MESSAGING_SENDER_ID=1234567890
NEXT_PUBLIC_FIREBASE_APP_ID=1:123:web:abc
NEXT_PUBLIC_FIREBASE_DATABASE_URL=https://your-project-default-rtdb.europe-west1.firebasedatabase.app
```

### Step 4 — Deploy Security Rules

```bash
npm install -g firebase-tools
firebase login
firebase use your-project-id
firebase deploy --only firestore:rules,firestore:indexes,database
```

### Step 5 — Run Dev Server

```bash
npm run dev
```

Open [http://localhost:3000](http://localhost:3000) on your phone or use Chrome DevTools mobile view.

---

## 🔥 Firebase Setup Details

### Firestore Collections

The app auto-creates these collections on first use:

| Collection | Purpose |
|---|---|
| `users` | User profiles + premium status |
| `incidents` | Reported safety incidents |
| `groups` | Private rider groups |
| `alerts` | Emergency alerts within groups |

### Realtime Database Structure

```
groupLocations/
  {groupId}/
    {userId}: { lat, lng, lastUpdated }
```

Used for live location — RTDB is better than Firestore for high-frequency writes.

### Create a Demo User

In Firebase Console → Authentication → Add User:
- Email: `demo@ridershield.ie`
- Password: `demo123`

Then in Firestore → Add document to `users`:
```json
{
  "id": "<paste the uid from Auth>",
  "name": "Demo Rider",
  "email": "demo@ridershield.ie",
  "isPremium": true,
  "sharingLocation": false,
  "createdAt": "<timestamp>"
}
```

---

## 🌍 Deployment to Vercel

### Option A — Vercel CLI

```bash
npm install -g vercel
vercel login
vercel
```

Set environment variables when prompted or in the Vercel dashboard.

### Option B — GitHub Integration

1. Push code to GitHub
2. Import repo at [vercel.com/new](https://vercel.com/new)
3. Add environment variables in **Settings → Environment Variables**
4. Deploy

> The `vercel.json` targets the `dub1` (Dublin) region for low latency.

---

## 📱 Features by Tier

| Feature | Free | Premium (€4.99/mo) |
|---|---|---|
| View safety map | ✅ | ✅ |
| Report incidents | ✅ | ✅ |
| Join existing groups | ✅ | ✅ |
| Create private groups | ❌ | ✅ |
| Live location sharing | ❌ | ✅ |
| Emergency alerts | ❌ | ✅ |

> The mock payment flow simulates Stripe. Replace `handleMockUpgrade()` in `ProfileScreen.tsx` with real Stripe Checkout for production.

---

## 🗺️ Map Details

- **Tile provider**: CartoDB Dark Matter (no API key needed)
- **Incident markers**: Colour-coded by type, pin-drop style
- **Heatmap**: Toggle on/off, shows incident density
- **Time filter**: 6h / 12h / 24h view
- **Group members**: Green avatar markers, updates every 5 seconds
- **Your location**: Blue dot with pulsing ring

---

## ⚡ Performance Optimisations

- **Map**: Mounted once and kept in DOM (hidden via z-index), avoids re-init cost
- **Location**: Interval-based polling (5s) instead of continuous GPS watch
- **Firestore**: Real-time listeners with `onSnapshot` — no polling
- **RTDB**: Used for location (sub-second writes, efficient for geolocation)
- **Code splitting**: Map loaded dynamically (`next/dynamic`) — not in initial bundle

---

## 🔒 Privacy & Security

- Location sharing is **opt-in** per group, toggled by the rider
- Location data only visible within the private group
- Incidents are anonymised on the map (userName shown only in popup)
- Firestore rules restrict reads to authenticated members only
- RTDB rules only allow users to write their own location

---

## 🛠️ Next Steps (Post-MVP)

- [ ] Real Stripe payment integration
- [ ] Push notifications (Firebase Cloud Messaging)
- [ ] Rider verification badges
- [ ] Admin dashboard for incident moderation
- [ ] Incident upvote/verify system
- [ ] Route safety score overlay
- [ ] Native iOS/Android app (React Native)
- [ ] Multi-city support beyond Dublin

---

## 🐛 Troubleshooting

**Map not showing?**
- Check browser allows location permissions
- Leaflet CSS must load — check network tab

**Location not updating in group?**
- Ensure Premium is active (toggle in Profile → mock pay)
- Ensure "Share Location" toggle is ON in Group Detail
- Check RTDB rules are deployed

**Firebase auth errors?**
- Verify Email/Password provider is enabled in Firebase Console
- Check `.env.local` values are correct (no trailing spaces)

**Firestore permission denied?**
- Deploy security rules: `firebase deploy --only firestore:rules`
- Or temporarily use test mode rules in Firebase Console

---

## 📜 License

MIT — build on top of this, keep riders safe.
