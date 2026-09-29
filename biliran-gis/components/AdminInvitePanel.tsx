// components/AdminInvitePanel.tsx
//
// Admin-only invitation code management. Account creation is fully
// admin-controlled (settled decision, see CLAUDE.md) — before this, nothing
// in the app could actually create an invitation_codes row, so /activate
// had no way to ever be reached for a real user. Started as create/list
// only; edit and revoke (app/api/admin/invite/[id]/route.ts) came later,
// both refusing to touch an already-redeemed invitation. The edit-row's
// expiry field (added later still) lets an admin set/shorten/extend/clear
// an existing unredeemed invite's expires_at — app/api/activate/route.ts's
// existing expiry check (a plain Date comparison) needs no changes to
// honor whatever this sets.
//
// Plain tab content now — components/AdminShell.tsx renders this as its
// "Invitations" tab, not a full-screen takeover of its own. Used to own a
// fixed inset-0 opaque wrapper (back when this WAS the entire admin
// landing) plus an "Open User Dashboard" button that opened
// UserDashboardModal as a sibling overlay; both are gone now that
// AdminShell provides the shared header/tab chrome and "Rainfall &
// Scenarios" is its own tab rendering UserDashboardModal directly
// (embedded) instead. The form/edit/revoke logic below is otherwise
// unchanged.
//
// The list itself gained a derived Pending/Accepted/Expired status badge,
// a search box (email/office/name), a status filter, and a dedicated
// "Resend" button (reuses the PATCH endpoint with the row's own
// unchanged values — PATCH already resends on every edit, so this is
// just a no-op edit exposed as its own action, no new route needed). No
// "Revoked" status: revoking hard-deletes the row (see inviteStatus's own
// comment below), so there's nothing left to label afterward — a
// deliberate scope decision, not an oversight.
//
// Stat cards (Total/Pending/Accepted/Expired) are new this round —
// computed client-side from the already-fetched `invitations` array via
// the same `inviteStatus()` helper the list badges use, no new fetch. No
// "Revoked" card, same reasoning as the missing status.

'use client'

import { useEffect, useMemo, useState } from 'react'
import { supabase } from '@/lib/supabase'
import { StatCard } from '@/components/AdminDashboardTab'

interface Invitation {
  id: number
  code: string
  email: string
  office: string
  invitee_name: string | null
  redeemed: boolean
  expires_at: string | null
  redeemed_at: string | null
}

// Derived, not stored — "Revoked" isn't one of these: revoking an
// invitation (DELETE, app/api/admin/invite/[id]/route.ts) hard-deletes
// the row, so there's no persisted state left to label afterward. Adding
// a real, filterable "Revoked" status would need a soft-revoke column
// plus a matching guard in app/api/activate/route.ts (otherwise a
// "revoked" code would still redeem) — a deliberate scope decision to
// leave that as-is for now, not an oversight.
type InviteStatus = 'Pending' | 'Accepted' | 'Expired'

function inviteStatus(inv: Invitation): InviteStatus {
  if (inv.redeemed) return 'Accepted'
  if (inv.expires_at && new Date(inv.expires_at).getTime() < Date.now()) return 'Expired'
  return 'Pending'
}

const STATUS_COLORS: Record<InviteStatus, string> = {
  Pending: '#8A4B12',
  Accepted: '#2C5F3E',
  Expired: '#C0392B',
}

