// components/DashboardShell.tsx
//
// Replaces the .bfw-dash placeholder in app/page.tsx. Built from what
// barangay_dashboard_data.json + public/data/geo/*.geojson actually contain
// (see lib/dashboardData.ts, lib/geo.ts, CLAUDE.md). Still deliberately does
// NOT include a hydrograph chart or FSI factor breakdown — those need
// per-basin time-series/factor data that isn't part of this repo's data.
// Building fake versions of those would mislead the officials this app is
// for. The map, though, is real: actual barangay/municipality polygons, not
// a placeholder — see BiliranMap.tsx.
//
// The map defaults to the whole-island view, unzoomed — it never
// auto-focuses a municipality or barangay on load, even though the LIVE
// UPDATE banner names the most urgent one; that's intentional so officials
// aren't dropped into one place before they've chosen to look there.
//
// The map itself is NOT rendered here — app/page.tsx mounts a single
// <BiliranMap> that persists across the login and dashboard states (see
// "one map, not two" in CLAUDE.md), animating its own wrapping box between
// a full-bleed login backdrop and its boxed spot here. This component just
// reserves that spot's layout space with an empty ref'd div (mapSlotRef) —
// page.tsx measures it (getBoundingClientRect) to know where to animate the
// real map into. barangays/loadError/selectedKey are lifted to page.tsx too,
// both because the persistent map needs them before this component ever
// mounts, and so the map and this list/detail panel share one selection.

'use client'

import { useMemo, useState, type RefObject } from 'react'
import { filterBarangays, sortBySeverity, type Barangay } from '@/lib/dashboardData'
import { MONITORED_MUNICIPALITIES } from '@/lib/municipalities'
import LiveUpdateBanner from '@/components/LiveUpdateBanner'
import BarangayList from '@/components/BarangayList'
import BarangayDetailPanel from '@/components/BarangayDetailPanel'

export default function DashboardShell({
  barangays,
  loadError,
  selectedKey,
  onSelectKey,
  mapSlotRef,
}: {
  barangays: Barangay[] | null
  loadError: string | null
  selectedKey: string | null
  onSelectKey: (key: string) => void
  mapSlotRef: RefObject<HTMLDivElement | null>
}) {
  const [query, setQuery] = useState('')
  const [municipality, setMunicipality] = useState<string | null>(null)

  const sorted = useMemo(() => (barangays ? sortBySeverity(barangays) : []), [barangays])
  const filtered = useMemo(
    () => filterBarangays(sorted, query, municipality),
    [sorted, query, municipality]
  )
  const selected = useMemo(
    () => sorted.find((b) => b.key === selectedKey) ?? null,
    [sorted, selectedKey]
  )

  return (
    <div className="flex h-full flex-col gap-4">
      <div
        className="rounded-lg border px-3 py-2 text-xs"
        style={{ background: 'rgba(192, 57, 43, 0.15)', borderColor: '#C0392B', color: '#F2D9D5' }}
      >
        Modeled from a single synthetic design storm, not a live rainfall feed — treat every
        countdown below as illustrative until a real forecast is wired in.
      </div>

      {loadError && (
        <p className="text-sm text-[#F2D9D5]">Couldn&apos;t load barangay data: {loadError}</p>
      )}

      {barangays && (
        <>
          <LiveUpdateBanner barangays={barangays} onSelect={(b) => onSelectKey(b.key)} />

          <div className="flex flex-wrap items-center gap-2">
            <input
              type="search"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Search barangay or municipality…"
              className="min-w-[200px] flex-1 rounded-md border px-3 py-2 text-sm outline-none"
              style={{ background: 'var(--card-bg)', borderColor: 'var(--card-border)', color: 'var(--text-strong)' }}
            />
            <select
              value={municipality ?? ''}
              onChange={(e) => setMunicipality(e.target.value || null)}
              className="rounded-md border px-3 py-2 text-sm outline-none"
              style={{ background: 'var(--card-bg)', borderColor: 'var(--card-border)', color: 'var(--text-strong)' }}
            >
              <option value="">All municipalities</option>
              {MONITORED_MUNICIPALITIES.map((m) => (
                <option key={m} value={m}>{m}</option>
              ))}
            </select>
          </div>

          {/*
            The map is the dominant element here (~60% of the available
            height), not one of two panes sharing a column with the list.
            This div is an empty spacer, not the map itself — it just
            reserves the layout space (and its position/size is what
            page.tsx measures to animate the real, persistent map into).
          */}
          <div className="flex min-h-0 flex-1 flex-col gap-4">
            <div ref={mapSlotRef} className="h-80 shrink-0 md:h-[60%]" />
            <div className="grid min-h-0 flex-1 grid-cols-1 gap-4 md:grid-cols-[1fr_320px]">
              <div className="min-h-0 overflow-y-auto pr-1">
                <h3 className="mb-2 px-1 text-xs font-semibold uppercase tracking-wide" style={{ color: 'var(--text-soft)' }}>
                  Barangays by flood susceptibility, highest first
                </h3>
                <BarangayList barangays={filtered} selectedKey={selectedKey} onSelect={(b) => onSelectKey(b.key)} />
              </div>
              <div className="hidden md:block">
                <BarangayDetailPanel barangay={selected} />
              </div>
            </div>
          </div>

          {/* Selected detail, inline on small screens where the sidebar is hidden. */}
          {selected && (
            <div className="md:hidden">
              <BarangayDetailPanel barangay={selected} />
            </div>
          )}
        </>
      )}
    </div>
  )
}
