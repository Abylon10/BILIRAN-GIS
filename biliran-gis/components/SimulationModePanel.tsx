// components/SimulationModePanel.tsx
//
// Admin-only "what if" tool. Originally rendered inside
// UserDashboardModal's slide-out sidebar; the embedded (Rainfall &
// Scenarios tab) case now renders this as an always-visible right-column
// panel instead (see UserDashboardModal.tsx's two-column layout) — this
// component itself is unchanged either way, just laid out differently by
// its caller. Pick a min/max rain rate + storm duration (capped at 24
// hours) and run it against the WHOLE island at once
// (lib/islandSimulation.ts) — not just the currently selected barangay.
// Purely client-side and ephemeral — nothing here is persisted.
//
// "Start simulation" hands the full island-wide result map up via
// onSimulate() instead of rendering it directly, so the caller can
// re-rank/re-color the whole dashboard. A local copy is also kept
// (`lastResults`) purely to render this panel's own "Predicted Alert
// Count" breakdown — real, derived from the same results just computed,
// not a second calculation. "Scenario Name" is a plain local text field,
// never sent anywhere — a session-only label for the admin's own
// reference, cleared on Reset. "Reset" restores the default inputs,
// clears the local summary, and (via the optional onReset callback)
// tells the caller to revert to the real, non-simulated data too —
// consolidating what used to be this component's own "Exit" button (no
// output shown here, easy to just close) and UserDashboardModal's
// separate "⚠ SIMULATED · Clear" header chip (no longer needed once this
// panel's own output is always visible) into one action.

'use client'

import { useEffect, useMemo, useState } from 'react'
import type { Barangay, FsiLabel } from '@/lib/dashboardData'
import { urgencyTierColor } from '@/lib/dashboardData'
import { loadBasinHydrographs, hydrographForBarangay } from '@/lib/hydrographData'
import { loadFsiFactors, WEIGHT_SCHEME_LABEL, WEIGHT_SCHEME_WEIGHTS, type WeightScheme, type FactorWeights } from '@/lib/fsiFactorData'
import { type SimulationParams } from '@/lib/simulationMode'
import { simulateIsland, type IslandSimResult } from '@/lib/islandSimulation'
import { logActivity } from '@/lib/activityLog'

const ALERT_LABELS: FsiLabel[] = ['Very Low', 'Low', 'Moderate', 'High', 'Very High']
const SCHEMES = ['rainfall', 'terrain', 'equal'] as const

const DEFAULT_MIN_RATE = 5
const DEFAULT_MAX_RATE = 50
const DEFAULT_DURATION_HOURS = 2
const MAX_DURATION_HOURS = 24
// Matches MAX_DURATION_HOURS, not a separately-tuned number — the chart's
// displayed window has to cover at least the longest storm an admin can
// type, or a long duration's own ramp-down/hold phase would be cut off
// before it ever becomes visible (confirmed: at the old 6h window with a
// 12h duration cap, the ramp only ever reached its peak at the window's
// own right edge, never showing the decline at all).
const TOTAL_WINDOW_HOURS = MAX_DURATION_HOURS
const DT_HOURS = 1 / 12 // 5 minutes — matches the real storm's step, so axes line up

interface BasinCheckEntry {
  key: string
  hasBasin: boolean
}

