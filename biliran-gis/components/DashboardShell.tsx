// components/DashboardShell.tsx
//
// Replaces the .bfw-dash placeholder in app/page.tsx. Built from what
// barangay_dashboard_data.json + public/data/geo/*.geojson actually contain
// (see lib/dashboardData.ts, lib/geo.ts, CLAUDE.md). Still deliberately does
// NOT include a real hydrograph chart or FSI factor breakdown — those need
// per-basin time-series/factor data that isn't part of this repo's data.
// Building fake versions of those would mislead the officials this app is
// for. The compact layout below does reserve a labeled hydrograph corner
// (HYDROGRAPH_UNAVAILABLE_LABEL) so the spot exists and reads honestly as
// "not yet modeled" rather than either fabricating a curve or looking
// broken/missing. The map, though, is real: actual barangay/municipality
// polygons, not a placeholder — see BiliranMap.tsx.
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

// Row count, not a pixel value — more meaningful than an arbitrary pixel
// threshold since row height could vary, and robust to it if it ever does
// (checked via each row's own getBoundingClientRect, not row-height math).
// SCROLL_DEBOUNCE_MS still avoids flickering the map in and out mid-scroll
// (the settled answer to Part 3's "instant vs debounced" question) — though
// now that compacting is one-way (see handleListScroll below), "flicker"
// really just means "compact a beat too early while still fast-scrolling
// past row 8," not an in-and-out toggle.
const ROW_COMPACT_THRESHOLD = 8
const SCROLL_DEBOUNCE_MS = 100

// ~20% bigger than the original 160×120 starting point — eyeballed
// against the real layout, not a pixel-perfect spec.
const COMPACT_MAP_WIDTH = 192
const COMPACT_MAP_HEIGHT = 144

// Not a chart — see the file header comment. This corner exists so the
// compact layout has a labeled, honest placeholder instead of either a
// fabricated curve or an empty gap where a hydrograph would eventually go.
const HYDROGRAPH_UNAVAILABLE_LABEL = 'No basin flow data available yet'

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

  // One-way: once compacted, scroll position no longer matters — only an
  // explicit tap on the compacted map re-expands it (see onCompactTap in
  // app/page.tsx). So this only ever calls onListScrolledChange(true), and
  // only while not already compact.
  const scrollDebounceRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  function handleListScroll(e: React.UIEvent<HTMLDivElement>) {
    if (listScrolled) return
    const container = e.currentTarget
    if (scrollDebounceRef.current) clearTimeout(scrollDebounceRef.current)
    scrollDebounceRef.current = setTimeout(() => {
      // Re-queried at settle time (not per scroll tick) — container is a
      // real DOM node captured above, safe to read after the debounce
      // delay (unlike the SyntheticEvent itself, whose currentTarget goes
      // stale once the handler returns).
      const targetRow = container.querySelectorAll('li')[ROW_COMPACT_THRESHOLD - 1]
      // Fewer than ROW_COMPACT_THRESHOLD barangays in the filtered list
      // (e.g. a small municipality filter) — that row never exists, so
      // scrolling can never trigger compacting; nothing to do.
      if (!targetRow) return
      if (targetRow.getBoundingClientRect().top <= container.getBoundingClientRect().top) {
        onListScrolledChange(true)
      }
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
              className="bfw-btn rounded-full px-3 py-2 text-sm outline-none"
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
            map into.

            Once compact (listScrolled), this wrapper switches from a flex
            column to a 2×2 CSS grid: the map spacer is pinned to the
            top-left cell at its exact compact size/position (so
            mapSlotRef's measured rect — and therefore the real map's
            on-screen box — never changes because of this; only this
            component's own layout around it does), and the list+detail
            grid fills the remaining column beside the map (and both rows,
            so it still extends below it too) instead of leaving that
            space empty. The FSI legend itself can't move into that space
            — it's rendered inside BiliranMap's own box, clipped to it
            (overflow-hidden) — so the list is just sized to sit beside
            the compact map+legend without overlapping it.
          */}
          <div
            className={listScrolled ? 'grid min-h-0 flex-1 gap-4' : 'flex min-h-0 flex-1 flex-col gap-4'}
            style={
              listScrolled
                ? { gridTemplateColumns: `${COMPACT_MAP_WIDTH}px 1fr`, gridTemplateRows: `${COMPACT_MAP_HEIGHT}px 1fr` }
                : undefined
            }
          >
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
              style={{
                pointerEvents: 'none',
                width: listScrolled ? COMPACT_MAP_WIDTH : undefined,
                height: listScrolled ? COMPACT_MAP_HEIGHT : undefined,
                ...(listScrolled ? { gridColumn: 1, gridRow: 1 } : {}),
              }}
            />

            {/*
              Directly below the compact map (and its FSI legend, which
              lives inside the map's own box) — the grid cell at column 1,
              row 2 is otherwise empty once compact. Deliberately NOT a
              chart (see the file header comment) — dashed border + muted
              text mark it as a reserved-but-unavailable feature, not a
              broken one.
            */}
            {listScrolled && (
              <div
                className="flex flex-col items-center justify-center gap-1 rounded-lg border border-dashed px-2 py-1 text-center"
                style={{
                  gridColumn: 1,
                  gridRow: 2,
                  width: COMPACT_MAP_WIDTH,
                  borderColor: 'var(--card-border)',
                  color: 'var(--text-soft)',
                  opacity: 0.75,
                }}
              >
                <span className="text-[10px] font-semibold uppercase tracking-wide">Hydrograph</span>
                <span className="text-[10px] leading-tight">{HYDROGRAPH_UNAVAILABLE_LABEL}</span>
              </div>
            )}

            <div
              className="grid min-h-0 flex-1 grid-cols-1 gap-4 md:grid-cols-[1fr_320px]"
              style={listScrolled ? { gridColumn: 2, gridRow: '1 / span 2' } : undefined}
            >
              <div ref={listScrollRef} onScroll={handleListScroll} className="min-h-0 overflow-y-auto pr-1">
                <h3 className="mb-2 px-1 text-xs font-semibold uppercase tracking-wide" style={{ color: 'var(--text-soft)' }}>
                  Barangays by flood susceptibility, highest first
                </h3>
                <BarangayList
                  barangays={filtered}
                  selectedKey={selectedKey}
                  onSelect={(b) => onSelectKey(b.key)}
                  onSelectMunicipality={onMunicipalityChange}
                />
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
