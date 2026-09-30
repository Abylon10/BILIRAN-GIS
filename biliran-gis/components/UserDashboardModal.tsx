// components/UserDashboardModal.tsx
//
// The "Rainfall & Scenarios" admin tab content (components/AdminShell.tsx)
// — the real end-user dashboard (map + barangay list + detail panel,
// including the real hydrograph and factor breakdown) as a self-contained
// snapshot, plus a "Simulation Mode" entry point. Its own selectedKey/
// municipality state is local and independent of app/page.tsx's — this is
// a read-only-ish view, not a second copy of the live dashboard's
// navigation state.
//
// Takes an `embedded` prop: true when rendered as AdminShell tab content
// (no fixed inset-0 overlay, no fade-in transition, no top-left "×" — the
// tab bar itself is the way in and out, so there's nothing for this view
// to close back to on its own). `onClose` becomes optional accordingly —
// only the non-embedded (default) mode ever calls it.
//
// The map here is StaticIslandMap (read-only, no pan/zoom) — NOT a second
// <BiliranMap> instance. See that file's header comment for why this
// doesn't reopen this app's "one persistent map" decision. It's sized
// larger here than its default (a full-screen view has the room), still
// the same non-interactive component either way.
//
// Simulation Mode: for the embedded (Rainfall & Scenarios tab) case, an
// always-visible right-column panel (see the two-column layout below);
// for the non-embedded case, still the original slide-out sidebar from
// the right edge, always mounted but transformed off-screen when closed
// so its own input state survives being closed/reopened — kept as-is in
// case a future non-embedded caller returns (see UserDashboardModal's
// own `embedded` prop comment above). Either way, "Start simulation"
// runs the storm against the WHOLE island at once (lib/
// islandSimulation.ts) — see islandSim below: every barangay's displayed
// FSI score/label and Warning/Alert/Danger countdown gets overridden
// with its simulated value, which re-sorts the ranking and re-colors the
// map for free (BarangayList.tsx/BarangayDetailPanel.tsx/
// StaticIslandMap.tsx all need zero changes for this — they only ever
// read whatever Barangay[] they're handed, never look up the "real" data
// themselves). Countdown recompute reuses a real, disclosed formula
// (threshold-crossing on simulated discharge); FSI recompute is a
// disclosed approximation the user explicitly asked for after being told
// no real discharge-to-FSI formula exists — see lib/islandSimulation.ts's
// own header comment for the full reasoning.
//
// Embedded two-column layout (this round, matching a reference mockup):
// left column is the map + a "Barangay Ranking" table (a real `<table>`,
// same pattern as AdminDashboardTab.tsx's own "Recent FSI by barangay"
// table — replaces the row-button BarangayList for this tab specifically,
// other BarangayList callers untouched); right column is the always-
// visible SimulationModePanel plus a new "Selected Barangay" summary
// card (small map thumbnail + FSI/countdown/rainfall recap, all fields
// BarangayDetailPanel already receives, just re-presented compactly),
// immediately followed by the real BarangayDetailPanel itself as a
// separate sibling card (not nested inside the summary card behind a
// toggle, per feedback from testing the previous round's build — the FSI
// summary and the full hydrograph/factor-breakdown detail need to read
// as two distinct sections). SimulationModePanel's own `onReset`
// (not `onExit`, which the embedded case doesn't pass) clears `islandSim`
// here — consolidating what used to be a separate "⚠ SIMULATED · Clear"
// header chip into the panel's own Reset button, since its output is
// always visible now rather than living in a dismissable sidebar.

'use client'

import { useEffect, useMemo, useState } from 'react'
import {
  loadBarangays,
  filterBarangays,
  sortBySeverity,
  formatHoursAsCountdown,
  urgencyTierColor,
  type Barangay,
} from '@/lib/dashboardData'
import { opaqueBg } from '@/lib/opaqueTheme'
import type { SimulationParams, SimulationRunResult } from '@/lib/simulationMode'
import type { IslandSimResult } from '@/lib/islandSimulation'
import StaticIslandMap from '@/components/StaticIslandMap'
import MunicipalityFilterDropdown from '@/components/MunicipalityFilterDropdown'
import BarangayList from '@/components/BarangayList'
import BarangayDetailPanel from '@/components/BarangayDetailPanel'
import SimulationModePanel from '@/components/SimulationModePanel'

const TRANSITION_MS = 300
const MAP_HEIGHT = 320
const THUMBNAIL_HEIGHT = 120

interface IslandSim {
  params: SimulationParams
  results: Map<string, IslandSimResult>
}

