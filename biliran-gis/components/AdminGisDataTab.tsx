// components/AdminGisDataTab.tsx
//
// The admin shell's "GIS & FSI Data" tab — an honest info page naming the
// 4 real FSI input factors and their real provenance, plus the real
// validation numbers already computed and documented in CLAUDE.md (see
// its "Provenance and how this was built" / "Validated, not just
// assumed" sections). Nothing here is new data or a new claim — this
// surfaces already-true, already-documented facts in the UI rather than
// inventing a "System Status"/"datasets" panel with numbers this repo
// has no way to back (the reference mockup's own "6 GIS Datasets" card
// was one of the things flagged and dropped for exactly this reason).
//
// The "Terrain base"/"Rainfall base" toggle below reuses the exact same
// comparison the main dashboard's own toggle shows (see DashboardShell.tsx,
// app/page.tsx) — a static (ratio=1) recombination of each barangay's own
// stored factor values under either weighting scheme, independent of live
// weather. The validation correlation/mean-absolute-difference numbers are
// now computed live in-browser from the real 115-barangay dataset for
// whichever scheme is selected, rather than two fixed paragraphs reporting
// an earlier manual offline pass — guaranteed correct for both schemes and
// automatically right again if the underlying data is ever reprocessed.

'use client'

import { useEffect, useMemo, useState } from 'react'
import type { Barangay } from '@/lib/dashboardData'
import { loadFsiFactors, recomputeFsiStatic, TERRAIN_BASE_WEIGHTS, type RawFactorData, type FactorWeights } from '@/lib/fsiFactorData'

type Scheme = 'rainfall' | 'terrain'

const FACTOR_META: { key: keyof FactorWeights; name: string; description: string }[] = [
  {
    key: 'hand',
    name: 'HAND (inverted)',
    description: 'Height Above Nearest Drainage — lower elevation above the nearest stream means higher flood susceptibility, so this factor is inverted before combining.',
  },
  {
    key: 'twi',
    name: 'TWI',
    description: 'Topographic Wetness Index — how much a location tends to accumulate water based on slope and upstream drainage area.',
  },
  {
    key: 'lclu',
    name: 'LCLU',
    description: 'Land cover / land use — a runoff score per land-cover class (e.g. built-up areas shed more water than forest).',
  },
  {
    key: 'rainfall',
    name: 'Rainfall',
    description: 'A 6-hour rainfall total, interpolated across the 7 monitored municipalities.',
  },
]

function pearsonCorrelation(xs: number[], ys: number[]): number {
  const n = xs.length
  const meanX = xs.reduce((a, b) => a + b, 0) / n
  const meanY = ys.reduce((a, b) => a + b, 0) / n
  let cov = 0
  let varX = 0
  let varY = 0
  for (let i = 0; i < n; i++) {
    const dx = xs[i] - meanX
    const dy = ys[i] - meanY
    cov += dx * dy
    varX += dx * dx
    varY += dy * dy
  }
  return cov / Math.sqrt(varX * varY)
}

