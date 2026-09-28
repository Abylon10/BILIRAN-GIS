// lib/islandSimulation.ts
//
// Island-wide Simulation Mode: runs one admin-supplied storm scenario
// against every barangay at once, instead of the single barangay
// lib/simulationMode.ts alone supports. Two genuinely different kinds of
// output here, deliberately not treated the same way:
//
// - Warning/Alert/Danger countdown times: a REAL, disclosed formula
//   (CLAUDE.md: "Runoff thresholds are relative to each basin's own
//   modeled peak Q — Warning 50% / Alert 75% / Danger 95%"). Recomputing
//   these for a simulated storm reuses that same real formula against a
//   simulated discharge curve — legitimate, not invented. Only available
//   for the 113 barangays with basin/hydrograph data; the 2 without keep
//   their real static times (see crossingTimeHours/simulateIsland below).
//
// - FSI score/label: NO real formula turns a discharge curve into an FSI
//   score — the real FSI (fsi_factors.json) is 0.30*hand + 0.30*twi +
//   0.20*lclu + 0.20*rainfall, where hand/twi/lclu are static terrain
//   factors (genuinely storm-independent) and rainfall is already stored
//   pre-normalized (no raw mm total to rescale a simulated value against).
//   This was disclosed plainly and the user chose to build an approximate
//   recompute anyway. The approach: scale each barangay's own REAL
//   rainfall factor by the ratio of the simulated storm's total rainfall
//   to the real design storm's total rainfall (both computed the same
//   way, over the same window, so directly comparable) — preserves each
//   barangay's real spatial variation instead of flattening every
//   barangay to one shared value, and is self-consistent by construction:
//   inputting the real storm's own parameters gives ratio=1 and exactly
//   reproduces the existing fsi_recomputed value. Still an approximation
//   layered on an approximation — every caller must label it as such.

import type { RawHydrographData } from './hydrographData'
import type { RawFactorData } from './fsiFactorData'
import { fsiLabelForScore, type FsiLabel } from './dashboardData'
import {
  buildRaisedTriangularHyetograph,
  simulateForBarangay,
  type SimulationParams,
  type SimulatedHydrograph,
} from './simulationMode'

export interface IslandSimResult {
  // null only for the 2 barangays with no basin data — no discharge curve
  // to derive a crossing time from at all.
  warningTimeHours: number | null
  alertTimeHours: number | null
  dangerTimeHours: number | null
  simulatedFsi: number
  simulatedLabel: FsiLabel
  hydrograph: SimulatedHydrograph | null
}

const CROSSING_EPS = 1e-9
const RATIO_EPS = 1e-6

/**
 * First time index at which q reaches `fraction` of its own max — the
 * same relative-threshold method CLAUDE.md documents the real pipeline
 * using (50%/75%/95% of peak Q), just run against a simulated curve.
 *
 * Guards max(q) ~ 0 (no rain at all, or minRate = maxRate = 0): without
 * this, q[0] >= 0 would trivially "cross" a 0 threshold immediately,
 * misreporting "Danger in 0 hours" for a barangay experiencing zero
 * simulated rain. Returns the end of the window instead — a "never
 * meaningfully crossed within this window" reading, at the cost of being
 * indistinguishable from a crossing that happens to land on the very
 * last sample; accepted as a known limitation rather than adding a
 * tri-state return type for this edge case alone.
 */
export function crossingTimeHours(timeHours: number[], q: number[], fraction: number): number {
  const maxQ = Math.max(...q, 0)
  const lastTime = timeHours[timeHours.length - 1] ?? 0
  if (maxQ <= CROSSING_EPS) return lastTime

  const threshold = fraction * maxQ
  for (let i = 0; i < q.length; i++) {
    if (q[i] >= threshold) return timeHours[i]
  }
  return lastTime
}

function sum(xs: number[]): number {
  return xs.reduce((a, b) => a + b, 0)
}

function clamp01(x: number): number {
  return Math.min(1, Math.max(0, x))
}

/**
 * Runs one storm scenario against every barangay in fsi_factors.json
 * (all 115 — a superset of the 113 with basin/hydrograph data). No new
 * fetch: both `hydrographData`/`factorData` are already-loaded, cached
 * results from loadBasinHydrographs()/loadFsiFactors().
 */
export function simulateIsland(
  hydrographData: RawHydrographData,
  factorData: RawFactorData,
  params: SimulationParams,
  dtHours: number,
  totalHours: number
): Map<string, IslandSimResult> {
  // Real design storm's own hyetograph, reconstructed from its own stored
  // storm_params (not hardcoded) via minRate:0 — buildRaisedTriangularHyetograph's
  // own doc comment confirms this exactly reproduces the real single-peak
  // triangular shape — over the identical window/step as the simulated
  // one below, so the two totals are directly comparable.
  const real = buildRaisedTriangularHyetograph(
    {
      minRate: 0,
      maxRate: hydrographData.storm_params.peak_mm_hr,
      durationHours: hydrographData.storm_params.duration_hours,
    },
    dtHours,
    totalHours
  )
  const realTotalMm = sum(real.rainfallMmHr) * dtHours

  const sim = buildRaisedTriangularHyetograph(params, dtHours, totalHours)
  const simTotalMm = sum(sim.rainfallMmHr) * dtHours

  const ratio = realTotalMm > RATIO_EPS ? simTotalMm / realTotalMm : 1

  const results = new Map<string, IslandSimResult>()
  const w = factorData.factor_weights

  for (const key of Object.keys(factorData.barangays)) {
    const factors = factorData.barangays[key]
    const simulatedRainfallFactor = clamp01(factors.rainfall * ratio)
    const simulatedFsi =
      w.hand * factors.hand + w.twi * factors.twi + w.lclu * factors.lclu + w.rainfall * simulatedRainfallFactor
    const simulatedLabel = fsiLabelForScore(simulatedFsi)

    const simHydro = simulateForBarangay(hydrographData, key, params, dtHours, totalHours)

    results.set(key, {
      warningTimeHours: simHydro ? crossingTimeHours(simHydro.timeHours, simHydro.q, 0.5) : null,
      alertTimeHours: simHydro ? crossingTimeHours(simHydro.timeHours, simHydro.q, 0.75) : null,
      dangerTimeHours: simHydro ? crossingTimeHours(simHydro.timeHours, simHydro.q, 0.95) : null,
      simulatedFsi,
      simulatedLabel,
      hydrograph: simHydro,
    })
  }

  return results
}
