// components/BarangayDetailPanel.tsx
//
// "Detail Overview" sidebar from the design spec in CLAUDE.md. The
// HAND/TWI/LC factor breakdown and a real per-basin hydrograph CHART called
// for in that spec aren't shown here because barangay_dashboard_data.json
// only carries the combined mean_fsi_score, not the individual factor
// contributions or a Q-vs-time series — add those fields to the pipeline
// output before building either. A labeled hydrograph *placeholder*
// (below) is shown though, directly under the FSI block — a deliberate,
// honest "not yet modeled" corner, not a step toward a fake chart.

import { formatHoursAsCountdown, urgencyTierColor, type Barangay } from '@/lib/dashboardData'

export default function BarangayDetailPanel({ barangay }: { barangay: Barangay | null }) {
  if (!barangay) {
    return (
      <div
        className="flex h-full min-h-[220px] items-center justify-center rounded-xl border p-6 text-center text-sm"
        style={{ background: 'var(--card-bg)', borderColor: 'var(--card-border)', color: 'var(--text-soft)' }}
      >
        Select a barangay to see its modeled countdown and FSI details.
      </div>
    )
  }

  return (
    <div
      className="flex flex-col gap-4 rounded-xl border p-5 shadow-lg backdrop-blur-xl"
      style={{ background: 'var(--card-bg)', borderColor: 'var(--card-border)' }}
    >
      <div>
        <h3 className="text-lg font-semibold" style={{ color: 'var(--text-strong)' }}>
          {barangay.barangay}
        </h3>
        <p className="text-sm" style={{ color: 'var(--text-soft)' }}>{barangay.municipality}</p>
      </div>

      <div className="flex items-center gap-3">
        <span
          className="h-3 w-3 shrink-0 rounded-full"
          style={{ background: urgencyTierColor(barangay.dominant_fsi_label) }}
          aria-hidden
        />
        <div>
          <div className="text-3xl font-bold" style={{ color: 'var(--text-strong)' }}>
            {barangay.dominant_fsi_label}
          </div>
          <div className="text-sm" style={{ color: 'var(--text-soft)' }}>
            flood susceptibility · score {barangay.mean_fsi_score.toFixed(3)}
          </div>
        </div>
      </div>

      {/*
        Directly below the FSI block above — a labeled, honest placeholder
        (dashed border + muted opacity, same visual cue used elsewhere in
        this app for a reserved-but-unavailable feature), not a fabricated
        curve. See the file header comment for why a real chart isn't here.
      */}
      <div
        className="flex items-center gap-3 rounded-lg border border-dashed px-3 py-2"
        style={{ borderColor: 'var(--card-border)', opacity: 0.75 }}
      >
        <span className="h-3 w-3 shrink-0 rounded-full" style={{ background: 'var(--text-soft)' }} aria-hidden />
        <div>
          <div className="text-sm font-semibold uppercase tracking-wide" style={{ color: 'var(--text-soft)' }}>
            Hydrograph
          </div>
          <div className="text-xs" style={{ color: 'var(--text-soft)' }}>
            No basin flow data available yet
          </div>
        </div>
      </div>

      <dl className="grid grid-cols-2 gap-3 text-sm">
        <Stat label="Basins" value={String(barangay.basin_ids.length)} />
        <Stat label="Danger at" value={formatHoursAsCountdown(barangay.danger_time_hours)} />
        <Stat label="Warning at" value={formatHoursAsCountdown(barangay.warning_time_hours)} />
        <Stat label="Alert at" value={formatHoursAsCountdown(barangay.alert_time_hours)} />
      </dl>

      <p className="text-xs" style={{ color: 'var(--text-soft)' }}>
        Times are hours into a modeled design storm, not a live countdown — see the
        banner above for the honesty note on this.
      </p>
    </div>
  )
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <dt className="text-xs" style={{ color: 'var(--text-soft)' }}>{label}</dt>
      <dd className="font-semibold" style={{ color: 'var(--text-strong)' }}>{value}</dd>
    </div>
  )
}
