// components/BarangayDetailPanel.tsx
//
// "Detail Overview" sidebar from the design spec in CLAUDE.md.
//
// The hydrograph is real now: public/data/basin_hydrographs.json (real
// island-wide per-basin runoff, see CLAUDE.md for full provenance) is
// fetched lazily and rendered as a hand-rolled inline SVG chart for the
// 113 barangays with basin overlap. The 2 barangays with none (Kawayan/
// Burabod, Kawayan/Poblacion — verified zero pixel overlap, a real
// absence of river risk, not a data gap) keep the same honest dashed
// placeholder this corner has always shown.
//
// The HAND/TWI/LC/rainfall factor breakdown is real too now:
// public/data/fsi_factors.json (zonal-averaged from the pipeline's aligned
// rasters, see CLAUDE.md for provenance, known approximations, and the
// validation against mean_fsi_score). fsi_recomputed there is a
// supplementary approximation — mean_fsi_score above stays authoritative.

'use client'

import { useEffect, useState } from 'react'
import { formatHoursAsCountdown, urgencyTierColor, type Barangay } from '@/lib/dashboardData'
import { loadBasinHydrographs, hydrographForBarangay, type PrimaryHydrograph, type StormParams } from '@/lib/hydrographData'
import { loadFsiFactors, factorsForBarangay, type BarangayFactors } from '@/lib/fsiFactorData'
import DischargeChart from '@/components/DischargeChart'

interface HydrographEntry {
  key: string
  hydrograph: PrimaryHydrograph | null
  stormParams: StormParams
}

interface FactorEntry {
  key: string
  factors: BarangayFactors | null
}

export default function BarangayDetailPanel({ barangay }: { barangay: Barangay | null }) {
  // Keyed by barangay.key rather than reset-on-effect-entry, so switching
  // barangays never needs a synchronous setState at the top of the effect
  // (which would otherwise cause a redundant extra render on every switch).
  // A stale entry (key mismatch) is treated as "still loading" for the
  // barangay now selected.
  const [entry, setEntry] = useState<HydrographEntry | null>(null)
  const [failedKey, setFailedKey] = useState<string | null>(null)
  const [factorEntry, setFactorEntry] = useState<FactorEntry | null>(null)

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

    loadFsiFactors()
      .then((data) => {
        if (cancelled) return
        setFactorEntry({ key: barangay.key, factors: factorsForBarangay(data, barangay.key) })
      })
      .catch(() => {
        // Supplementary data — no dedicated error UI, same as "not available".
      })

    return () => {
      cancelled = true
    }
  }, [barangay])

  const isCurrent = barangay != null && entry?.key === barangay.key
  const hasFailed = barangay != null && failedKey === barangay.key
  const isFactorsCurrent = barangay != null && factorEntry?.key === barangay.key

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
        <DischargeChart
          timeHours={entry.hydrograph.timeHours}
          q={entry.hydrograph.q}
          title="Hydrograph"
          metaLabel={`basin ${entry.hydrograph.basinId} · peak ${Math.max(...entry.hydrograph.q, 0.001).toFixed(1)} m³/s`}
          captionText={`Modeled from a single synthetic ${entry.stormParams.duration_hours}-hour design storm, ${entry.stormParams.peak_mm_hr}mm/hr peak.`}
        />
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

      {isFactorsCurrent && factorEntry?.factors && (
        <FactorBreakdown factors={factorEntry.factors} />
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

function FactorBreakdown({ factors }: { factors: BarangayFactors }) {
  const rows: { label: string; value: number }[] = [
    { label: 'HAND (elevation above drainage)', value: factors.hand },
    { label: 'TWI (wetness index)', value: factors.twi },
    { label: 'Land cover runoff', value: factors.lclu },
    { label: '6-hour rainfall forecast', value: factors.rainfall },
  ]

  return (
    <div
      className="flex flex-col gap-2 rounded-lg border px-3 py-2"
      style={{ borderColor: 'var(--card-border)' }}
    >
      <div className="text-sm font-semibold uppercase tracking-wide" style={{ color: 'var(--text-soft)' }}>
        Factor breakdown
      </div>
      <div className="flex flex-col gap-1.5">
        {rows.map((row) => (
          <div key={row.label} className="flex items-center gap-2">
            <div className="w-36 shrink-0 text-xs" style={{ color: 'var(--text-soft)' }}>
              {row.label}
            </div>
            <div className="h-2 flex-1 overflow-hidden rounded-full" style={{ background: 'var(--card-border)' }}>
              <div
                className="h-full rounded-full"
                style={{ width: `${Math.round(row.value * 100)}%`, background: '#3B82C4' }}
              />
            </div>
            <div className="w-9 shrink-0 text-right text-xs" style={{ color: 'var(--text-soft)' }}>
              {row.value.toFixed(2)}
            </div>
          </div>
        ))}
      </div>
      <div className="text-[10px]" style={{ color: 'var(--text-soft)' }}>
        Each factor normalized 0-1 across the island; an approximate breakdown, not a
        replacement for the score above.
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
