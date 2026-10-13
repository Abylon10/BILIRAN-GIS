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

const FACTORS: { name: string; weight: string; description: string }[] = [
  {
    name: 'HAND (inverted)',
    weight: '0.25',
    description: 'Height Above Nearest Drainage — lower elevation above the nearest stream means higher flood susceptibility, so this factor is inverted before combining.',
  },
  {
    name: 'TWI',
    weight: '0.15',
    description: 'Topographic Wetness Index — how much a location tends to accumulate water based on slope and upstream drainage area.',
  },
  {
    name: 'LCLU',
    weight: '0.15',
    description: 'Land cover / land use — a runoff score per land-cover class (e.g. built-up areas shed more water than forest).',
  },
  {
    name: 'Rainfall',
    weight: '0.45',
    description: 'A 6-hour rainfall total, interpolated across the 7 monitored municipalities.',
  },
]

export default function AdminGisDataTab() {
  return (
    <div className="flex flex-col gap-6">
      <div>
        <h3 className="mb-1 text-xs font-semibold uppercase tracking-wide" style={{ color: 'var(--text-soft)' }}>
          FSI formula
        </h3>
        <p className="rounded-lg border px-3 py-2 font-mono text-sm" style={{ borderColor: 'var(--card-border)', background: 'var(--card-bg)', color: 'var(--text-strong)' }}>
          FSI = 0.25·HAND(inverted) + 0.15·TWI + 0.15·LCLU + 0.45·Rainfall
        </p>
        <p className="mt-1 text-xs" style={{ color: 'var(--text-soft)' }}>
          Each factor is min-max normalized globally across the island before combining. Weights changed from the
          external pipeline&apos;s original <code>compute_fsi.py</code> values (0.30/0.30/0.20/0.20) to this
          rainfall-weighted provisional set by direct request.
        </p>
      </div>

      <div>
        <h3 className="mb-2 text-xs font-semibold uppercase tracking-wide" style={{ color: 'var(--text-soft)' }}>
          Input factors
        </h3>
        <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
          {FACTORS.map((f) => (
            <div key={f.name} className="rounded-lg border p-3" style={{ borderColor: 'var(--card-border)', background: 'var(--card-bg)' }}>
              <div className="flex items-center justify-between">
                <span className="text-sm font-semibold" style={{ color: 'var(--text-strong)' }}>{f.name}</span>
                <span className="text-xs" style={{ color: 'var(--text-soft)' }}>weight {f.weight}</span>
              </div>
              <p className="mt-1 text-xs" style={{ color: 'var(--text-soft)' }}>{f.description}</p>
            </div>
          ))}
        </div>
      </div>

      <div>
        <h3 className="mb-1 text-xs font-semibold uppercase tracking-wide" style={{ color: 'var(--text-soft)' }}>
          Validation
        </h3>
        <div className="rounded-lg border px-3 py-2 text-sm" style={{ borderColor: 'var(--card-border)', background: 'var(--card-bg)', color: 'var(--text-strong)' }}>
          <p>
            With the original pipeline weights (0.30/0.30/0.20/0.20), the recomputed per-barangay score
            (<code>fsi_recomputed</code>) was cross-checked against the 115 barangays&apos; authoritative
            <code> mean_fsi_score</code>: correlation 0.85, mean absolute difference 0.038 on the 0-1 scale.
          </p>
          <p className="mt-2">
            With the current provisional weights above (rainfall raised to 0.45), that agreement is weaker —
            <strong> correlation 0.57</strong>, <strong>mean absolute difference 0.077</strong>, largest single
            outlier +0.29 (San Roque, Naval) — expected, since rainfall is one of the two factors reconstructed
            from a substitute/derived raster rather than the pipeline&apos;s own canonical file, and giving it
            more weight amplifies that approximation&apos;s effect.
          </p>
          <p className="mt-2 text-xs" style={{ color: 'var(--text-soft)' }}>
            Two of the four inputs (TWI&apos;s flow-accumulation input, and rainfall) were reconstructed from
            substitute/derived rasters rather than the pipeline&apos;s own canonical files. <code>mean_fsi_score</code>{' '}
            remains the one authoritative score used everywhere else in this app; nothing here changes it.
          </p>
        </div>
      </div>
    </div>
  )
}
