// components/AdminReportsTab.tsx
//
// The admin shell's "Reports" tab (components/AdminShell.tsx) — replaces
// the old AdminComingSoonTab placeholder. Shows every real, logged
// island-wide simulation run that an admin explicitly saved
// (SimulationModePanel.tsx's own "Save to Reports" button, NOT every
// "Start simulation"/tap-to-simulate run — see that component's own
// header comment for why) as a reviewable scenario card: the exact
// rain/duration/weighting-scheme inputs that were run, plus the real,
// already-computed Predicted Alert Count breakdown from that run — never
// recomputed here, just the same numbers SimulationModePanel itself
// showed at the time.
//
// Filters to actionType === 'simulation_run' client-side rather than a
// separate table/endpoint — see supabase/activity-logs-setup.sql's own
// header comment for why Reports and Activity Logs (AdminActivityLogTab.tsx)
// are deliberately two views over one shared log, not two features.
//
// Tapping "Load into Simulation Mode" calls onLoadIntoSimulation (passed
// down from AdminShell.tsx) with exactly this row's saved scenario —
// AdminShell switches to the Rainfall & Scenarios tab and feeds it into
// SimulationModePanel's own `prefillTrigger` prop, which fills the form
// WITHOUT auto-running it (the admin reviews/tweaks, then starts it
// themselves) — a direct, explicit choice, not the same thing
// externalTrigger's tap-to-simulate already does.

'use client'

import { useEffect, useState } from 'react'
import { loadActivityLogs, type ActivityLogEntry, type SimulationRunDetails } from '@/lib/activityLog'
import { urgencyTierColor, type FsiLabel } from '@/lib/dashboardData'
import { WEIGHT_SCHEME_LABEL } from '@/lib/fsiFactorData'

const ALERT_LABELS: FsiLabel[] = ['Very Low', 'Low', 'Moderate', 'High', 'Very High']

export interface SimulationPrefill {
  minRate: number
  maxRate: number
  durationHours: number
  scheme: SimulationRunDetails['scheme']
  scenarioName: string
}

// Narrows ActivityLogEntry's discriminated union down to the
// 'simulation_run' member — `.filter()` alone checks actionType at
// runtime but doesn't narrow the array's own TS element type, so entry.details
// would still type as the full union (SimulationRunDetails |
// InvitationCreatedDetails) everywhere below without this.
type SimulationRunEntry = Extract<ActivityLogEntry, { actionType: 'simulation_run' }>
function isSimulationRun(e: ActivityLogEntry): e is SimulationRunEntry {
  return e.actionType === 'simulation_run'
}

export default function AdminReportsTab({ onLoadIntoSimulation }: { onLoadIntoSimulation: (prefill: SimulationPrefill) => void }) {
  const [logs, setLogs] = useState<SimulationRunEntry[] | null>(null)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    let cancelled = false
    loadActivityLogs()
      .then((entries) => {
        if (!cancelled) setLogs(entries.filter(isSimulationRun))
      })
      .catch(() => {
        if (!cancelled) setError('Could not load saved reports.')
      })
    return () => {
      cancelled = true
    }
  }, [])

  if (error) {
    return <p className="text-sm" style={{ color: '#C0392B' }}>{error}</p>
  }

  if (!logs) {
    return <p className="text-sm" style={{ color: 'var(--text-soft)' }}>Loading reports…</p>
  }

  if (logs.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center gap-2 rounded-lg border py-16 text-center" style={{ borderColor: 'var(--card-border)' }}>
        <h3 className="text-base font-semibold" style={{ color: 'var(--text-strong)' }}>
          No reports yet
        </h3>
        <p className="max-w-sm text-sm" style={{ color: 'var(--text-soft)' }}>
          Every island-wide scenario run from the Rainfall & Scenarios tab is saved here automatically. Run one to see it show up.
        </p>
      </div>
    )
  }

  return (
    <div className="flex flex-col gap-3">
      {logs.map((entry) => {
        const d = entry.details
        return (
          <div key={entry.id} className="rounded-lg border p-4" style={{ borderColor: 'var(--card-border)' }}>
            <div className="flex flex-wrap items-start justify-between gap-2">
              <div>
                <h3 className="text-sm font-semibold" style={{ color: 'var(--text-strong)' }}>
                  {d.scenarioName || 'Untitled scenario'}
                </h3>
                <p className="text-xs" style={{ color: 'var(--text-soft)' }}>
                  {new Date(entry.createdAt).toLocaleString()}
                  {entry.actorLabel ? ` · ${entry.actorLabel}` : ''}
                </p>
              </div>
              <button
                type="button"
                className="bfw-btn shrink-0 rounded-full px-3 py-1.5 text-xs font-semibold"
                onClick={() =>
                  onLoadIntoSimulation({
                    minRate: d.minRate,
                    maxRate: d.maxRate,
                    durationHours: d.durationHours,
                    scheme: d.scheme,
                    scenarioName: d.scenarioName,
                  })
                }
              >
                Load into Simulation Mode
              </button>
            </div>

            <div className="mt-3 flex flex-wrap gap-x-6 gap-y-1 text-xs" style={{ color: 'var(--text-soft)' }}>
              <span>
                Rain: <span style={{ color: 'var(--text-strong)' }}>{d.minRate}–{d.maxRate} mm/hr</span>
              </span>
              <span>
                Duration: <span style={{ color: 'var(--text-strong)' }}>{d.durationHours}h</span>
              </span>
              <span>
                Weighting: <span style={{ color: 'var(--text-strong)' }}>{WEIGHT_SCHEME_LABEL[d.scheme]}</span>
              </span>
            </div>

            <div className="mt-3 grid grid-cols-5 gap-2 text-center">
              {ALERT_LABELS.map((label) => (
                <div key={label}>
                  <div className="text-base font-semibold" style={{ color: urgencyTierColor(label) }}>
                    {d.alertCounts[label] ?? 0}
                  </div>
                  <div className="text-[10px]" style={{ color: 'var(--text-soft)' }}>
                    {label}
                  </div>
                </div>
              ))}
            </div>
          </div>
        )
      })}
    </div>
  )
}
