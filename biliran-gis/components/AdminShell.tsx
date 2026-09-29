// components/AdminShell.tsx
//
// The admin landing — what app/page.tsx now mounts for `showAdminPanel &&
// isAdmin` instead of AdminInvitePanel directly. A full-screen admin UI
// with a persistent LEFT SIDEBAR nav (Dashboard / Barangays / GIS & FSI
// Data / Rainfall & Scenarios / Invitations / Users, plus Reports /
// Activity Logs / Settings — see AdminComingSoonTab.tsx) and a slim top
// bar (breadcrumb, page title/subtitle, Day/Night + Profile), replacing
// this shell's own earlier horizontal top-tab-bar version (see CLAUDE.md
// for that round's history) to match a later, more detailed reference
// mockup the user shared. Reports/Activity Logs/Settings are real nav
// entries now (not omitted), but render an honest "not built yet"
// placeholder — no fabricated report rows, log entries, or settings that
// don't do anything (this project's consistent no-fabrication rule).
//
// Fully occludes the persistent app header and the real dashboard/map
// while open, same precedent UserDashboardModal already established (a
// temporary admin-only view, not permanent app chrome) — z-50,
// opaqueBg(theme) for every background layer here (NOT the --body-bg/
// --header-bg CSS variables — those are deliberately translucent, and
// using them let the real dashboard/map visibly ghost through behind
// this shell the first time this was built, caught via Playwright before
// shipping — see lib/opaqueTheme.ts's own header comment).
//
// Tabs are plain client-side state, not routes — this whole shell only
// ever exists behind the admin auth gate already enforced by
// app/page.tsx's own `showAdminPanel && isAdmin` condition, so there's
// nothing here that needs to survive a reload/deep-link.

'use client'

import { useState, type ReactNode } from 'react'
import { opaqueBg } from '@/lib/opaqueTheme'
import HeaderProfileButton from '@/components/HeaderProfileButton'
import AdminDashboardTab from '@/components/AdminDashboardTab'
import AdminBarangaysTab from '@/components/AdminBarangaysTab'
import AdminGisDataTab from '@/components/AdminGisDataTab'
import AdminUsersTab from '@/components/AdminUsersTab'
import AdminInvitePanel from '@/components/AdminInvitePanel'
import AdminComingSoonTab from '@/components/AdminComingSoonTab'
import UserDashboardModal from '@/components/UserDashboardModal'
import type { Barangay } from '@/lib/dashboardData'

type TabId = 'dashboard' | 'barangays' | 'gis' | 'rainfall' | 'invitations' | 'users' | 'reports' | 'activity' | 'settings'

// Small hand-rolled stroke icons (this repo has no icon library — same
// "no charting library" spirit as DischargeChart.tsx's own inline SVG).
// One shared 20x20 stroke wrapper, each nav item just supplies its path.
function NavIcon({ d }: { d: string }) {
  return (
    <svg viewBox="0 0 20 20" className="h-4 w-4 shrink-0" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
      <path d={d} />
    </svg>
  )
}

const ICONS: Record<TabId, string> = {
  dashboard: 'M3 10.5 10 4l7 6.5M5 9v7h10V9',
  barangays: 'M4 17V7l6-3 6 3v10M4 17h12M8 17v-4h4v4',
  gis: 'M3 6l5-2 4 2 5-2v10l-5 2-4-2-5 2V6zM8 4v10M12 6v10',
  rainfall: 'M5 13a3 3 0 0 1 .5-6 4 4 0 0 1 7.6-1.5A3.5 3.5 0 0 1 14.5 13H5Zm2 3.5.8-1.5M10 16.5l.8-1.5M13 16.5l.8-1.5',
  invitations: 'M3 5h14v10H3V5Zm0 0 7 6 7-6',
  users: 'M7 9a2.5 2.5 0 1 0 0-5 2.5 2.5 0 0 0 0 5Zm7 2a2.2 2.2 0 1 0 0-4.4 2.2 2.2 0 0 0 0 4.4ZM2 17c0-2.8 2.2-5 5-5s5 2.2 5 5M12 12.5c2.2.3 4 2 4 4.5',
  reports: 'M5 3h7l3 3v11H5V3Zm7 0v3h3M7 10h6M7 13h6',
  activity: 'M10 4.5a5.5 5.5 0 1 0 5.5 5.5H10V4.5Z M12 3.5A5.5 5.5 0 0 1 16.5 8H12V3.5Z',
  settings: 'M10 12.5a2.5 2.5 0 1 0 0-5 2.5 2.5 0 0 0 0 5Zm7-2.5-1.6-.4-.4-1 1-1.4-1.4-1.4-1.4 1-1-.4L11.8 3H8.2l-.4 1.6-1 .4-1.4-1L4 5.4l1 1.4-.4 1L3 8.2v3.6l1.6.4.4 1-1 1.4 1.4 1.4 1.4-1 1 .4.4 1.6h3.6l.4-1.6 1-.4 1.4 1 1.4-1.4-1-1.4.4-1 1.6-.4V10Z',
}

