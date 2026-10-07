// components/DischargeChart.tsx
//
// Hand-rolled inline SVG discharge-vs-time chart. Originally lived inline
// in BarangayDetailPanel.tsx as the real hydrograph's renderer; extracted
// so Simulation Mode's recomputed curve can reuse the exact same chart
// (same axes/shape), just with a distinct color and caption — making the
// real and simulated curves directly, visually comparable.

import { useState } from 'react'

export default function DischargeChart({
  timeHours,
  q,
  title,
  metaLabel,
  captionText,
  color = '#3B82C4',
  ariaLabel = 'Basin discharge over time',
  infoText,
}: {
  timeHours: number[]
  q: number[]
  title: string
  metaLabel: string
  captionText: string
  color?: string
  ariaLabel?: string
  // Optional plain-language explainer shown via a small "?" button next to
  // the title — omit it (the real hydrograph/precipitation charts are the
  // only callers that pass it, by direct request) to render no button at
  // all, same as before this prop existed. Same tap-to-toggle, inline-
  // expand-below convention as FactorBreakdown's own "?" buttons just
  // below in this file's caller (BarangayDetailPanel.tsx) — reusing that
  // established pattern instead of inventing a new floating-popover one.
  infoText?: string
}) {
  const width = 280
  const height = 90
  const padLeft = 28
  const padBottom = 14
  const padTop = 6
  const plotW = width - padLeft
  const plotH = height - padBottom - padTop

  const maxTime = timeHours[timeHours.length - 1] || 1
  const maxQ = Math.max(...q, 0.001)

  const points = timeHours
    .map((t, i) => {
      const x = padLeft + (t / maxTime) * plotW
      const y = padTop + plotH - (q[i] / maxQ) * plotH
      return `${x.toFixed(1)},${y.toFixed(1)}`
    })
    .join(' ')

  const [showInfo, setShowInfo] = useState(false)

  return (
    <div className="flex flex-col gap-2 rounded-lg border px-3 py-2" style={{ borderColor: 'var(--card-border)' }}>
      <div className="flex items-center justify-between gap-2">
        <div className="flex min-w-0 items-center gap-1.5">
          <div className="truncate text-sm font-semibold uppercase tracking-wide" style={{ color: 'var(--text-soft)' }}>
            {title}
          </div>
          {infoText && (
            <button
              type="button"
              onClick={() => setShowInfo((v) => !v)}
              aria-expanded={showInfo}
              aria-label={`What is ${title}?`}
              className="flex h-4 w-4 shrink-0 items-center justify-center rounded-full border text-[9px] font-bold"
              style={{
                borderColor: 'var(--card-border)',
                color: showInfo ? 'var(--card-bg)' : 'var(--text-soft)',
                background: showInfo ? 'var(--text-soft)' : 'transparent',
              }}
            >
              ?
            </button>
          )}
        </div>
        <div className="shrink-0 text-xs" style={{ color: 'var(--text-soft)' }}>
          {metaLabel}
        </div>
      </div>

      {showInfo && infoText && (
        <div className="rounded-md px-2 py-1.5 text-[10px] leading-snug" style={{ background: 'var(--card-border)', color: 'var(--text-soft)' }}>
          {infoText}
        </div>
      )}

      <svg viewBox={`0 0 ${width} ${height}`} width="100%" height={height} role="img" aria-label={ariaLabel}>
        <line x1={padLeft} y1={padTop} x2={padLeft} y2={padTop + plotH} stroke="var(--card-border)" strokeWidth={1} />
        <line x1={padLeft} y1={padTop + plotH} x2={width} y2={padTop + plotH} stroke="var(--card-border)" strokeWidth={1} />
        <polyline points={points} fill="none" stroke={color} strokeWidth={1.5} />
        <text x={0} y={padTop + 5} fontSize={8} fill="var(--text-soft)">
          {maxQ.toFixed(0)}
        </text>
        <text x={0} y={padTop + plotH + 4} fontSize={8} fill="var(--text-soft)">
          0
        </text>
        <text x={padLeft} y={height} fontSize={8} fill="var(--text-soft)">
          0h
        </text>
        <text x={width - 16} y={height} fontSize={8} fill="var(--text-soft)">
          {maxTime.toFixed(1)}h
        </text>
      </svg>

      <div className="text-[10px]" style={{ color: 'var(--text-soft)' }}>
        {captionText}
      </div>
    </div>
  )
}
