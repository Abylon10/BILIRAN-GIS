// components/ProfilePanel.tsx
//
// Profile view behind the hidden "+" menu: account email, office/
// access_level from user_profiles, and a photo backed by a private
// Supabase Storage bucket (see supabase/avatars-storage-setup.sql and
// app/api/profile/avatar-upload-url/route.ts). The bucket stays private —
// upload goes through a per-request signed upload URL, display through a
// freshly-signed read URL, never a public bucket URL.

'use client'

import { useEffect, useRef, useState } from 'react'
import type { User } from '@supabase/supabase-js'
import { supabase } from '@/lib/supabase'
import { fetchOwnProfile, getAvatarUrl, updateOwnAvatarPath, type Profile } from '@/lib/profile'

const MAX_AVATAR_BYTES = 5 * 1024 * 1024

export default function ProfilePanel({
  user,
  onClose,
  onAvatarChange,
}: {
  user: User
  onClose: () => void
  onAvatarChange?: (url: string | null) => void
}) {
  const [profile, setProfile] = useState<Profile | null>(null)
  const [loading, setLoading] = useState(true)
  const [avatarUrl, setAvatarUrl] = useState<string | null>(null)
  const [uploadState, setUploadState] = useState<'idle' | 'uploading' | 'error'>('idle')
  const [uploadError, setUploadError] = useState<string | null>(null)
  const fileInputRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    let cancelled = false
    fetchOwnProfile(user.id).then(async (p) => {
      if (cancelled) return
      setProfile(p)
      setLoading(false)
      if (p?.avatar_path) {
        const url = await getAvatarUrl(p.avatar_path)
        if (!cancelled) setAvatarUrl(url)
      }
    })
    return () => {
      cancelled = true
    }
  }, [user.id])

  async function handleFileSelected(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0]
    e.target.value = ''
    if (!file) return

    if (!file.type.startsWith('image/')) {
      setUploadState('error')
      setUploadError('Please choose an image file.')
      return
    }
    if (file.size > MAX_AVATAR_BYTES) {
      setUploadState('error')
      setUploadError('Image must be under 5MB.')
      return
    }

    setUploadState('uploading')
    setUploadError(null)

    const { data: { session } } = await supabase.auth.getSession()
    if (!session) {
      setUploadState('error')
      setUploadError('Your session expired — sign in again.')
      return
    }

    const res = await fetch('/api/profile/avatar-upload-url', {
      method: 'POST',
      headers: { Authorization: `Bearer ${session.access_token}` },
    })
    const uploadUrlData = await res.json()
    if (!res.ok) {
      setUploadState('error')
      setUploadError(uploadUrlData.error ?? 'Could not start the upload.')
      return
    }

    const { path, token } = uploadUrlData as { path: string; token: string }
    const { error: uploadErr } = await supabase.storage
      .from('avatars')
      .uploadToSignedUrl(path, token, file)
    if (uploadErr) {
      setUploadState('error')
      setUploadError('Upload failed — try again.')
      return
    }

    const saved = await updateOwnAvatarPath(user.id, path)
    if (!saved) {
      setUploadState('error')
      setUploadError('Photo uploaded, but saving it to your profile failed.')
      return
    }

    const url = await getAvatarUrl(path)
    setAvatarUrl(url)
    onAvatarChange?.(url)
    setUploadState('idle')
  }

  return (
    <Modal onClose={onClose} title="Profile">
      <div className="mb-5 flex items-center gap-4">
        <button
          type="button"
          onClick={() => fileInputRef.current?.click()}
          disabled={uploadState === 'uploading'}
          className="relative h-16 w-16 shrink-0 overflow-hidden rounded-full border-2 disabled:cursor-not-allowed"
          style={{ borderColor: 'var(--card-border)', background: 'var(--card-bg)' }}
          aria-label="Change profile photo"
          title="Change profile photo"
        >
          {avatarUrl ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={avatarUrl} alt="" className="h-full w-full object-cover" />
          ) : (
            <span className="flex h-full w-full items-center justify-center text-lg font-semibold" style={{ color: 'var(--text-soft)' }}>
              {(user.email ?? '?').charAt(0).toUpperCase()}
            </span>
          )}
          {uploadState === 'uploading' && (
            <span className="absolute inset-0 flex items-center justify-center bg-black/40 text-[10px] font-medium text-white">
              Uploading…
            </span>
          )}
        </button>
        <div>
          <button
            type="button"
            onClick={() => fileInputRef.current?.click()}
            disabled={uploadState === 'uploading'}
            className="text-sm font-medium underline decoration-dotted underline-offset-2 disabled:cursor-not-allowed disabled:opacity-50"
            style={{ color: 'var(--text-strong)' }}
          >
            {avatarUrl ? 'Change photo' : 'Upload photo'}
          </button>
          <p className="mt-0.5 text-xs" style={{ color: 'var(--text-soft)' }}>JPG or PNG, up to 5MB</p>
        </div>
        <input
          ref={fileInputRef}
          type="file"
          accept="image/*"
          onChange={handleFileSelected}
          className="hidden"
        />
      </div>

      {uploadState === 'error' && uploadError && (
        <p role="alert" className="mb-4 rounded-md bg-[#FBEEE0]/90 px-3 py-2 text-sm text-[#8A4B12]">
          {uploadError}
        </p>
      )}

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
