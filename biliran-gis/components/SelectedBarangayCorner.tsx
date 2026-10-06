// components/SelectedBarangayCorner.tsx
//
// A small, compact "quick glance" card for the currently-selected
// barangay — shown on the full-bleed map (app/page.tsx) whenever
// something is selected and the full sidebar is closed, so its FSI
// score/class/countdown is visible without opening the sidebar at all.
// Tapping it opens the full sidebar for the complete picture (hydrograph/
// precipitation charts, factor breakdown — see BarangayDetailPanel.tsx).
//
// Deliberately simpler than the admin dashboard's own SelectedBarangayCard
// (components/UserDashboardModal.tsx) — no thumbnail map, no simulation
// fields, both admin-only concepts — but follows the same established
// spirit: a compact summary card kept separate from the full detail panel,
// not one component trying to do both.

import { formatHoursAsCountdown, urgencyTierColor, type Barangay } from '@/lib/dashboardData'

export default function SelectedBarangayCorner({
  barangay,
  onExpand,
}: {
  barangay: Barangay
  onExpand: () => void
}) {
  return (
    <button
      type="button"
      onClick={onExpand}
      aria-label={`View full details for ${barangay.barangay}`}
      className="bfw-selected-corner fixed right-5 top-1/2 z-[18] w-full max-w-[260px] -translate-y-1/2 rounded-xl border p-3 text-left shadow-lg backdrop-blur-xl"
      style={{ background: 'var(--card-bg)', borderColor: 'var(--card-border)' }}
    >
      <style>{`
        @keyframes bfw-selected-corner-in {
          from { opacity: 0; transform: translateY(-50%) translateX(16px); }
          to { opacity: 1; transform: translateY(-50%) translateX(0); }
        }
        .bfw-selected-corner { animation: bfw-selected-corner-in 300ms cubic-bezier(0.22,1,0.36,1); }
        @media (prefers-reduced-motion: reduce) {
          .bfw-selected-corner { animation: none !important; }
        }
      `}</style>

      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="truncate text-sm font-semibold" style={{ color: 'var(--text-strong)' }}>
            {barangay.barangay}
          </p>
          <p className="truncate text-xs" style={{ color: 'var(--text-soft)' }}>{barangay.municipality}</p>
        </div>
        <div className="shrink-0 text-right">
          <span className="text-base font-semibold" style={{ color: 'var(--text-strong)' }}>
            {barangay.mean_fsi_score.toFixed(2)}
          </span>
          <span
            className="ml-1.5 rounded-full px-1.5 py-0.5 text-[10px] font-semibold"
            style={{ background: `${urgencyTierColor(barangay.dominant_fsi_label)}33`, color: urgencyTierColor(barangay.dominant_fsi_label) }}
          >
            {barangay.dominant_fsi_label}
          </span>
        </div>
      </div>
      <div className="mt-1 text-xs" style={{ color: 'var(--text-soft)' }}>
        {formatHoursAsCountdown(barangay.danger_time_hours)} to Danger
      </div>
      <div className="mt-2 text-[11px] font-medium underline decoration-dotted underline-offset-2" style={{ color: 'var(--text-soft)' }}>
        View full details →
      </div>
    </button>
  )
}
