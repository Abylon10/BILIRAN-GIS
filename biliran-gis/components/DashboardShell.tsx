// components/DashboardShell.tsx
//
// Replaces the .bfw-dash placeholder in app/page.tsx. Built from what
// barangay_dashboard_data.json actually contains (see lib/dashboardData.ts).
// Deliberately does NOT include a choropleth map, hydrograph chart, or
// precipitation/factor-breakdown cards from the original design spec in
// CLAUDE.md — those need barangay boundary geometry and per-basin
// time-series data that aren't part of this repo's data. Building fake
// versions of those would mislead the officials this app is for.

'use client'

import { useEffect, useMemo, useState } from 'react'
import {
  filterBarangays,
  loadBarangays,
  sortByUrgency,
  type Barangay,
} from '@/lib/dashboardData'
import { MONITORED_MUNICIPALITIES } from '@/lib/municipalities'
import LiveUpdateBanner from '@/components/LiveUpdateBanner'
import BarangayList from '@/components/BarangayList'
import BarangayDetailPanel from '@/components/BarangayDetailPanel'

export default function DashboardShell() {
  const [barangays, setBarangays] = useState<Barangay[] | null>(null)
  const [loadError, setLoadError] = useState<string | null>(null)
  const [query, setQuery] = useState('')
  const [municipality, setMunicipality] = useState<string | null>(null)
  const [selectedKey, setSelectedKey] = useState<string | null>(null)

  useEffect(() => {
    loadBarangays()
      .then(setBarangays)
      .catch((err) => setLoadError(err instanceof Error ? err.message : 'Failed to load data.'))
  }, [])

  const sorted = useMemo(() => (barangays ? sortByUrgency(barangays) : []), [barangays])
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
          <LiveUpdateBanner barangays={barangays} onSelect={(b) => setSelectedKey(b.key)} />

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

          <div className="grid flex-1 grid-cols-1 gap-4 overflow-hidden md:grid-cols-[1fr_320px]">
            <div className="overflow-y-auto pr-1">
              <BarangayList barangays={filtered} selectedKey={selectedKey} onSelect={(b) => setSelectedKey(b.key)} />
            </div>
            <div className="hidden md:block">
              <BarangayDetailPanel barangay={selected} />
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
