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

/** Most urgent first: soonest modeled time-to-Danger, then highest mean FSI score. */
export function sortByUrgency(barangays: Barangay[]): Barangay[] {
  return [...barangays].sort((a, b) => {
    if (a.danger_time_hours !== b.danger_time_hours) {
      return a.danger_time_hours - b.danger_time_hours
    }
    return b.mean_fsi_score - a.mean_fsi_score
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
