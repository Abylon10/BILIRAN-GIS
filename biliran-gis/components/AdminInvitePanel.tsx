// components/AdminInvitePanel.tsx
//
// Admin-only invitation code management. Account creation is fully
// admin-controlled (settled decision, see CLAUDE.md) — before this, nothing
// in the app could actually create an invitation_codes row, so /activate
// had no way to ever be reached for a real user. Started as create/list
// only; edit and revoke (app/api/admin/invite/[id]/route.ts) came later,
// both refusing to touch an already-redeemed invitation.

'use client'

import { useEffect, useState } from 'react'
import { supabase } from '@/lib/supabase'
import { Modal } from '@/components/ProfilePanel'

interface Invitation {
  id: number
  code: string
  email: string
  office: string
  redeemed: boolean
  expires_at: string | null
  redeemed_at: string | null
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

export default function AdminInvitePanel({ onClose }: { onClose: () => void }) {
  const [email, setEmail] = useState('')
  const [office, setOffice] = useState('')
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [created, setCreated] = useState<Invitation | null>(null)
  const [invitations, setInvitations] = useState<Invitation[]>([])

  // Inline edit state — at most one row editable at a time.
  const [editingId, setEditingId] = useState<number | null>(null)
  const [editEmail, setEditEmail] = useState('')
  const [editOffice, setEditOffice] = useState('')
  const [rowError, setRowError] = useState<string | null>(null)
  const [rowBusyId, setRowBusyId] = useState<number | null>(null)

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

    const token = await getToken()
    if (!token) {
      setLoading(false)
      setError('Your session expired — sign in again.')
      return
    }

    const res = await fetch('/api/admin/invite', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${token}`,
      },
      body: JSON.stringify({ email, office }),
    })
    const data = await res.json()
    setLoading(false)

    if (!res.ok) {
      setError(data.error ?? 'Could not create invitation.')
      return
    }

    setCreated(data.invitation)
    setEmail('')
    setOffice('')
    await refresh()
  }

  function startEdit(inv: Invitation) {
    setRowError(null)
    setEditingId(inv.id)
    setEditEmail(inv.email)
    setEditOffice(inv.office)
  }

  function cancelEdit() {
    setEditingId(null)
  }

  async function saveEdit(id: number) {
    setRowError(null)
    setRowBusyId(id)

    const token = await getToken()
    if (!token) {
      setRowBusyId(null)
      setRowError('Your session expired — sign in again.')
      return
    }

    const res = await fetch(`/api/admin/invite/${id}`, {
      method: 'PATCH',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${token}`,
      },
      body: JSON.stringify({ email: editEmail, office: editOffice }),
    })
    const data = await res.json()
    setRowBusyId(null)

    if (!res.ok) {
      setRowError(data.error ?? 'Could not update invitation.')
      return
    }

    setEditingId(null)
    await refresh()
  }

  async function revoke(id: number) {
    setRowError(null)
    setRowBusyId(id)

    const token = await getToken()
    if (!token) {
      setRowBusyId(null)
      setRowError('Your session expired — sign in again.')
      return
    }

    const res = await fetch(`/api/admin/invite/${id}`, {
      method: 'DELETE',
      headers: { Authorization: `Bearer ${token}` },
    })
    setRowBusyId(null)

    if (!res.ok) {
      const data = await res.json().catch(() => ({}))
      setRowError(data.error ?? 'Could not revoke invitation.')
      return
    }

    await refresh()
  }

  return (
    <Modal title="Invitations" onClose={onClose}>
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

        {error && (
          <p role="alert" className="rounded-md bg-[#FBEEE0]/90 px-3 py-2 text-sm text-[#8A4B12]">
            {error}
          </p>
        )}
        {created && (
          <p className="rounded-md bg-[#E7F3E9] px-3 py-2 text-sm text-[#2C5F3E]">
            Created code <span className="font-mono font-semibold">{created.code}</span> for {created.email}
          </p>
        )}

        <button
          type="submit"
          disabled={loading}
          className="w-full rounded-md bg-[#E8A33D] py-2 text-sm font-semibold text-[#0B3654] transition-colors hover:bg-[#DB962E] disabled:cursor-not-allowed disabled:opacity-50"
        >
          {loading ? 'Creating…' : 'Create invitation'}
        </button>
      </form>

      {invitations.length > 0 && (
        <div className="mt-5 max-h-64 overflow-y-auto border-t pt-3" style={{ borderColor: 'var(--card-border)' }}>
          {rowError && (
            <p role="alert" className="mb-2 rounded-md bg-[#FBEEE0]/90 px-3 py-2 text-xs text-[#8A4B12]">
              {rowError}
            </p>
          )}
          <ul className="space-y-2 text-xs">
            {invitations.map((inv) => {
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
                        className="rounded bg-[#E8A33D] px-2 py-1 text-xs font-semibold text-[#0B3654] disabled:cursor-not-allowed disabled:opacity-50"
                      >
                        {busy ? 'Saving…' : 'Save'}
                      </button>
                    </div>
                  </li>
                )
              }
              return (
                <li key={inv.id} className="flex items-center justify-between gap-2" style={{ color: 'var(--text-soft)' }}>
                  <span className="truncate">{inv.email} · {inv.office}</span>
                  {inv.redeemed ? (
                    <span className="font-mono shrink-0">redeemed</span>
                  ) : (
                    <span className="flex shrink-0 items-center gap-2">
                      <span className="font-mono">{inv.code}</span>
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
                </li>
              )
            })}
          </ul>
        </div>
      )}
    </Modal>
  )
}
