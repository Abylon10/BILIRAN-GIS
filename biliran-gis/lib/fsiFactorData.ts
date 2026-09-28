// lib/fsiFactorData.ts
//
// Loads and shapes public/data/fsi_factors.json — a per-barangay breakdown
// of the four normalized inputs that combine into mean_fsi_score (HAND
// inverted, TWI, LCLU runoff score, 6-hour rainfall forecast), each 0-1,
// zonal-averaged from the pipeline's aligned rasters. See CLAUDE.md for
// full provenance, the known approximations (a substitute flow-accumulation
// raster for TWI, a reconstructed rainfall grid), and the validation against
// the authoritative mean_fsi_score (correlation 0.85, mean abs diff 0.038).
//
// fsi_recomputed here is a supplementary, approximate recombination of the
// four factors below — it does NOT replace or override mean_fsi_score in
// barangay_dashboard_data.json, which stays the authoritative score.

export interface FactorWeights {
  hand: number
  twi: number
  lclu: number
  rainfall: number
}

export interface BarangayFactors {
  hand: number
  twi: number
  lclu: number
  rainfall: number
  fsi_recomputed: number
  n_pixels: number
}

interface RawFactorData {
  description: string
  factor_weights: FactorWeights
  barangays: Record<string, BarangayFactors>
}

let cache: RawFactorData | null = null
let inflight: Promise<RawFactorData> | null = null

export async function loadFsiFactors(): Promise<RawFactorData> {
  if (cache) return cache
  if (!inflight) {
    inflight = fetch('/data/fsi_factors.json', { cache: 'force-cache' })
      .then((res) => {
        if (!res.ok) throw new Error(`Failed to load FSI factors (${res.status})`)
        return res.json()
      })
      .then((data: RawFactorData) => {
        cache = data
        return data
      })
      .catch((err) => {
        inflight = null
        throw err
      })
  }
  return inflight
}

export function factorsForBarangay(data: RawFactorData, barangayKey: string): BarangayFactors | null {
  return data.barangays[barangayKey] ?? null
}
