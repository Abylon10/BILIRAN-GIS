// components/AdminDashboardTab.tsx
//
// The admin shell's default tab (components/AdminShell.tsx) — an overview
// matching the reference mockup's own Dashboard tab, but built entirely
// from real, already-established data sources in this app: no invented
// "System Status"/backup panels, no placeholder counts. `barangays` is
// the same live-forecast-overlaid list app/page.tsx already computes for
// the public dashboard (lib/liveIslandState.ts) — reused here, not
// recomputed, so this can never show a different number than the public
// view for the same barangay.
//
// The one genuinely new piece: "FSI Trend", a real daily snapshot history
// (public.fsi_daily_snapshots, supabase/fsi-daily-snapshots-setup.sql).
// This tab POSTs today's snapshot once per mount (idempotent — the route
// only inserts if today's row doesn't already exist) computed from
// whichever barangay data is currently loaded, then GETs the last 30 rows
// to render lib/FsiTrendChart.tsx. Starts empty and only ever grows from
// whenever that table is first created forward — never backfilled.

'use client'

import { useEffect, useMemo, useState } from 'react'
import { supabase } from '@/lib/supabase'
import { sortBySeverity, urgencyTierColor, highestRiskCrossing, formatHoursAsCountdown, type Barangay } from '@/lib/dashboardData'
import { fetchFsiHistory, postTodaySnapshot, type FsiSnapshot } from '@/lib/fsiTrend'
import StaticIslandMap from '@/components/StaticIslandMap'
import FsiTrendChart from '@/components/FsiTrendChart'

const GIS_FSI_FACTOR_COUNT = 4 // HAND, TWI, LCLU, Rainfall — see components/AdminGisDataTab.tsx
const TOTAL_BARANGAY_COUNT = 115

async function getToken(): Promise<string | null> {
  const { data: { session } } = await supabase.auth.getSession()
  return session?.access_token ?? null
}

// Exported — AdminBarangaysTab.tsx/AdminUsersTab.tsx/AdminInvitePanel.tsx
// reuse this same small stat-card shape rather than each defining their
// own copy.
export function StatCard({ label, value, sub }: { label: string; value: string; sub?: string }) {
  return (
    <div className="rounded-lg border p-4" style={{ borderColor: 'var(--card-border)', background: 'var(--card-bg)' }}>
      <div className="text-xs font-semibold uppercase tracking-wide" style={{ color: 'var(--text-soft)' }}>
        {label}
      </div>
      <div className="mt-1 text-2xl font-semibold" style={{ color: 'var(--text-strong)' }}>
        {value}
      </div>
      {sub && (
        <div className="mt-0.5 text-xs" style={{ color: 'var(--text-soft)' }}>
          {sub}
        </div>
      )}
    </div>
  )
}

