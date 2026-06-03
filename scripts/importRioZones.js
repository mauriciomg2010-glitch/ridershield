// Run: node src/scripts/importRioZones.js
// Seeds Rio de Janeiro permanent zones into Firestore risk_zones collection.
const { initializeApp } = require('firebase/app')
const { getFirestore, doc, setDoc } = require('firebase/firestore')
const zones = require('../data/rio_permanent_zones.json')

const firebaseConfig = {
  apiKey: process.env.NEXT_PUBLIC_FIREBASE_API_KEY,
  authDomain: process.env.NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN,
  projectId: process.env.NEXT_PUBLIC_FIREBASE_PROJECT_ID,
}

const app = initializeApp(firebaseConfig)
const db = getFirestore(app)

async function run() {
  for (const zone of zones) {
    const zoneId = `PERMANENT-rio-${zone.id}`
    await setDoc(doc(db, 'risk_zones', zoneId), {
      ...zone,
      zoneId,
      zoneType: 'permanent',
      isPermanent: true,
      canBeRemovedByReports: false,
      autoExpireAt: null,
      city: 'rio-de-janeiro',
      country: 'BR',
      createdAt: new Date().toISOString(),
    })
    console.log(`Imported: ${zoneId} — ${zone.name}`)
  }
  console.log('Done.')
  process.exit(0)
}

run().catch(err => { console.error(err); process.exit(1) })
