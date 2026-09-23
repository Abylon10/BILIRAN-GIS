// components/ProfilePanel.tsx
//
// Profile view behind the header profile button (components/
// HeaderProfileButton.tsx): account email, editable title/first/family
// name + office (user_profiles — see supabase/profile-name-fields-setup.sql
// for the columns and a related access_level RLS-column-grant fix),
// access level (read-only, never user-editable), a photo backed by a
// private Supabase Storage bucket (see supabase/avatars-storage-setup.sql
// and app/api/profile/avatar-upload-url/route.ts — the bucket stays
// private, upload goes through a per-request signed upload URL, display
// through a freshly-signed read URL, never a public bucket URL), and,
// moved here from the old bottom-right "+" menu, an admin-panel entry
// point (isAdmin-gated) and Sign out.

'use client'

import { useEffect, useRef, useState } from 'react'
import type { User } from '@supabase/supabase-js'
import { supabase } from '@/lib/supabase'
import {
  fetchOwnProfile,
  getAvatarUrl,
  updateOwnAvatarPath,
  updateOwnProfileFields,
  type Profile,
} from '@/lib/profile'

const MAX_AVATAR_BYTES = 5 * 1024 * 1024

export default function ProfilePanel({
  user,
  onClose,
  onAvatarChange,
  onProfileFieldsChange,
  isAdmin,
  onOpenAdmin,
  onSignOut,
}: {
  user: User
  onClose: () => void
  onAvatarChange?: (url: string | null) => void
  // Lets the header profile button update its own name/office display
  // immediately after a save, without a second fetch.
  onProfileFieldsChange?: (fields: Pick<Profile, 'title' | 'first_name' | 'family_name' | 'office'>) => void
  isAdmin: boolean
  onOpenAdmin: () => void
  onSignOut: () => void
}) {
  const [profile, setProfile] = useState<Profile | null>(null)
  const [loading, setLoading] = useState(true)
  const [avatarUrl, setAvatarUrl] = useState<string | null>(null)
  const [uploadState, setUploadState] = useState<'idle' | 'uploading' | 'error'>('idle')
  const [uploadError, setUploadError] = useState<string | null>(null)
  const fileInputRef = useRef<HTMLInputElement>(null)

  const [title, setTitle] = useState('')
  const [firstName, setFirstName] = useState('')
  const [familyName, setFamilyName] = useState('')
  const [office, setOffice] = useState('')
  const [savingFields, setSavingFields] = useState(false)
  const [fieldsError, setFieldsError] = useState<string | null>(null)
  const [fieldsSaved, setFieldsSaved] = useState(false)

  useEffect(() => {
    let cancelled = false
    fetchOwnProfile(user.id).then(async (p) => {
      if (cancelled) return
      setProfile(p)
      setLoading(false)
      if (p) {
        setTitle(p.title ?? '')
        setFirstName(p.first_name ?? '')
        setFamilyName(p.family_name ?? '')
        setOffice(p.office ?? '')
      }
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

  async function handleSaveFields(e: React.FormEvent) {
    e.preventDefault()
    setSavingFields(true)
    setFieldsError(null)
    setFieldsSaved(false)

    const fields = {
      title: title.trim() || null,
      first_name: firstName.trim() || null,
      family_name: familyName.trim() || null,
      office: office.trim() || null,
    }
    const ok = await updateOwnProfileFields(user.id, fields)
    setSavingFields(false)

    if (!ok) {
      setFieldsError('Could not save changes.')
      return
    }
    setFieldsSaved(true)
    onProfileFieldsChange?.(fields)
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
          <Avatar url={avatarUrl} label={user.email} sizeClassName="h-full w-full" />
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

      <p className="mb-3 text-sm" style={{ color: 'var(--text-soft)' }}>
        {user.email ?? '—'}
      </p>

      <form onSubmit={handleSaveFields} className="space-y-3">
        <div className="grid grid-cols-[80px_1fr] gap-2">
          <FieldInput label="Title" value={title} onChange={setTitle} placeholder="Mr./Mrs./Ms./Engr." disabled={loading} />
          <FieldInput label="First name" value={firstName} onChange={setFirstName} disabled={loading} />
        </div>
        <FieldInput label="Family name" value={familyName} onChange={setFamilyName} disabled={loading} />
        <FieldInput label="Office" value={office} onChange={setOffice} placeholder="e.g. MDRRMO Naval" disabled={loading} />

        {fieldsError && (
          <p role="alert" className="rounded-md bg-[#FBEEE0]/90 px-3 py-2 text-sm text-[#8A4B12]">
            {fieldsError}
          </p>
        )}
        {fieldsSaved && !fieldsError && (
          <p className="rounded-md bg-[#E7F3E9] px-3 py-2 text-sm text-[#2C5F3E]">Saved.</p>
        )}

        <button
          type="submit"
          disabled={loading || savingFields}
          className="bfw-btn w-full rounded-md py-2 text-sm font-semibold"
        >
          {savingFields ? 'Saving…' : 'Save changes'}
        </button>
      </form>

      <dl className="mt-4 space-y-3 text-sm">
        <Row label="Access level" value={loading ? 'Loading…' : profile?.access_level ?? '—'} />
      </dl>

      <div className="mt-5 space-y-2 border-t pt-4" style={{ borderColor: 'var(--card-border)' }}>
        {isAdmin && (
          <button
            type="button"
            onClick={onOpenAdmin}
            className="w-full rounded-md border py-2 text-sm font-medium"
            style={{ borderColor: 'var(--card-border)', color: 'var(--text-strong)' }}
          >
            Admin panel
          </button>
        )}
        <button
          type="button"
          onClick={onSignOut}
          className="w-full rounded-md border py-2 text-sm font-medium"
          style={{ borderColor: 'var(--card-border)', color: 'var(--text-strong)' }}
        >
          Sign out
        </button>
      </div>
    </Modal>
  )
}

function FieldInput({
  label,
  value,
  onChange,
  placeholder,
  disabled,
}: {
  label: string
  value: string
  onChange: (v: string) => void
  placeholder?: string
  disabled?: boolean
}) {
  return (
    <label className="block">
      <span className="text-xs font-medium" style={{ color: 'var(--text-soft)' }}>{label}</span>
      <input
        type="text"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder}
        disabled={disabled}
        className="mt-1 w-full rounded-md border px-3 py-2 text-sm outline-none disabled:opacity-50"
        style={{ borderColor: 'var(--field-line)', color: 'var(--text-strong)' }}
      />
    </label>
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

// Shared avatar-with-fallback, used both here and by
// components/HeaderProfileButton.tsx (which has no `user` yet pre-login,
// so it never has a `label` — just the generic silhouette). `label` (an
// email, initial extracted here) is for when a user IS known but has no
// photo; the silhouette is for when neither is known.
export function Avatar({
  url,
  label,
  sizeClassName = 'h-10 w-10',
}: {
  url?: string | null
  label?: string | null
  sizeClassName?: string
}) {
  if (url) {
    return (
      // eslint-disable-next-line @next/next/no-img-element
      <img src={url} alt="" className={`${sizeClassName} object-cover`} />
    )
  }
  if (label) {
    return (
      <span
        className={`flex ${sizeClassName} items-center justify-center text-lg font-semibold`}
        style={{ color: 'var(--text-soft)' }}
      >
        {label.charAt(0).toUpperCase()}
      </span>
    )
  }
  return (
    <span className={`flex ${sizeClassName} items-center justify-center`} style={{ color: 'var(--text-soft)' }}>
      <svg viewBox="0 0 24 24" fill="currentColor" className="h-3/5 w-3/5" aria-hidden>
        <circle cx="12" cy="8" r="4" />
        <path d="M4 20c0-4.42 3.58-8 8-8s8 3.58 8 8" />
      </svg>
    </span>
  )
}

// Matches BiliranMap.tsx's zoom transform / HeaderProfileButton.tsx's
// avatar-grow / app/page.tsx's map-shell easing family, so this reads
// consistent with the rest of the app's motion rather than a flat default.
const MODAL_TRANSITION_MS = 300

export function Modal({
  title,
  onClose,
  children,
}: {
  title: string
  onClose: () => void
  children: React.ReactNode
}) {
  // Mounted/unmounted entirely by the caller's own conditional (e.g.
  // `{showProfile && <ProfilePanel/>}` in app/page.tsx), so an exit
  // transition needs its own beat before the real onClose actually
  // unmounts this — `open` false-by-default then flipped true next frame
  // drives the entrance; requestClose flips it back to false and defers
  // the real onClose until the CSS transition has had time to run.
  const [open, setOpen] = useState(false)

  useEffect(() => {
    const raf = requestAnimationFrame(() => setOpen(true))
    return () => cancelAnimationFrame(raf)
  }, [])

  function requestClose() {
    setOpen(false)
    setTimeout(onClose, MODAL_TRANSITION_MS)
  }

  return (
    <div
      className="bfw-modal-backdrop fixed inset-0 z-50 flex items-center justify-center bg-black/40 px-6"
      data-open={open}
      onClick={requestClose}
    >
      <style>{`
        .bfw-modal-backdrop {
          opacity: 0;
          transition: opacity ${MODAL_TRANSITION_MS}ms cubic-bezier(0.22,1,0.36,1);
        }
        .bfw-modal-backdrop[data-open='true'] { opacity: 1; }
        .bfw-modal-dialog {
          opacity: 0;
          transform: scale(0.95);
          transition: opacity ${MODAL_TRANSITION_MS}ms cubic-bezier(0.22,1,0.36,1), transform ${MODAL_TRANSITION_MS}ms cubic-bezier(0.22,1,0.36,1);
        }
        .bfw-modal-backdrop[data-open='true'] .bfw-modal-dialog { opacity: 1; transform: scale(1); }
        @media (prefers-reduced-motion: reduce) {
          .bfw-modal-backdrop, .bfw-modal-dialog { transition: none !important; }
        }
      `}</style>
      <div
        role="dialog"
        aria-modal="true"
        onClick={(e) => e.stopPropagation()}
        className="bfw-modal-dialog w-full max-w-sm rounded-2xl border p-6 shadow-2xl backdrop-blur-xl"
        style={{ background: 'var(--card-bg)', borderColor: 'var(--card-border)' }}
      >
        <div className="mb-4 flex items-center justify-between">
          <h2 className="text-lg font-semibold" style={{ color: 'var(--text-strong)' }}>{title}</h2>
          <button
            type="button"
            onClick={requestClose}
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
