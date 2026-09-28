// components/SimulationModePanel.tsx
//
// Admin-only "what if" tool, rendered inside UserDashboardModal's
// slide-out sidebar: pick a min/max rain rate + storm duration (capped
// at 12 hours) and run it against the WHOLE island at once
// (lib/islandSimulation.ts) — not just the currently selected barangay.
// Purely client-side and ephemeral — nothing here is persisted.
//
// Doesn't render its own output — "Start simulation" hands the full
// island-wide result map up via onSimulate() instead, so the caller can
// re-rank/re-color the whole dashboard and auto-close this sidebar.
// "Exit" closes without running anything.

'use client'

import { useEffect, useState } from 'react'
import type { Barangay } from '@/lib/dashboardData'
import { loadBasinHydrographs, hydrographForBarangay } from '@/lib/hydrographData'
import { loadFsiFactors } from '@/lib/fsiFactorData'
import { type SimulationParams } from '@/lib/simulationMode'
import { simulateIsland, type IslandSimResult } from '@/lib/islandSimulation'

const DEFAULT_MIN_RATE = 5
const DEFAULT_MAX_RATE = 50
const DEFAULT_DURATION_HOURS = 2
const MAX_DURATION_HOURS = 12
const TOTAL_WINDOW_HOURS = 6
const DT_HOURS = 1 / 12 // 5 minutes — matches the real storm's step, so axes line up

interface BasinCheckEntry {
  key: string
  hasBasin: boolean
}

export default function SimulationModePanel({
  selectedBarangay,
  onExit,
  onSimulate,
}: {
  // Purely informational here now (the "does the currently selected
  // barangay have its own river data" preview line) — the simulation
  // itself always runs island-wide, never gated on a selection.
  selectedBarangay: Barangay | null
  onExit: () => void
  onSimulate: (results: Map<string, IslandSimResult>, params: SimulationParams) => void
}) {
  const [minRate, setMinRate] = useState(DEFAULT_MIN_RATE)
  const [maxRate, setMaxRate] = useState(DEFAULT_MAX_RATE)
  const [durationHours, setDurationHours] = useState(DEFAULT_DURATION_HOURS)
  // Keyed by barangay.key rather than reset-on-effect-entry, so switching
  // barangays never needs a synchronous setState at the top of the effect
  // (see the same pattern in BarangayDetailPanel.tsx).
  const [basinCheck, setBasinCheck] = useState<BasinCheckEntry | null>(null)
  const [running, setRunning] = useState(false)

  useEffect(() => {
    if (!selectedBarangay) return
    let cancelled = false
    loadBasinHydrographs()
      .then((data) => {
        if (cancelled) return
        setBasinCheck({ key: selectedBarangay.key, hasBasin: hydrographForBarangay(data, selectedBarangay.key) !== null })
      })
      .catch(() => {
        if (!cancelled) setBasinCheck({ key: selectedBarangay.key, hasBasin: false })
      })
    return () => {
      cancelled = true
    }
  }, [selectedBarangay])

  const isCurrent = selectedBarangay != null && basinCheck?.key === selectedBarangay.key
  const hasBasin = isCurrent ? basinCheck.hasBasin : null

  // A bad input only used to break one barangay's chart — low stakes. Now
  // it drives the whole island's ranking/FSI/countdowns, so it needs a
  // real guard rather than just letting NaN/negative values flow through.
  const inputsValid = minRate >= 0 && maxRate >= minRate && durationHours > 0

  function runSimulation() {
    if (!inputsValid) return
    setRunning(true)
    const params: SimulationParams = { minRate, maxRate, durationHours }
    Promise.all([loadBasinHydrographs(), loadFsiFactors()]).then(([hydrographData, factorData]) => {
      const results = simulateIsland(hydrographData, factorData, params, DT_HOURS, TOTAL_WINDOW_HOURS)
      setRunning(false)
      onSimulate(results, params)
    })
  }

  return (
    <div className="flex h-full flex-col gap-4">
      <div className="flex items-center justify-between">
        <h3 className="text-sm font-semibold" style={{ color: 'var(--text-strong)' }}>
          Simulation Mode
        </h3>
        <button
          type="button"
          onClick={onExit}
          className="bfw-btn rounded-full px-3 py-1.5 text-xs font-semibold"
        >
          Exit
        </button>
      </div>

      <div
        className="rounded-lg border px-3 py-2 text-xs"
        style={{ background: 'rgba(184, 134, 11, 0.35)', borderColor: '#B8860B', color: '#3D2B00' }}
      >
        SIMULATED — not real data. Runs this storm against the whole island at once:
        countdown times reuse the same real per-basin formula the static hydrographs use;
        FSI scores are an approximate recombination of each barangay&apos;s real terrain
        factors with a scenario-scaled rainfall input, not the authoritative score.
      </div>

      {selectedBarangay && hasBasin === false && (
        <p className="text-xs" style={{ color: 'var(--text-soft)' }}>
          {selectedBarangay.barangay} has no basin/river data — its countdown times won&apos;t
          change, but its FSI estimate still will.
        </p>
      )}

      <div className="flex flex-col gap-3">
        <NumberField label="Min rain (mm/hr)" value={minRate} onChange={setMinRate} />
        <NumberField label="Max rain (mm/hr)" value={maxRate} onChange={setMaxRate} />
        <NumberField
          label={`Duration (hr, max ${MAX_DURATION_HOURS})`}
          value={durationHours}
          onChange={setDurationHours}
          step={0.5}
          max={MAX_DURATION_HOURS}
        />
      </div>

      {!inputsValid && (
        <p role="alert" className="text-xs" style={{ color: '#C0392B' }}>
          Max rain must be at least min rain, both must be 0 or more, and duration must be
          greater than 0.
        </p>
      )}

      <button
        type="button"
        className="bfw-btn mt-auto w-full rounded-md py-2 text-sm font-semibold"
        onClick={runSimulation}
        disabled={!inputsValid || running}
      >
        {running ? 'Simulating…' : 'Start simulation'}
      </button>
    </div>
  )
}

function NumberField({
  label,
  value,
  onChange,
  step = 1,
  max,
}: {
  label: string
  value: number
  onChange: (value: number) => void
  step?: number
  max?: number
}) {
  return (
    <label className="flex flex-col gap-1 text-xs" style={{ color: 'var(--text-soft)' }}>
      {label}
      <input
        type="number"
        value={value}
        step={step}
        max={max}
        onChange={(e) => {
          const next = Number(e.target.value)
          onChange(max !== undefined ? Math.min(next, max) : next)
        }}
        className="rounded-md border px-2 py-1 text-sm"
        style={{ borderColor: 'var(--card-border)', background: 'var(--card-bg)', color: 'var(--text-strong)' }}
      />
    </label>
  )
}
