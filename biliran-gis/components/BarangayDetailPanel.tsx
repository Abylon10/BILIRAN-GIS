// components/BarangayDetailPanel.tsx
//
// "Detail Overview" sidebar from the design spec in CLAUDE.md. The
// HAND/TWI/LC factor breakdown called for in that spec still isn't shown
// here because barangay_dashboard_data.json only carries the combined
// mean_fsi_score, not the individual factor contributions — that part is
// still genuinely blocked (see CLAUDE.md).
//
// The hydrograph is real now: public/data/basin_hydrographs.json (real
// island-wide per-basin runoff, see CLAUDE.md for full provenance) is
// fetched lazily and rendered as a hand-rolled inline SVG chart for the
// 113 barangays with basin overlap. The 2 barangays with none (Kawayan/
// Burabod, Kawayan/Poblacion — verified zero pixel overlap, a real
// absence of river risk, not a data gap) keep the same honest dashed
// placeholder this corner has always shown.

'use client'

import { useEffect, useState } from 'react'
import { formatHoursAsCountdown, urgencyTierColor, type Barangay } from '@/lib/dashboardData'
import { loadBasinHydrographs, hydrographForBarangay, type PrimaryHydrograph, type StormParams } from '@/lib/hydrographData'

interface HydrographEntry {
  key: string
  hydrograph: PrimaryHydrograph | null
  stormParams: StormParams
}

export default function BarangayDetailPanel({ barangay }: { barangay: Barangay | null }) {
  // Keyed by barangay.key rather than reset-on-effect-entry, so switching
  // barangays never needs a synchronous setState at the top of the effect
  // (which would otherwise cause a redundant extra render on every switch).
  // A stale entry (key mismatch) is treated as "still loading" for the
  // barangay now selected.
  const [entry, setEntry] = useState<HydrographEntry | null>(null)
  const [failedKey, setFailedKey] = useState<string | null>(null)

  useEffect(() => {
    if (!barangay) return
    let cancelled = false

    loadBasinHydrographs()
      .then((data) => {
        if (cancelled) return
        setEntry({ key: barangay.key, hydrograph: hydrographForBarangay(data, barangay.key), stormParams: data.storm_params })
      })
      .catch(() => {
        if (cancelled) return
        setFailedKey(barangay.key)
      })

    return () => {
      cancelled = true
    }
  }, [barangay])

  const isCurrent = barangay != null && entry?.key === barangay.key
  const hasFailed = barangay != null && failedKey === barangay.key

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

      {isCurrent && entry?.hydrograph ? (
        <HydrographChart hydrograph={entry.hydrograph} stormParams={entry.stormParams} />
      ) : (
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
              {hasFailed
                ? 'Could not load basin flow data.'
                : !isCurrent
                  ? 'Loading basin flow data…'
                  : 'No basin flow data available for this barangay'}
            </div>
          </div>
        </div>
      )}

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

function HydrographChart({
  hydrograph,
  stormParams,
}: {
  hydrograph: PrimaryHydrograph
  stormParams: StormParams
}) {
  const width = 280
  const height = 90
  const padLeft = 28
  const padBottom = 14
  const padTop = 6
  const plotW = width - padLeft
  const plotH = height - padBottom - padTop

  const maxTime = hydrograph.timeHours[hydrograph.timeHours.length - 1] || 1
  const maxQ = Math.max(...hydrograph.q, 0.001)

  const points = hydrograph.timeHours
    .map((t, i) => {
      const x = padLeft + (t / maxTime) * plotW
      const y = padTop + plotH - (hydrograph.q[i] / maxQ) * plotH
      return `${x.toFixed(1)},${y.toFixed(1)}`
    })
    .join(' ')

  const peakQ = maxQ.toFixed(1)

  return (
    <div
      className="flex flex-col gap-2 rounded-lg border px-3 py-2"
      style={{ borderColor: 'var(--card-border)' }}
    >
      <div className="flex items-center justify-between">
        <div className="text-sm font-semibold uppercase tracking-wide" style={{ color: 'var(--text-soft)' }}>
          Hydrograph
        </div>
        <div className="text-xs" style={{ color: 'var(--text-soft)' }}>
          basin {hydrograph.basinId} · peak {peakQ} m³/s
        </div>
      </div>

      <svg viewBox={`0 0 ${width} ${height}`} width="100%" height={height} role="img" aria-label="Basin discharge over time">
        <line x1={padLeft} y1={padTop} x2={padLeft} y2={padTop + plotH} stroke="var(--card-border)" strokeWidth={1} />
        <line x1={padLeft} y1={padTop + plotH} x2={width} y2={padTop + plotH} stroke="var(--card-border)" strokeWidth={1} />
        <polyline points={points} fill="none" stroke="#3B82C4" strokeWidth={1.5} />
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
        {`Modeled from a single synthetic ${stormParams.duration_hours}-hour design storm, ${stormParams.peak_mm_hr}mm/hr peak.`}
      </div>
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
