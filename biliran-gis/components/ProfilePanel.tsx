// components/ProfilePanel.tsx
//
// Minimal Profile view behind the hidden "+" menu: account email plus the
// office/access_level from user_profiles. No photo/Storage-backed fields
// yet — CLAUDE.md notes that piece needs its own design pass.

'use client'

import { useEffect, useState } from 'react'
import type { User } from '@supabase/supabase-js'
import { fetchOwnProfile, type Profile } from '@/lib/profile'

export default function ProfilePanel({ user, onClose }: { user: User; onClose: () => void }) {
  const [profile, setProfile] = useState<Profile | null>(null)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    let cancelled = false
    fetchOwnProfile(user.id).then((p) => {
      if (!cancelled) {
        setProfile(p)
        setLoading(false)
      }
    })
    return () => {
      cancelled = true
    }
  }, [user.id])

  return (
    <Modal onClose={onClose} title="Profile">
      <dl className="space-y-3 text-sm">
        <Row label="Email" value={user.email ?? '—'} />
        <Row label="Office" value={loading ? 'Loading…' : profile?.office ?? '—'} />
        <Row label="Access level" value={loading ? 'Loading…' : profile?.access_level ?? '—'} />
      </dl>
    </Modal>
  )
}

function Row({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-center justify-between gap-4">
      <dt style={{ color: 'var(--text-soft)' }}>{label}</dt>
      <dd className="font-medium" style={{ color: 'var(--text-strong)' }}>{value}</dd>
    </div>
  )
}

export function Modal({
  title,
  onClose,
  children,
}: {
  title: string
  onClose: () => void
  children: React.ReactNode
}) {
  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 px-6"
      onClick={onClose}
    >
      <div
        role="dialog"
        aria-modal="true"
        onClick={(e) => e.stopPropagation()}
        className="w-full max-w-sm rounded-2xl border p-6 shadow-2xl backdrop-blur-xl"
        style={{ background: 'var(--card-bg)', borderColor: 'var(--card-border)' }}
      >
        <div className="mb-4 flex items-center justify-between">
          <h2 className="text-lg font-semibold" style={{ color: 'var(--text-strong)' }}>{title}</h2>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close"
            className="text-xl leading-none"
            style={{ color: 'var(--text-soft)' }}
          >
            ×
          </button>
        </div>
        {children}
      </div>
    </div>
  )
}
