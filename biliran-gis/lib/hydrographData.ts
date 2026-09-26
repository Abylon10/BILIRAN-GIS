// lib/hydrographData.ts
//
// Loads and shapes public/data/basin_hydrographs.json — real per-basin
// runoff hydrographs (island-wide r.watershed delineation, Kirpich
// time-of-concentration, exact analytical linear-reservoir routing) joined
// to the 115 official barangays via actual polygon-to-raster overlap. See
// CLAUDE.md for full provenance, including why 2 of the 115 barangays
// genuinely have no basin overlap (not a gap in the data).
//
// Lazily fetched — only called when a barangay detail panel actually needs
// a curve, not loaded eagerly alongside barangay_dashboard_data.json.

export interface StormParams {
  peak_mm_hr: number
  duration_hours: number
  n_timesteps: number
  dt_hours: number
}

interface BasinDetail {
  basin_id: number
  overlap_cells: number
  overlap_area_km2: number
  A: number
  Tc_hours: number
}

interface BarangayBasinInfo {
  risk_type: 'riverine + FSI' | 'FSI only' | string
  n_basins: number
  basin_details: BasinDetail[]
}

interface BasinHydrographRecord {
  basin_id: number
  A: number
  k_hours: number
  area_km2: number
  hydrograph: {
    time_hours: number[]
    Q: number[]
    rainfall_mm_hr: number[]
  }
}

interface RawHydrographData {
  description: string
  storm_params: StormParams
  barangays: Record<string, BarangayBasinInfo>
  basins: Record<string, BasinHydrographRecord>
}

export interface PrimaryHydrograph {
  basinId: number
  overlapAreaKm2: number
  areaKm2: number
  /** Reservoir coefficient (1/hour) — exposed so Simulation Mode can recompute this same basin's curve for arbitrary rainfall inputs. */
  A: number
  timeHours: number[]
  q: number[]
  rainfallMmHr: number[]
}

let cache: RawHydrographData | null = null
let inflight: Promise<RawHydrographData> | null = null

export async function loadBasinHydrographs(): Promise<RawHydrographData> {
  if (cache) return cache
  if (!inflight) {
    inflight = fetch('/data/basin_hydrographs.json', { cache: 'force-cache' })
      .then((res) => {
        if (!res.ok) throw new Error(`Failed to load basin hydrographs (${res.status})`)
        return res.json()
      })
      .then((data: RawHydrographData) => {
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

/**
 * A barangay can overlap several basins (up to 36, island-wide). This picks
 * the largest-overlap-area basin's curve as the barangay's "primary"
 * hydrograph — a documented simplification for a first pass, not a hidden
 * one; see the plan/CLAUDE.md for why showing all of them at once would be
 * visual clutter.
 */
export function hydrographForBarangay(
  data: RawHydrographData,
  barangayKey: string
): PrimaryHydrograph | null {
  const info = data.barangays[barangayKey]
  if (!info || info.basin_details.length === 0) return null

  const primary = info.basin_details.reduce((best, d) =>
    d.overlap_area_km2 > best.overlap_area_km2 ? d : best
  )
  const basin = data.basins[String(primary.basin_id)]
  if (!basin) return null

  return {
    basinId: primary.basin_id,
    overlapAreaKm2: primary.overlap_area_km2,
    areaKm2: basin.area_km2,
    A: basin.A,
    timeHours: basin.hydrograph.time_hours,
    q: basin.hydrograph.Q,
    rainfallMmHr: basin.hydrograph.rainfall_mm_hr,
  }
}
