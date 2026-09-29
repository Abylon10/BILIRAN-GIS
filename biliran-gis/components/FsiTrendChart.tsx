// components/FsiTrendChart.tsx
//
// Hand-rolled inline SVG line chart for the admin Dashboard tab's "FSI
// Trend" panel — same polyline technique as components/DischargeChart.tsx
// (this repo's own "no charting library" convention), just a date x-axis
// and a fixed [0, 1] FSI y-axis instead of hours/discharge. Fed by
// lib/fsiTrend.ts's fetchFsiHistory(), which only ever returns real rows
// from public.fsi_daily_snapshots — this chart never invents points, so a
// short history (as few as one day, right after the table is first
// created) is expected and rendered honestly, not padded.

import type { FsiSnapshot } from '@/lib/fsiTrend'
import { fsiScoreColor } from '@/lib/dashboardData'

function formatShortDate(dateStr: string): string {
  const d = new Date(`${dateStr}T00:00:00`)
  return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' })
}

export default function FsiTrendChart({ snapshots }: { snapshots: FsiSnapshot[] }) {
  const width = 560
  const height = 160
  const padLeft = 32
  const padBottom = 20
  const padTop = 10
  const plotW = width - padLeft - 8
  const plotH = height - padBottom - padTop

  if (snapshots.length === 0) {
    return (
      <div className="flex flex-col gap-2 rounded-lg border px-3 py-2" style={{ borderColor: 'var(--card-border)' }}>
        <div className="text-sm font-semibold uppercase tracking-wide" style={{ color: 'var(--text-soft)' }}>
          FSI Trend
        </div>
        <div className="text-xs" style={{ color: 'var(--text-soft)' }}>
          No snapshots recorded yet — one is saved automatically each day this tab is viewed. Check back tomorrow to
          see the first two points.
        </div>
      </div>
    )
  }

  const latest = snapshots[snapshots.length - 1]
  const maxIndex = Math.max(snapshots.length - 1, 1)

  const points = snapshots
    .map((s, i) => {
      const x = padLeft + (i / maxIndex) * plotW
      const y = padTop + plotH - Math.min(Math.max(s.avg_fsi, 0), 1) * plotH
      return `${x.toFixed(1)},${y.toFixed(1)}`
    })
    .join(' ')

  return (
    <div className="flex flex-col gap-2 rounded-lg border px-3 py-2" style={{ borderColor: 'var(--card-border)' }}>
      <div className="flex items-center justify-between">
        <div className="text-sm font-semibold uppercase tracking-wide" style={{ color: 'var(--text-soft)' }}>
          FSI Trend
        </div>
        <div className="text-xs" style={{ color: 'var(--text-soft)' }}>
          latest {latest.avg_fsi.toFixed(2)} · {latest.high_risk_count} high-risk · {latest.source}
        </div>
      </div>

      <svg viewBox={`0 0 ${width} ${height}`} width="100%" height={height} role="img" aria-label="Average FSI over time">
        <line x1={padLeft} y1={padTop} x2={padLeft} y2={padTop + plotH} stroke="var(--card-border)" strokeWidth={1} />
        <line
          x1={padLeft}
          y1={padTop + plotH}
          x2={width}
          y2={padTop + plotH}
          stroke="var(--card-border)"
          strokeWidth={1}
        />
        {snapshots.length > 1 && <polyline points={points} fill="none" stroke={fsiScoreColor(latest.avg_fsi)} strokeWidth={1.5} />}
        {snapshots.map((s, i) => {
          const x = padLeft + (i / maxIndex) * plotW
          const y = padTop + plotH - Math.min(Math.max(s.avg_fsi, 0), 1) * plotH
          return <circle key={s.snapshot_date} cx={x} cy={y} r={2.5} fill={fsiScoreColor(s.avg_fsi)} />
        })}
        <text x={0} y={padTop + 5} fontSize={9} fill="var(--text-soft)">
          1.0
        </text>
        <text x={0} y={padTop + plotH + 4} fontSize={9} fill="var(--text-soft)">
          0.0
        </text>
        <text x={padLeft} y={height} fontSize={9} fill="var(--text-soft)">
          {formatShortDate(snapshots[0].snapshot_date)}
        </text>
        <text x={width - 40} y={height} fontSize={9} fill="var(--text-soft)">
          {formatShortDate(latest.snapshot_date)}
        </text>
      </svg>

      <div className="text-[10px]" style={{ color: 'var(--text-soft)' }}>
        One real point per calendar date, recorded automatically the first time this tab is viewed that day — never
        backfilled or estimated for earlier dates.
      </div>
    </div>
  )
}
