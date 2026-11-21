// lib/activityLog.ts
//
// Client-side helpers for app/api/admin/activity-logs/route.ts — the one
// table behind both the "Reports" and "Activity Logs" admin tabs (see
// that route's own header comment). `logActivity()` is called from two
// places: SimulationModePanel.tsx's own explicit "Save to Reports" button
// (not automatically on every run — see that component's own header
// comment for why this changed), and AdminInvitePanel.tsx right after a
// successful invitation creation. `loadActivityLogs()` is called by both
// AdminReportsTab.tsx and AdminActivityLogTab.tsx against the same rows.

import { supabase } from './supabase'
import type { FsiLabel } from './dashboardData'
import type { WeightScheme } from './fsiFactorData'

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

// The structured payload an 'invitation_created' row's `details` column
// holds — just what AdminInvitePanel.tsx already collects on its own
// creation form; nothing new is fetched or invented for this.
export interface InvitationCreatedDetails {
  email: string
  office: string
  inviteeName: string | null
}

// A discriminated union (actionType is the discriminant) rather than one
// shape with optional fields — this is what lets AdminActivityLogTab.tsx's
// own `entry.actionType === 'simulation_run'` check narrow `entry.details`
// to SimulationRunDetails automatically, with no cast needed.
export type ActivityLogEntry =
  | { id: number; actorLabel: string | null; actionType: 'simulation_run'; summary: string; details: SimulationRunDetails; createdAt: string }
  | { id: number; actorLabel: string | null; actionType: 'invitation_created'; summary: string; details: InvitationCreatedDetails; createdAt: string }

async function authHeader(): Promise<Record<string, string>> {
  const {
    data: { session },
  } = await supabase.auth.getSession()
  const token = session?.access_token
  return token ? { Authorization: `Bearer ${token}` } : {}
}

// Returns whether the write actually succeeded, rather than firing and
// forgetting — callers (SimulationModePanel's "Save to Reports" button,
// AdminInvitePanel's post-creation call) use this to show real confirmation
// instead of an optimistic "Saved" that might not reflect what happened.
export async function logActivity(
  actionType: ActivityLogEntry['actionType'],
  summary: string,
  details: SimulationRunDetails | InvitationCreatedDetails
): Promise<boolean> {
  try {
    const headers = await authHeader()
    const res = await fetch('/api/admin/activity-logs', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...headers },
      body: JSON.stringify({ actionType, summary, details }),
    })
    return res.ok
  } catch {
    return false
  }
}

export async function loadActivityLogs(): Promise<ActivityLogEntry[]> {
  const headers = await authHeader()
  const res = await fetch('/api/admin/activity-logs', { headers })
  if (!res.ok) throw new Error(`Failed to load activity logs (${res.status})`)
  const json = await res.json()
  return (json.logs ?? []).map(
    (row: { id: number; actor_label: string | null; action_type: ActivityLogEntry['actionType']; summary: string; details: SimulationRunDetails | InvitationCreatedDetails; created_at: string }) =>
      ({
        id: row.id,
        actorLabel: row.actor_label,
        actionType: row.action_type,
        summary: row.summary,
        details: row.details,
        createdAt: row.created_at,
      }) as ActivityLogEntry
  )
}
