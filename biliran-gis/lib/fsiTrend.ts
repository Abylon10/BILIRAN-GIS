// lib/fsiTrend.ts
//
// Client loader for /api/admin/fsi-snapshot — the real, growing "FSI
// Trend" history behind the admin Dashboard tab's chart. Takes a bearer
// token rather than fetching its own session, matching the pattern
// components/AdminInvitePanel.tsx already uses for every other
// admin-gated call — the caller (components/AdminDashboardTab.tsx)
// already needs its own token for other admin fetches, no reason to
// duplicate supabase.auth.getSession() here too.

export interface FsiSnapshot {
  snapshot_date: string
  avg_fsi: number
  high_risk_count: number
  source: 'live' | 'static'
}

export async function fetchFsiHistory(token: string): Promise<FsiSnapshot[]> {
  const res = await fetch('/api/admin/fsi-snapshot', {
    headers: { Authorization: `Bearer ${token}` },
  })
  if (!res.ok) return []
  const data = await res.json()
  return data.snapshots ?? []
}

/**
 * Idempotent — the route itself only inserts if today's row doesn't
 * already exist, so calling this on every Dashboard-tab mount is safe
 * and never overwrites an already-recorded day.
 */
export async function postTodaySnapshot(
  token: string,
  avgFsi: number,
  highRiskCount: number,
  source: 'live' | 'static'
): Promise<boolean> {
  try {
    const res = await fetch('/api/admin/fsi-snapshot', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${token}`,
      },
      body: JSON.stringify({ avgFsi, highRiskCount, source }),
    })
    if (!res.ok) return false
    const data = await res.json()
    return Boolean(data.created)
  } catch {
    // Best-effort — the Dashboard tab's other real numbers must still
    // render even if this particular write fails.
    return false
  }
}
