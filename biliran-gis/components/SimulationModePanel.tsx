// components/SimulationModePanel.tsx
//
// Admin-only "what if" tool, rendered inside UserDashboardModal's
// slide-out sidebar: pick min/max rain rate + storm duration (capped at
// 12 hours) for the currently selected barangay, recompute its primary
// basin's discharge curve client-side (lib/simulationMode.ts — same
// basin selection and same exact analytical formula the real static
// hydrographs use). Purely client-side and ephemeral — nothing here is
// persisted.
//
// Doesn't render its own output chart — "Start simulation" hands the
// result up via onSimulate() instead, so the caller can show it
// alongside the real hydrograph in BarangayDetailPanel and auto-close
// this sidebar. "Exit" closes without running anything.

'use client'

import { useEffect, useState } from 'react'
import type { Barangay } from '@/lib/dashboardData'
import { loadBasinHydrographs, hydrographForBarangay } from '@/lib/hydrographData'
import { simulateForBarangay, type SimulatedHydrograph } from '@/lib/simulationMode'

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

export interface SimulationRunResult {
  minRate: number
  maxRate: number
  durationHours: number
  sim: SimulatedHydrograph
}

export default function SimulationModePanel({
  barangay,
  onExit,
  onSimulate,
}: {
  barangay: Barangay | null
  onExit: () => void
  onSimulate: (result: SimulationRunResult) => void
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

  function runSimulation() {
    if (!barangay) return
    setRunning(true)
    loadBasinHydrographs().then((data) => {
      const sim = simulateForBarangay(data, barangay.key, { minRate, maxRate, durationHours }, DT_HOURS, TOTAL_WINDOW_HOURS)
      setRunning(false)
      if (sim) onSimulate({ minRate, maxRate, durationHours, sim })
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
        SIMULATED — not real data. Recomputed client-side from the inputs below using the
        same real per-basin formula the static hydrograph uses, not an actual forecast.
      </div>

      <div className="text-xs" style={{ color: 'var(--text-soft)' }}>
        {barangay.barangay}, {barangay.municipality}
      </div>

      {hasBasin === false ? (
        <p className="text-xs" style={{ color: 'var(--text-soft)' }}>
          {barangay.barangay} has no basin/river data to simulate against.
        </p>
      ) : (
        <>
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

          <button
            type="button"
            className="bfw-btn mt-auto w-full rounded-md py-2 text-sm font-semibold"
            onClick={runSimulation}
            disabled={hasBasin === null || running}
          >
            {running ? 'Simulating…' : 'Start simulation'}
          </button>
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