export default function SimulationModePanel({
  selectedBarangay,
  onExit,
  onReset,
  onSimulate,
  externalTrigger,
  prefillTrigger,
}: {
  // Purely informational here now (the "does the currently selected
  // barangay have its own river data" preview line) — the simulation
  // itself always runs island-wide, never gated on a selection.
  selectedBarangay: Barangay | null
  // Non-embedded slide-out sidebar mode: closes without running anything.
  onExit?: () => void
  // Embedded always-visible mode: resets this panel's own inputs/summary
  // AND tells the caller to revert the dashboard to real (non-simulated)
  // data — see this file's own header comment for why these two modes
  // use different actions.
  onReset?: () => void
  onSimulate: (results: Map<string, IslandSimResult>, params: SimulationParams) => void
  // Set by the Rainfall & Scenarios tab when an admin taps a point on the
  // real Precipitation chart (BarangayDetailPanel.tsx's own
  // onPrecipitationTap, routed through UserDashboardModal.tsx) — an
  // alternative to typing min/max rain by hand. `token` increments on
  // every tap, including a second tap at the same rate, so the effect
  // below always re-fires (an unchanged `rateMmHr` alone wouldn't).
  externalTrigger?: { rateMmHr: number; token: number } | null
  // Set by AdminReportsTab/AdminActivityLogTab (routed through
  // AdminShell.tsx -> UserDashboardModal.tsx) when an admin taps a saved
  // report/log row — loads that row's own saved scenario straight into
  // this form so it can be reviewed/tweaked, WITHOUT auto-running it
  // (direct, explicit choice: unlike externalTrigger's tap-to-simulate,
  // which is a fast island-wide "what if this rate held," loading a past
  // scenario back in is meant to be reviewed first, then started on
  // purpose via the normal "Start simulation" button). `token` follows the
  // same increment-per-tap convention as externalTrigger, for the same
  // reason (re-fires even if the same row is tapped twice in a row).
  prefillTrigger?: { minRate: number; maxRate: number; durationHours: number; scheme: WeightScheme; scenarioName: string; token: number } | null
}) {
  const [minRate, setMinRate] = useState(DEFAULT_MIN_RATE)
  const [maxRate, setMaxRate] = useState(DEFAULT_MAX_RATE)
  const [durationHours, setDurationHours] = useState(DEFAULT_DURATION_HOURS)
  const [scenarioName, setScenarioName] = useState('')
  // Which FSI weighting scheme the simulated FSI is recombined under —
  // default 'rainfall' keeps this component's exact pre-existing behavior
  // (always whatever factor_weights currently holds); 'terrain'/'equal'
  // pass a fixed override into simulateIsland() instead. Local to this
  // component, not lifted — this panel already owns all its own scenario-
  // form state.
  const [scheme, setScheme] = useState<WeightScheme>('rainfall')
  // Keyed by barangay.key rather than reset-on-effect-entry, so switching
  // barangays never needs a synchronous setState at the top of the effect
  // (see the same pattern in BarangayDetailPanel.tsx).
  const [basinCheck, setBasinCheck] = useState<BasinCheckEntry | null>(null)
  const [running, setRunning] = useState(false)
  // Local copy of the last run's own results — purely to render this
  // panel's own "Predicted Alert Count" breakdown below; the full map is
  // already handed to the caller via onSimulate for the real dashboard
  // re-rank/re-color.
  const [lastResults, setLastResults] = useState<Map<string, IslandSimResult> | null>(null)

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

  // Takes an optional explicit `params`/`weightsOverride`/`scenarioNameOverride`
  // instead of always reading minRate/maxRate/durationHours/scenarioName off
  // state — the tap-to-simulate effect below needs to run with the exact
  // rate/name just set, and setMinRate/setMaxRate/setScenarioName wouldn't be
  // reflected in state until the next render (stale-closure trap), so it
  // passes the values through directly rather than set-state-then-call.
  // `scheme` itself never needs this treatment — nothing sets it
  // synchronously right before calling runSimulation the way tap-to-simulate
  // does for scenarioName, so reading it fresh off state is always correct.
  function runSimulation(overrideParams?: SimulationParams, weightsOverride?: FactorWeights, scenarioNameOverride?: string) {
    const params = overrideParams ?? { minRate, maxRate, durationHours }
    if (!(params.minRate >= 0 && params.maxRate >= params.minRate && params.durationHours > 0)) return
    const effectiveScenarioName = scenarioNameOverride ?? scenarioName
    setRunning(true)
    const weights = weightsOverride ?? (scheme === 'rainfall' ? undefined : WEIGHT_SCHEME_WEIGHTS[scheme])
    Promise.all([loadBasinHydrographs(), loadFsiFactors()]).then(([hydrographData, factorData]) => {
      const results = simulateIsland(hydrographData, factorData, params, DT_HOURS, TOTAL_WINDOW_HOURS, weights)
      setRunning(false)
      setLastResults(results)
      onSimulate(results, params)

      // Real counts from this exact run's own results, not re-derived
      // from state later (`lastResults` won't have committed yet at this
      // point) — same reduce logic as the `alertCounts` useMemo below.
      const counts: Record<FsiLabel, number> = { 'Very Low': 0, Low: 0, Moderate: 0, High: 0, 'Very High': 0 }
      for (const r of results.values()) counts[r.simulatedLabel] = (counts[r.simulatedLabel] ?? 0) + 1

      const summary = `${effectiveScenarioName ? `${effectiveScenarioName}: ` : ''}${params.minRate}-${params.maxRate}mm/hr rain, ${params.durationHours}h duration (${WEIGHT_SCHEME_LABEL[scheme]})`
      logActivity('simulation_run', summary, {
        minRate: params.minRate,
        maxRate: params.maxRate,
        durationHours: params.durationHours,
        scheme,
        scenarioName: effectiveScenarioName,
        alertCounts: counts,
      })
    })
  }

  // Tap-to-simulate: a flat (minRate === maxRate) scenario at the tapped
  // rate, held for the same TOTAL_WINDOW_HOURS every chart in this app
  // already uses — reusing simulateIsland()'s own documented behavior
  // that minRate === maxRate collapses buildRaisedTriangularHyetograph's
  // ramp to a constant rate for the whole window, rather than inventing a
  // new shape for a single tapped point. Also updates the visible
  // min/max/duration fields so the admin can see (and tweak) what ran.
  //
  // Adjust state during render off a previous-value comparison, rather
  // than in an effect — same pattern BiliranMap.tsx already uses for
  // syncing selectedKey/focusedMunicipality (see its own comment there),
  // and required here regardless: an effect calling setState synchronously
  // in its body trips this project's react-hooks/set-state-in-effect lint
  // rule (cascading-renders warning), which the render-phase version does
  // not.
  const [prevTriggerToken, setPrevTriggerToken] = useState<number | undefined>(undefined)
  if (externalTrigger && externalTrigger.token !== prevTriggerToken) {
    setPrevTriggerToken(externalTrigger.token)
    const rate = Math.max(0, externalTrigger.rateMmHr)
    setMinRate(rate)
    setMaxRate(rate)
    setDurationHours(TOTAL_WINDOW_HOURS)
    const tapScenarioName = `Tapped @ ${rate.toFixed(1)} mm/hr`
    setScenarioName(tapScenarioName)
    runSimulation({ minRate: rate, maxRate: rate, durationHours: TOTAL_WINDOW_HOURS }, undefined, tapScenarioName)
  }

  // Load a saved report/log row's scenario back into this form — see
  // this component's own `prefillTrigger` prop comment for why this
  // deliberately does NOT call runSimulation the way externalTrigger's
  // block above does.
  const [prevPrefillToken, setPrevPrefillToken] = useState<number | undefined>(undefined)
  if (prefillTrigger && prefillTrigger.token !== prevPrefillToken) {
    setPrevPrefillToken(prefillTrigger.token)
    setMinRate(prefillTrigger.minRate)
    setMaxRate(prefillTrigger.maxRate)
    setDurationHours(prefillTrigger.durationHours)
    setScheme(prefillTrigger.scheme)
    setScenarioName(prefillTrigger.scenarioName)
  }

  function reset() {
    setMinRate(DEFAULT_MIN_RATE)
    setMaxRate(DEFAULT_MAX_RATE)
    setDurationHours(DEFAULT_DURATION_HOURS)
    setScenarioName('')
    setScheme('rainfall')
    setLastResults(null)
    onReset?.()
  }

  // Real counts from the last run's own results (`lastResults`), not
  // invented — one bucket per the same 5 FSI classes used everywhere
  // else in this app (lib/dashboardData.ts's fsiLabelForScore thresholds).
  const alertCounts = useMemo(() => {
    const counts: Record<FsiLabel, number> = { 'Very Low': 0, Low: 0, Moderate: 0, High: 0, 'Very High': 0 }
    if (!lastResults) return counts
    for (const r of lastResults.values()) {
      counts[r.simulatedLabel] = (counts[r.simulatedLabel] ?? 0) + 1
    }
    return counts
  }, [lastResults])

  return (
    <div className="flex h-full flex-col gap-4">
      <div className="flex items-center justify-between">
        <h3 className="text-sm font-semibold" style={{ color: 'var(--text-strong)' }}>
          Simulation Mode
        </h3>
        {onExit && (
          <button
            type="button"
            onClick={onExit}
            className="bfw-btn rounded-full px-3 py-1.5 text-xs font-semibold"
          >
            Exit
          </button>
        )}
        {/*
          Solid #B8860B, not the old translucent rgba(184,134,11,0.35) —
          a translucent fill composites with whatever theme background
          sits behind it, so the same #3D2B00 text read fine over the
          light theme's card but was nearly illegible over the dark
          theme's. A solid, fixed background gives this box the same
          contrast regardless of theme, same reasoning for the banner
          below.
        */}
        {lastResults && (
          <span className="rounded-full px-3 py-1 text-xs font-semibold" style={{ background: '#B8860B', color: '#3D2B00' }}>
            SIMULATED
          </span>
        )}
      </div>

      <div
        className="rounded-lg border px-3 py-2 text-xs"
        style={{ background: '#B8860B', borderColor: '#B8860B', color: '#3D2B00' }}
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

      <div className="flex flex-col gap-1.5">
        <span className="text-xs" style={{ color: 'var(--text-soft)' }}>
          FSI weighting
        </span>
        <div className="flex gap-1.5">
          {SCHEMES.map((s) => (
            <button
              key={s}
              type="button"
              aria-pressed={scheme === s}
              onClick={() => setScheme(s)}
              className="rounded-full border px-3 py-1 text-xs font-medium"
              style={
                scheme === s
                  ? { background: 'var(--btn-to)', borderColor: 'var(--btn-to)', color: 'var(--btn-text)' }
                  : { background: 'transparent', borderColor: 'var(--card-border)', color: 'var(--text-soft)' }
              }
            >
              {WEIGHT_SCHEME_LABEL[s]}
            </button>
          ))}
        </div>
      </div>

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
        <label className="flex flex-col gap-1 text-xs" style={{ color: 'var(--text-soft)' }}>
          Scenario name (optional)
          <input
            type="text"
            value={scenarioName}
            onChange={(e) => setScenarioName(e.target.value)}
            maxLength={60}
            placeholder="e.g. Heavy Rain — Typhoon"
            className="rounded-md border px-2 py-1 text-sm"
            style={{ borderColor: 'var(--card-border)', background: 'var(--card-bg)', color: 'var(--text-strong)' }}
          />
        </label>
      </div>

      {!inputsValid && (
        <p role="alert" className="text-xs" style={{ color: '#C0392B' }}>
          Max rain must be at least min rain, both must be 0 or more, and duration must be
          greater than 0.
        </p>
      )}

      <div className="flex gap-2">
        <button
          type="button"
          className="bfw-btn rounded-md px-3 py-2 text-sm font-semibold"
          onClick={reset}
          disabled={running}
        >
          Reset
        </button>
        <button
          type="button"
          className="bfw-btn flex-1 rounded-md py-2 text-sm font-semibold"
          onClick={() => runSimulation()}
          disabled={!inputsValid || running}
        >
          {running ? 'Simulating…' : 'Start simulation'}
        </button>
      </div>

      {lastResults && (
        <div className="rounded-lg border p-3" style={{ borderColor: 'var(--card-border)' }}>
          <div className="mb-2 flex items-center justify-between text-xs font-semibold uppercase tracking-wide" style={{ color: 'var(--text-soft)' }}>
            <span>Predicted alert count</span>
            {scenarioName && <span className="normal-case" style={{ color: 'var(--text-strong)' }}>{scenarioName}</span>}
          </div>
          <div className="grid grid-cols-5 gap-2 text-center">
            {ALERT_LABELS.map((label) => (
              <div key={label}>
                <div className="text-lg font-semibold" style={{ color: urgencyTierColor(label) }}>
                  {alertCounts[label]}
                </div>
                <div className="text-[10px]" style={{ color: 'var(--text-soft)' }}>
                  {label}
                </div>
              </div>
            ))}
          </div>
        </div>
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
