// components/AdminActivityLogTab.tsx
//
// The admin shell's "Activity Logs" tab (components/AdminShell.tsx) —
// replaces the old AdminComingSoonTab placeholder. Shows EVERY row from
// the same shared log AdminReportsTab.tsx filters down to
// simulation-run scenario cards — here, as a compact, one-line-per-entry
// audit trail instead (timestamp, actor, summary), matching this table's
// own forward-compatible design (see supabase/activity-logs-setup.sql's
// header comment: only `action_type = 'simulation_run'` exists today, but
// the table/this list are both built to show other action types later
// without changes here).
//
// Tapping a row loads that scenario into Simulation Mode too — same
// onLoadIntoSimulation callback AdminReportsTab.tsx uses, same
// load-don't-auto-run behavior (see SimulationModePanel.tsx's own
// `prefillTrigger` prop comment). Only rows whose actionType is
// 'simulation_run' are tappable — a future non-simulation action type
// would show here but render as plain, non-interactive text instead.

'use client'

import { useEffect, useState } from 'react'
import { loadActivityLogs, type ActivityLogEntry } from '@/lib/activityLog'
import type { SimulationPrefill } from '@/components/AdminReportsTab'

export default function AdminActivityLogTab({ onLoadIntoSimulation }: { onLoadIntoSimulation: (prefill: SimulationPrefill) => void }) {
  const [logs, setLogs] = useState<ActivityLogEntry[] | null>(null)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    let cancelled = false
    loadActivityLogs()
      .then((entries) => {
        if (!cancelled) setLogs(entries)
      })
      .catch(() => {
        if (!cancelled) setError('Could not load activity logs.')
      })
    return () => {
      cancelled = true
    }
  }, [])

  if (error) {
    return <p className="text-sm" style={{ color: '#C0392B' }}>{error}</p>
  }

  if (!logs) {
    return <p className="text-sm" style={{ color: 'var(--text-soft)' }}>Loading activity…</p>
  }

  if (logs.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center gap-2 rounded-lg border py-16 text-center" style={{ borderColor: 'var(--card-border)' }}>
        <h3 className="text-base font-semibold" style={{ color: 'var(--text-strong)' }}>
          No activity yet
        </h3>
        <p className="max-w-sm text-sm" style={{ color: 'var(--text-soft)' }}>
          Admin actions (starting with island-wide simulation runs) are logged here automatically as they happen.
        </p>
      </div>
    )
  }

  return (
    <div className="flex flex-col divide-y rounded-lg border" style={{ borderColor: 'var(--card-border)' }}>
      {logs.map((entry) => {
        const tappable = entry.actionType === 'simulation_run'
        const row = (
          <div className="flex flex-wrap items-center justify-between gap-x-4 gap-y-1 px-4 py-3 text-sm">
            <div className="min-w-0">
              <span style={{ color: 'var(--text-strong)' }}>{entry.summary}</span>
              {entry.actorLabel && (
                <span className="ml-2 text-xs" style={{ color: 'var(--text-soft)' }}>
                  — {entry.actorLabel}
                </span>
              )}
            </div>
            <span className="shrink-0 text-xs" style={{ color: 'var(--text-soft)' }}>
              {new Date(entry.createdAt).toLocaleString()}
            </span>
          </div>
        )

        if (!tappable) {
          return (
            <div key={entry.id} style={{ borderColor: 'var(--card-border)' }}>
              {row}
            </div>
          )
        }

        const d = entry.details
        return (
          <button
            key={entry.id}
            type="button"
            className="text-left transition-colors hover:brightness-95"
            style={{ borderColor: 'var(--card-border)' }}
            onClick={() =>
              onLoadIntoSimulation({
                minRate: d.minRate,
                maxRate: d.maxRate,
                durationHours: d.durationHours,
                scheme: d.scheme,
                scenarioName: d.scenarioName,
              })
            }
            title="Load this scenario into Simulation Mode"
          >
            {row}
          </button>
        )
      })}
    </div>
  )
}
