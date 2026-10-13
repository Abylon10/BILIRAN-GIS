// components/DischargeChart.tsx
//
// Hand-rolled inline SVG discharge-vs-time chart. Originally lived inline
// in BarangayDetailPanel.tsx as the real hydrograph's renderer; extracted
// so Simulation Mode's recomputed curve can reuse the exact same chart
// (same axes/shape), just with a distinct color and caption — making the
// real and simulated curves directly, visually comparable.

import { useRef, useState } from 'react'

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
  // Bigger canvas than the original 280x90 — the old size left no real
  // room for gridlines/tick labels without cramming, reported directly as
  // "make the graph clearer and easy to understand".
  const width = 300
  const height = 150
  const padLeft = 32
  const padBottom = 20
  const padTop = 10
  const plotW = width - padLeft
  const plotH = height - padTop - padBottom

  const maxTime = timeHours[timeHours.length - 1] || 1
  const maxQ = Math.max(...q, 0.001)

  const xOf = (t: number) => padLeft + (t / maxTime) * plotW
  const yOf = (v: number) => padTop + plotH - (v / maxQ) * plotH

  const points = timeHours.map((t, i) => `${xOf(t).toFixed(1)},${yOf(q[i]).toFixed(1)}`).join(' ')
  const areaPoints = `${xOf(0).toFixed(1)},${yOf(0).toFixed(1)} ${points} ${xOf(maxTime).toFixed(1)},${yOf(0).toFixed(1)}`

  const peakIndex = q.reduce((best, v, i) => (v > q[best] ? i : best), 0)
  const peakX = xOf(timeHours[peakIndex])
  const peakY = yOf(q[peakIndex])

  // 3 recessive horizontal gridlines (0, mid, max) with real tick labels,
  // instead of the original's bare top/bottom-only numbers.
  const yTicks = [0, maxQ / 2, maxQ]
  // Evenly-spaced x-axis ticks instead of just the two endpoints.
  const xTickCount = 4
  const xTicks = Array.from({ length: xTickCount + 1 }, (_, i) => (maxTime * i) / xTickCount)

  const [showInfo, setShowInfo] = useState(false)
  const [hoverIndex, setHoverIndex] = useState<number | null>(null)
  const svgRef = useRef<SVGSVGElement>(null)

  function nearestIndexForClientX(clientX: number): number {
    const svg = svgRef.current
    if (!svg || timeHours.length === 0) return 0
    const rect = svg.getBoundingClientRect()
    // Map the pointer's screen position into the SVG's own viewBox units —
    // needed because the SVG is scaled to 100% width, so screen pixels and
    // viewBox units aren't 1:1.
    const svgX = ((clientX - rect.left) / rect.width) * width
    const t = Math.min(maxTime, Math.max(0, ((svgX - padLeft) / plotW) * maxTime))
    let nearest = 0
    let bestDist = Infinity
    for (let i = 0; i < timeHours.length; i++) {
      const dist = Math.abs(timeHours[i] - t)
      if (dist < bestDist) {
        bestDist = dist
        nearest = i
      }
    }
    return nearest
  }

  const hovered = hoverIndex != null ? { t: timeHours[hoverIndex], v: q[hoverIndex] } : null

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

      <svg
        ref={svgRef}
        viewBox={`0 0 ${width} ${height}`}
        width="100%"
        height={height}
        role="img"
        aria-label={ariaLabel}
        onPointerMove={(e) => setHoverIndex(nearestIndexForClientX(e.clientX))}
        onPointerLeave={() => setHoverIndex(null)}
        style={{ touchAction: 'none' }}
      >
        {/* Recessive gridlines + y-axis tick labels (0, mid, max) */}
        {yTicks.map((v) => (
          <g key={v}>
            <line
              x1={padLeft}
              x2={width}
              y1={yOf(v)}
              y2={yOf(v)}
              stroke="var(--card-border)"
              strokeWidth={1}
              opacity={0.6}
            />
            <text x={padLeft - 6} y={yOf(v) + 3} textAnchor="end" fontSize={8} fill="var(--text-soft)">
              {v.toFixed(v < 1 ? 2 : 0)}
            </text>
          </g>
        ))}

        {/* x-axis tick labels, evenly spaced instead of just the endpoints */}
        {xTicks.map((t, i) => (
          <text
            key={t}
            x={xOf(t)}
            y={height - 4}
            textAnchor={i === 0 ? 'start' : i === xTicks.length - 1 ? 'end' : 'middle'}
            fontSize={8}
            fill="var(--text-soft)"
          >
            {t.toFixed(1)}h
          </text>
        ))}

        {/* Subtle area fill under the curve — makes magnitude easier to read at a glance */}
        <polygon points={areaPoints} fill={color} fillOpacity={0.15} stroke="none" />
        <polyline points={points} fill="none" stroke={color} strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" />

        {/* Peak-point marker — the single most important value, already captioned
            elsewhere ("peak X m³/s"/"peak X mm/hr"), now visually findable on the curve itself. */}
        <circle cx={peakX} cy={peakY} r={2.75} fill={color} stroke="var(--card-bg)" strokeWidth={1} />

        {/* Hover: a vertical guide line, a highlighted point at the nearest sample, and a
            small value readout — pinned to the top of the plot (not following the cursor
            vertically) so it never runs off the top of this small canvas. */}
        {hovered && (
          <>
            <line
              x1={xOf(hovered.t)}
              x2={xOf(hovered.t)}
              y1={padTop}
              y2={padTop + plotH}
              stroke="var(--text-soft)"
              strokeWidth={1}
              strokeDasharray="2,2"
            />
            <circle cx={xOf(hovered.t)} cy={yOf(hovered.v)} r={3} fill={color} stroke="var(--card-bg)" strokeWidth={1.5} />
            {(() => {
              const label = `${hovered.t.toFixed(2)}h: ${hovered.v.toFixed(2)}`
              const labelW = label.length * 4.4 + 8
              const labelX = Math.min(Math.max(xOf(hovered.t) - labelW / 2, padLeft), width - labelW)
              return (
                <g>
                  <rect x={labelX} y={padTop - 2} width={labelW} height={13} rx={3} fill="var(--card-bg)" stroke="var(--card-border)" strokeWidth={1} />
                  <text x={labelX + labelW / 2} y={padTop + 7} textAnchor="middle" fontSize={8} fontFamily="monospace" fill="var(--text-strong)">
                    {label}
                  </text>
                </g>
              )
            })()}
          </>
        )}
      </svg>

      <div className="text-[10px]" style={{ color: 'var(--text-soft)' }}>
        {captionText}
      </div>
    </div>
  )
}
