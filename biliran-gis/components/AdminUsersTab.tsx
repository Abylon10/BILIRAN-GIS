// components/AdminUsersTab.tsx
//
// The admin shell's "Users" tab — a read-only list of real, already-
// activated accounts (app/api/admin/users/route.ts). Deliberately
// read-only, per the user's own explicit scope choice for this tab: no
// edit/promote/demote affordance here, just visibility into who has an
// account. The Active/Disabled column reflects Supabase Auth's own real
// `banned_until` field (see that route's own comment) — a status label,
// not a toggle; disabling a user is done from the Supabase dashboard.
//
// Stat cards, "Last Login", search, and an access-level filter are new
// this round (matching a reference mockup). Last Login is Supabase
// Auth's own real `last_sign_in_at` — not invented. No "Pending" stat
// card here (that's an Invitations-tab concept, not a Users one) and no
// "+ Add User"/row-actions menu — stays fully read-only.

'use client'

import { useEffect, useMemo, useState } from 'react'
import { supabase } from '@/lib/supabase'
import { StatCard } from '@/components/AdminDashboardTab'

interface AdminUser {
  id: string
  email: string | null
  office: string | null
  accessLevel: string | null
  title: string | null
  firstName: string | null
  familyName: string | null
  joinedAt: string
  disabled: boolean
  lastLoginAt: string | null
}

async function getToken(): Promise<string | null> {
  const { data: { session } } = await supabase.auth.getSession()
  return session?.access_token ?? null
}

function displayName(u: AdminUser): string {
  const full = [u.title, u.firstName, u.familyName].filter(Boolean).join(' ')
  return full || u.email || 'Unknown'
}

export default function AdminUsersTab() {
  const [users, setUsers] = useState<AdminUser[] | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [search, setSearch] = useState('')
  const [accessFilter, setAccessFilter] = useState<'all' | string>('all')

  useEffect(() => {
    let cancelled = false
    getToken().then((token) => {
      if (!token) {
        if (!cancelled) setError('Your session expired — sign in again.')
        return
      }
      fetch('/api/admin/users', { headers: { Authorization: `Bearer ${token}` } })
        .then(async (res) => {
          if (!res.ok) throw new Error('Could not load users.')
          return res.json()
        })
        .then((data) => {
          if (!cancelled) setUsers(data.users ?? [])
        })
        .catch(() => {
          if (!cancelled) setError('Could not load users.')
        })
    })
    return () => {
      cancelled = true
    }
  }, [])

  const accessLevels = useMemo(() => {
    if (!users) return []
    return Array.from(new Set(users.map((u) => u.accessLevel).filter((a): a is string => Boolean(a)))).sort()
  }, [users])

  const filtered = useMemo(() => {
    if (!users) return []
    const q = search.trim().toLowerCase()
    return users.filter((u) => {
      if (accessFilter !== 'all' && u.accessLevel !== accessFilter) return false
      if (!q) return true
      return (
        displayName(u).toLowerCase().includes(q) ||
        (u.email ?? '').toLowerCase().includes(q) ||
        (u.office ?? '').toLowerCase().includes(q)
      )
    })
  }, [users, search, accessFilter])

  if (error) {
    return (
      <p role="alert" className="rounded-md bg-[#FBEEE0]/90 px-3 py-2 text-sm text-[#8A4B12]">
        {error}
      </p>
    )
  }

  if (!users) {
    return (
      <p className="text-sm" style={{ color: 'var(--text-soft)' }}>
        Loading users…
      </p>
    )
  }

  const activeCount = users.filter((u) => !u.disabled).length
  const disabledCount = users.filter((u) => u.disabled).length

  return (
    <div className="flex flex-col gap-4">
      <div className="grid grid-cols-3 gap-4">
        <StatCard label="Total users" value={String(users.length)} />
        <StatCard label="Active" value={String(activeCount)} />
        <StatCard label="Disabled" value={String(disabledCount)} />
      </div>

      <p className="text-xs" style={{ color: 'var(--text-soft)' }}>
        Read-only — account creation and access level are managed via the Invitations tab.
      </p>

      <div className="flex flex-wrap items-center gap-2">
        <input
          type="text"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="Search name, email, or office…"
          className="min-w-0 flex-1 rounded-md border px-3 py-2 text-sm outline-none"
          style={{ borderColor: 'var(--field-line)', color: 'var(--text-strong)' }}
        />
        <select
          value={accessFilter}
          onChange={(e) => setAccessFilter(e.target.value)}
          className="shrink-0 rounded-md border px-2 py-2 text-sm outline-none"
          style={{ borderColor: 'var(--field-line)', color: 'var(--text-strong)', background: 'var(--card-bg)' }}
        >
          <option value="all">All access levels</option>
          {accessLevels.map((a) => (
            <option key={a} value={a}>{a}</option>
          ))}
        </select>
      </div>

      <div className="overflow-x-auto rounded-lg border" style={{ borderColor: 'var(--card-border)' }}>
        <table className="w-full text-left text-sm">
          <thead>
            <tr style={{ color: 'var(--text-soft)' }}>
              <th className="px-3 py-2 font-medium">Name</th>
              <th className="px-3 py-2 font-medium">Email</th>
              <th className="px-3 py-2 font-medium">Office</th>
              <th className="px-3 py-2 font-medium">Access level</th>
              <th className="px-3 py-2 font-medium">Status</th>
              <th className="px-3 py-2 font-medium">Last login</th>
              <th className="px-3 py-2 font-medium">Joined</th>
            </tr>
          </thead>
          <tbody>
            {filtered.map((u) => (
              <tr key={u.id} className="border-t" style={{ borderColor: 'var(--card-border)' }}>
                <td className="px-3 py-2" style={{ color: 'var(--text-strong)' }}>{displayName(u)}</td>
                <td className="px-3 py-2" style={{ color: 'var(--text-soft)' }}>{u.email ?? '—'}</td>
                <td className="px-3 py-2" style={{ color: 'var(--text-soft)' }}>{u.office ?? '—'}</td>
                <td className="px-3 py-2" style={{ color: 'var(--text-soft)' }}>{u.accessLevel ?? '—'}</td>
                <td className="px-3 py-2">
                  <span
                    className="rounded-full px-2 py-0.5 text-xs font-semibold"
                    style={
                      u.disabled
                        ? { background: 'rgba(192, 57, 43, 0.15)', color: '#C0392B' }
                        : { background: 'rgba(44, 95, 62, 0.15)', color: '#2C5F3E' }
                    }
                  >
                    {u.disabled ? 'Disabled' : 'Active'}
                  </span>
                </td>
                <td className="px-3 py-2" style={{ color: 'var(--text-soft)' }}>
                  {u.lastLoginAt ? new Date(u.lastLoginAt).toLocaleString() : 'Never'}
                </td>
                <td className="px-3 py-2" style={{ color: 'var(--text-soft)' }}>{new Date(u.joinedAt).toLocaleDateString()}</td>
              </tr>
            ))}
            {filtered.length === 0 && (
              <tr>
                <td colSpan={7} className="px-3 py-6 text-center text-xs" style={{ color: 'var(--text-soft)' }}>
                  No users match.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  )
}
