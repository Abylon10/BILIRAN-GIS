// lib/simulationMode.ts
//
// Client-side "what if" recompute for Simulation Mode — reuses the exact
// same basin selection (hydrographForBarangay) and the exact same
// analytical routing formula the real static hydrographs were built with
// (see CLAUDE.md's "exact analytical formula" section), just fed a
// synthetic rainfall series built from an admin's own min/max/duration
// inputs instead of the pipeline's fixed 50mm/hr design storm.
//
// The real storm is a symmetric triangular hyetograph (0 -> peak -> 0).
// This generalizes that to a *raised* triangle: ramp from minRate up to
// maxRate over half the duration, back down to minRate over the other
// half, then hold at minRate (a background rate, not a fabricated drop to
// zero) for the rest of the fixed display window — a literal
// generalization of the documented shape, not an invented one.
//
// Purely client-side and ephemeral: nothing here is persisted or sent
// anywhere. Every output must be labeled as simulated by its caller.

import { hydrographForBarangay, type PrimaryHydrograph } from './hydrographData'

export interface SimulationParams {
  minRate: number
  maxRate: number
  durationHours: number
}

export interface SimulatedHydrograph {
  basinId: number
  A: number
  timeHours: number[]
  q: number[]
  rainfallMmHr: number[]
}

/**
 * A raised triangular hyetograph over a fixed total window (matching the
 * real storm's window/step so simulated and real charts share an x-axis).
 */
export function buildRaisedTriangularHyetograph(
  params: SimulationParams,
  dtHours: number,
  totalHours: number
): { timeHours: number[]; rainfallMmHr: number[] } {
  const { minRate, maxRate, durationHours } = params
  const n = Math.round(totalHours / dtHours) + 1
  const halfDuration = durationHours / 2

  const timeHours: number[] = []
  const rainfallMmHr: number[] = []
  for (let i = 0; i < n; i++) {
    const t = i * dtHours
    let rate: number
    if (t <= halfDuration) {
      rate = minRate + (maxRate - minRate) * (halfDuration === 0 ? 1 : t / halfDuration)
    } else if (t <= durationHours) {
      rate = maxRate - (maxRate - minRate) * ((t - halfDuration) / halfDuration)
    } else {
      rate = minRate
    }
    timeHours.push(t)
    rainfallMmHr.push(rate)
  }
  return { timeHours, rainfallMmHr }
}

/**
 * The exact analytical linear-reservoir recurrence already used to build
 * every real static hydrograph in this app: Q[t+1] = Q[t]*e^(-A*dt) +
 * R[t+1]*(1-e^(-A*dt)), Q[0] = 0. Unconditionally stable for any A > 0.
 */
export function recomputeHydrograph(A: number, dtHours: number, rainfallMmHr: number[]): number[] {
  const decay = Math.exp(-A * dtHours)
  const q: number[] = [0]
  for (let i = 1; i < rainfallMmHr.length; i++) {
    q.push(q[i - 1] * decay + rainfallMmHr[i] * (1 - decay))
  }
  return q
}

/**
 * Simulates the same primary basin hydrographForBarangay() would pick for
 * the real chart, so the two are always directly comparable. Returns null
 * under the same conditions the real loader does (no basin overlap).
 */
export function simulateForBarangay(
  data: Parameters<typeof hydrographForBarangay>[0],
  barangayKey: string,
  params: SimulationParams,
  dtHours: number,
  totalHours: number
): SimulatedHydrograph | null {
  const primary: PrimaryHydrograph | null = hydrographForBarangay(data, barangayKey)
  if (!primary) return null

  const { timeHours, rainfallMmHr } = buildRaisedTriangularHyetograph(params, dtHours, totalHours)
  const q = recomputeHydrograph(primary.A, dtHours, rainfallMmHr)

  return {
    basinId: primary.basinId,
    A: primary.A,
    timeHours,
    q,
    rainfallMmHr,
  }
}
