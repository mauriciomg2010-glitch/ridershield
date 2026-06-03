// Run: node src/scripts/importIBGEZones.js <path-to-geojson>
// Imports IBGE aglomerados subnormais GeoJSON into Firestore risk_zones collection.
// Download from: https://www.ibge.gov.br/geociencias/organizacao-do-territorio/tipologias-do-territorio/15788-aglomerados-subnormais.html
const { initializeApp } = require('firebase/app')
const { getFirestore, doc, setDoc } = require('firebase/firestore')
const fs = require('fs')

const firebaseConfig = {
  apiKey: process.env.NEXT_PUBLIC_FIREBASE_API_KEY,
  authDomain: process.env.NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN,
  projectId: process.env.NEXT_PUBLIC_FIREBASE_PROJECT_ID,
}

const app = initializeApp(firebaseConfig)
const db = getFirestore(app)

function computeCentroid(coordinates) {
  // Handle Polygon or MultiPolygon
  const ring = Array.isArray(coordinates[0][0]) ? coordinates[0] : coordinates[0][0]
  let latSum = 0, lngSum = 0
  for (const [lng, lat] of ring) { lngSum += lng; latSum += lat }
  return { lat: latSum / ring.length, lng: lngSum / ring.length }
}

function estimateRadius(coordinates) {
  const ring = Array.isArray(coordinates[0][0]) ? coordinates[0] : coordinates[0][0]
  const lngs = ring.map(c => c[0])
  const lats = ring.map(c => c[1])
  const widthM = (Math.max(...lngs) - Math.min(...lngs)) * 111320 * Math.cos(lats[0] * Math.PI / 180)
  const heightM = (Math.max(...lats) - Math.min(...lats)) * 111320
  return Math.round(Math.max(widthM, heightM) / 2)
}

async function run() {
  const geojsonPath = process.argv[2]
  if (!geojsonPath) { console.error('Usage: node importIBGEZones.js <path-to-geojson>'); process.exit(1) }
  const geojson = JSON.parse(fs.readFileSync(geojsonPath, 'utf-8'))

  for (const feature of geojson.features) {
    const props = feature.properties
    const name = props.NM_AGLOM || props.nm_aglom || props.NOME || 'Unnamed'
    const city = (props.NM_MUN || props.NM_MUNICIPIO || 'unknown').toLowerCase().replace(/\s+/g, '-').replace(/[^a-z0-9-]/g, '')
    const zoneId = `IBGE-${city}-${name.toLowerCase().replace(/\s+/g, '-').replace(/[^a-z0-9-]/g, '')}`
    const centroid = computeCentroid(feature.geometry.coordinates)
    const radius = Math.min(estimateRadius(feature.geometry.coordinates), 3000)

    await setDoc(doc(db, 'risk_zones', zoneId), {
      id: zoneId,
      name,
      zone: props.NM_SUBDIST || props.NM_BAIRRO || city,
      lat: centroid.lat,
      lng: centroid.lng,
      radius,
      riskLevel: 'medium',
      zoneId,
      zoneType: 'ibge',
      isPermanent: true,
      canBeRemovedByReports: false,
      autoExpireAt: null,
      city,
      country: 'BR',
      ibgeCode: props.CD_GEOCODI || props.CD_AGLU || null,
      createdAt: new Date().toISOString(),
    })
    console.log(`Imported: ${zoneId} — ${name}`)
  }
  console.log('Done.')
  process.exit(0)
}

run().catch(err => { console.error(err); process.exit(1) })