export default function UserDashboardModal({
  onClose,
  theme,
  embedded = false,
}: {
  onClose?: () => void
  theme: 'light' | 'dark'
  embedded?: boolean
}) {
  const [barangays, setBarangays] = useState<Barangay[] | null>(null)
  const [selectedKey, setSelectedKey] = useState<string | null>(null)
  const [municipality, setMunicipality] = useState<string | null>(null)
  const [search, setSearch] = useState('')
  const [sidebarOpen, setSidebarOpen] = useState(false)
  const [islandSim, setIslandSim] = useState<IslandSim | null>(null)

  // Same two-phase open/close technique as the shared Modal
  // (components/ProfilePanel.tsx) — `open` starts false and flips true
  // next frame to drive the entrance transition; requestClose flips it
  // back and defers the real onClose until the CSS transition has run.
  // Embedded mode skips this entirely — it's tab content, not an overlay
  // that fades in/out, so `open` just stays true the whole time.
  const [open, setOpen] = useState(embedded)
  useEffect(() => {
    if (embedded) return
    const raf = requestAnimationFrame(() => setOpen(true))
    return () => cancelAnimationFrame(raf)
  }, [embedded])
  function requestClose() {
    if (embedded) return
    setOpen(false)
    setTimeout(() => onClose?.(), TRANSITION_MS)
  }

  useEffect(() => {
    loadBarangays()
      .then(setBarangays)
      .catch(() => {
        // Same lazy-load pattern as the real dashboard — no dedicated error UI here.
      })
  }, [])

  // Overlays each barangay's real FSI/countdown fields with its simulated
  // ones when a simulation is active — everything downstream (sort,
  // filter, list rows, map color, detail panel) just reads these fields
  // off whatever Barangay object it's given, so nothing else needs to
  // know a simulation is even happening. Falls back to the real
  // warning/alert/danger times for the 2 basin-less barangays (no
  // discharge curve to derive a countdown from), same honest-absence
  // pattern as their missing hydrograph chart elsewhere in this app.
  const displayBarangays = useMemo(() => {
    if (!barangays || !islandSim) return barangays
    return barangays.map((b) => {
      const r = islandSim.results.get(b.key)
      if (!r) return b
      return {
        ...b,
        mean_fsi_score: r.simulatedFsi,
        dominant_fsi_label: r.simulatedLabel,
        warning_time_hours: r.warningTimeHours ?? b.warning_time_hours,
        alert_time_hours: r.alertTimeHours ?? b.alert_time_hours,
        danger_time_hours: r.dangerTimeHours ?? b.danger_time_hours,
      }
    })
  }, [barangays, islandSim])

  const sorted = useMemo(() => (displayBarangays ? sortBySeverity(displayBarangays) : []), [displayBarangays])
  const filtered = useMemo(
    () => filterBarangays(sorted, embedded ? search : '', municipality),
    [sorted, municipality, search, embedded]
  )
  const selected = useMemo(() => sorted.find((b) => b.key === selectedKey) ?? null, [sorted, selectedKey])

  const simulationResult: SimulationRunResult | null = useMemo(() => {
    if (!islandSim || !selected) return null
    const entry = islandSim.results.get(selected.key)
    if (!entry?.hydrograph) return null
    return {
      minRate: islandSim.params.minRate,
      maxRate: islandSim.params.maxRate,
      durationHours: islandSim.params.durationHours,
      sim: entry.hydrograph,
    }
  }, [islandSim, selected])

  const bg = opaqueBg(theme)

  const disclosureBanner = islandSim ? (
    <div
      className="rounded-lg border px-3 py-2 text-xs"
      style={{ background: 'rgba(184, 134, 11, 0.15)', borderColor: '#B8860B', color: 'var(--text-strong)' }}
    >
      Showing a SIMULATED scenario ({islandSim.params.minRate}-{islandSim.params.maxRate}mm/hr rain,{' '}
      {islandSim.params.durationHours}h duration) — FSI scores, ranking, and countdown times below are
      recomputed for this storm, not real conditions. FSI is an approximate recombination of each
      barangay&apos;s real terrain factors with a scenario-scaled rainfall input, not the authoritative
      score.
    </div>
  ) : (
    <div
      className="rounded-lg border px-3 py-2 text-xs"
      style={{ background: 'rgba(192, 57, 43, 0.15)', borderColor: '#C0392B', color: 'var(--text-strong)' }}
    >
      Modeled from a single synthetic design storm, not a live rainfall feed — treat every
      countdown below as illustrative until a real forecast is wired in.
    </div>
  )

  return (
    <div
      className={embedded ? 'flex flex-col' : 'bfw-user-dashboard fixed inset-0 z-50 flex flex-col'}
      data-open={open}
      style={embedded ? undefined : { background: bg }}
    >
      <style>{`
        .bfw-user-dashboard {
          opacity: 0;
          transition: opacity ${TRANSITION_MS}ms cubic-bezier(0.22,1,0.36,1);
        }
        .bfw-user-dashboard[data-open='true'] { opacity: 1; }
        .bfw-sim-sidebar {
          transform: translateX(100%);
          pointer-events: none;
          transition: transform ${TRANSITION_MS}ms cubic-bezier(0.22,1,0.36,1);
        }
        .bfw-sim-sidebar[data-open='true'] { transform: translateX(0); pointer-events: auto; }
        @media (prefers-reduced-motion: reduce) {
          .bfw-user-dashboard, .bfw-sim-sidebar { transition: none !important; }
        }
      `}</style>

      {!embedded && (
        <div
          className="flex shrink-0 items-center justify-between gap-3 border-b px-6 py-4"
          style={{ borderColor: 'var(--card-border)' }}
        >
          <button
            type="button"
            onClick={requestClose}
            aria-label="Close user dashboard"
            className="bfw-btn flex h-9 w-9 shrink-0 items-center justify-center rounded-full text-lg leading-none"
          >
            ×
          </button>
          <h2 className="text-lg font-semibold" style={{ color: 'var(--text-strong)' }}>
            User Dashboard
          </h2>
          <div className="flex shrink-0 items-center gap-2">
            {/*
              Persistent, never scrolls out of view (unlike the banner
              below, which lives inside the scrollable body) — the one
              disclosure surface guaranteed visible the entire time a
              simulation is active, however far the list is scrolled.
            */}
            {islandSim && (
              // Solid #B8860B, not a translucent rgba fill — see
              // SimulationModePanel.tsx's own comment on its matching
              // chip for why (translucent + dark text broke in Night mode).
              <button
                type="button"
                onClick={() => setIslandSim(null)}
                className="rounded-full border px-3 py-1.5 text-xs font-semibold"
                style={{ background: '#B8860B', borderColor: '#B8860B', color: '#3D2B00' }}
              >
                ⚠ SIMULATED · Clear
              </button>
            )}
            <button
              type="button"
              className="bfw-btn rounded-full px-4 py-2 text-sm font-semibold"
              onClick={() => setSidebarOpen(true)}
              disabled={!barangays}
            >
              Simulation Mode
            </button>
          </div>
        </div>
      )}

      {!embedded && (
        <div className="flex min-h-0 flex-1 flex-col gap-4 overflow-y-auto p-6">
          {disclosureBanner}

          {displayBarangays && (
            <>
              <StaticIslandMap barangays={displayBarangays} selectedKey={selectedKey} highlightMunicipality={municipality} height={MAP_HEIGHT} />

              <MunicipalityFilterDropdown value={municipality} onChange={setMunicipality} theme={theme} />

              <div className="grid min-h-0 flex-1 grid-cols-1 gap-4 md:grid-cols-[1fr_320px]">
                <div className="min-h-0 overflow-y-auto pr-1">
                  <h3 className="mb-2 px-1 text-xs font-semibold uppercase tracking-wide" style={{ color: 'var(--text-soft)' }}>
                    Barangays by flood susceptibility, highest first
                  </h3>
                  <BarangayList
                    barangays={filtered}
                    selectedKey={selectedKey}
                    onSelect={(b) => setSelectedKey(b.key)}
                    onSelectMunicipality={setMunicipality}
                  />
                </div>
                <div className="min-h-0 overflow-y-auto">
                  <BarangayDetailPanel barangay={selected} simulationResult={simulationResult} />
                </div>
              </div>
            </>
          )}
        </div>
      )}

      {embedded && displayBarangays && (
        <div className="grid min-h-0 flex-1 grid-cols-1 gap-4 overflow-y-auto lg:grid-cols-[1fr_360px]">
          <div className="flex flex-col gap-4">
            {disclosureBanner}

            <StaticIslandMap barangays={displayBarangays} selectedKey={selectedKey} highlightMunicipality={municipality} height={MAP_HEIGHT} />

            <div className="flex flex-wrap items-center gap-2">
              <input
                type="text"
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder="Search barangay name…"
                className="min-w-0 flex-1 rounded-md border px-3 py-2 text-sm outline-none"
                style={{ borderColor: 'var(--field-line)', color: 'var(--text-strong)' }}
              />
              <MunicipalityFilterDropdown value={municipality} onChange={setMunicipality} theme={theme} />
            </div>

            {/*
              Same BarangayList row component the non-embedded "Open User
              Dashboard" path already uses (below) — per direct feedback,
              this tab's own ranking list should look like that one, not
              like a distinct flat table (BarangayRankingTable, which this
              replaces — see its own removed definition's history in
              CLAUDE.md for why it existed before this).
            */}
            <BarangayList
              barangays={filtered}
              selectedKey={selectedKey}
              onSelect={(b) => setSelectedKey(b.key)}
              onSelectMunicipality={setMunicipality}
            />
          </div>

          <div className="flex flex-col gap-4">
            <SimulationModePanel
              selectedBarangay={selected}
              onReset={() => setIslandSim(null)}
              onSimulate={(results, params) => setIslandSim({ results, params })}
            />

            {selected && (
              <>
                <SelectedBarangayCard barangay={selected} islandSim={islandSim} />
                {/*
                  A separate sibling card, not nested inside
                  SelectedBarangayCard's own border — the FSI summary and
                  the full hydrograph/factor-breakdown detail read as two
                  distinct sections again (matching the pre-two-column
                  layout), not one box with a "View full details" toggle.
                  BarangayDetailPanel already renders its own
                  rounded-xl/border/p-5 card, so no new styling is needed
                  here for it to look separate.
                */}
                <BarangayDetailPanel barangay={selected} simulationResult={simulationResult} />
              </>
            )}
          </div>
        </div>
      )}

      {!embedded && (
        <div
          className="bfw-sim-sidebar fixed right-0 top-0 z-[60] flex h-full w-80 flex-col border-l p-4 shadow-2xl"
          data-open={sidebarOpen}
          style={{ background: bg, borderColor: 'var(--card-border)' }}
        >
          <SimulationModePanel
            selectedBarangay={selected}
            onExit={() => setSidebarOpen(false)}
            onSimulate={(results, params) => {
              setIslandSim({ results, params })
              setSidebarOpen(false)
            }}
          />
        </div>
      )}
    </div>
  )
}

