// components/BarangayList.tsx
//
// Urgency-sorted list of barangays ("Most Urgent Barangays" in the design
// spec). Stands in for a choropleth map for now — plotting real barangay
// boundaries needs barangay_biliran.geojson, which isn't in this repo (see
// CLAUDE.md).

import { formatHoursAsCountdown, urgencyTierColor, type Barangay } from '@/lib/dashboardData'

export default function BarangayList({
  barangays,
  selectedKey,
  onSelect,
}: {
  barangays: Barangay[]
  selectedKey: string | null
  onSelect: (barangay: Barangay) => void
}) {
  if (barangays.length === 0) {
    return (
      <p className="px-1 py-6 text-center text-sm" style={{ color: 'var(--text-soft)' }}>
        No barangays match your search.
      </p>
    )
  }

  return (
    <ul className="flex flex-col gap-2">
      {barangays.map((b) => {
        const selected = b.key === selectedKey
        return (
          <li key={b.key}>
            <button
              type="button"
              onClick={() => onSelect(b)}
              className="flex w-full items-center gap-3 rounded-lg border px-3 py-2.5 text-left transition-colors"
              style={{
                background: selected ? 'rgba(232, 163, 61, 0.28)' : 'var(--card-bg)',
                borderColor: selected ? '#E8A33D' : 'var(--card-border)',
              }}
            >
              <span
                aria-hidden
                className="h-2.5 w-2.5 shrink-0 rounded-full"
                style={{ background: urgencyTierColor(b.dominant_fsi_label) }}
              />
              <span className="min-w-0 flex-1">
                <span className="block truncate text-sm font-medium" style={{ color: 'var(--text-strong)' }}>
                  {b.barangay}
                </span>
                <span className="block truncate text-xs" style={{ color: 'var(--text-soft)' }}>
                  {b.municipality} · {b.dominant_fsi_label}
                </span>
              </span>
              <span className="shrink-0 text-right text-xs font-semibold" style={{ color: 'var(--text-strong)' }}>
                {formatHoursAsCountdown(b.danger_time_hours)}
                <span className="block font-normal" style={{ color: 'var(--text-soft)' }}>
                  to Danger
                </span>
              </span>
            </button>
          </li>
        )
      })}
    </ul>
  )
}
