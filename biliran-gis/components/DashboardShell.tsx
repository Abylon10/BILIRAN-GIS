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

import { useMemo, useRef, type RefObject } from 'react'
import { filterBarangays, sortBySeverity, type Barangay } from '@/lib/dashboardData'
import { MONITORED_MUNICIPALITIES } from '@/lib/municipalities'
import LiveUpdateBanner from '@/components/LiveUpdateBanner'
import BarangayList from '@/components/BarangayList'
import BarangayDetailPanel from '@/components/BarangayDetailPanel'

// How far the barangay list has to scroll, and how long it has to sit
// still past that point, before the map compacts — both tuned so ordinary
// scrolling through the list doesn't flicker the map in and out near the
// threshold (the settled answer to Part 3's "instant vs debounced" question).
const SCROLL_COMPACT_THRESHOLD_PX = 50
const SCROLL_DEBOUNCE_MS = 100

export default function DashboardShell({
  barangays,
  loadError,
  selectedKey,
  onSelectKey,
  municipality,
  onMunicipalityChange,
  mapSlotRef,
  listScrollRef,
  listScrolled,
  onListScrolledChange,
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
  mapSlotRef: RefObject<HTMLDivElement | null>
  // The barangay list's own scroll container — page.tsx also uses this
  // directly to scroll back to top when the compacted map is tapped (see
  // BiliranMap.tsx's onCompactTap), so it's owned up there like mapSlotRef,
  // not created locally in this component.
  listScrollRef: RefObject<HTMLDivElement | null>
  listScrolled: boolean
  onListScrolledChange: (scrolled: boolean) => void
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

  const scrollDebounceRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  function handleListScroll(e: React.UIEvent<HTMLDivElement>) {
    const scrollTop = e.currentTarget.scrollTop
    if (scrollDebounceRef.current) clearTimeout(scrollDebounceRef.current)
    scrollDebounceRef.current = setTimeout(() => {
      onListScrolledChange(scrollTop > SCROLL_COMPACT_THRESHOLD_PX)
    }, SCROLL_DEBOUNCE_MS)
  }

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
          {/*
            Disappears while the list is scrolled (compact map) rather than
            shrinking in place — the settled answer to Part 3's "what
            happens to the alert banner" question. Reappears once scrolled
            back above the threshold, same as the map expanding again.
          */}
          {!listScrolled && <LiveUpdateBanner barangays={barangays} onSelect={(b) => onSelectKey(b.key)} />}

          <div className="flex flex-wrap items-center gap-2">
            <select
              value={municipality ?? ''}
              onChange={(e) => onMunicipalityChange(e.target.value || null)}
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
            The map is the dominant element here (~70% of the available
            height) until the list scrolls — this div is an empty spacer,
            not the map itself, reserving the layout space that page.tsx
            measures (getBoundingClientRect) to animate the real, persistent
            map into. Shrinking it to the compact size below is what gives
            the list its reclaimed vertical space — the grid row underneath
            is flex-1, so it grows to fill whatever this spacer gives up.
          */}
          <div className="flex min-h-0 flex-1 flex-col gap-4">
            {/*
              pointer-events: none — this spacer only reserves layout
              space; the real map is a position:fixed sibling elsewhere in
              the DOM (app/page.tsx's .bfw-map-shell) sitting at a LOWER
              z-index than .bfw-dash (which this spacer is inside), so
              without this the spacer silently swallows every click/drag/
              wheel gesture meant for the map underneath it (found via this
              feature's own testing — tap-to-zoom-a-municipality never
              reached the map once boxed into the dashboard). No transition
              on this spacer itself (it's invisible) — the visible move/
              resize is .bfw-map-shell's own existing eased transition
              (app/page.tsx), driven by re-measuring this rect once it's
              already settled at its new size.
            */}
            <div
              ref={mapSlotRef}
              className={listScrolled ? 'shrink-0' : 'h-96 shrink-0 md:h-[70%]'}
              style={{ pointerEvents: 'none', width: listScrolled ? 160 : undefined, height: listScrolled ? 120 : undefined }}
            />
            <div className="grid min-h-0 flex-1 grid-cols-1 gap-4 md:grid-cols-[1fr_320px]">
              <div ref={listScrollRef} onScroll={handleListScroll} className="min-h-0 overflow-y-auto pr-1">
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
