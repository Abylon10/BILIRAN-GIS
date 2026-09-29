// components/AdminShell.tsx
//
// The admin landing — what app/page.tsx now mounts for `showAdminPanel &&
// isAdmin` instead of AdminInvitePanel directly. A full-screen, multi-tab
// shell (Dashboard / Barangays / GIS & FSI Data / Rainfall & Scenarios /
// Invitations / Users) replacing the old single-purpose Invitations
// landing, matching the reference mockup's own top-nav structure.
//
// Owns its own header row (title/subtitle left, Day/Night toggle +
// Profile right) rather than relying on app/page.tsx's persistent
// absolute-positioned header — it fully occludes that header while open,
// same precedent UserDashboardModal already established (a temporary
// snapshot/admin view, not the permanent app chrome), so this sits at
// z-50 like that component rather than needing the old z-18-below-header
// arrangement AdminInvitePanel used when it had no header controls of its
// own. app/page.tsx's own ProfilePanel is rendered AFTER this component
// in the DOM (see that file) so it paints above this shell at the same
// z-50 when opened from the profile button below.
//
// Background: uses lib/opaqueTheme.ts's opaqueBg(theme), NOT the
// --body-bg/--header-bg CSS variables — those are deliberately
// translucent (meant to tint over the always-present map scene behind a
// small card), which let the real dashboard/map visibly ghost through
// behind this shell the first time this was built with them (found via
// this feature's own Playwright pass, screenshotted). Same fix already
// applied to UserDashboardModal.tsx and AdminInvitePanel.tsx's old
// full-screen wrapper — see lib/opaqueTheme.ts's own header comment.
//
// Tabs are plain client-side state, not routes — this whole shell only
// ever exists behind the admin auth gate already enforced by
// app/page.tsx's own `showAdminPanel && isAdmin` condition, so there's
// nothing here that needs to survive a reload/deep-link.
//
// Deliberately NOT in this shell (see the plan this was built from):
// a "System Status" panel (nothing real to report — no GIS-processing
// service or backup system exists in this app), an Activity Log tab (a
// genuinely separate feature needing a real audit table, deferred), and
// Reports/Settings tabs (no real content or data to back either yet).

'use client'

import { useState } from 'react'
import { opaqueBg } from '@/lib/opaqueTheme'
import HeaderProfileButton from '@/components/HeaderProfileButton'
import AdminDashboardTab from '@/components/AdminDashboardTab'
import AdminBarangaysTab from '@/components/AdminBarangaysTab'
import AdminGisDataTab from '@/components/AdminGisDataTab'
import AdminUsersTab from '@/components/AdminUsersTab'
import AdminInvitePanel from '@/components/AdminInvitePanel'
import UserDashboardModal from '@/components/UserDashboardModal'
import type { Barangay } from '@/lib/dashboardData'

type TabId = 'dashboard' | 'barangays' | 'gis' | 'rainfall' | 'invitations' | 'users'

const TABS: { id: TabId; label: string }[] = [
  { id: 'dashboard', label: 'Dashboard' },
  { id: 'barangays', label: 'Barangays' },
  { id: 'gis', label: 'GIS & FSI Data' },
  { id: 'rainfall', label: 'Rainfall & Scenarios' },
  { id: 'invitations', label: 'Invitations' },
  { id: 'users', label: 'Users' },
]

export default function AdminShell({
  theme,
  onToggleTheme,
  avatarUrl,
  displayName,
  office,
  onOpenProfile,
  barangays,
  liveActive,
}: {
  theme: 'light' | 'dark'
  onToggleTheme: () => void
  avatarUrl: string | null
  displayName: string | null
  office: string | null
  onOpenProfile: () => void
  // Same live-forecast-overlaid barangay list app/page.tsx already
  // computes for the real dashboard (lib/liveIslandState.ts) — reused
  // here rather than re-fetched/re-computed a second time, so the admin
  // view's numbers can never drift from what the public dashboard shows.
  barangays: Barangay[] | null
  liveActive: boolean
}) {
  const [tab, setTab] = useState<TabId>('dashboard')
  const bg = opaqueBg(theme)

  return (
    <div className="fixed inset-0 z-50 flex flex-col" style={{ background: bg }}>
      <div
        className="flex shrink-0 flex-wrap items-center justify-between gap-3 border-b px-6 py-4"
        style={{ background: theme === 'dark' ? '#032F30' : '#0A7075', borderColor: '#0C969C' }}
      >
        <div>
          <h1 className="text-lg font-semibold" style={{ color: '#E7F1F5' }}>
            Admin
          </h1>
          <p className="text-sm" style={{ color: '#B7D2DE' }}>
            Biliran flood risk monitor — administration
          </p>
        </div>
        <div className="flex shrink-0 items-center gap-2">
          <button
            type="button"
            onClick={onToggleTheme}
            aria-label="Toggle day and night"
            className="bfw-btn shrink-0 rounded-full px-3 py-1.5 text-xs font-medium"
          >
            {theme === 'light' ? '☀ Day' : '☾ Night'}
          </button>
          <HeaderProfileButton
            revealed
            avatarUrl={avatarUrl}
            displayName={displayName}
            office={office}
            onClick={onOpenProfile}
          />
        </div>
      </div>

      <nav
        className="flex shrink-0 gap-1 overflow-x-auto border-b px-4 py-2"
        style={{ borderColor: 'var(--card-border)', background: bg }}
        aria-label="Admin sections"
      >
        {TABS.map((t) => (
          <button
            key={t.id}
            type="button"
            onClick={() => setTab(t.id)}
            aria-current={tab === t.id ? 'page' : undefined}
            className="shrink-0 rounded-full px-3 py-1.5 text-sm font-medium transition-colors"
            style={
              tab === t.id
                ? { background: 'rgba(232, 163, 61, 0.28)', color: 'var(--text-strong)', border: '1px solid #E8A33D' }
                : { color: 'var(--text-soft)', border: '1px solid transparent' }
            }
          >
            {t.label}
          </button>
        ))}
      </nav>

      <div className="min-h-0 flex-1 overflow-y-auto p-6">
        {tab === 'dashboard' && <AdminDashboardTab barangays={barangays} liveActive={liveActive} onOpenBarangay={() => setTab('barangays')} />}
        {tab === 'barangays' && <AdminBarangaysTab barangays={barangays} theme={theme} />}
        {tab === 'gis' && <AdminGisDataTab />}
        {tab === 'rainfall' && <UserDashboardModal embedded theme={theme} />}
        {tab === 'invitations' && <AdminInvitePanel />}
        {tab === 'users' && <AdminUsersTab />}
      </div>
    </div>
  )
}
