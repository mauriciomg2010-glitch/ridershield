// Run: node -r @swc-node/register src/scripts/importAllZones.js [city]
// Or compile first: tsc src/data/permanent_zones_all_cities.ts && node importAllZones.js
// Seeds all permanent zones (or a specific city) into Firestore risk_zones collection.

const { initializeApp } = require('firebase/app')
const { getFirestore, doc, setDoc, serverTimestamp } = require('firebase/firestore')

// Load compiled data (run tsc first or use ts-node)
let zones
try {
  zones = require('../data/permanent_zones_all_cities').PERMANENT_ZONES
} catch {
  console.error('Compile permanent_zones_all_cities.ts first: npx tsc --module commonjs src/data/permanent_zones_all_cities.ts')
  process.exit(1)
}

const firebaseConfig = {
  apiKey: process.env.NEXT_PUBLIC_FIREBASE_API_KEY,
  authDomain: process.env.NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN,
  projectId: process.env.NEXT_PUBLIC_FIREBASE_PROJECT_ID,
}

const app = initializeApp(firebaseConfig)
const db = getFirestore(app)

const RISK_SCORE = { low: 20, medium: 45, high: 70, critical: 90 }

async function run() {
  const filterCity = process.argv[2] ?? null
  const toImport = filterCity ? zones.filter(z => z.city === filterCity) : zones
  console.log(`A importar ${toImport.length} zonas${filterCity ? ` (${filterCity})` : ''}...`)
  let ok = 0, erros = 0

  for (const zona of toImport) {
    try {
      const zoneId = `PERMANENT-${zona.id}`
      await setDoc(doc(db, 'risk_zones', zoneId), {
        zoneId,
        zoneType: 'permanent',
        city: zona.city,
        country: zona.country,
        lat: zona.lat,
        lng: zona.lng,
        radius: zona.radius,
        areaName: zona.name,
        zone: zona.zone,
        riskLevel: zona.riskLevel,
        riskScore: RISK_SCORE[zona.riskLevel] ?? 45,
        peakHours: zona.peakHours,
        source: zona.source,
        isPermanent: true,
        canBeRemovedByReports: false,
        autoExpireAt: null,
        incidentCount: 0,
        createdAt: serverTimestamp(),
        updatedAt: serverTimestamp(),
      }, { merge: true })
      ok++
      console.log(`✅ ${zona.city} — ${zona.name}`)
    } catch (e) {
      erros++
      console.error(`❌ ${zona.name}:`, e.message)
    }
  }

  console.log(`\nConcluído: ${ok} importadas / ${erros} erros`)
  process.exit(0)
}

run().catch(err => { console.error(err); process.exit(1) })