// Supabase returns expires_at as an ISO 8601 UTC string, but
// <input type="datetime-local"> needs local "YYYY-MM-DDTHH:mm" — these
// convert between the two. Empty string <-> null, both meaning "no
// expiry."
function toDatetimeLocalValue(iso: string | null): string {
  if (!iso) return ''
  const d = new Date(iso)
  const pad = (n: number) => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`
}
function fromDatetimeLocalValue(value: string): string | null {
  return value ? new Date(value).toISOString() : null
}

async function getToken(): Promise<string | null> {
  const { data: { session } } = await supabase.auth.getSession()
  return session?.access_token ?? null
}

async function fetchInvitations(token: string): Promise<Invitation[]> {
  const res = await fetch('/api/admin/invite', {
    headers: { Authorization: `Bearer ${token}` },
  })
  if (!res.ok) return []
  const data = await res.json()
  return data.invitations ?? []
}

export default function AdminInvitePanel() {
  const [email, setEmail] = useState('')
  const [office, setOffice] = useState('')
  const [inviteeName, setInviteeName] = useState('')
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [created, setCreated] = useState<{ invitation: Invitation; emailSent: boolean; emailError: string | null } | null>(null)
  const [invitations, setInvitations] = useState<Invitation[]>([])
  const [search, setSearch] = useState('')
  const [statusFilter, setStatusFilter] = useState<InviteStatus | 'all'>('all')
  // Set from a successful resend, scoped to the row it applies to — same
  // pattern as editResult below, just for the dedicated Resend button
  // rather than a save.
  const [resendResult, setResendResult] = useState<{ id: number; emailSent: boolean; emailError: string | null } | null>(null)

  // Inline edit state — at most one row editable at a time.
  const [editingId, setEditingId] = useState<number | null>(null)
  const [editEmail, setEditEmail] = useState('')
  const [editOffice, setEditOffice] = useState('')
  const [editInviteeName, setEditInviteeName] = useState('')
  const [editExpiresAt, setEditExpiresAt] = useState('')
  const [rowError, setRowError] = useState<string | null>(null)
  const [rowBusyId, setRowBusyId] = useState<number | null>(null)
  // Set from a successful save's response, scoped to the row it applies
  // to — the edit row itself collapses back to display mode immediately
  // on save, so this is what actually surfaces the "emailed to X" /
  // "email failed" result after that collapse.
  const [editResult, setEditResult] = useState<{ id: number; emailSent: boolean; emailError: string | null } | null>(null)

  async function refresh() {
    const token = await getToken()
    if (token) setInvitations(await fetchInvitations(token))
  }

  // Not calling refresh() directly here — react-hooks flags a setState call
  // reached via a directly-invoked named function as a cascading-render
  // risk. Inlining the same fetch as a .then() chain (mirroring this
  // component's original effect shape) avoids that without losing the
  // cancelled-guard.
  useEffect(() => {
    let cancelled = false
    getToken().then((token) => {
      if (!token) return
      fetchInvitations(token).then((data) => {
        if (!cancelled) setInvitations(data)
      })
    })
    return () => {
      cancelled = true
    }
  }, [])

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    setError(null)
    setCreated(null)
    setLoading(true)

    // Wrapped in try/catch/finally — without it, a network failure, a
    // timed-out request, or any non-JSON response (e.g. a platform
    // timeout page instead of real JSON) throws before setLoading(false)
    // ever runs, leaving the button stuck on "Creating…" forever with no
    // error shown. finally guarantees the loading state always clears,
    // success or failure.
    try {
      const token = await getToken()
      if (!token) {
        setError('Your session expired — sign in again.')
        return
      }

      const res = await fetch('/api/admin/invite', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({ email, office, invitee_name: inviteeName || null }),
      })
      const data = await res.json()

      if (!res.ok) {
        setError(data.error ?? 'Could not create invitation.')
        return
      }

      setCreated({ invitation: data.invitation, emailSent: data.emailSent, emailError: data.emailError })
      setEmail('')
      setOffice('')
      setInviteeName('')
      await refresh()
    } catch {
      setError('Could not reach the server — check your connection and try again.')
    } finally {
      setLoading(false)
    }
  }

  function startEdit(inv: Invitation) {
    setRowError(null)
    setEditResult(null)
    setResendResult(null)
    setEditingId(inv.id)
    setEditEmail(inv.email)
    setEditOffice(inv.office)
    setEditInviteeName(inv.invitee_name ?? '')
    setEditExpiresAt(toDatetimeLocalValue(inv.expires_at))
  }

  function cancelEdit() {
    setEditingId(null)
  }

  async function saveEdit(id: number) {
    setRowError(null)
    setRowBusyId(id)

    // Same try/catch/finally reasoning as handleSubmit above — a thrown
    // network/parse error must never leave rowBusyId stuck on this row.
    try {
      const token = await getToken()
      if (!token) {
        setRowError('Your session expired — sign in again.')
        return
      }

      const res = await fetch(`/api/admin/invite/${id}`, {
        method: 'PATCH',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({
          email: editEmail,
          office: editOffice,
          invitee_name: editInviteeName || null,
          expires_at: fromDatetimeLocalValue(editExpiresAt),
        }),
      })
      const data = await res.json()

      if (!res.ok) {
        setRowError(data.error ?? 'Could not update invitation.')
        return
      }

      setEditResult({ id, emailSent: data.emailSent, emailError: data.emailError })
      setEditingId(null)
      await refresh()
    } catch {
      setRowError('Could not reach the server — check your connection and try again.')
    } finally {
      setRowBusyId(null)
    }
  }

  // Dedicated "Resend" — reuses the PATCH endpoint with the row's own
  // current values unchanged (PATCH already resends the email on every
  // successful edit; a no-op edit is a legitimate, safe way to trigger
  // just that, with no new backend route needed). Only ever called for an
  // unredeemed row (the only kind this button renders for), so this can
  // never re-notify someone who already activated.
  async function resendInvite(inv: Invitation) {
    setRowError(null)
    setResendResult(null)
    setRowBusyId(inv.id)

    try {
      const token = await getToken()
      if (!token) {
        setRowError('Your session expired — sign in again.')
        return
      }

      const res = await fetch(`/api/admin/invite/${inv.id}`, {
        method: 'PATCH',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({
          email: inv.email,
          office: inv.office,
          invitee_name: inv.invitee_name,
          expires_at: inv.expires_at,
        }),
      })
      const data = await res.json()

      if (!res.ok) {
        setRowError(data.error ?? 'Could not resend invitation.')
        return
      }

      setResendResult({ id: inv.id, emailSent: data.emailSent, emailError: data.emailError })
    } catch {
      setRowError('Could not reach the server — check your connection and try again.')
    } finally {
      setRowBusyId(null)
    }
  }

  async function revoke(id: number) {
    setRowError(null)
    setRowBusyId(id)

    // Same try/catch/finally reasoning as handleSubmit/saveEdit above —
    // this already guarded the res.json() parse on failure, but not a
    // thrown fetch() itself (e.g. a network drop), which would have left
    // rowBusyId stuck the same way.
    try {
      const token = await getToken()
      if (!token) {
        setRowError('Your session expired — sign in again.')
        return
      }

      const res = await fetch(`/api/admin/invite/${id}`, {
        method: 'DELETE',
        headers: { Authorization: `Bearer ${token}` },
      })

      if (!res.ok) {
        const data = await res.json().catch(() => ({}))
        setRowError(data.error ?? 'Could not revoke invitation.')
        return
      }

      await refresh()
    } catch {
      setRowError('Could not reach the server — check your connection and try again.')
    } finally {
      setRowBusyId(null)
    }
  }

  const statusCounts = useMemo(() => {
    const counts = { Pending: 0, Accepted: 0, Expired: 0 }
    for (const inv of invitations) counts[inviteStatus(inv)]++
    return counts
  }, [invitations])

  const filteredInvitations = invitations.filter((inv) => {
    if (statusFilter !== 'all' && inviteStatus(inv) !== statusFilter) return false
    const q = search.trim().toLowerCase()
    if (!q) return true
    return (
      inv.email.toLowerCase().includes(q) ||
      inv.office.toLowerCase().includes(q) ||
      (inv.invitee_name ?? '').toLowerCase().includes(q)
    )
  })

  return (
    <div className="flex flex-col">
      <h2 className="mb-4 text-lg font-semibold" style={{ color: 'var(--text-strong)' }}>
        Invitations
      </h2>

      <div className="mx-auto grid w-full max-w-xl grid-cols-2 gap-4 sm:grid-cols-4">
        <StatCard label="Total invitations" value={String(invitations.length)} />
        <StatCard label="Pending" value={String(statusCounts.Pending)} />
        <StatCard label="Accepted" value={String(statusCounts.Accepted)} />
        <StatCard label="Expired" value={String(statusCounts.Expired)} />
      </div>

      {/*
        Entrance-only (a full expand/collapse height animation would fight
        with this list's own overflow-y-auto scroll) — same easing family
        as Modal/BiliranMap/HeaderProfileButton, just an @keyframes instead
        of a two-phase transition since there's no exit state to animate
        (the row swaps back to its display form immediately on cancel/save).
      */}
      <style>{`
        @keyframes bfw-edit-row-enter {
          from { opacity: 0; transform: scale(0.97); }
          to { opacity: 1; transform: scale(1); }
        }
        .bfw-edit-row-enter { animation: bfw-edit-row-enter 250ms cubic-bezier(0.22,1,0.36,1); }
        @media (prefers-reduced-motion: reduce) {
          .bfw-edit-row-enter { animation: none; }
        }
      `}</style>
      <div className="mx-auto min-h-0 w-full max-w-xl flex-1 overflow-y-auto p-6">
      <form onSubmit={handleSubmit} className="space-y-3">
        <label className="block">
          <span className="text-sm font-medium" style={{ color: 'var(--text-strong)' }}>Email</span>
          <input
            type="email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            required
            className="mt-1 w-full rounded-md border px-3 py-2 text-sm outline-none"
            style={{ borderColor: 'var(--field-line)', color: 'var(--text-strong)' }}
          />
        </label>
        <label className="block">
          <span className="text-sm font-medium" style={{ color: 'var(--text-strong)' }}>Office</span>
          <input
            type="text"
            value={office}
            onChange={(e) => setOffice(e.target.value)}
            required
            placeholder="e.g. MDRRMO Naval"
            className="mt-1 w-full rounded-md border px-3 py-2 text-sm outline-none"
            style={{ borderColor: 'var(--field-line)', color: 'var(--text-strong)' }}
          />
        </label>
        <label className="block">
          <span className="text-sm font-medium" style={{ color: 'var(--text-strong)' }}>Recipient name (optional)</span>
          <input
            type="text"
            value={inviteeName}
            onChange={(e) => setInviteeName(e.target.value)}
            maxLength={100}
            placeholder="e.g. Juan Dela Cruz"
            className="mt-1 w-full rounded-md border px-3 py-2 text-sm outline-none"
            style={{ borderColor: 'var(--field-line)', color: 'var(--text-strong)' }}
          />
        </label>

        {error && (
          <p role="alert" className="rounded-md bg-[#FBEEE0]/90 px-3 py-2 text-sm text-[#8A4B12]">
            {error}
          </p>
        )}
        {created && (
          <div className="space-y-1 rounded-md bg-[#E7F3E9] px-3 py-2 text-sm text-[#2C5F3E]">
            <p>
              Created code <span className="font-mono font-semibold">{created.invitation.code}</span> for {created.invitation.email}
            </p>
            <p style={created.emailSent ? undefined : { color: '#8A4B12' }}>
              {created.emailSent
                ? `Emailed to ${created.invitation.email}.`
                : `Created, but the email couldn't be sent${created.emailError ? ` (${created.emailError})` : ''} — share the code above manually.`}
            </p>
          </div>
        )}

        <button
          type="submit"
          disabled={loading}
          className="bfw-btn w-full rounded-md py-2 text-sm font-semibold"
        >
          {loading ? 'Creating…' : 'Create invitation'}
        </button>
      </form>

      {invitations.length > 0 && (
        <div className="mt-5 border-t pt-3" style={{ borderColor: 'var(--card-border)' }}>
          <div className="mb-2 flex flex-wrap items-center gap-2">
            <input
              type="text"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Search email, office, or name"
              className="min-w-0 flex-1 rounded-md border px-2 py-1.5 text-xs outline-none"
              style={{ borderColor: 'var(--field-line)', color: 'var(--text-strong)' }}
            />
            <select
              value={statusFilter}
              onChange={(e) => setStatusFilter(e.target.value as InviteStatus | 'all')}
              className="shrink-0 rounded-md border px-2 py-1.5 text-xs outline-none"
              style={{ borderColor: 'var(--field-line)', color: 'var(--text-strong)', background: 'var(--card-bg)' }}
            >
              <option value="all">All statuses</option>
              <option value="Pending">Pending</option>
              <option value="Accepted">Accepted</option>
              <option value="Expired">Expired</option>
            </select>
          </div>

          {rowError && (
            <p role="alert" className="mb-2 rounded-md bg-[#FBEEE0]/90 px-3 py-2 text-xs text-[#8A4B12]">
              {rowError}
            </p>
          )}
          {filteredInvitations.length === 0 && (
            <p className="py-3 text-center text-xs" style={{ color: 'var(--text-soft)' }}>
              No invitations match.
            </p>
          )}
          <ul className="max-h-64 space-y-2 overflow-y-auto text-xs">
            {filteredInvitations.map((inv) => {
              const busy = rowBusyId === inv.id
              if (editingId === inv.id) {
                return (
                  <li key={inv.id} className="bfw-edit-row-enter space-y-1.5 rounded-md border p-2" style={{ borderColor: 'var(--card-border)' }}>
                    <input
                      type="email"
                      value={editEmail}
                      onChange={(e) => setEditEmail(e.target.value)}
                      className="w-full rounded border px-2 py-1 text-xs outline-none"
                      style={{ borderColor: 'var(--field-line)', color: 'var(--text-strong)' }}
                    />
                    <input
                      type="text"
                      value={editOffice}
                      onChange={(e) => setEditOffice(e.target.value)}
                      className="w-full rounded border px-2 py-1 text-xs outline-none"
                      style={{ borderColor: 'var(--field-line)', color: 'var(--text-strong)' }}
                    />
                    <input
                      type="text"
                      value={editInviteeName}
                      onChange={(e) => setEditInviteeName(e.target.value)}
                      maxLength={100}
                      placeholder="Recipient name (optional)"
                      className="w-full rounded border px-2 py-1 text-xs outline-none"
                      style={{ borderColor: 'var(--field-line)', color: 'var(--text-strong)' }}
                    />
                    <label className="block">
                      <span className="text-[10px]" style={{ color: 'var(--text-soft)' }}>Expires</span>
                      <div className="flex items-center gap-2">
                        <input
                          type="datetime-local"
                          value={editExpiresAt}
                          onChange={(e) => setEditExpiresAt(e.target.value)}
                          className="w-full rounded border px-2 py-1 text-xs outline-none"
                          style={{ borderColor: 'var(--field-line)', color: 'var(--text-strong)' }}
                        />
                        {editExpiresAt && (
                          <button
                            type="button"
                            onClick={() => setEditExpiresAt('')}
                            className="shrink-0 text-[10px] underline decoration-dotted underline-offset-2"
                            style={{ color: 'var(--text-soft)' }}
                          >
                            Clear
                          </button>
                        )}
                      </div>
                    </label>
                    <div className="flex justify-end gap-2 pt-0.5">
                      <button
                        type="button"
                        onClick={cancelEdit}
                        disabled={busy}
                        className="text-xs font-medium"
                        style={{ color: 'var(--text-soft)' }}
                      >
                        Cancel
                      </button>
                      <button
                        type="button"
                        onClick={() => saveEdit(inv.id)}
                        disabled={busy}
                        className="bfw-btn rounded px-2 py-1 text-xs font-semibold"
                      >
                        {busy ? 'Saving…' : 'Save'}
                      </button>
                    </div>
                  </li>
                )
              }
              const status = inviteStatus(inv)
              return (
                <li key={inv.id} className="space-y-0.5">
                  <div className="flex items-center justify-between gap-2" style={{ color: 'var(--text-soft)' }}>
                    <span className="flex min-w-0 items-center gap-1.5">
                      <span
                        className="shrink-0 rounded-full px-1.5 py-0.5 text-[10px] font-semibold"
                        style={{ background: `${STATUS_COLORS[status]}26`, color: STATUS_COLORS[status] }}
                      >
                        {status}
                      </span>
                      <span className="truncate">{inv.email} · {inv.office}</span>
                    </span>
                    {inv.redeemed ? (
                      <span className="font-mono shrink-0">redeemed</span>
                    ) : (
                      <span className="flex shrink-0 items-center gap-2">
                        <span className="font-mono">{inv.code}</span>
                        <button
                          type="button"
                          onClick={() => resendInvite(inv)}
                          disabled={busy}
                          className="underline decoration-dotted underline-offset-2 disabled:cursor-not-allowed disabled:opacity-50"
                        >
                          {busy ? '…' : 'Resend'}
                        </button>
                        <button
                          type="button"
                          onClick={() => startEdit(inv)}
                          disabled={busy}
                          className="underline decoration-dotted underline-offset-2 disabled:cursor-not-allowed disabled:opacity-50"
                        >
                          Edit
                        </button>
                        <button
                          type="button"
                          onClick={() => revoke(inv.id)}
                          disabled={busy}
                          className="underline decoration-dotted underline-offset-2 disabled:cursor-not-allowed disabled:opacity-50"
                          style={{ color: '#C0392B' }}
                        >
                          {busy ? '…' : 'Revoke'}
                        </button>
                      </span>
                    )}
                  </div>
                  {!inv.redeemed && (
                    <div className="text-[10px]" style={{ color: 'var(--text-soft)', opacity: 0.75 }}>
                      {inv.expires_at ? `Expires ${new Date(inv.expires_at).toLocaleString()}` : 'No expiry'}
                    </div>
                  )}
                  {editResult && editResult.id === inv.id && (
                    <div className="text-[10px]" style={{ color: editResult.emailSent ? '#2C5F3E' : '#8A4B12' }}>
                      {editResult.emailSent
                        ? `Emailed to ${inv.email}.`
                        : `Updated, but the email couldn't be sent${editResult.emailError ? ` (${editResult.emailError})` : ''} — share the code manually.`}
                    </div>
                  )}
                  {resendResult && resendResult.id === inv.id && (
                    <div className="text-[10px]" style={{ color: resendResult.emailSent ? '#2C5F3E' : '#8A4B12' }}>
                      {resendResult.emailSent
                        ? `Emailed to ${inv.email}.`
                        : `Couldn't resend the email${resendResult.emailError ? ` (${resendResult.emailError})` : ''} — share the code manually.`}
                    </div>
                  )}
                </li>
              )
            })}
          </ul>
        </div>
      )}
      </div>
    </div>
  )
}
