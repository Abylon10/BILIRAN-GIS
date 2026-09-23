// app/reset-password/page.tsx
//
// Reached via the email link from supabase.auth.resetPasswordForEmail()
// (sent by the login card's "Forgot password?" flow — see app/page.tsx's
// handleForgotPassword). The link's URL fragment carries a recovery
// token; the Supabase browser client (lib/supabase.ts, createClient's
// detectSessionInUrl defaults to true) parses it and establishes a
// session automatically before this page's own code runs — no
// server-side token handling here, unlike app/activate's invitation-code
// flow, which goes through /api/activate instead. Once that session
// exists, supabase.auth.updateUser({ password }) is all that's needed.
//
// Standalone route, outside the single-page login/dashboard state
// machine in app/page.tsx — kept deliberately simple (one fixed light
// palette, no day/night toggle) rather than importing that whole state
// machine's theming for a page the user only ever sees once per reset.

'use client'

import { useEffect, useState, type FormEvent } from 'react'
import Link from 'next/link'
import { supabase } from '@/lib/supabase'

type Status = 'checking' | 'ready' | 'invalid' | 'done'

export default function ResetPasswordPage() {
  const [status, setStatus] = useState<Status>('checking')
  const [password, setPassword] = useState('')
  const [confirm, setConfirm] = useState('')
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    // A session existing here means the recovery link's token was valid
    // and detectSessionInUrl already exchanged it; none means the link
    // was missing its token, already used, or expired.
    supabase.auth.getSession().then(({ data: { session } }) => {
      setStatus(session ? 'ready' : 'invalid')
    })
  }, [])

  async function handleSubmit(e: FormEvent) {
    e.preventDefault()
    setError(null)

    if (password !== confirm) {
      setError("Passwords don't match.")
      return
    }
    if (password.length < 6) {
      setError('Password must be at least 6 characters.')
      return
    }

    setLoading(true)
    const { error: updateError } = await supabase.auth.updateUser({ password })
    setLoading(false)

    if (updateError) {
      setError('Could not update your password — try the reset link again.')
      return
    }

    // The recovery session isn't the app's normal signed-in state (no
    // today's bfw_last_login_date set on this device) — sign out so the
    // homepage falls through to its own ordinary login card rather than
    // half-reusing this session as if the user had just signed in there.
    await supabase.auth.signOut()
    setStatus('done')
  }

  return (
    <Centered>
      {status === 'checking' && <p style={{ color: '#274D60' }}>Checking your link…</p>}

      {status === 'invalid' && (
        <>
          <h1 className="text-xl font-semibold" style={{ color: '#031716' }}>
            Link expired
          </h1>
          <p className="mt-2 text-sm" style={{ color: '#274D60' }}>
            This password reset link is invalid or has expired. Go back to the sign-in page and request
            a new one.
          </p>
          <Link
            href="/"
            className="mt-6 block w-full rounded-md py-2.5 text-center text-sm font-semibold"
            style={{ background: 'linear-gradient(145deg, #6BA3BE, #0C969C)', color: '#FBFEFF' }}
          >
            Back to sign in
          </Link>
        </>
      )}

      {status === 'ready' && (
        <>
          <h1 className="text-xl font-semibold" style={{ color: '#031716' }}>
            Set a new password
          </h1>

          <form onSubmit={handleSubmit} className="mt-6 space-y-4">
            <label className="block">
              <span className="text-sm font-medium" style={{ color: '#031716' }}>New password</span>
              <input
                type="password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                required
                minLength={6}
                className="mt-1.5 w-full rounded-md border px-3 py-2 outline-none"
                style={{ borderColor: '#B7D2DE', color: '#031716' }}
              />
            </label>

            <label className="block">
              <span className="text-sm font-medium" style={{ color: '#031716' }}>Confirm password</span>
              <input
                type="password"
                value={confirm}
                onChange={(e) => setConfirm(e.target.value)}
                required
                minLength={6}
                className="mt-1.5 w-full rounded-md border px-3 py-2 outline-none"
                style={{ borderColor: '#B7D2DE', color: '#031716' }}
              />
            </label>

            {error && (
              <p role="alert" className="rounded-md bg-[#FBEEE0] px-3 py-2 text-sm text-[#8A4B12]">
                {error}
              </p>
            )}

            <button
              type="submit"
              disabled={loading}
              className="w-full rounded-md py-2.5 text-sm font-semibold disabled:cursor-not-allowed disabled:opacity-50"
              style={{ background: 'linear-gradient(145deg, #6BA3BE, #0C969C)', color: '#FBFEFF' }}
            >
              {loading ? 'Saving…' : 'Save new password'}
            </button>
          </form>
        </>
      )}

      {status === 'done' && (
        <>
          <h1 className="text-xl font-semibold" style={{ color: '#031716' }}>
            Password updated
          </h1>
          <p className="mt-2 text-sm" style={{ color: '#274D60' }}>
            Sign in with your new password.
          </p>
          <Link
            href="/"
            className="mt-6 block w-full rounded-md py-2.5 text-center text-sm font-semibold"
            style={{ background: 'linear-gradient(145deg, #6BA3BE, #0C969C)', color: '#FBFEFF' }}
          >
            Continue to sign in
          </Link>
        </>
      )}
    </Centered>
  )
}

function Centered({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex min-h-screen items-center justify-center px-6" style={{ background: '#CFE4EC' }}>
      <div
        className="w-full max-w-sm rounded-2xl border p-8 shadow-lg"
        style={{ background: 'rgba(231, 241, 245, 0.9)', borderColor: 'rgba(107, 163, 190, 0.5)' }}
      >
        {children}
      </div>
    </div>
  )
}
