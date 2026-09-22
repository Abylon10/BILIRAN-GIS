// lib/dashboardData.ts
//
// Loads and shapes public/data/barangay_dashboard_data.json — the static
// output of the external FSI/runoff pipeline (see CLAUDE.md). Every number
// here comes from a single synthetic design storm, not a live rainfall feed,
// so "time to X" is "hours into that modeled storm," not a real countdown.
// Keep that distinction visible in the UI (see the banner in DashboardShell).

import { municipalityForPrefix } from '@/lib/municipalities'

export type FsiLabel = 'Low' | 'Moderate' | 'High' | 'Very High' | string

export interface BarangayRecord {
  barangay: string
  pgc_prefix: string
  basin_ids: number[]
  has_river_data: boolean
  mean_fsi_score: number
  dominant_fsi_label: FsiLabel
  warning_time_hours: number
  alert_time_hours: number
  danger_time_hours: number
}

export interface Barangay extends BarangayRecord {
  key: string
  municipality: string
}

type RawData = Record<string, BarangayRecord>

let cache: Barangay[] | null = null

/**
 * barangay_biliran.geojson (and this dashboard JSON, derived from it) has a
 * known source-level double-UTF-8-encoding bug — see CLAUDE.md. Only repair
 * strings that actually show the tell-tale "Ã" + continuation-byte pattern,
 * so correctly-encoded names are never touched.
 */
function fixMojibake(s: string): string {
  if (!/Ã[\u0080-¿]/.test(s)) return s
  try {
    const bytes = Uint8Array.from(s, (c) => c.charCodeAt(0))
    return new TextDecoder('utf-8', { fatal: true }).decode(bytes)
  } catch {
    return s
  }
}

export async function loadBarangays(): Promise<Barangay[]> {
  if (cache) return cache
  const res = await fetch('/data/barangay_dashboard_data.json', { cache: 'force-cache' })
  if (!res.ok) throw new Error(`Failed to load dashboard data (${res.status})`)
  const raw: RawData = await res.json()
  cache = Object.entries(raw).map(([key, record]) => ({
    ...record,
    barangay: fixMojibake(record.barangay),
    key,
    municipality: municipalityForPrefix(record.pgc_prefix),
  }))
  return cache
}

/**
 * Highest susceptibility first: continuous mean_fsi_score descending, per
 * the settled decision to rank by that score rather than the discrete
 * dominant_fsi_label class (see CLAUDE.md). Ties broken by soonest modeled
 * time-to-Danger.
 */
export function sortBySeverity(barangays: Barangay[]): Barangay[] {
  return [...barangays].sort((a, b) => {
    if (a.mean_fsi_score !== b.mean_fsi_score) {
      return b.mean_fsi_score - a.mean_fsi_score
    }
    return a.danger_time_hours - b.danger_time_hours
  })
}

export function filterBarangays(
  barangays: Barangay[],
  query: string,
  municipality: string | null
): Barangay[] {
  const q = query.trim().toLowerCase()
  return barangays.filter((b) => {
    if (municipality && b.municipality !== municipality) return false
    if (!q) return true
    return b.barangay.toLowerCase().includes(q) || b.municipality.toLowerCase().includes(q)
  })
}

/** The single most urgent upcoming threshold crossing across every barangay. */
export function mostUrgentCrossing(barangays: Barangay[]): {
  barangay: Barangay
  tier: 'Alert' | 'Danger'
  hours: number
} | null {
  let best: { barangay: Barangay; tier: 'Alert' | 'Danger'; hours: number } | null = null
  for (const b of barangays) {
    for (const [tier, hours] of [
      ['Alert', b.alert_time_hours],
      ['Danger', b.danger_time_hours],
    ] as const) {
      if (!best || hours < best.hours) {
        best = { barangay: b, tier, hours }
      }
    }
  }
  return best
}

/** Worst-case (highest) mean_fsi_score among a municipality's barangays — safety-first, not an average. */
export function municipalityWorstScore(barangays: Barangay[], municipality: string): number {
  let worst = 0
  for (const b of barangays) {
    if (b.municipality === municipality && b.mean_fsi_score > worst) worst = b.mean_fsi_score
  }
  return worst
}

export function formatHoursAsCountdown(hours: number): string {
  const totalMinutes = Math.round(hours * 60)
  const h = Math.floor(totalMinutes / 60)
  const m = totalMinutes % 60
  if (h <= 0) return `${m} min`
  return `${h}h ${m}m`
}

export function urgencyTierColor(label: FsiLabel): string {
  switch (label) {
    case 'Very High':
      return '#C0392B'
    case 'High':
      return '#E8A33D'
    case 'Moderate':
      return '#D9B23C'
    case 'Low':
      return '#4F8A45'
    default:
      return '#7A8A99'
  }
}

const SCORE_COLOR_STOPS: [number, [number, number, number]][] = [
  [0, [79, 138, 69]], // #4F8A45 green
  [0.35, [217, 178, 60]], // #D9B23C yellow
  [0.65, [232, 163, 61]], // #E8A33D orange
  [1, [192, 57, 43]], // #C0392B red
]

/** Continuous green→yellow→orange→red fill for a mean_fsi_score in [0, 1], for map polygons. */
export function fsiScoreColor(score: number): string {
  const s = Math.min(1, Math.max(0, score))
  for (let i = 0; i < SCORE_COLOR_STOPS.length - 1; i++) {
    const [s0, c0] = SCORE_COLOR_STOPS[i]
    const [s1, c1] = SCORE_COLOR_STOPS[i + 1]
    if (s >= s0 && s <= s1) {
      const t = s1 === s0 ? 0 : (s - s0) / (s1 - s0)
      const r = Math.round(c0[0] + (c1[0] - c0[0]) * t)
      const g = Math.round(c0[1] + (c1[1] - c0[1]) * t)
      const b = Math.round(c0[2] + (c1[2] - c0[2]) * t)
      return `rgb(${r}, ${g}, ${b})`
    }
  }
  return '#7A8A99'
}
