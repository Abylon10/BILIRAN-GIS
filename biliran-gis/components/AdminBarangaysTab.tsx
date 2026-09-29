// components/AdminBarangaysTab.tsx
//
// The admin shell's "Barangays" tab — a browsable list of all 115,
// filterable by municipality, with the same real detail panel
// (BarangayDetailPanel, hydrograph + factor breakdown included) the
// public dashboard and the admin Dashboard tab's own table both use.
// `barangays` is the same live-forecast-overlaid list threaded down from
// app/page.tsx through AdminShell — never a separate fetch/recompute.

'use client'

import { useMemo, useState } from 'react'
import { filterBarangays, sortBySeverity, type Barangay } from '@/lib/dashboardData'
import MunicipalityFilterDropdown from '@/components/MunicipalityFilterDropdown'
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

  const sorted = useMemo(() => (barangays ? sortBySeverity(barangays) : []), [barangays])
  const filtered = useMemo(() => filterBarangays(sorted, '', municipality), [sorted, municipality])
  const selected = useMemo(() => sorted.find((b) => b.key === selectedKey) ?? null, [sorted, selectedKey])

  if (!barangays) {
    return (
      <p className="text-sm" style={{ color: 'var(--text-soft)' }}>
        Loading barangay data…
      </p>
    )
  }

  return (
    <div className="flex h-full flex-col gap-4">
      <div className="flex items-center justify-between gap-2">
        <MunicipalityFilterDropdown value={municipality} onChange={setMunicipality} theme={theme} />
        <span className="text-xs" style={{ color: 'var(--text-soft)' }}>
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
