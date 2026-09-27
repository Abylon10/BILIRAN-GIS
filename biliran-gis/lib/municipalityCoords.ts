// lib/municipalityCoords.ts
//
// Lat/lon centroids for the 7 monitored municipalities, used to fetch
// real weather from Open-Meteo (see app/api/weather/route.ts). These are
// NOT invented for this: they're the exact same 7 points already read
// directly from the external GIS pipeline's own rainfall_timeseries.json
// (Google Drive) during this session's FSI factor breakdown work — the
// one other place in this app's data provenance that already needed
// municipality-level rainfall coordinates. Maripipi is intentionally
// absent — unmonitored, same exclusion as everywhere else in this app
// (see lib/municipalities.ts's own MARIPIPI comment).

export interface Coordinates {
  lat: number
  lon: number
}

export const MUNICIPALITY_COORDS: Record<string, Coordinates> = {
  Naval: { lat: 11.493849, lon: 124.362175 },
  Almeria: { lat: 11.634446, lon: 124.4236 },
  Biliran: { lat: 11.564148, lon: 124.47321 },
  Cabucgayan: { lat: 11.493849, lon: 124.52275 },
  Caibiran: { lat: 11.564148, lon: 124.553566 },
  Culaba: { lat: 11.634446, lon: 124.50403 },
  Kawayan: { lat: 11.7750435, lon: 124.32408 },
}
