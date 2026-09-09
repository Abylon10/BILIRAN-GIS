// app/activate/page.tsx

'use client'

import { useState, type FormEvent } from 'react'
import { useRouter, useSearchParams } from 'next/navigation'
import { getOrCreateDeviceId } from '@/lib/deviceId'

export default function ActivatePage() {
  const router = useRouter()
  const searchParams = useSearchParams()
  const code = searchParams.get('code') ?? ''

  const [password, setPassword] = useState('')
  const [confirm, setConfirm] = useState('')
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function handleSubmit(e: FormEvent) {
    e.preventDefault()
    setError(null)

    if (password !== confirm) {
      setError("Passwords don't match.")
      return
    }

    setLoading(true)
    const res = await fetch('/api/activate', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ code, password, deviceId: getOrCreateDeviceId() }),
    })
    const data = await res.json()
    setLoading(false)

    if (!res.ok) {
      setError(data.error ?? 'Something went wrong.')
      return
    }

    router.push('/login?activated=1')
  }

  if (!code) {
    return (
      <Centered>
        <p className="text-[#8A4B12]">
          No invitation code found. Check the link from your email.
        </p>
      </Centered>
    )
  }

  return (
    <Centered>
      <h1 className="text-xl font-semibold text-[#0B3654]">Set your password</h1>
      <p className="mt-1 text-sm text-[#3E6664]">
        Invitation code: <span className="font-mono">{code}</span>
      </p>

      <form onSubmit={handleSubmit} className="mt-6 space-y-4">
        <label className="block">
          <span className="text-sm font-medium text-[#0B3654]">Password</span>
          <input
            type="password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            required
            minLength={6}
            className="mt-1.5 w-full rounded-md border border-[#C9DEDA] px-3 py-2 text-[#0B3654] outline-none focus:border-[#1F5C6B]"
          />
        </label>

        <label className="block">
          <span className="text-sm font-medium text-[#0B3654]">Confirm password</span>
          <input
            type="password"
            value={confirm}
            onChange={(e) => setConfirm(e.target.value)}
            required
            minLength={6}
            className="mt-1.5 w-full rounded-md border border-[#C9DEDA] px-3 py-2 text-[#0B3654] outline-none focus:border-[#1F5C6B]"
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
          className="w-full rounded-md bg-[#E8A33D] py-2.5 text-sm font-semibold text-[#0B3654] transition-colors hover:bg-[#DB962E] disabled:cursor-not-allowed disabled:opacity-50"
        >
          {loading ? 'Creating account…' : 'Activate account'}
        </button>
      </form>
    </Centered>
  )
}

function Centered({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex min-h-screen items-center justify-center bg-[#F4F7F6] px-6">
      <div className="w-full max-w-sm rounded-2xl border border-[#E3ECEA] bg-white p-8 shadow-lg">
        {children}
      </div>
    </div>
  )
}