export default function AdminGisDataTab({ barangays }: { barangays: Barangay[] | null }) {
  const [scheme, setScheme] = useState<Scheme>('rainfall')
  const [factorData, setFactorData] = useState<RawFactorData | null>(null)

  useEffect(() => {
    let cancelled = false
    loadFsiFactors().then((data) => {
      if (!cancelled) setFactorData(data)
    })
    return () => {
      cancelled = true
    }
  }, [])

  const weights: FactorWeights | null = useMemo(() => {
    if (scheme === 'terrain') return TERRAIN_BASE_WEIGHTS
    return factorData?.factor_weights ?? null
  }, [scheme, factorData])

  // Live, in-browser Pearson correlation + mean absolute difference between
  // this scheme's static recomputation and the authoritative mean_fsi_score
  // across every barangay both datasets agree on — the same math an
  // earlier manual offline pass already ran once per scheme (see CLAUDE.md),
  // now reproduced here so it reacts to the toggle and can't drift stale.
  const validation = useMemo(() => {
    if (!weights || !factorData || !barangays) return null
    const authoritativeByKey = new Map(barangays.map((b) => [b.key, b.mean_fsi_score]))
    const recomputed: number[] = []
    const authoritative: number[] = []
    const diffs: { key: string; delta: number }[] = []
    for (const [key, factors] of Object.entries(factorData.barangays)) {
      const auth = authoritativeByKey.get(key)
      if (auth == null) continue
      const fsi = recomputeFsiStatic(factors, weights)
      recomputed.push(fsi)
      authoritative.push(auth)
      diffs.push({ key, delta: fsi - auth })
    }
    if (recomputed.length < 2) return null
    const correlation = pearsonCorrelation(recomputed, authoritative)
    const meanAbsDiff = diffs.reduce((sum, d) => sum + Math.abs(d.delta), 0) / diffs.length
    const largestOutlier = diffs.reduce((best, d) => (Math.abs(d.delta) > Math.abs(best.delta) ? d : best), diffs[0])
    const barangayName = (key: string) => barangays.find((b) => b.key === key)?.barangay ?? key
    return {
      n: diffs.length,
      correlation,
      meanAbsDiff,
      largestOutlier: { name: barangayName(largestOutlier.key), delta: largestOutlier.delta },
    }
  }, [weights, factorData, barangays])

  // Which barangays' severity tier (fsiLabelForScore band) differs between
  // the two schemes — computed once both schemes' recomputations are
  // available, regardless of which one is currently toggled, so this list
  // doesn't flicker empty while only one scheme's data is "selected."
  const movers = useMemo(() => {
    if (!factorData || !barangays) return null
    const authoritativeByKey = new Map(barangays.map((b) => [b.key, b.barangay]))
    const rows: { name: string; terrainFsi: number; rainfallFsi: number }[] = []
    for (const [key, factors] of Object.entries(factorData.barangays)) {
      const name = authoritativeByKey.get(key)
      if (!name) continue
      rows.push({
        name,
        terrainFsi: recomputeFsiStatic(factors, TERRAIN_BASE_WEIGHTS),
        rainfallFsi: recomputeFsiStatic(factors, factorData.factor_weights),
      })
    }
    const tier = (score: number) => (score < 0.2 ? 0 : score < 0.4 ? 1 : score < 0.6 ? 2 : score < 0.8 ? 3 : 4)
    const changed = rows
      .map((r) => ({ ...r, delta: r.rainfallFsi - r.terrainFsi, tierChanged: tier(r.terrainFsi) !== tier(r.rainfallFsi) }))
      .filter((r) => r.tierChanged)
      .sort((a, b) => Math.abs(b.delta) - Math.abs(a.delta))
    return { total: rows.length, changedCount: changed.length, top: changed.slice(0, 5) }
  }, [factorData, barangays])

  const formula = weights
    ? `FSI = ${weights.hand.toFixed(2)}·HAND(inverted) + ${weights.twi.toFixed(2)}·TWI + ${weights.lclu.toFixed(2)}·LCLU + ${weights.rainfall.toFixed(2)}·Rainfall`
    : 'FSI = —'

  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-wrap items-center gap-2">
        <span className="text-xs font-semibold uppercase tracking-wide" style={{ color: 'var(--text-soft)' }}>
          FSI weighting:
        </span>
        <div className="flex gap-1.5">
          {(['rainfall', 'terrain'] as const).map((s) => (
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
              {s === 'rainfall' ? 'Rainfall base' : 'Terrain base'}
            </button>
          ))}
        </div>
      </div>

      <div>
        <h3 className="mb-1 text-xs font-semibold uppercase tracking-wide" style={{ color: 'var(--text-soft)' }}>
          FSI formula
        </h3>
        <p className="rounded-lg border px-3 py-2 font-mono text-sm" style={{ borderColor: 'var(--card-border)', background: 'var(--card-bg)', color: 'var(--text-strong)' }}>
          {formula}
        </p>
        <p className="mt-1 text-xs" style={{ color: 'var(--text-soft)' }}>
          Each factor is min-max normalized globally across the island before combining.{' '}
          {scheme === 'terrain'
            ? "Showing the external pipeline's original weights (0.30/0.30/0.20/0.20) — switch to Rainfall base for the current provisional set."
            : 'Weights changed from the original pipeline values (0.30/0.30/0.20/0.20) to this rainfall-weighted provisional set by direct request — switch to Terrain base to compare.'}
        </p>
      </div>

      <div>
        <h3 className="mb-2 text-xs font-semibold uppercase tracking-wide" style={{ color: 'var(--text-soft)' }}>
          Input factors
        </h3>
        <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
          {FACTOR_META.map((f) => (
            <div key={f.name} className="rounded-lg border p-3" style={{ borderColor: 'var(--card-border)', background: 'var(--card-bg)' }}>
              <div className="flex items-center justify-between">
                <span className="text-sm font-semibold" style={{ color: 'var(--text-strong)' }}>{f.name}</span>
                <span className="text-xs" style={{ color: 'var(--text-soft)' }}>
                  weight {weights ? weights[f.key].toFixed(2) : '—'}
                </span>
              </div>
              <p className="mt-1 text-xs" style={{ color: 'var(--text-soft)' }}>{f.description}</p>
            </div>
          ))}
        </div>
      </div>

      <div>
        <h3 className="mb-1 text-xs font-semibold uppercase tracking-wide" style={{ color: 'var(--text-soft)' }}>
          Validation — {scheme === 'terrain' ? 'Terrain base' : 'Rainfall base'}
        </h3>
        <div className="rounded-lg border px-3 py-2 text-sm" style={{ borderColor: 'var(--card-border)', background: 'var(--card-bg)', color: 'var(--text-strong)' }}>
          {validation ? (
            <>
              <p>
                Recomputed per-barangay score cross-checked against the {validation.n} barangays&apos; authoritative{' '}
                <code>mean_fsi_score</code>: <strong>correlation {validation.correlation.toFixed(2)}</strong>,{' '}
                <strong>mean absolute difference {validation.meanAbsDiff.toFixed(3)}</strong>, largest single outlier{' '}
                {validation.largestOutlier.delta >= 0 ? '+' : ''}
                {validation.largestOutlier.delta.toFixed(2)} ({validation.largestOutlier.name}).
              </p>
              <p className="mt-2 text-xs" style={{ color: 'var(--text-soft)' }}>
                Two of the four inputs (TWI&apos;s flow-accumulation input, and rainfall) were reconstructed from
                substitute/derived rasters rather than the pipeline&apos;s own canonical files. <code>mean_fsi_score</code>{' '}
                remains the one authoritative score used everywhere else in this app; nothing here changes it. Computed
                live from the real dataset each time this toggle changes, not a stored figure.
              </p>
            </>
          ) : (
            <p className="text-xs" style={{ color: 'var(--text-soft)' }}>Loading factor data…</p>
          )}
        </div>
      </div>

      {movers && (
        <div>
          <h3 className="mb-1 text-xs font-semibold uppercase tracking-wide" style={{ color: 'var(--text-soft)' }}>
            Barangays that change severity tier between schemes
          </h3>
          <div className="rounded-lg border px-3 py-2 text-sm" style={{ borderColor: 'var(--card-border)', background: 'var(--card-bg)', color: 'var(--text-strong)' }}>
            <p className="text-xs" style={{ color: 'var(--text-soft)' }}>
              {movers.changedCount} of {movers.total} barangays shift severity tier (Very Low/Low/Moderate/High/Very
              High) between Terrain base and Rainfall base weights.
            </p>
            {movers.top.length > 0 && (
              <ul className="mt-2 flex flex-col gap-1">
                {movers.top.map((m) => (
                  <li key={m.name} className="flex items-center justify-between text-xs">
                    <span style={{ color: 'var(--text-strong)' }}>{m.name}</span>
                    <span style={{ color: 'var(--text-soft)' }}>
                      {m.terrainFsi.toFixed(2)} → {m.rainfallFsi.toFixed(2)} ({m.delta >= 0 ? '+' : ''}
                      {m.delta.toFixed(2)})
                    </span>
                  </li>
                ))}
              </ul>
            )}
          </div>
        </div>
      )}
    </div>
  )
}