export default function AdminDashboardTab({
  barangays,
  liveActive,
  onOpenBarangay,
}: {
  barangays: Barangay[] | null
  liveActive: boolean
  onOpenBarangay?: (barangay: Barangay) => void
}) {
  const [userCount, setUserCount] = useState<number | null>(null)
  const [snapshots, setSnapshots] = useState<FsiSnapshot[]>([])

  useEffect(() => {
    let cancelled = false
    getToken().then((token) => {
      if (!token) return
      fetch('/api/admin/users', { headers: { Authorization: `Bearer ${token}` } })
        .then((res) => (res.ok ? res.json() : null))
        .then((data) => {
          if (!cancelled && data) setUserCount(data.users?.length ?? null)
        })
        .catch(() => {})
    })
    return () => {
      cancelled = true
    }
  }, [])

  const sorted = useMemo(() => (barangays ? sortBySeverity(barangays) : []), [barangays])
  const highRiskCount = useMemo(
    () => sorted.filter((b) => b.dominant_fsi_label === 'High' || b.dominant_fsi_label === 'Very High').length,
    [sorted]
  )
  const avgFsi = useMemo(() => {
    if (sorted.length === 0) return null
    return sorted.reduce((sum, b) => sum + b.mean_fsi_score, 0) / sorted.length
  }, [sorted])
  const classBreakdown = useMemo(() => {
    if (sorted.length === 0) return []
    const labels: Barangay['dominant_fsi_label'][] = ['Very Low', 'Low', 'Moderate', 'High', 'Very High']
    return labels.map((label) => ({
      label,
      count: sorted.filter((b) => b.dominant_fsi_label === label).length,
    }))
  }, [sorted])
  const alert = useMemo(() => (sorted.length > 0 ? highestRiskCrossing(sorted) : null), [sorted])

  // Idempotent upsert-if-missing — safe to call on every mount of this
  // tab, never overwrites an already-recorded day's row (see this route's
  // own header comment, app/api/admin/fsi-snapshot/route.ts).
  useEffect(() => {
    if (avgFsi === null) return
    let cancelled = false
    getToken().then((token) => {
      if (!token) return
      postTodaySnapshot(token, avgFsi, highRiskCount, liveActive ? 'live' : 'static').finally(() => {
        if (cancelled) return
        fetchFsiHistory(token).then((data) => {
          if (!cancelled) setSnapshots(data)
        })
      })
    })
    return () => {
      cancelled = true
    }
    // Deliberately only re-runs when avgFsi/highRiskCount/liveActive change
    // (e.g. once live data first arrives) — not on every barangays
    // reference change, since the upsert itself is a no-op after the
    // first successful call each calendar day anyway.
  }, [avgFsi, highRiskCount, liveActive])

  if (!barangays) {
    return (
      <p className="text-sm" style={{ color: 'var(--text-soft)' }}>
        Loading dashboard data…
      </p>
    )
  }

  return (
    <div className="flex flex-col gap-6">
      <div className="grid grid-cols-2 gap-4 md:grid-cols-4">
        <StatCard label="Barangays monitored" value={String(TOTAL_BARANGAY_COUNT)} />
        <StatCard label="Registered users" value={userCount === null ? '…' : String(userCount)} />
        <StatCard label="GIS / FSI factors" value={String(GIS_FSI_FACTOR_COUNT)} sub="HAND · TWI · LCLU · Rainfall" />
        <StatCard label="High + Very High risk" value={String(highRiskCount)} sub={`of ${sorted.length} barangays`} />
      </div>

      <div
        className="rounded-lg border px-3 py-2 text-xs"
        style={
          liveActive
            ? { background: 'rgba(10, 112, 117, 0.15)', borderColor: '#0A7075', color: 'var(--text-strong)' }
            : { background: 'rgba(192, 57, 43, 0.15)', borderColor: '#C0392B', color: 'var(--text-strong)' }
        }
      >
        {liveActive
          ? "Numbers below are computed from today's live Open-Meteo forecast, same as the public dashboard."
          : "Loading the live forecast — numbers below are still the static synthetic design-storm baseline."}
      </div>

      {alert && (
        <div
          className="rounded-lg border px-3 py-2 text-xs"
          style={{ background: 'rgba(192, 57, 43, 0.15)', borderColor: '#C0392B', color: 'var(--text-strong)' }}
        >
          Highest-risk barangay: <span className="font-semibold">{alert.barangay.barangay}</span> ({alert.barangay.municipality}) —
          modeled {alert.tier} in {formatHoursAsCountdown(alert.hours)}.
        </div>
      )}

      <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
        <div>
          <h3 className="mb-2 text-xs font-semibold uppercase tracking-wide" style={{ color: 'var(--text-soft)' }}>
            Flood susceptibility map
          </h3>
          <StaticIslandMap barangays={barangays} selectedKey={null} height={280} />
        </div>

        <div>
          <h3 className="mb-2 text-xs font-semibold uppercase tracking-wide" style={{ color: 'var(--text-soft)' }}>
            FSI class breakdown
          </h3>
          <div className="flex flex-col gap-2 rounded-lg border p-3" style={{ borderColor: 'var(--card-border)' }}>
            {classBreakdown.map(({ label, count }) => {
              const pct = sorted.length > 0 ? (count / sorted.length) * 100 : 0
              return (
                <div key={label} className="flex items-center gap-2">
                  <span className="w-20 shrink-0 text-xs" style={{ color: 'var(--text-soft)' }}>
                    {label}
                  </span>
                  <div className="h-2 flex-1 overflow-hidden rounded-full" style={{ background: 'var(--body-bg)' }}>
                    <div className="h-full rounded-full" style={{ width: `${pct}%`, background: urgencyTierColor(label) }} />
                  </div>
                  <span className="w-16 shrink-0 text-right text-xs" style={{ color: 'var(--text-strong)' }}>
                    {count} ({pct.toFixed(0)}%)
                  </span>
                </div>
              )
            })}
          </div>
        </div>
      </div>

      <div>
        <h3 className="mb-2 text-xs font-semibold uppercase tracking-wide" style={{ color: 'var(--text-soft)' }}>
          Recent FSI by barangay
        </h3>
        <div className="overflow-x-auto rounded-lg border" style={{ borderColor: 'var(--card-border)' }}>
          <table className="w-full text-left text-sm">
            <thead>
              <tr style={{ color: 'var(--text-soft)' }}>
                <th className="px-3 py-2 font-medium">Barangay</th>
                <th className="px-3 py-2 font-medium">Municipality</th>
                <th className="px-3 py-2 font-medium">FSI score</th>
                <th className="px-3 py-2 font-medium">Class</th>
              </tr>
            </thead>
            <tbody>
              {sorted.slice(0, 10).map((b) => (
                <tr
                  key={b.key}
                  className="cursor-pointer border-t"
                  style={{ borderColor: 'var(--card-border)' }}
                  onClick={() => onOpenBarangay?.(b)}
                >
                  <td className="px-3 py-2" style={{ color: 'var(--text-strong)' }}>{b.barangay}</td>
                  <td className="px-3 py-2" style={{ color: 'var(--text-soft)' }}>{b.municipality}</td>
                  <td className="px-3 py-2" style={{ color: 'var(--text-strong)' }}>{b.mean_fsi_score.toFixed(2)}</td>
                  <td className="px-3 py-2">
                    <span
                      className="rounded-full px-2 py-0.5 text-xs font-semibold"
                      style={{ background: `${urgencyTierColor(b.dominant_fsi_label)}33`, color: urgencyTierColor(b.dominant_fsi_label) }}
                    >
                      {b.dominant_fsi_label}
                    </span>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      <FsiTrendChart snapshots={snapshots} />
    </div>
  )
}
