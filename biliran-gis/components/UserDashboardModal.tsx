// components/UserDashboardModal.tsx
//
// "Open User Dashboard" — reachable from inside the admin session
// (AdminInvitePanel.tsx) without leaving it: a full-screen takeover (not
// a centered dialog) showing the real end-user dashboard (map + barangay
// list + detail panel, including the real hydrograph and factor
// breakdown) as a self-contained snapshot, plus a "Simulation Mode" entry
// point. Its own selectedKey/municipality state is local and independent
// of app/page.tsx's — this is a read-only-ish view, not a second copy of
// the live dashboard's navigation state.
//
// Full-screen rather than a dialog-over-a-backdrop on purpose: the
// Invitations panel that opens this is never mounted at the same time
// (see AdminInvitePanel.tsx's showUserDashboard branch) — stacking two
// independent Modal backdrops used to be exactly what produced a
// compounding double-blur behind this view, which is why this no longer
// reuses the shared Modal component at all. Its own close control is a
// top-left "×", not the shared Modal's top-right convention — deliberate,
// since this reads as "exit this view," not "dismiss a dialog."
//
// The map here is StaticIslandMap (read-only, no pan/zoom) — NOT a second
// <BiliranMap> instance. See that file's header comment for why this
// doesn't reopen this app's "one persistent map" decision. It's sized
// larger here than its default (a full-screen view has the room), still
// the same non-interactive component either way.
//
// Simulation Mode is a slide-out sidebar from the right edge (not the old
// inline toggle-panel-below-the-grid), always mounted but transformed
// off-screen when closed so its own input state survives being
// closed/reopened. "Start simulation" hands its result up via onSimulate
// and this component auto-closes the sidebar; the resulting chart then
// renders inside BarangayDetailPanel, alongside the real hydrograph, for
// direct comparison — not inside the sidebar itself. Results are keyed by
// barangay so switching the selected barangay never shows a stale result
// for a different one (see simEntry below).

'use client'

import { useEffect, useMemo, useState } from 'react'
import { loadBarangays, filterBarangays, sortBySeverity, type Barangay } from '@/lib/dashboardData'
import StaticIslandMap from '@/components/StaticIslandMap'
import MunicipalityFilterDropdown from '@/components/MunicipalityFilterDropdown'
import BarangayList from '@/components/BarangayList'
import BarangayDetailPanel from '@/components/BarangayDetailPanel'
import SimulationModePanel, { type SimulationRunResult } from '@/components/SimulationModePanel'

const TRANSITION_MS = 300
const MAP_HEIGHT = 320

// This app's --card-bg/--header-bg/--body-bg are all deliberately
// translucent (paired with backdrop-blur, meant to tint over the always-
// present map scene behind them) — fine for a small card, but a full-
// screen takeover needs a genuinely opaque background or the persistent
// map/dashboard underneath bleeds through as visible ghosting. Same RGB
// channels as --card-bg, just alpha 1 — and, same reasoning as
// MunicipalityFilterDropdown's DAY_COLORS/NIGHT_COLORS, keyed directly by
// the theme prop rather than a CSS variable, so this never depends on
// what's rendered behind it.
const DAY_BG = '#E7F1F5'
const NIGHT_BG = '#031716'

interface SimEntry {
  barangayKey: string
  result: SimulationRunResult
}

export default function UserDashboardModal({
  onClose,
  theme,
}: {
  onClose: () => void
  theme: 'light' | 'dark'
}) {
  const [barangays, setBarangays] = useState<Barangay[] | null>(null)
  const [selectedKey, setSelectedKey] = useState<string | null>(null)
  const [municipality, setMunicipality] = useState<string | null>(null)
  const [sidebarOpen, setSidebarOpen] = useState(false)
  const [simEntry, setSimEntry] = useState<SimEntry | null>(null)

  // Same two-phase open/close technique as the shared Modal
  // (components/ProfilePanel.tsx) — `open` starts false and flips true
  // next frame to drive the entrance transition; requestClose flips it
  // back and defers the real onClose until the CSS transition has run.
  const [open, setOpen] = useState(false)
  useEffect(() => {
    const raf = requestAnimationFrame(() => setOpen(true))
    return () => cancelAnimationFrame(raf)
  }, [])
  function requestClose() {
    setOpen(false)
    setTimeout(onClose, TRANSITION_MS)
  }

  useEffect(() => {
    loadBarangays()
      .then(setBarangays)
      .catch(() => {
        // Same lazy-load pattern as the real dashboard — no dedicated error UI here.
      })
  }, [])

  const sorted = useMemo(() => (barangays ? sortBySeverity(barangays) : []), [barangays])
  const filtered = useMemo(() => filterBarangays(sorted, '', municipality), [sorted, municipality])
  const selected = useMemo(() => sorted.find((b) => b.key === selectedKey) ?? null, [sorted, selectedKey])
  const simulationResult = simEntry && selected && simEntry.barangayKey === selected.key ? simEntry.result : null
  const bg = theme === 'dark' ? NIGHT_BG : DAY_BG

  return (
    <div
      className="bfw-user-dashboard fixed inset-0 z-50 flex flex-col"
      data-open={open}
      style={{ background: bg }}
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

      <div
        className="flex shrink-0 items-center justify-between border-b px-6 py-4"
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
        <button
          type="button"
          className="bfw-btn shrink-0 rounded-full px-4 py-2 text-sm font-semibold"
          onClick={() => setSidebarOpen(true)}
          disabled={!selected}
        >
          Simulation Mode
        </button>
      </div>

      <div className="flex min-h-0 flex-1 flex-col gap-4 overflow-y-auto p-6">
        <div
          className="rounded-lg border px-3 py-2 text-xs"
          style={{ background: 'rgba(192, 57, 43, 0.15)', borderColor: '#C0392B', color: '#F2D9D5' }}
        >
          Modeled from a single synthetic design storm, not a live rainfall feed — treat every
          countdown below as illustrative until a real forecast is wired in.
        </div>

        {barangays && (
          <>
            <StaticIslandMap barangays={barangays} selectedKey={selectedKey} height={MAP_HEIGHT} />

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

      <div
        className="bfw-sim-sidebar fixed right-0 top-0 z-[60] flex h-full w-80 flex-col border-l p-4 shadow-2xl"
        data-open={sidebarOpen}
        style={{ background: bg, borderColor: 'var(--card-border)' }}
      >
        <SimulationModePanel
          barangay={selected}
          onExit={() => setSidebarOpen(false)}
          onSimulate={(result) => {
            if (!selected) return
            setSimEntry({ barangayKey: selected.key, result })
            setSidebarOpen(false)
          }}
        />
      </div>
    </div>
  )
}
