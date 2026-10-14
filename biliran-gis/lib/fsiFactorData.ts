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

export interface RawFactorData {
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

// The external pipeline's original "terrain-majority" weights — live in
// fsi_factors.json's own factor_weights until a direct request changed it
// to the "rainfall-majority" set currently there (see CLAUDE.md). No longer
// stored anywhere in data, so it's hardcoded here — the one place in code
// that needs it, for the Terrain base / Rainfall base comparison toggle
// (components/DashboardShell.tsx, components/AdminGisDataTab.tsx).
export const TERRAIN_BASE_WEIGHTS: FactorWeights = { hand: 0.3, twi: 0.3, lclu: 0.2, rainfall: 0.2 }

/**
 * Static (ratio=1, no live-weather or simulated-storm scaling) recombination
 * of a barangay's own stored factor values under an arbitrary weight set —
 * the exact formula already used offline to produce each barangay's stored
 * fsi_recomputed under the current weights, generalized so it can run for
 * either weighting scheme, live, in the browser. Deliberately simpler than
 * lib/islandSimulation.ts/lib/liveIslandState.ts's versions of this same sum,
 * which additionally scale the rainfall term by a scenario/forecast ratio —
 * this one answers "what do different weights do," not "what does different
 * rainfall do," so it never touches the rainfall factor's stored value.
 */
export function recomputeFsiStatic(factors: BarangayFactors, weights: FactorWeights): number {
  return weights.hand * factors.hand + weights.twi * factors.twi + weights.lclu * factors.lclu + weights.rainfall * factors.rainfall
}

export interface FactorTertiles {
  hand: [number, number]
  twi: [number, number]
  lclu: [number, number]
}

function percentile(sorted: number[], p: number): number {
  const idx = p * (sorted.length - 1)
  const lo = Math.floor(idx)
  const hi = Math.min(lo + 1, sorted.length - 1)
  const frac = idx - lo
  return sorted[lo] * (1 - frac) + sorted[hi] * frac
}

let tertileCache: { data: RawFactorData; tertiles: FactorTertiles } | null = null

/**
 * Real, data-driven tertile (33rd/66th percentile) boundaries for HAND/TWI/
 * LCLU, computed directly from every barangay's own factor value rather than
 * a hardcoded guess — used to sort a barangay into one of 3 plain-language
 * categories per factor (BarangayDetailPanel's "Barangay Factor Profile").
 * Stays correct automatically if the underlying raster data is ever
 * reprocessed, instead of drifting from a stale hardcoded boundary. Cached
 * against the same RawFactorData reference loadFsiFactors() already caches,
 * so the O(n log n) sort only runs once per page load, not once per
 * barangay selected.
 */
export function getFactorTertiles(data: RawFactorData): FactorTertiles {
  if (tertileCache && tertileCache.data === data) return tertileCache.tertiles
  const values = Object.values(data.barangays)
  const sortedOf = (key: 'hand' | 'twi' | 'lclu') => values.map((f) => f[key]).sort((a, b) => a - b)
  const bounds = (sorted: number[]): [number, number] => [percentile(sorted, 1 / 3), percentile(sorted, 2 / 3)]
  const tertiles: FactorTertiles = {
    hand: bounds(sortedOf('hand')),
    twi: bounds(sortedOf('twi')),
    lclu: bounds(sortedOf('lclu')),
  }
  tertileCache = { data, tertiles }
  return tertiles
}
