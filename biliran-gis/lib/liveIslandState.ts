// lib/liveIslandState.ts
//
// Drives the REAL (non-admin) dashboard's headline numbers from today's
// live Open-Meteo forecast instead of the static synthetic design storm —
// FSI score/label, Warning/Alert/Danger countdown, and the barangay
// ranking all now respond to actual forecast rain. This reuses the exact
// same real formulas Simulation Mode already established (see
// lib/islandSimulation.ts's own header comment for the full reasoning);
// the only thing that changes here is the rainfall INPUT — a real,
// per-municipality Open-Meteo hourly forecast instead of an admin-typed
// synthetic hyetograph.
//
// Countdown times: crossingTimeHours() (lib/islandSimulation.ts) is the
// same real, disclosed relative-threshold method (50/75/95% of a basin's
// own modeled peak Q) the pipeline itself uses — reused unchanged, just
// against a real forecasted discharge curve.
//
// FSI score: still no real formula exists that turns live rainfall into
// the terrain-factor recombination directly (disclosed in CLAUDE.md,
// "Deliberately still not built" — full per-basin recompute). The
// approach mirrors Simulation Mode's own already-accepted approximation:
// each barangay's real, static rainfall factor is scaled by a ratio of
// live forecasted rainfall to the real design storm's own total rainfall
// — self-consistent by construction (a municipality forecasting exactly
// the design storm's own total reproduces ratio=1, unchanged). This
// generalizes Simulation Mode's one-ratio-for-the-whole-island approach
// to one ratio PER MUNICIPALITY, since real per-municipality forecasts
// are now available (more spatially faithful, not less faithful).
// hand/twi/lclu (static terrain) are untouched — they don't change with
// weather.

import { fsiLabelForScore, type FsiLabel } from './dashboardData'
import { hydrographForBarangay, type RawHydrographData } from './hydrographData'
import type { RawFactorData } from './fsiFactorData'
import { recomputeHydrograph } from './simulationMode'
import { crossingTimeHours } from './islandSimulation'
import type { WeatherData } from './liveWeather'

export interface LiveHydrograph {
  basinId: number
  timeHours: number[]
  q: number[]
  rainfallMmHr: number[]
}

export interface LiveComputedState {
  // null only for the 2 barangays with no basin overlap at all — no
  // discharge curve to derive a crossing time from, same honest absence
  // as their missing hydrograph chart everywhere else in this app.
  warningTimeHours: number | null
  alertTimeHours: number | null
  dangerTimeHours: number | null
  liveFsi: number
  liveLabel: FsiLabel
  // The rainfall factor actually used in liveFsi above (the barangay's
  // real static factor, scaled by the live/design-storm ratio and
  // reclamped to [0,1]) — exposed so the detail panel's factor-breakdown
  // bar can show the same number the score was built from, instead of
  // silently showing the pre-scaling static value beside a live score.
  liveRainfallFactor: number
  hydrograph: LiveHydrograph | null
}

// The real design storm is a symmetric 0 -> peak -> 0 triangle over
// duration_hours — its total rainfall depth is exactly a triangle's area
// (peak * duration / 2), independent of time-step, so this is computed
// analytically rather than by discretizing a hyetograph.
function designStormTotalMm(hydrographData: RawHydrographData): number {
  const { peak_mm_hr, duration_hours } = hydrographData.storm_params
  return 0.5 * peak_mm_hr * duration_hours
}

// How far into an hourly forecast to sum for the FSI rainfall-factor
// ratio — matches the real design storm's own 6-hour display window.
const FSI_WINDOW_HOURS = 6

function clamp01(x: number): number {
  return Math.min(1, Math.max(0, x))
}

/**
 * Runs the live-forecast recompute for every barangay in fsi_factors.json
 * (all 115). `municipalityByBarangayKey` supplies each barangay's own
 * municipality (already on the Barangay object everywhere else in this
 * app) so its live rainfall input can be looked up.
 */
export function computeLiveIslandState(
  hydrographData: RawHydrographData,
  factorData: RawFactorData,
  weatherByMunicipality: Record<string, WeatherData | null>,
  municipalityByBarangayKey: Map<string, string>
): Map<string, LiveComputedState> {
  const results = new Map<string, LiveComputedState>()
  const w = factorData.factor_weights
  const designTotalMm = designStormTotalMm(hydrographData)

  for (const key of Object.keys(factorData.barangays)) {
    const factors = factorData.barangays[key]
    const municipality = municipalityByBarangayKey.get(key)
    const weather = municipality ? weatherByMunicipality[municipality] ?? null : null

    let ratio = 1
    if (weather && weather.hourlyPrecipitationMm.length > 0) {
      const liveTotalMm = weather.hourlyPrecipitationMm
        .slice(0, FSI_WINDOW_HOURS)
        .reduce((a, b) => a + b, 0)
      ratio = designTotalMm > 0 ? liveTotalMm / designTotalMm : 0
    }
    const simulatedRainfallFactor = clamp01(factors.rainfall * ratio)
    const liveFsi =
      w.hand * factors.hand + w.twi * factors.twi + w.lclu * factors.lclu + w.rainfall * simulatedRainfallFactor
    const liveLabel = fsiLabelForScore(liveFsi)

    let hydrograph: LiveHydrograph | null = null
    let warningTimeHours: number | null = null
    let alertTimeHours: number | null = null
    let dangerTimeHours: number | null = null

    const primary = hydrographForBarangay(hydrographData, key)
    if (primary && weather && weather.hourlyPrecipitationMm.length > 0) {
      const rainfallMmHr = weather.hourlyPrecipitationMm
      const q = recomputeHydrograph(primary.A, 1, rainfallMmHr)
      const timeHours = rainfallMmHr.map((_, i) => i)
      warningTimeHours = crossingTimeHours(timeHours, q, 0.5)
      alertTimeHours = crossingTimeHours(timeHours, q, 0.75)
      dangerTimeHours = crossingTimeHours(timeHours, q, 0.95)
      hydrograph = { basinId: primary.basinId, timeHours, q, rainfallMmHr }
    }

    results.set(key, {
      warningTimeHours,
      alertTimeHours,
      dangerTimeHours,
      liveFsi,
      liveLabel,
      liveRainfallFactor: simulatedRainfallFactor,
      hydrograph,
    })
  }

  return results
}
