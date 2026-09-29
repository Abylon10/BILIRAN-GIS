// components/AdminUsersTab.tsx
//
// The admin shell's "Users" tab — a read-only list of real, already-
// activated accounts (app/api/admin/users/route.ts). Deliberately
// read-only, per the user's own explicit scope choice for this tab: no
// edit/promote/demote affordance here, just visibility into who has an
// account. The Active/Disabled column reflects Supabase Auth's own real
// `banned_until` field (see that route's own comment) — a status label,
// not a toggle; disabling a user is done from the Supabase dashboard.

'use client'

import { useEffect, useState } from 'react'
import { supabase } from '@/lib/supabase'

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

  return (
    <div className="flex flex-col gap-3">
      <p className="text-xs" style={{ color: 'var(--text-soft)' }}>
        {users.length} registered {users.length === 1 ? 'account' : 'accounts'}. Read-only — account creation and
        access level are managed via the Invitations tab.
      </p>
      <div className="overflow-x-auto rounded-lg border" style={{ borderColor: 'var(--card-border)' }}>
        <table className="w-full text-left text-sm">
          <thead>
            <tr style={{ color: 'var(--text-soft)' }}>
              <th className="px-3 py-2 font-medium">Name</th>
              <th className="px-3 py-2 font-medium">Email</th>
              <th className="px-3 py-2 font-medium">Office</th>
              <th className="px-3 py-2 font-medium">Access level</th>
              <th className="px-3 py-2 font-medium">Status</th>
              <th className="px-3 py-2 font-medium">Joined</th>
            </tr>
          </thead>
          <tbody>
            {users.map((u) => (
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
                <td className="px-3 py-2" style={{ color: 'var(--text-soft)' }}>{new Date(u.joinedAt).toLocaleDateString()}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  )
}
