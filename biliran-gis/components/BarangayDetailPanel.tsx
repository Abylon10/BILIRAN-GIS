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
import { loadFsiFactors, factorsForBarangay, getFactorTertiles, type BarangayFactors, type FactorWeights, type FactorTertiles } from '@/lib/fsiFactorData'
import type { SimulationRunResult } from '@/lib/simulationMode'
import type { LiveHydrograph } from '@/lib/liveIslandState'
import DischargeChart from '@/components/DischargeChart'

interface HydrographEntry {
  key: string
  hydrograph: PrimaryHydrograph | null
  stormParams: StormParams
}

interface FactorEntry {
  key: string
  factors: BarangayFactors | null
  weights: FactorWeights | null
  tertiles: FactorTertiles | null
}

export default function BarangayDetailPanel({
  barangay,
  liveHydrograph,
  liveRainfallFactor,
  simulationResult,
}: {
  barangay: Barangay | null
  // The real (non-admin) dashboard's live-forecast-driven discharge curve
  // for this barangay — computed synchronously in app/page.tsx from
  // already-loaded data (lib/liveIslandState.ts), not fetched here, so
  // there's no separate loading race to guard against the way the static
  // entry/factorEntry state below has to. Supersedes the static
  // entry.hydrograph chart below when present; null while live data
  // hasn't loaded yet (falls back to the static chart) or for the 2
  // basin-less barangays (same honest absence as always).
  liveHydrograph?: LiveHydrograph | null
  // The same live-scaled rainfall factor that actually fed liveFsi above,
  // for the factor-breakdown bar below — without this it would silently
  // show the pre-scaling static value beside a live score built from a
  // different (often clamped) number.
  liveRainfallFactor?: number | null
  // Admin-only, from UserDashboardModal's Simulation Mode sidebar — the
  // real dashboard (DashboardShell.tsx) never passes this, so it's
  // optional and renders nothing extra there. Owned by the caller, not
  // this component: cleared whenever the caller's own selection changes,
  // so a stale result from a different barangay never shows here.
  simulationResult?: SimulationRunResult | null
}) {
  // Keyed by barangay.key rather than reset-on-effect-entry, so switching
  // barangays never needs a synchronous setState at the top of the effect
  // (which would otherwise cause a redundant extra render on every switch).
  // A stale entry (key mismatch) is treated as "still loading" for the
  // barangay now selected.
  const [entry, setEntry] = useState<HydrographEntry | null>(null)
  const [failedKey, setFailedKey] = useState<string | null>(null)
  const [factorEntry, setFactorEntry] = useState<FactorEntry | null>(null)
  // Same single-open-at-a-time "?" pattern as FactorBreakdown's own
  // openFactor below, kept as a separate piece of state since these are a
  // different group of rows (the Basins/Danger/Warning/Alert stat grid,
  // not the factor breakdown) — opening one here doesn't need to, and
  // shouldn't, close whichever factor explanation is open.
  const [openStat, setOpenStat] = useState<string | null>(null)

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
        setFactorEntry({
          key: barangay.key,
          factors: factorsForBarangay(data, barangay.key),
          weights: data.factor_weights,
          tertiles: getFactorTertiles(data),
        })
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

      {(() => {
        // Prefer the live-forecast curve (real, non-admin dashboard's
        // default now) over the static design-storm one — falls back to
        // the static chart only while live data hasn't loaded yet, same
        // graceful-degradation pattern used everywhere else in this app.
        const hydro = liveHydrograph ?? (isCurrent ? entry?.hydrograph ?? null : null)
        if (!hydro) return null
        const captionText = liveHydrograph
          ? `Computed from today's live Open-Meteo forecast${barangay ? ` for ${barangay.municipality}` : ''}.`
          : entry?.stormParams
            ? `Modeled from a single synthetic ${entry.stormParams.duration_hours}-hour design storm, ${entry.stormParams.peak_mm_hr}mm/hr peak.`
            : ''
        return (
          <>
            <DischargeChart
              timeHours={hydro.timeHours}
              q={hydro.q}
              title="Hydrograph"
              metaLabel={`basin ${hydro.basinId} · peak ${Math.max(...hydro.q, 0.001).toFixed(1)} m³/s`}
              captionText={captionText}
              infoText="How much water is expected to flow through this barangay's drainage basin over time, in cubic meters per second (m³/s). A higher curve means more water moving through at once — this is what the Danger/Alert countdown is based on."
            />
            <DischargeChart
              timeHours={hydro.timeHours}
              q={hydro.rainfallMmHr}
              title="Precipitation"
              metaLabel={`peak ${Math.max(...hydro.rainfallMmHr, 0.001).toFixed(0)} mm/hr`}
              captionText={captionText}
              color="#0891B2"
              ariaLabel="Rainfall over time"
              infoText="Expected rainfall intensity over time, in millimeters per hour (mm/hr). This rainfall is what drives the Hydrograph above — more/heavier rain means more water flowing through the basin."
            />
          </>
        )
      })()}

      {simulationResult && (
        <>
          <DischargeChart
            timeHours={simulationResult.sim.timeHours}
            q={simulationResult.sim.q}
            title="Simulated hydrograph"
            metaLabel={`basin ${simulationResult.sim.basinId} · peak ${Math.max(...simulationResult.sim.q, 0.001).toFixed(1)} m³/s`}
            captionText={`Simulated: ${simulationResult.minRate}-${simulationResult.maxRate}mm/hr rain, ${simulationResult.durationHours}-hour duration.`}
            color="#D97706"
            ariaLabel="Simulated basin discharge over time"
          />
          {/*
            Precipitation's own simulated counterpart — the real chart
            above already gets one (Simulated hydrograph), but
            Precipitation never did, so it stayed showing only the real/
            live rainfall curve even while a scenario was active.
            rainfallMmHr is the same raised-triangular hyetograph
            simulationResult.sim.q was itself recomputed from
            (lib/simulationMode.ts's buildRaisedTriangularHyetograph),
            already present on this object — no new computation needed.
          */}
          <DischargeChart
            timeHours={simulationResult.sim.timeHours}
            q={simulationResult.sim.rainfallMmHr}
            title="Simulated precipitation"
            metaLabel={`peak ${Math.max(...simulationResult.sim.rainfallMmHr, 0.001).toFixed(0)} mm/hr`}
            captionText={`Simulated: ${simulationResult.minRate}-${simulationResult.maxRate}mm/hr rain, ${simulationResult.durationHours}-hour duration.`}
            color="#D97706"
            ariaLabel="Simulated rainfall over time"
          />
        </>
      )}

      {!(isCurrent && entry?.hydrograph) && (
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

      {isFactorsCurrent && factorEntry?.factors && factorEntry.weights && factorEntry.tertiles && (
        <BarangayFactorProfile
          factors={factorEntry.factors}
          weights={factorEntry.weights}
          tertiles={factorEntry.tertiles}
          // Only the rainfall row is live-scaled — hand/twi/lclu are
          // static terrain properties, genuinely unaffected by weather.
          // liveHydrograph doubles as "live data is active for this
          // barangay" here (same condition the hydrograph charts above
          // already key off), so this stays in sync with them for free.
          liveRainfallFactor={liveHydrograph ? liveRainfallFactor : null}
        />
      )}

      <dl className="grid grid-cols-2 gap-3 text-sm">
        <Stat
          statKey="basins"
          label="Basins"
          value={String(barangay.basin_ids.length)}
          explanation="The number of distinct river basins whose watershed boundary overlaps this barangay's area. A barangay overlapping more than one basin draws its modeled risk from more than one discharge curve, not just the single one shown above."
          openStat={openStat}
          onToggle={setOpenStat}
        />
        <Stat
          statKey="danger"
          label="Danger at"
          value={formatHoursAsCountdown(barangay.danger_time_hours)}
          explanation="Hours into the forecast/storm when modeled flow is projected to reach 95% of this basin's peak discharge — the highest and most urgent of the three thresholds."
          openStat={openStat}
          onToggle={setOpenStat}
        />
        <Stat
          statKey="warning"
          label="Warning at"
          value={formatHoursAsCountdown(barangay.warning_time_hours)}
          explanation="Hours into the forecast/storm when modeled flow is projected to reach 50% of this basin's peak discharge — the earliest of the three thresholds."
          openStat={openStat}
          onToggle={setOpenStat}
        />
        <Stat
          statKey="alert"
          label="Alert at"
          value={formatHoursAsCountdown(barangay.alert_time_hours)}
          explanation="Hours into the forecast/storm when modeled flow is projected to reach 75% of this basin's peak discharge — the middle threshold, between Warning and Danger."
          openStat={openStat}
          onToggle={setOpenStat}
        />
      </dl>

      <p className="text-xs" style={{ color: 'var(--text-soft)' }}>
        {liveHydrograph
          ? "Times are hours into today's live Open-Meteo forecast — see the banner above for the computation basis."
          : 'Times are hours into a modeled design storm, not a live countdown — see the banner above for the honesty note on this.'}
      </p>
    </div>
  )
}

// Shared across every factor's own "?" explanation and the group caption
// below, so both say the same thing about what the underlying 0-1 number
// actually is (a relative island-wide rank, not a physical unit) rather
// than drifting into slightly different wording in two places. The plain-
// language category each row shows is derived from that same 0-1 rank, not
// a separate measurement.
const FACTOR_SCORE_FRAMING =
  "Each category is this barangay's real rank among all 115 against the island-wide range for that factor " +
  '(bottom/middle/top third) — not an arbitrary label. Not a replacement for the score above.'

type FactorTier = 'low' | 'mid' | 'high'

function tierFor(value: number, bounds: [number, number]): FactorTier {
  if (value < bounds[0]) return 'low'
  if (value < bounds[1]) return 'mid'
  return 'high'
}

// Low/mid/high here always means "least to most flood-susceptible" for
// that factor, so one shared tier->severity-color mapping works for all
// three categorized rows — reusing the app's one existing severity palette
// (urgencyTierColor, also used by the map/legend/list) rather than
// inventing new badge colors.
const TIER_COLOR: Record<FactorTier, string> = {
  low: urgencyTierColor('Low'),
  mid: urgencyTierColor('Moderate'),
  high: urgencyTierColor('High'),
}

// The 3 category names per factor, in [low, mid, high] tier order. Each
// factor's "high" tier is the direction that existing code already treats
// as more flood-susceptible (HAND is pre-inverted so a high score means
// closer to drainage; see factorsForBarangay's own provenance notes).
const CATEGORY_LABEL: Record<'hand' | 'twi' | 'lclu', [string, string, string]> = {
  hand: ['Elevated Terrain', 'Intermediate Drainage Elevation', 'Drainage-Adjacent Lowland'],
  twi: ['Low Water Accumulation', 'Moderate Water Accumulation', 'High Water Accumulation'],
  lclu: ['Infiltration-Supporting Cover', 'Mixed or Modified Cover', 'Runoff-Prone Cover'],
}

function categoryLabelFor(key: 'hand' | 'twi' | 'lclu', tier: FactorTier): string {
  const idx = tier === 'low' ? 0 : tier === 'mid' ? 1 : 2
  return CATEGORY_LABEL[key][idx]
}

function BarangayFactorProfile({
  factors,
  weights,
  tertiles,
  liveRainfallFactor,
}: {
  factors: BarangayFactors
  weights: FactorWeights
  tertiles: FactorTertiles
  liveRainfallFactor?: number | null
}) {
  const [openFactor, setOpenFactor] = useState<string | null>(null)

  const categorized: {
    key: 'hand' | 'twi' | 'lclu'
    label: string
    value: number
    weight: number
    tier: FactorTier
    category: string
    explanation: string
  }[] = [
    {
      key: 'hand',
      label: 'HAND (elevation above drainage)',
      value: factors.hand,
      weight: weights.hand,
      tier: tierFor(factors.hand, tertiles.hand),
      category: categoryLabelFor('hand', tierFor(factors.hand, tertiles.hand)),
      explanation:
        "A relative score (0-1) ranking this barangay's elevation above the nearest drainage channel against " +
        'every other barangay on the island. Lower means closer to a stream/drainage, typically raising flood risk.',
    },
    {
      key: 'twi',
      label: 'TWI (wetness index)',
      value: factors.twi,
      weight: weights.twi,
      tier: tierFor(factors.twi, tertiles.twi),
      category: categoryLabelFor('twi', tierFor(factors.twi, tertiles.twi)),
      explanation:
        'A relative score (0-1) ranking how much water tends to accumulate here — based on slope and upstream ' +
        'contributing area — against every other barangay on the island. Higher means water pools more easily.',
    },
    {
      key: 'lclu',
      label: 'Land cover runoff',
      value: factors.lclu,
      weight: weights.lclu,
      tier: tierFor(factors.lclu, tertiles.lclu),
      category: categoryLabelFor('lclu', tierFor(factors.lclu, tertiles.lclu)),
      explanation:
        "A relative score (0-1) ranking this barangay's runoff potential from its land cover type against " +
        'every other barangay on the island. Paved/built-up areas shed rainfall faster than forested or ' +
        'vegetated ones, raising this factor.',
    },
  ]

  const rainfallLabel = liveRainfallFactor != null ? "Today's live rainfall forecast" : 'Design-storm rainfall forecast'
  const rainfallValue = liveRainfallFactor ?? factors.rainfall
  const rainfallExplanation =
    "This barangay's own rainfall input into the FSI formula, scored 0-1 against the island-wide range. " +
    "Unlike HAND/TWI/land cover, it isn't sorted into a category here — rainfall changes with the weather, " +
    "so a fixed island-wide rank for it wouldn't stay meaningful from one day to the next."

  return (
    <div className="flex flex-col gap-3 rounded-lg border px-3 py-2.5" style={{ borderColor: 'var(--card-border)' }}>
      <div className="text-sm font-semibold uppercase tracking-wide" style={{ color: 'var(--text-soft)' }}>
        Barangay Factor Profile
      </div>

      <div className="flex flex-col gap-2.5">
        {categorized.map((row) => (
          <div key={row.key} className="flex flex-col gap-1">
            <div className="flex items-start justify-between gap-2">
              <div className="flex min-w-0 items-center gap-1.5 text-xs" style={{ color: 'var(--text-soft)' }}>
                <span className="truncate">{row.label}</span>
                {/*
                  Same real-tap-target (not hover-only) "?" convention this
                  panel already uses elsewhere in this file (Stat's own
                  button below) — works on phone, opens at most one
                  explanation at a time via openFactor.
                */}
                <button
                  type="button"
                  onClick={() => setOpenFactor((cur) => (cur === row.key ? null : row.key))}
                  aria-expanded={openFactor === row.key}
                  aria-label={`What is ${row.label}?`}
                  className="flex h-4 w-4 shrink-0 items-center justify-center rounded-full border text-[9px] font-bold"
                  style={{
                    borderColor: 'var(--card-border)',
                    color: openFactor === row.key ? 'var(--card-bg)' : 'var(--text-soft)',
                    background: openFactor === row.key ? 'var(--text-soft)' : 'transparent',
                  }}
                >
                  ?
                </button>
              </div>
              <div className="shrink-0 text-right">
                <div className="font-mono text-sm font-semibold" style={{ color: 'var(--text-strong)' }}>
                  {row.value.toFixed(2)}
                </div>
                <span
                  className="mt-0.5 inline-block rounded-full px-2 py-0.5 text-[10px] font-semibold"
                  style={{ background: `${TIER_COLOR[row.tier]}33`, color: TIER_COLOR[row.tier] }}
                >
                  {row.category}
                </span>
              </div>
            </div>
            {openFactor === row.key && (
              <div className="rounded-md px-2 py-1.5 text-[10px] leading-snug" style={{ background: 'var(--card-border)', color: 'var(--text-soft)' }}>
                {row.explanation} This factor contributes {Math.round(row.weight * 100)}% to the FSI score.
              </div>
            )}
          </div>
        ))}

        <div className="flex flex-col gap-1">
          <div className="flex items-start justify-between gap-2">
            <div className="flex min-w-0 items-center gap-1.5 text-xs" style={{ color: 'var(--text-soft)' }}>
              <span className="truncate">{rainfallLabel}</span>
              <button
                type="button"
                onClick={() => setOpenFactor((cur) => (cur === 'rainfall' ? null : 'rainfall'))}
                aria-expanded={openFactor === 'rainfall'}
                aria-label={`What is ${rainfallLabel}?`}
                className="flex h-4 w-4 shrink-0 items-center justify-center rounded-full border text-[9px] font-bold"
                style={{
                  borderColor: 'var(--card-border)',
                  color: openFactor === 'rainfall' ? 'var(--card-bg)' : 'var(--text-soft)',
                  background: openFactor === 'rainfall' ? 'var(--text-soft)' : 'transparent',
                }}
              >
                ?
              </button>
            </div>
            <div className="shrink-0 text-right">
              <div className="font-mono text-sm font-semibold" style={{ color: 'var(--text-strong)' }}>
                {rainfallValue.toFixed(2)}
              </div>
              <div className="mt-0.5 text-[10px]" style={{ color: 'var(--text-soft)' }}>
                {liveRainfallFactor != null ? 'Estimated from Open-Meteo' : 'From the static design storm'}
              </div>
            </div>
          </div>
          {openFactor === 'rainfall' && (
            <div className="rounded-md px-2 py-1.5 text-[10px] leading-snug" style={{ background: 'var(--card-border)', color: 'var(--text-soft)' }}>
              {rainfallExplanation} This factor contributes {Math.round(weights.rainfall * 100)}% to the FSI score.
            </div>
          )}
        </div>
      </div>

      <div className="text-[10px]" style={{ color: 'var(--text-soft)' }}>
        {FACTOR_SCORE_FRAMING}
      </div>
    </div>
  )
}

function Stat({
  statKey,
  label,
  value,
  explanation,
  openStat,
  onToggle,
}: {
  statKey: string
  label: string
  value: string
  explanation: string
  openStat: string | null
  onToggle: (key: string | null) => void
}) {
  const isOpen = openStat === statKey
  return (
    <div>
      <dt className="flex items-center gap-1 text-xs" style={{ color: 'var(--text-soft)' }}>
        <span>{label}</span>
        {/* Same real-tap-target "?" pattern as FactorBreakdown's rows above. */}
        <button
          type="button"
          onClick={() => onToggle(isOpen ? null : statKey)}
          aria-expanded={isOpen}
          aria-label={`What is ${label}?`}
          className="flex h-4 w-4 shrink-0 items-center justify-center rounded-full border text-[9px] font-bold"
          style={{
            borderColor: 'var(--card-border)',
            color: isOpen ? 'var(--card-bg)' : 'var(--text-soft)',
            background: isOpen ? 'var(--text-soft)' : 'transparent',
          }}
        >
          ?
        </button>
      </dt>
      <dd className="font-semibold" style={{ color: 'var(--text-strong)' }}>{value}</dd>
      {isOpen && (
        <div className="mt-1 rounded-md px-2 py-1.5 text-[10px] leading-snug" style={{ background: 'var(--card-border)', color: 'var(--text-soft)' }}>
          {explanation}
        </div>
      )}
    </div>
  )
}
