// components/AdminInvitePanel.tsx
//
// Admin-only invitation code creation. Account creation is fully
// admin-controlled (settled decision, see CLAUDE.md) — before this, nothing
// in the app could actually create an invitation_codes row, so /activate
// had no way to ever be reached for a real user.

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

  useEffect(() => {
    let cancelled = false
    supabase.auth.getSession().then(({ data: { session } }) => {
      if (!session) return
      fetchInvitations(session.access_token).then((data) => {
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

    const { data: { session } } = await supabase.auth.getSession()
    if (!session) {
      setLoading(false)
      setError('Your session expired — sign in again.')
      return
    }

    const res = await fetch('/api/admin/invite', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${session.access_token}`,
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
    setInvitations(await fetchInvitations(session.access_token))
  }

  return (
    <Modal title="Invitations" onClose={onClose}>
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
        <div className="mt-5 max-h-48 overflow-y-auto border-t pt-3" style={{ borderColor: 'var(--card-border)' }}>
          <ul className="space-y-1.5 text-xs">
            {invitations.map((inv) => (
              <li key={inv.id} className="flex items-center justify-between gap-2" style={{ color: 'var(--text-soft)' }}>
                <span className="truncate">{inv.email} · {inv.office}</span>
                <span className="font-mono">{inv.redeemed ? 'redeemed' : inv.code}</span>
              </li>
            ))}
          </ul>
        </div>
      )}
    </Modal>
  )
}
