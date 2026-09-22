// lib/municipalities.ts
//
// Maps a barangay's `pgc_prefix` (from barangay_dashboard_data.json) to its
// municipality, and gives Maripipi's location for the "unmonitored" map
// marker. Confirmed against the PSA/OCHA administrative boundaries dataset
// (adm3_psgc / center_lat / center_lon per municipality) — the same source
// used to build public/data/geo/*.geojson — not just the PSGC-numbering
// guess this file used to carry.

export const MUNICIPALITY_BY_PREFIX: Record<string, string> = {
  '807801': 'Almeria',
  '807802': 'Biliran',
  '807803': 'Cabucgayan',
  '807804': 'Caibiran',
  '807805': 'Culaba',
  '807806': 'Kawayan',
  '807808': 'Naval',
}

export const MONITORED_MUNICIPALITIES = Object.values(MUNICIPALITY_BY_PREFIX).sort()

export function municipalityForPrefix(pgcPrefix: string): string {
  return MUNICIPALITY_BY_PREFIX[pgcPrefix] ?? 'Unknown'
}

/** No polygon/barangay data exists for Maripipi in this repo — only its centroid, for the map's "unmonitored" marker. */
export const MARIPIPI = {
  name: 'Maripipi',
  lon: 124.32138273,
  lat: 11.78861297,
}
