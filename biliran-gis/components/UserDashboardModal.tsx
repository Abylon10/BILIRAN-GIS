// components/UserDashboardModal.tsx
//
// "Open User Dashboard" — reachable from inside the admin session
// (AdminInvitePanel.tsx) without leaving it: this mounts on top of the
// already-open Invitations modal, showing the real end-user dashboard
// (map + barangay list + detail panel, including the real hydrograph and
// factor breakdown) as a self-contained snapshot, plus a "Simulation
// Mode" entry point. Its own selectedKey/municipality state is local and
// independent of app/page.tsx's — this is a read-only-ish view, not a
// second copy of the live dashboard's navigation state.
//
// The map here is StaticIslandMap (read-only, no pan/zoom) — NOT a second
// <BiliranMap> instance. See that file's header comment for why this
// doesn't reopen this app's "one persistent map" decision.

'use client'

import { useEffect, useMemo, useState } from 'react'
import { Modal } from '@/components/ProfilePanel'
import { loadBarangays, filterBarangays, sortBySeverity, type Barangay } from '@/lib/dashboardData'
import StaticIslandMap from '@/components/StaticIslandMap'
import MunicipalityFilterDropdown from '@/components/MunicipalityFilterDropdown'
import BarangayList from '@/components/BarangayList'
import BarangayDetailPanel from '@/components/BarangayDetailPanel'
import SimulationModePanel from '@/components/SimulationModePanel'

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
  const [showSimulation, setShowSimulation] = useState(false)

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

  return (
    <Modal title="User Dashboard" onClose={onClose} maxWidthClassName="max-w-4xl">
      <div className="flex flex-col gap-4">
        <div
          className="rounded-lg border px-3 py-2 text-xs"
          style={{ background: 'rgba(192, 57, 43, 0.15)', borderColor: '#C0392B', color: '#F2D9D5' }}
        >
          Modeled from a single synthetic design storm, not a live rainfall feed — treat every
          countdown below as illustrative until a real forecast is wired in.
        </div>

        {barangays && (
          <>
            <StaticIslandMap barangays={barangays} selectedKey={selectedKey} />

            <div className="flex flex-wrap items-center justify-between gap-2">
              <MunicipalityFilterDropdown value={municipality} onChange={setMunicipality} theme={theme} />
              <button
                type="button"
                className="bfw-btn rounded-full px-4 py-2 text-sm font-semibold"
                onClick={() => setShowSimulation((v) => !v)}
                disabled={!selected}
              >
                Simulation Mode
              </button>
            </div>

            <div className="grid min-h-0 grid-cols-1 gap-4 md:grid-cols-[1fr_320px]" style={{ height: '50vh' }}>
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
                <BarangayDetailPanel barangay={selected} />
              </div>
            </div>

            {showSimulation && selected && (
              <SimulationModePanel barangay={selected} />
            )}
          </>
        )}
      </div>
    </Modal>
  )
}