// "Selected Barangay" compact summary card for the embedded layout's
// right column — every field here is already computed/available on
// `barangay`/`islandSim`, nothing new is fetched or invented. The real
// BarangayDetailPanel (hydrograph/factor breakdown) renders as this
// card's own separate sibling in UserDashboardModal's own JSX, not
// nested inside here behind a toggle — keeps the FSI summary and the
// full detail visually distinct, per the user's own "separate the FSI
// and hydrograph, like before" request.
function SelectedBarangayCard({
  barangay,
  islandSim,
}: {
  barangay: Barangay
  islandSim: IslandSim | null
}) {
  return (
    <div className="flex flex-col gap-3 rounded-lg border p-3" style={{ borderColor: 'var(--card-border)' }}>
      <div>
        <h3 className="text-xs font-semibold uppercase tracking-wide" style={{ color: 'var(--text-soft)' }}>
          Selected barangay
        </h3>
        <p className="text-sm font-semibold" style={{ color: 'var(--text-strong)' }}>{barangay.barangay}</p>
        <p className="text-xs" style={{ color: 'var(--text-soft)' }}>{barangay.municipality}, Biliran</p>
      </div>

      <StaticIslandMap barangays={[barangay]} selectedKey={barangay.key} height={THUMBNAIL_HEIGHT} />

      <div className="grid grid-cols-2 gap-2 text-xs">
        <div>
          <div style={{ color: 'var(--text-soft)' }}>FSI score</div>
          <div className="flex items-center gap-1.5">
            <span className="text-base font-semibold" style={{ color: 'var(--text-strong)' }}>{barangay.mean_fsi_score.toFixed(2)}</span>
            <span
              className="rounded-full px-1.5 py-0.5 text-[10px] font-semibold"
              style={{ background: `${urgencyTierColor(barangay.dominant_fsi_label)}33`, color: urgencyTierColor(barangay.dominant_fsi_label) }}
            >
              {barangay.dominant_fsi_label}
            </span>
          </div>
        </div>
        <div>
          <div style={{ color: 'var(--text-soft)' }}>Predicted countdown</div>
          <div className="font-semibold" style={{ color: 'var(--text-strong)' }}>{formatHoursAsCountdown(barangay.danger_time_hours)} to Danger</div>
        </div>
        {islandSim && (
          <>
            <div>
              <div style={{ color: 'var(--text-soft)' }}>Rainfall (mm/hr)</div>
              <div className="font-semibold" style={{ color: 'var(--text-strong)' }}>
                {islandSim.params.minRate}–{islandSim.params.maxRate}
                <span className="ml-1 font-normal" style={{ color: 'var(--text-soft)' }}>(scenario range)</span>
              </div>
            </div>
            <div>
              <div style={{ color: 'var(--text-soft)' }}>Simulation duration</div>
              <div className="font-semibold" style={{ color: 'var(--text-strong)' }}>
                {islandSim.params.durationHours}h
                <span className="ml-1 font-normal" style={{ color: 'var(--text-soft)' }}>(scenario)</span>
              </div>
            </div>
          </>
        )}
      </div>

      <p className="text-[10px]" style={{ color: 'var(--text-soft)' }}>
        {islandSim
          ? 'This is a simulated result based on the selected scenario. Actual conditions may vary.'
          : 'Real modeled values from the static design storm — not a live forecast.'}
      </p>
    </div>
  )
}
