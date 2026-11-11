// lib/activityLog.ts
//
// Client-side helpers for app/api/admin/activity-logs/route.ts — the one
// table behind both the "Reports" and "Activity Logs" admin tabs (see
// that route's own header comment). `logActivity()` is called once, from
// SimulationModePanel.tsx, right after a real island-wide simulation run
// completes; `loadActivityLogs()` is called by both AdminReportsTab.tsx
// and AdminActivityLogTab.tsx against the same rows.

import { supabase } from './supabase'
import type { FsiLabel } from './dashboardData'
import type { WeightScheme } from './fsiFactorData'

export type ActivityActionType = 'simulation_run'

// The structured payload a 'simulation_run' row's `details` column holds —
// everything SimulationModePanel.tsx needs to reload the exact same
// scenario into its own form (see its own `prefillTrigger` prop), plus the
// real, already-computed alert-count breakdown so Reports can show a
// result summary without recomputing anything.
export interface SimulationRunDetails {
  minRate: number
  maxRate: number
  durationHours: number
  scheme: WeightScheme
  scenarioName: string
  alertCounts: Record<FsiLabel, number>
}

export interface ActivityLogEntry {
  id: number
  actorLabel: string | null
  actionType: ActivityActionType
  summary: string
  details: SimulationRunDetails
  createdAt: string
}

async function authHeader(): Promise<Record<string, string>> {
  const {
    data: { session },
  } = await supabase.auth.getSession()
  const token = session?.access_token
  return token ? { Authorization: `Bearer ${token}` } : {}
}

// Fire-and-forget by design — called right after a simulation already ran
// and its results are already on screen; a failed log write shouldn't
// undo that or surface an error to the admin mid-scenario. Mirrors the
// same graceful-degradation posture lib/email.ts already uses for a
// different non-critical side effect.
export async function logActivity(actionType: ActivityActionType, summary: string, details: SimulationRunDetails): Promise<void> {
  try {
    const headers = await authHeader()
    await fetch('/api/admin/activity-logs', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...headers },
      body: JSON.stringify({ actionType, summary, details }),
    })
  } catch {
    // Silently dropped — see this function's own comment above.
  }
}

export async function loadActivityLogs(): Promise<ActivityLogEntry[]> {
  const headers = await authHeader()
  const res = await fetch('/api/admin/activity-logs', { headers })
  if (!res.ok) throw new Error(`Failed to load activity logs (${res.status})`)
  const json = await res.json()
  return (json.logs ?? []).map(
    (row: { id: number; actor_label: string | null; action_type: ActivityActionType; summary: string; details: SimulationRunDetails; created_at: string }) => ({
      id: row.id,
      actorLabel: row.actor_label,
      actionType: row.action_type,
      summary: row.summary,
      details: row.details,
      createdAt: row.created_at,
    })
  )
}
