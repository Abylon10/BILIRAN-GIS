// components/AdminBarangaysTab.tsx
//
// The admin shell's "Barangays" tab — a browsable list of all 115,
// filterable by municipality and searchable by name, with the same real
// detail panel (BarangayDetailPanel, hydrograph + factor breakdown
// included) the public dashboard and the admin Dashboard tab's own table
// both use. `barangays` is the same live-forecast-overlaid list threaded
// down from app/page.tsx through AdminShell — never a separate fetch/
// recompute.
//
// Stat cards, search, and the map are new this round (matching a
// reference mockup): the 4 cards and the search box are real, computed
// from `barangays` directly — no invented "With Data"/"Status: Active"
// cards, since there's no real per-barangay active/inactive concept in
// this app. The map (StaticIslandMap) highlights both the selected
// barangay AND the active municipality filter (its new
// `highlightMunicipality` prop) — deliberately NOT a toggle between "Map
// View"/"Details" like the mockup's own tab switcher; always showing it
// alongside the list is simpler and still satisfies "track (highlight)
// the municipality and barangay." No "+ Add Barangay" button, no
// per-row Edit/Delete, no "Recent Activity" feed — barangay data comes
// from a fixed external pipeline, not an admin-editable database (see
// CLAUDE.md), and Activity Logs are their own deferred feature (see the
// sidebar's "Activity Logs" placeholder).

'use client'

import { useMemo, useState } from 'react'
import { filterBarangays, sortBySeverity, type Barangay } from '@/lib/dashboardData'
import { StatCard } from '@/components/AdminDashboardTab'
import MunicipalityFilterDropdown from '@/components/MunicipalityFilterDropdown'
import StaticIslandMap from '@/components/StaticIslandMap'
import BarangayList from '@/components/BarangayList'
import BarangayDetailPanel from '@/components/BarangayDetailPanel'

export default function AdminBarangaysTab({
  barangays,
  theme,
}: {
  barangays: Barangay[] | null
  theme: 'light' | 'dark'
}) {
  const [selectedKey, setSelectedKey] = useState<string | null>(null)
  const [municipality, setMunicipality] = useState<string | null>(null)
  const [search, setSearch] = useState('')

  const sorted = useMemo(() => (barangays ? sortBySeverity(barangays) : []), [barangays])
  const filtered = useMemo(() => filterBarangays(sorted, search, municipality), [sorted, search, municipality])
  const selected = useMemo(() => sorted.find((b) => b.key === selectedKey) ?? null, [sorted, selectedKey])

  const highRisk = useMemo(() => sorted.filter((b) => b.dominant_fsi_label === 'Very High').length, [sorted])
  const moderateRisk = useMemo(() => sorted.filter((b) => b.dominant_fsi_label === 'High' || b.dominant_fsi_label === 'Moderate').length, [sorted])
  const lowRisk = useMemo(() => sorted.filter((b) => b.dominant_fsi_label === 'Low' || b.dominant_fsi_label === 'Very Low').length, [sorted])

  if (!barangays) {
    return (
      <p className="text-sm" style={{ color: 'var(--text-soft)' }}>
        Loading barangay data…
      </p>
    )
  }

  return (
    <div className="flex h-full flex-col gap-4">
      <div className="grid grid-cols-2 gap-4 md:grid-cols-4">
        <StatCard label="Total barangays" value={String(sorted.length)} />
        <StatCard label="Very high risk" value={String(highRisk)} />
        <StatCard label="High / moderate risk" value={String(moderateRisk)} />
        <StatCard label="Low / very low risk" value={String(lowRisk)} />
      </div>

      <StaticIslandMap barangays={sorted} selectedKey={selectedKey} highlightMunicipality={municipality} height={220} />

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
        <span className="shrink-0 text-xs" style={{ color: 'var(--text-soft)' }}>
          {filtered.length} of {sorted.length} barangays
        </span>
      </div>

      <div className="grid min-h-0 flex-1 grid-cols-1 gap-4 md:grid-cols-[1fr_360px]">
        <div className="min-h-0 overflow-y-auto pr-1">
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
    </div>
  )
}
