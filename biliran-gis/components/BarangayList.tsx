// components/BarangayList.tsx
//
// Barangay list ranked by flood susceptibility, highest first (see
// sortBySeverity in lib/dashboardData.ts). Complements BiliranMap — the map
// shows where, this shows the ranking as a scannable list.

import { useRef } from 'react'
import { formatHoursAsCountdown, urgencyTierColor, type Barangay } from '@/lib/dashboardData'

// Must stay comfortably shorter than app/page.tsx's own
// BARANGAY_SELECT_COMPACT_DELAY_MS — see the onClick handler below for why.
const DOUBLE_TAP_WINDOW_MS = 350

export default function BarangayList({
  barangays,
  selectedKey,
  onSelect,
  onSelectMunicipality,
}: {
  barangays: Barangay[]
  selectedKey: string | null
  onSelect: (barangay: Barangay) => void
  // Double-tap/double-click a row: filters the list down to that
  // barangay's own municipality (same effect as picking it from the
  // filter dropdown above) — a single tap still just selects+focuses the
  // barangay as before.
  //
  // Detected manually (tracking which key was last clicked and when),
  // NOT via the browser's native onDoubleClick — the first tap of a
  // double-tap already selects the barangay, which (see
  // BARANGAY_SELECT_COMPACT_DELAY_MS in app/page.tsx) compacts the map
  // and moves this whole list from below the map to beside it after a
  // short delay. Native dblclick is a *position*-based browser gesture:
  // confirmed via Playwright that if that reflow happened before the
  // second physical click landed, the second click would hit a
  // completely different row, misfiring the filter against the wrong
  // municipality. Tracking by row *key* instead of screen position is
  // immune to that — it only fires once the same button is clicked twice
  // within the window, regardless of what moved around it — and the
  // matching page.tsx delay keeps the row stationary for that whole
  // window in the first place.
  onSelectMunicipality?: (municipality: string) => void
}) {
  const lastClickRef = useRef<{ key: string; time: number } | null>(null)
  if (barangays.length === 0) {
    return (
      <p className="px-1 py-6 text-center text-sm" style={{ color: 'var(--text-soft)' }}>
        No barangays match your search.
      </p>
    )
  }

  return (
    <ul className="flex flex-col gap-2">
      {barangays.map((b, i) => {
        const selected = b.key === selectedKey
        return (
          <li key={b.key}>
            <button
              type="button"
              onClick={() => {
                const now = Date.now()
                const last = lastClickRef.current
                if (last && last.key === b.key && now - last.time < DOUBLE_TAP_WINDOW_MS) {
                  lastClickRef.current = null
                  onSelectMunicipality?.(b.municipality)
                  return
                }
                lastClickRef.current = { key: b.key, time: now }
                onSelect(b)
              }}
              className="flex w-full items-center gap-3 rounded-lg border px-3 py-2.5 text-left transition-colors"
              style={{
                background: selected ? 'rgba(232, 163, 61, 0.28)' : 'var(--card-bg)',
                borderColor: selected ? '#E8A33D' : 'var(--card-border)',
              }}
            >
              <span
                className="w-5 shrink-0 text-center text-xs font-semibold"
                style={{ color: 'var(--text-soft)' }}
                aria-hidden
              >
                {i + 1}
              </span>
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
                {b.mean_fsi_score.toFixed(2)}
                <span className="block font-normal" style={{ color: 'var(--text-soft)' }}>
                  {formatHoursAsCountdown(b.danger_time_hours)} to Danger
                </span>
              </span>
            </button>
          </li>
        )
      })}
    </ul>
  )
}
