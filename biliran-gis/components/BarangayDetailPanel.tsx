// components/BarangayDetailPanel.tsx
//
// "Detail Overview" sidebar from the design spec in CLAUDE.md. The
// HAND/TWI/LC factor breakdown and per-basin hydrograph called for in that
// spec aren't shown here because barangay_dashboard_data.json only carries
// the combined mean_fsi_score, not the individual factor contributions or
// a Q-vs-time series — add those fields to the pipeline output before
// building that part.

import { formatHoursAsCountdown, type Barangay } from '@/lib/dashboardData'

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

      <div>
        <div className="text-3xl font-bold" style={{ color: 'var(--text-strong)' }}>
          {formatHoursAsCountdown(barangay.danger_time_hours)}
        </div>
        <div className="text-sm" style={{ color: 'var(--text-soft)' }}>
          to Danger · {barangay.dominant_fsi_label} susceptibility
        </div>
      </div>

      <dl className="grid grid-cols-2 gap-3 text-sm">
        <Stat label="FSI score" value={barangay.mean_fsi_score.toFixed(3)} />
        <Stat label="Basins" value={String(barangay.basin_ids.length)} />
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
