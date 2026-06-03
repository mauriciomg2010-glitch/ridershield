// Snap GPS coordinates to the nearest road using Mapbox Map Matching API

export interface SnapResult {
  lat: number
  lng: number
  segmentName: string | null
  snapConfidence: number
  snapped: boolean
}

export async function snapToRoad(lat: number, lng: number): Promise<SnapResult> {
  const token = process.env.NEXT_PUBLIC_MAPBOX_TOKEN
  try {
    const url =
      `https://api.mapbox.com/matching/v5/mapbox/cycling/${lng},${lat}` +
      `?geometries=geojson&radiuses=25&access_token=${token}`
    const res = await fetch(url)
    const data = await res.json()
    const matching = data.matchings?.[0]
    if (matching?.geometry?.coordinates?.[0]) {
      const [snapLng, snapLat] = matching.geometry.coordinates[0]
      return {
        lat: snapLat,
        lng: snapLng,
        segmentName: data.tracepoints?.[0]?.name ?? null,
        snapConfidence: matching.confidence ?? 0,
        snapped: true,
      }
    }
  } catch (err) {
    console.warn('Snap-to-road failed, using raw GPS:', err)
  }
  return { lat, lng, segmentName: null, snapConfidence: 0, snapped: false }
}
