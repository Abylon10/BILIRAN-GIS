// components/DashboardShell.tsx
//
// The content rendered inside the public dashboard's toggleable sidebar
// (see app/page.tsx) — the live-forecast/honesty banner, the municipality
// filter, the barangay list ranked by susceptibility, and the FSI detail
// panel. (The "Modeled Alert" LiveUpdateBanner that used to sit here was
// removed by direct request — components/LiveUpdateBanner.tsx is left in
// place, just no longer called from this file.)
//
// Below that shared full-width header block, the list and the FSI detail
// panel sit in a two-column grid at lg: and up (list left, detail right —
// now that the sidebar itself is full-width, there's room to show both at
// once instead of one buried below ~115 list rows). Below lg:, they stack
// as a single column with the detail panel first (same "pinned above the
// list" reasoning as before this round), matching this component's older,
// narrower-sidebar behavior exactly. Each column scrolls independently
// (min-h-0 overflow-y-auto) — see CLAUDE.md's "Independent scroll for each
// column" note (same pattern already used for the admin Rainfall &
// Scenarios tab) for why the full ancestor chain, including app/page.tsx's
// sidebar body wrapper, has to give up its own scroll for this to work.
//
// The map itself is NOT rendered here — app/page.tsx mounts a single,
// always full-bleed <BiliranMap> (see "one map, not two" in CLAUDE.md).
// barangays/loadError/selectedKey are lifted to page.tsx too, both because
// the persistent map needs them before this component ever mounts, and so
// the map and this list/detail panel share one selection.
//
// Still deliberately does NOT include a real hydrograph chart or FSI
// factor breakdown of its own — BarangayDetailPanel.tsx owns that, reused
// unchanged here.

'use client'

import { useCallback, useMemo } from 'react'
import { filterBarangays, sortBySeverity, type Barangay } from '@/lib/dashboardData'
import type { LiveHydrograph } from '@/lib/liveIslandState'
import BarangayList from '@/components/BarangayList'
import BarangayDetailPanel from '@/components/BarangayDetailPanel'
import MunicipalityFilterDropdown from '@/components/MunicipalityFilterDropdown'

export default function DashboardShell({
  barangays,
  loadError,
  selectedKey,
  onSelectKey,
  municipality,
  onMunicipalityChange,
  theme,
  liveActive,
  liveHydrograph,
  liveRainfallFactor,
}: {
  barangays: Barangay[] | null
  loadError: string | null
  selectedKey: string | null
  onSelectKey: (key: string) => void
  // Lifted to page.tsx too (same as selectedKey) so the map and this
  // filter stay in sync both ways — tapping a municipality on the map
  // updates this, and picking one here moves the map.
  municipality: string | null
  onMunicipalityChange: (name: string | null) => void
  // Passed straight through to MunicipalityFilterDropdown — its open panel
  // is portaled to document.body (see that file), outside .bfw-root's
  // [data-theme] scope that defines --card-bg/--text-strong/etc., so it
  // can't read those CSS variables via normal inheritance and needs the
  // theme as an explicit prop instead.
  theme: 'light' | 'dark'
  // True once app/page.tsx's live-forecast recompute (lib/liveIslandState.ts)
  // has real data for at least one municipality — swaps the banner below
  // from the old "synthetic storm" framing to a live-computation notice.
  // False (or still loading) falls back to the original honest framing,
  // since the numbers really are still the static synthetic-storm ones
  // until live data arrives.
  liveActive: boolean
  // The currently-selected barangay's live-forecast discharge curve, or
  // null (not loaded yet, or one of the 2 basin-less barangays) — forwarded
  // straight through to BarangayDetailPanel, computed once in app/page.tsx
  // rather than per-render here.
  liveHydrograph?: LiveHydrograph | null
  liveRainfallFactor?: number | null
}) {
  const sorted = useMemo(() => (barangays ? sortBySeverity(barangays) : []), [barangays])
  const filtered = useMemo(
    () => filterBarangays(sorted, '', municipality),
    [sorted, municipality]
  )
  const selected = useMemo(
    () => sorted.find((b) => b.key === selectedKey) ?? null,
    [sorted, selectedKey]
  )

  // Stabilized wrapper for onSelectKey (itself already useCallback'd in
  // app/page.tsx) — BarangayList's rows are React.memo-wrapped, which an
  // inline arrow recreated on every DashboardShell render would defeat.
  const handleSelect = useCallback((b: Barangay) => onSelectKey(b.key), [onSelectKey])

  return (
    <div className="flex h-full min-h-0 flex-col gap-4">
      <div
        className="rounded-lg border px-3 py-2 text-xs"
        style={
          liveActive
            ? { background: 'rgba(10, 112, 117, 0.15)', borderColor: '#0A7075', color: 'var(--text-strong)' }
            : { background: 'rgba(192, 57, 43, 0.15)', borderColor: '#C0392B', color: 'var(--text-strong)' }
        }
      >
        {liveActive
          ? "Computed from today's live Open-Meteo forecast — FSI = 0.30·HAND + 0.30·TWI + 0.20·LCLU + 0.20·live rainfall; Warning/Alert/Danger = 50%/75%/95% of each basin's live-forecast peak discharge."
          : 'Loading the live forecast — showing the static synthetic design-storm baseline until it arrives.'}
      </div>

      {loadError && (
        <p className="text-sm" style={{ color: '#C0392B' }}>Couldn&apos;t load barangay data: {loadError}</p>
      )}

      {barangays && (
        <>
          <div className="flex flex-wrap items-center gap-2">
            <MunicipalityFilterDropdown value={municipality} onChange={onMunicipalityChange} theme={theme} />
          </div>

          <div className="grid min-h-0 flex-1 grid-cols-1 gap-4 lg:grid-cols-2">
            {/*
              Below lg:, this column comes first — same "pinned above the
              list" reasoning as before this round, so opening the sidebar
              with something already selected still reveals the full
              FSI/hydrograph/factor-breakdown detail immediately without
              scrolling past the list first. At lg: and up it moves to the
              right, alongside the list instead of above it.
            */}
            <div className="bfw-sidebar-detail-col order-1 min-h-0 overflow-y-auto lg:order-2">
              <BarangayDetailPanel barangay={selected} liveHydrograph={liveHydrograph} liveRainfallFactor={liveRainfallFactor} />
            </div>

            <div className="bfw-sidebar-list-col order-2 min-h-0 overflow-y-auto lg:order-1">
              <h3 className="px-1 text-xs font-semibold uppercase tracking-wide" style={{ color: 'var(--text-soft)' }}>
                Barangays by flood susceptibility, highest first
              </h3>
              <BarangayList
                barangays={filtered}
                selectedKey={selectedKey}
                onSelect={handleSelect}
                onSelectMunicipality={onMunicipalityChange}
              />
            </div>
          </div>
        </>
      )}
    </div>
  )
}