const NAV: { id: TabId; label: string }[] = [
  { id: 'dashboard', label: 'Dashboard' },
  { id: 'barangays', label: 'Barangays' },
  { id: 'gis', label: 'GIS & FSI Data' },
  { id: 'rainfall', label: 'Rainfall & Scenarios' },
  { id: 'invitations', label: 'Invitations' },
  { id: 'users', label: 'Users' },
  { id: 'reports', label: 'Reports' },
  { id: 'activity', label: 'Activity Logs' },
  { id: 'settings', label: 'Settings' },
]

const PAGE_SUBTITLE: Record<TabId, string> = {
  dashboard: 'Overview of flood susceptibility across Biliran',
  barangays: 'Manage barangay information and their flood risk data',
  gis: 'The real FSI formula, its input factors, and validation numbers',
  rainfall: 'Run flood simulations using different rainfall scenarios',
  invitations: 'Invite MDRRMO personnel to access the flood risk monitor',
  users: 'Registered MDRRMO/admin accounts and their access levels',
  reports: 'Generated flood-risk reports and historical records',
  activity: 'A record of who added, edited, or uploaded data, and when',
  settings: 'Categories, thresholds, weights, and other configurable values',
}

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
  const sidebarBg = theme === 'dark' ? '#032F30' : '#0A7075'
  const activeTab = NAV.find((n) => n.id === tab)!

  let content: ReactNode
  switch (tab) {
    case 'dashboard':
      content = <AdminDashboardTab barangays={barangays} liveActive={liveActive} onOpenBarangay={() => setTab('barangays')} />
      break
    case 'barangays':
      content = <AdminBarangaysTab barangays={barangays} theme={theme} />
      break
    case 'gis':
      content = <AdminGisDataTab />
      break
    case 'rainfall':
      content = <UserDashboardModal embedded theme={theme} />
      break
    case 'invitations':
      content = <AdminInvitePanel />
      break
    case 'users':
      content = <AdminUsersTab />
      break
    case 'reports':
      content = <AdminComingSoonTab title="Reports" description="Generating and exporting flood-risk reports isn't built yet — this needs its own report format and export pipeline." />
      break
    case 'activity':
      content = <AdminComingSoonTab title="Activity Logs" description="Tracking who added, edited, or uploaded data needs a real audit table and logging on every admin action — a separate feature, not yet built." />
      break
    case 'settings':
      content = <AdminComingSoonTab title="Settings" description="Configurable categories, thresholds, and weights aren't editable yet — the FSI formula's weights are currently fixed (see the GIS & FSI Data tab)." />
      break
  }

  return (
    <div className="fixed inset-0 z-50 flex" style={{ background: bg }}>
      <aside
        className="flex w-56 shrink-0 flex-col border-r"
        style={{ background: sidebarBg, borderColor: '#0C969C' }}
      >
        <div className="flex items-center gap-2 border-b px-4 py-4" style={{ borderColor: 'rgba(255,255,255,0.15)' }}>
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src={theme === 'light' ? '/logo-light.png' : '/logo-dark.png'} alt="" className="h-7 w-7" />
          <div className="min-w-0">
            <div className="truncate text-sm font-semibold" style={{ color: '#E7F1F5' }}>
              Biliran — Admin
            </div>
            <div className="truncate text-[11px]" style={{ color: '#B7D2DE' }}>
              Flood Risk Monitor
            </div>
          </div>
        </div>

        <nav className="flex min-h-0 flex-1 flex-col gap-1 overflow-y-auto p-2" aria-label="Admin sections">
          {NAV.map((n) => (
            <button
              key={n.id}
              type="button"
              onClick={() => setTab(n.id)}
              aria-current={tab === n.id ? 'page' : undefined}
              className="flex items-center gap-2.5 rounded-lg px-3 py-2 text-left text-sm font-medium transition-colors"
              style={
                tab === n.id
                  ? { background: 'rgba(232, 163, 61, 0.28)', color: '#FBFEFF' }
                  : { color: '#B7D2DE' }
              }
            >
              <NavIcon d={ICONS[n.id]} />
              {n.label}
            </button>
          ))}
        </nav>

        <div className="border-t px-4 py-3 text-[11px]" style={{ borderColor: 'rgba(255,255,255,0.15)', color: '#B7D2DE' }}>
          Biliran Flood Risk Monitor
          <br />
          Sa Ligtas na Komunidad
        </div>
      </aside>

      <div className="flex min-h-0 flex-1 flex-col">
        <div
          className="flex shrink-0 flex-wrap items-center justify-between gap-3 border-b px-6 py-4"
          style={{ background: bg, borderColor: 'var(--card-border)' }}
        >
          <div>
            <div className="text-xs" style={{ color: 'var(--text-soft)' }}>
              Admin <span aria-hidden>›</span> {activeTab.label}
            </div>
            <h1 className="text-lg font-semibold" style={{ color: 'var(--text-strong)' }}>
              {activeTab.label}
            </h1>
            <p className="text-sm" style={{ color: 'var(--text-soft)' }}>
              {PAGE_SUBTITLE[tab]}
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

        <div className="min-h-0 flex-1 overflow-y-auto p-6">{content}</div>
      </div>
    </div>
  )
}
