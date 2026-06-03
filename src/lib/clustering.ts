// Auto-clustering: creates risk zones from rider report density using H3 hexagons.
// Runs after each valid report and can be triggered manually from admin.

import {
  collection, getDocs, query, where, setDoc, doc,
  Timestamp, serverTimestamp,
} from 'firebase/firestore'
import { db } from './firebase'

async function detectarCidade(lat: number, lng: number): Promise<string> {
  try {
    const token = process.env.NEXT_PUBLIC_MAPBOX_TOKEN
    const url = `https://api.mapbox.com/geocoding/v5/mapbox.places/${lng},${lat}.json?types=place&access_token=${token}`
    const res = await fetch(url)
    const data = await res.json()
    const place = data.features?.[0]?.text ?? 'unknown'
    return place.toLowerCase().replace(/\s+/g, '-').replace(/[^a-z0-9-]/g, '')
  } catch {
    return 'unknown'
  }
}

export async function processarClustering(lat: number, lng: number, raioMetros = 500): Promise<void> {
  const { latLngToCell, gridDisk, cellToLatLng } = await import('h3-js')

  const centroH3 = latLngToCell(lat, lng, 9)
  const hexagonosVizinhos = gridDisk(centroH3, 3)

  const seteDiasAtras = new Date()
  seteDiasAtras.setDate(seteDiasAtras.getDate() - 7)

  for (const h3Index of hexagonosVizinhos) {
    const reportsSnap = await getDocs(query(
      collection(db, 'incidents'),
      where('h3Index', '==', h3Index),
      where('timestamp', '>=', Timestamp.fromDate(seteDiasAtras)),
    ))

    const reports = reportsSnap.docs.map(d => d.data())
    if (reports.length < 1) continue

    // Weighted confidence score by rider trust
    const scoreTotal = reports.reduce((sum, r) => {
      return sum + (r.confidenceScore ?? 50) * ((r.riderScore ?? 50) / 100)
    }, 0)
    const scoreMedio = scoreTotal / reports.length

    // Dominant incident type
    const tipoCount: Record<string, number> = {}
    reports.forEach(r => { tipoCount[r.type] = (tipoCount[r.type] ?? 0) + 1 })
    const tipoDominante = Object.entries(tipoCount).sort((a, b) => b[1] - a[1])[0]?.[0] ?? 'suspicious_activity'

    // Peak hours (at least 2 reports in that hour)
    const horaCount: Record<number, number> = {}
    reports.forEach(r => { if (r.hour != null) horaCount[r.hour] = (horaCount[r.hour] ?? 0) + 1 })
    const horasPico = Object.entries(horaCount)
      .filter(([, count]) => count >= 2)
      .map(([hora]) => parseInt(hora))

    // Dominant road segment
    const segmentos = reports.filter(r => r.roadSegment).map(r => r.roadSegment as string)
    const segmentoDominante = segmentos.length > 0
      ? segmentos.sort((a, b) => segmentos.filter(s => s === b).length - segmentos.filter(s => s === a).length)[0]
      : null

    const riskLevel =
      reports.length >= 10 || scoreMedio >= 80 ? 'critical' :
      reports.length >= 6  || scoreMedio >= 60 ? 'high' :
      reports.length >= 3  || scoreMedio >= 40 ? 'medium' : 'low'

    // Radius scales with report density: 1 report = 60m, 2 = 150m, 3+ = 250-350m
    const radius =
      reports.length >= 6 ? 350 :
      reports.length >= 3 ? 250 :
      reports.length === 2 ? 150 : 60

    const [centroLat, centroLng] = cellToLatLng(h3Index)
    const zoneId = `AUTO-${h3Index}`
    const cidade = await detectarCidade(centroLat, centroLng)

    await setDoc(doc(db, 'risk_zones', zoneId), {
      zoneId,
      h3Index,
      zoneType: 'auto',
      city: cidade,
      lat: centroLat,
      lng: centroLng,
      radius,
      riskLevel,
      riskScore: Math.round(scoreMedio),
      incidentCount: reports.length,
      dominantType: tipoDominante,
      dominantSegment: segmentoDominante,
      peakHours: horasPico,
      source: 'auto_clustering',
      isPermanent: false,
      canBeRemovedByReports: true,
      autoExpireAt: Timestamp.fromDate(new Date(Date.now() + 7 * 24 * 60 * 60 * 1000)),
      lastIncidentAt: serverTimestamp(),
      createdAt: serverTimestamp(),
      updatedAt: serverTimestamp(),
    }, { merge: true })
  }
}
