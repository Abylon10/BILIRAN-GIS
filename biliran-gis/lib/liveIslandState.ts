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
//
// computeLiveIslandStateAtOffset() below reuses the exact same per-barangay
// formula (factored out into computeOneBarangay(), called by every entry
// point in this file) to answer a different, real-user-facing question:
// not "what's my risk right now," but "what does the forecast say the
// WHOLE island's risk will look like at hour N from now" — tapping a point
// on a barangay's real (already-live, already-fetched) Precipitation
// chart. This is NOT a hypothetical/simulated scenario the way admin
// Simulation Mode's typed min/max rain is — it's a different real point
// already sitting in the Open-Meteo forecast arrays this app already has
// in memory for all 7 monitored municipalities, just evaluated with the
// same 6-hour-window-starting-here logic "now" already uses, for every
// barangay at once (re-ranks the list, recolors the map — direct
// request, matching admin Simulation Mode's own island-wide scope, just
// fed from real forecast data instead of a hypothetical).
//
// `weights` (both entry points below) lets ANY of the FSI weighting
// schemes (Rainfall base / Terrain base / Equal weights —
// components/DashboardShell.tsx's own picker) use live/previewed rainfall
// as their rainfall term, not just Rainfall base — by direct request, a
// weighting scheme is now purely "which 4 numbers," independent of
// whether the rainfall term itself is live, previewed, or (while weather
// hasn't loaded yet) static.

import { fsiLabelForScore, type FsiLabel } from './dashboardData'
import { hydrographForBarangay, type RawHydrographData } from './hydrographData'
import type { RawFactorData, FactorWeights } from './fsiFactorData'
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

// How many hours forward (from the current hour, not from the start of
// Open-Meteo's own local-calendar-day array) to sum for the FSI
// rainfall-factor ratio — matches the real design storm's own 6-hour
// display window.
const FSI_WINDOW_HOURS = 6

function clamp01(x: number): number {
  return Math.min(1, Math.max(0, x))
}

// The one real per-barangay formula, shared by computeLiveIslandState()
// (offsetHours=0, all 115 barangays, "right now") and
// computeLiveStateForBarangayAtOffset() (one barangay, an admin/user-
// chosen offset) below — factored out so the two entry points can never
// silently drift apart. `offsetHours` shifts BOTH the FSI rainfall-ratio
// window and the hydrograph's own start point forward into the same
// already-fetched hourly forecast array; at offsetHours=0 this is byte-
// identical to the original inline loop body it replaced.
function computeOneBarangay(
  key: string,
  factors: RawFactorData['barangays'][string],
  weather: WeatherData | null,
  hydrographData: RawHydrographData,
  designTotalMm: number,
  w: RawFactorData['factor_weights'],
  offsetHours: number
): LiveComputedState {
  // currentHourIndex < 0 means the API couldn't place "now" in its own
  // hourly array (rare) — treated the same as weather being entirely
  // unavailable (ratio stays 1, i.e. unscaled static factor) rather than
  // silently reading from the wrong offset.
  const hasWeather = weather != null && weather.currentHourIndex >= 0 && weather.hourlyPrecipitationMm.length > 0
  const baseIndex = weather ? weather.currentHourIndex + offsetHours : -1

  let ratio = 1
  if (hasWeather) {
    const liveTotalMm = weather!.hourlyPrecipitationMm
      .slice(baseIndex, baseIndex + FSI_WINDOW_HOURS)
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
  if (primary && hasWeather) {
    // Sliced from baseIndex, not the array's own start — so index 0 here
    // (and therefore timeHours[0]) genuinely means "right now" (offsetHours
    // === 0) or "the previewed hour" (offsetHours > 0), not "midnight."
    // This is what makes the Warning/Alert/Danger countdown read as
    // hours-from-that-point instead of hours-since-midnight.
    const rainfallMmHr = weather!.hourlyPrecipitationMm.slice(baseIndex)
    const q = recomputeHydrograph(primary.A, 1, rainfallMmHr)
    const timeHours = rainfallMmHr.map((_, i) => i)
    warningTimeHours = crossingTimeHours(timeHours, q, 0.5)
    alertTimeHours = crossingTimeHours(timeHours, q, 0.75)
    dangerTimeHours = crossingTimeHours(timeHours, q, 0.95)
    hydrograph = { basinId: primary.basinId, timeHours, q, rainfallMmHr }
  }

  return {
    warningTimeHours,
    alertTimeHours,
    dangerTimeHours,
    liveFsi,
    liveLabel,
    liveRainfallFactor: simulatedRainfallFactor,
    hydrograph,
  }
}

/**
 * Runs the live-forecast recompute for every barangay in fsi_factors.json
 * (all 115). `municipalityByBarangayKey` supplies each barangay's own
 * municipality (already on the Barangay object everywhere else in this
 * app) so its live rainfall input can be looked up. `weights` optionally
 * overrides which FSI weighting scheme is used (components/DashboardShell.tsx's
 * picker) — omitted, it falls back to `factorData.factor_weights` (the
 * "Rainfall base" scheme) exactly as before this parameter existed.
 */
export function computeLiveIslandState(
  hydrographData: RawHydrographData,
  factorData: RawFactorData,
  weatherByMunicipality: Record<string, WeatherData | null>,
  municipalityByBarangayKey: Map<string, string>,
  weights?: FactorWeights
): Map<string, LiveComputedState> {
  return computeLiveIslandStateAtOffset(0, hydrographData, factorData, weatherByMunicipality, municipalityByBarangayKey, weights)
}

/**
 * Same real formula as computeLiveIslandState() above, for every barangay
 * at once, shifted `offsetHours` into that same already-loaded forecast —
 * "what does today's live forecast say the WHOLE island's risk will look
 * like at hour N from now," not a hypothetical. Island-wide (not just the
 * tapped barangay) by direct request, matching admin Simulation Mode's
 * own scope — re-ranking the list and recoloring the map the same way a
 * typed scenario does, just from real forecast data. Still cheap enough
 * to run on every tap: it's the same O(115) per-barangay formula
 * computeLiveIslandState() already runs for "now," just evaluated at a
 * different offset — no new fetch, no heavier computation class.
 */
export function computeLiveIslandStateAtOffset(
  offsetHours: number,
  hydrographData: RawHydrographData,
  factorData: RawFactorData,
  weatherByMunicipality: Record<string, WeatherData | null>,
  municipalityByBarangayKey: Map<string, string>,
  weights?: FactorWeights
): Map<string, LiveComputedState> {
  const results = new Map<string, LiveComputedState>()
  const w = weights ?? factorData.factor_weights
  const designTotalMm = designStormTotalMm(hydrographData)

  for (const key of Object.keys(factorData.barangays)) {
    const factors = factorData.barangays[key]
    const municipality = municipalityByBarangayKey.get(key)
    const weather = municipality ? weatherByMunicipality[municipality] ?? null : null
    results.set(key, computeOneBarangay(key, factors, weather, hydrographData, designTotalMm, w, offsetHours))
  }

  return results
}
