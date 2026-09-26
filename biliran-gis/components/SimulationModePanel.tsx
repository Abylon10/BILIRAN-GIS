// components/SimulationModePanel.tsx
//
// Admin-only "what if" tool: pick min/max rain rate + storm duration for
// the currently selected barangay, recompute its primary basin's
// discharge curve client-side (lib/simulationMode.ts — same basin
// selection and same exact analytical formula the real static
// hydrographs use), and render it next to (never instead of) the real
// data. Purely client-side and ephemeral — nothing here is persisted.

'use client'

import { useEffect, useState } from 'react'
import type { Barangay } from '@/lib/dashboardData'
import { loadBasinHydrographs, hydrographForBarangay } from '@/lib/hydrographData'
import { simulateForBarangay, type SimulatedHydrograph } from '@/lib/simulationMode'
import DischargeChart from '@/components/DischargeChart'

const DEFAULT_MIN_RATE = 5
const DEFAULT_MAX_RATE = 50
const DEFAULT_DURATION_HOURS = 2
const TOTAL_WINDOW_HOURS = 6
const DT_HOURS = 1 / 12 // 5 minutes — matches the real storm's step, so axes line up

interface BasinCheckEntry {
  key: string
  hasBasin: boolean
}

interface ResultEntry {
  key: string
  sim: SimulatedHydrograph | null
}

export default function SimulationModePanel({ barangay }: { barangay: Barangay | null }) {
  const [minRate, setMinRate] = useState(DEFAULT_MIN_RATE)
  const [maxRate, setMaxRate] = useState(DEFAULT_MAX_RATE)
  const [durationHours, setDurationHours] = useState(DEFAULT_DURATION_HOURS)
  // Both keyed by barangay.key rather than reset-on-effect-entry, so
  // switching barangays never needs a synchronous setState at the top of
  // the effect (see the same pattern in BarangayDetailPanel.tsx).
  const [basinCheck, setBasinCheck] = useState<BasinCheckEntry | null>(null)
  const [result, setResult] = useState<ResultEntry | null>(null)

  useEffect(() => {
    if (!barangay) return
    let cancelled = false
    loadBasinHydrographs()
      .then((data) => {
        if (cancelled) return
        setBasinCheck({ key: barangay.key, hasBasin: hydrographForBarangay(data, barangay.key) !== null })
      })
      .catch(() => {
        if (!cancelled) setBasinCheck({ key: barangay.key, hasBasin: false })
      })
    return () => {
      cancelled = true
    }
  }, [barangay])

  if (!barangay) return null

  const isCurrent = basinCheck?.key === barangay.key
  const hasBasin = isCurrent ? basinCheck.hasBasin : null
  const shownResult = result?.key === barangay.key ? result.sim : null

  function runSimulation() {
    if (!barangay) return
    loadBasinHydrographs().then((data) => {
      setResult({ key: barangay.key, sim: simulateForBarangay(data, barangay.key, { minRate, maxRate, durationHours }, DT_HOURS, TOTAL_WINDOW_HOURS) })
    })
  }

  return (
    <div className="flex flex-col gap-3 rounded-xl border p-4" style={{ background: 'var(--card-bg)', borderColor: 'var(--card-border)' }}>
      <div
        className="rounded-lg border px-3 py-2 text-xs"
        style={{ background: 'rgba(184, 134, 11, 0.15)', borderColor: '#B8860B', color: '#F2E4C4' }}
      >
        SIMULATED — not real data. Recomputed client-side from the inputs below using the
        same real per-basin formula the static hydrograph uses, not an actual forecast.
      </div>

      {hasBasin === false ? (
        <p className="text-xs" style={{ color: 'var(--text-soft)' }}>
          {barangay.barangay} has no basin/river data to simulate against.
        </p>
      ) : (
        <>
          <div className="grid grid-cols-3 gap-2">
            <NumberField label="Min rain (mm/hr)" value={minRate} onChange={setMinRate} />
            <NumberField label="Max rain (mm/hr)" value={maxRate} onChange={setMaxRate} />
            <NumberField label="Duration (hr)" value={durationHours} onChange={setDurationHours} step={0.5} />
          </div>

          <button
            type="button"
            className="bfw-btn w-full rounded-md py-2 text-sm font-semibold"
            onClick={runSimulation}
            disabled={hasBasin === null}
          >
            Run simulation
          </button>

          {shownResult && (
            <DischargeChart
              timeHours={shownResult.timeHours}
              q={shownResult.q}
              title="Simulated hydrograph"
              metaLabel={`basin ${shownResult.basinId} · peak ${Math.max(...shownResult.q, 0.001).toFixed(1)} m³/s`}
              captionText={`Simulated: ${minRate}-${maxRate}mm/hr rain, ${durationHours}-hour duration.`}
              color="#D97706"
            />
          )}
        </>
      )}
    </div>
  )
}

function NumberField({
  label,
  value,
  onChange,
  step = 1,
}: {
  label: string
  value: number
  onChange: (value: number) => void
  step?: number
}) {
  return (
    <label className="flex flex-col gap-1 text-xs" style={{ color: 'var(--text-soft)' }}>
      {label}
      <input
        type="number"
        value={value}
        step={step}
        onChange={(e) => onChange(Number(e.target.value))}
        className="rounded-md border px-2 py-1 text-sm"
        style={{ borderColor: 'var(--card-border)', background: 'var(--card-bg)', color: 'var(--text-strong)' }}
      />
    </label>
  )
}
