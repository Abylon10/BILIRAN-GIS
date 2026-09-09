// app/page.tsx
//
// Single entry point combining login and dashboard as two states of one
// mounted page, rather than two separate routes. This is what makes the
// "card opens up to reveal the map" transition possible without a hard
// navigation/reload.
//
// States:
//   'checking'   — briefly, while we check session + today's login date
//   'needsLogin' — sunny/night idle scene + login card visible
//   'revealed'   — rainy/dashboard scene + dashboard shell visible
//
// Daily gate: even with a valid Supabase session, the login card reappears
// if the last successful login wasn't today (per device, via localStorage).
// This is a UX gate, not a security boundary — real access control still
// lives in the Supabase session + RLS policies.
//
// Replace the placeholder <DashboardShell> and <IslandScene> pieces with
// the real MapLibre map once that's ready — the state machine and
// transition logic around them won't need to change.

'use client'

import { useEffect, useState, useCallback, type FormEvent } from 'react'
import { supabase } from '@/lib/supabase'

const LAST_LOGIN_KEY = 'bfw_last_login_date'

type AuthState = 'checking' | 'needsLogin' | 'revealed'

export default function HomePage() {
  const [authState, setAuthState] = useState<AuthState>('checking')
  const [theme, setTheme] = useState<'light' | 'dark'>('light')
  const [menuOpen, setMenuOpen] = useState(false)

  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  // Follow system theme
  useEffect(() => {
    const mq = window.matchMedia('(prefers-color-scheme: dark)')
    setTheme(mq.matches ? 'dark' : 'light')
    const listener = (e: MediaQueryListEvent) => setTheme(e.matches ? 'dark' : 'light')
    mq.addEventListener('change', listener)
    return () => mq.removeEventListener('change', listener)
  }, [])

  // Resolve initial state: session + daily gate, no animation on this first resolution
  useEffect(() => {
    async function resolve() {
      const { data: { session } } = await supabase.auth.getSession()
      const lastLogin = window.localStorage.getItem(LAST_LOGIN_KEY)
      const today = new Date().toDateString()

      if (session && lastLogin === today) {
        setAuthState('revealed')
      } else {
        setAuthState('needsLogin')
      }
    }
    resolve()
  }, [])

  const handleSubmit = useCallback(
    async (e: FormEvent) => {
      e.preventDefault()
      setError(null)
      setLoading(true)

      const { error: authError } = await supabase.auth.signInWithPassword({ email, password })
      setLoading(false)

      if (authError) {
        setError('Email or password is incorrect. Try again.')
        return
      }

      window.localStorage.setItem(LAST_LOGIN_KEY, new Date().toDateString())
      setAuthState('revealed') // triggers the CSS transition since this happens post-mount
    },
    [email, password]
  )

  const handleSignOut = useCallback(async () => {
    await supabase.auth.signOut()
    window.localStorage.removeItem(LAST_LOGIN_KEY)
    setAuthState('needsLogin')
  }, [])

  const revealed = authState === 'revealed'
  const emailValid = /\S+@\S+\.\S+/.test(email)
  const passwordValid = password.length >= 6

  return (
    <div
      data-theme={theme}
      data-revealed={revealed}
      className="bfw-root relative min-h-screen w-full overflow-hidden"
    >
      <style>{`
        .bfw-root[data-theme='light'] {
          --sky-top: #6EC6E8; --sky-bottom: #DCEFF5;
          --sea-top: #1E7F8C; --sea-bottom: #58C2C9;
          --land: #6FA85B; --land-dark: #4F8A45; --contour: #3E7038; --mountain: #8C7355;
          --sun-glow: rgba(253, 200, 90, 0.55); --sun-core: #FFD873;
          --cloud: rgba(255, 255, 255, 0.9);
          --card-bg: rgba(255, 255, 255, 0.72); --card-border: rgba(255, 255, 255, 0.5);
          --text-strong: #0B3654; --text-soft: #3E6664; --field-line: #C9DEDA;
        }
        .bfw-root[data-theme='dark'] {
          --sky-top: #0B1830; --sky-bottom: #1B2C46;
          --sea-top: #0B3038; --sea-bottom: #114652;
          --land: #33502F; --land-dark: #24391F; --contour: #1B2E17; --mountain: #4A4038;
          --sun-glow: rgba(230, 235, 255, 0.18); --sun-core: #EDEFF7;
          --cloud: rgba(210, 220, 235, 0.35);
          --card-bg: rgba(11, 24, 40, 0.6); --card-border: rgba(255, 255, 255, 0.12);
          --text-strong: #F2F6F5; --text-soft: #A9C0C6; --field-line: rgba(255, 255, 255, 0.2);
        }
        /* Revealed state darkens the sky toward a rainy mood, regardless of theme */
        .bfw-root[data-revealed='true'] .bfw-sky { background: linear-gradient(to bottom, #3B5368, #223244) !important; }
        .bfw-root[data-revealed='true'] .bfw-sun { opacity: 0; }
        .bfw-root[data-revealed='true'] .bfw-rain { opacity: 1; }

        .bfw-sky { position: absolute; inset: 0; background: linear-gradient(to bottom, var(--sky-top), var(--sky-bottom)); transition: background 1.2s ease; }
        .bfw-scene { position: absolute; inset: -6%; animation: bfw-drift 42s ease-in-out infinite alternate; }
        @keyframes bfw-drift { 0% { transform: translate(0,0) scale(1.02); } 100% { transform: translate(18px,-12px) scale(1.02); } }
        .bfw-sun { transition: opacity 1s ease; }
        .bfw-rain { position: absolute; inset: 0; opacity: 0; transition: opacity 1.2s ease; pointer-events: none; }

        .bfw-card { transition: transform 0.6s ease, opacity 0.5s ease; }
        .bfw-root[data-revealed='true'] .bfw-card { transform: translateY(40px) scale(0.92); opacity: 0; pointer-events: none; }

        .bfw-dash { opacity: 0; transition: opacity 0.8s ease 0.4s; pointer-events: none; }
        .bfw-root[data-revealed='true'] .bfw-dash { opacity: 1; pointer-events: auto; }

        .bfw-loading-cover { position: absolute; inset: 0; background: var(--sky-bottom, #DCEFF5); z-index: 50; transition: opacity 0.3s ease; }

        @media (prefers-reduced-motion: reduce) { .bfw-scene { animation: none !important; } }
      `}</style>

      <div className="bfw-sky" />

      {/* Sun */}
      <svg className="bfw-sun pointer-events-none absolute right-[12%] top-[10%] h-40 w-40" viewBox="0 0 200 200" aria-hidden>
        <circle cx="100" cy="100" r="90" fill="var(--sun-glow)" />
        <circle cx="100" cy="100" r="46" fill="var(--sun-core)" />
      </svg>

      {/* Rain, fades in only when revealed */}
      <svg className="bfw-rain" aria-hidden>
        <g stroke="rgba(255,255,255,0.45)" strokeWidth="2">
          {Array.from({ length: 24 }).map((_, i) => {
            const x = (i * 173) % 100
            const y = (i * 97) % 60
            return <line key={i} x1={`${x}%`} y1={`${y}%`} x2={`${x - 4}%`} y2={`${y + 8}%`} />
          })}
        </g>
      </svg>

      {/* Placeholder island scene — swap for the real MapLibre map later */}
      <div className="bfw-scene">
        <IslandScene />
      </div>

      {/* Theme toggle */}
      <button
        type="button"
        onClick={() => setTheme((t) => (t === 'light' ? 'dark' : 'light'))}
        aria-label="Toggle day and night"
        className="absolute right-5 top-5 z-20 rounded-full border px-3 py-1.5 text-xs font-medium backdrop-blur-md transition-colors"
        style={{ background: 'var(--card-bg)', borderColor: 'var(--card-border)', color: 'var(--text-strong)' }}
      >
        {theme === 'light' ? '☀ Day' : '☾ Night'}
      </button>

      {/* Login card */}
      <div className="bfw-card relative z-10 flex min-h-screen items-center justify-center px-6 py-16" data-revealed={revealed}>
        <div className="w-full max-w-sm rounded-2xl border p-8 shadow-2xl backdrop-blur-xl" style={{ background: 'var(--card-bg)', borderColor: 'var(--card-border)' }}>
          <div className="flex justify-center">
            <img
              src={theme === 'light' ? '/logo-light.png' : '/logo-dark.png'}
              alt="Biliran Flood Watch"
              className="h-16 w-auto select-none"
              draggable={false}
            />
          </div>

          <h2 className="mt-2 text-center text-xl font-semibold" style={{ color: 'var(--text-strong)' }}>Sign in</h2>
          <p className="text-center mt-1 text-sm" style={{ color: 'var(--text-soft)' }}>Biliran Flood Watch</p>

          <form onSubmit={handleSubmit} className="mt-6 space-y-5">
            <Field label="Email" type="email" value={email} onChange={setEmail} valid={email.length > 0 && emailValid} />
            <Field label="Password" type="password" value={password} onChange={setPassword} valid={password.length > 0 && passwordValid} />

            {error && <p role="alert" className="rounded-md bg-[#FBEEE0]/90 px-3 py-2 text-sm text-[#8A4B12]">{error}</p>}

            <button
              type="submit"
              disabled={loading || !emailValid || !passwordValid}
              className="w-full rounded-md bg-[#E8A33D] py-2.5 text-sm font-semibold text-[#0B3654] transition-colors hover:bg-[#DB962E] disabled:cursor-not-allowed disabled:opacity-50"
            >
              {loading ? 'Signing in…' : 'Sign in'}
            </button>
          </form>
        </div>
      </div>

      {/* Dashboard shell placeholder */}
      <div className="bfw-dash absolute inset-0 z-10 p-6" data-revealed={revealed}>
        <div>
          <h1 className="text-lg font-semibold text-[#F2F6F5]">Biliran — flood risk map</h1>
          <p className="text-sm text-[#CFE0DD]">Live conditions loading…</p>
        </div>
        {/* Real map, drill-down, and countdown dashboard go here */}
      </div>

      {/* Bottom-right menu: Profile / Dashboard / Sign out — only relevant once logged in */}
      {revealed && (
        <div className="absolute bottom-5 right-5 z-20 flex flex-col items-end gap-2">
          {menuOpen && (
            <div className="mb-1 flex flex-col overflow-hidden rounded-2xl border shadow-lg backdrop-blur-xl" style={{ background: 'var(--card-bg)', borderColor: 'var(--card-border)' }}>
              <MenuItem label="Profile" onClick={() => setMenuOpen(false)} />
              <MenuItem label="Dashboard" onClick={() => setMenuOpen(false)} />
              <MenuItem label="Sign out" onClick={handleSignOut} />
            </div>
          )}
          <button
            onClick={() => setMenuOpen((v) => !v)}
            aria-label="Open menu"
            aria-expanded={menuOpen}
            className="flex h-12 w-12 items-center justify-center rounded-full border shadow-lg backdrop-blur-xl transition-transform"
            style={{ background: 'var(--card-bg)', borderColor: 'var(--card-border)', color: 'var(--text-strong)', transform: menuOpen ? 'rotate(45deg)' : 'none' }}
          >
            <span className="text-2xl leading-none">+</span>
          </button>
        </div>
      )}

      {/* Loading cover, hides the pre-resolved state flash */}
      <div
        className="bfw-loading-cover"
        style={{ opacity: authState === 'checking' ? 1 : 0, pointerEvents: authState === 'checking' ? 'auto' : 'none' }}
      />
    </div>
  )
}

function Field({ label, type, value, onChange, valid }: { label: string; type: string; value: string; onChange: (v: string) => void; valid: boolean }) {
  return (
    <label className="block">
      <span className="text-sm font-medium" style={{ color: 'var(--text-strong)' }}>{label}</span>
      <div className="relative mt-1.5">
        <input
          type={type}
          value={value}
          onChange={(e) => onChange(e.target.value)}
          required
          className="w-full border-0 border-b-2 bg-transparent px-0 py-2 outline-none focus:ring-0"
          style={{ borderColor: 'var(--field-line)', color: 'var(--text-strong)' }}
        />
        <span
          aria-hidden
          className="pointer-events-none absolute bottom-0 left-0 h-[2px] bg-[#E8A33D] transition-all duration-500 ease-out"
          style={{ width: valid ? '100%' : '0%' }}
        />
      </div>
    </label>
  )
}

function MenuItem({ label, onClick }: { label: string; onClick: () => void }) {
  return (
    <button
      onClick={onClick}
      className="px-5 py-3 text-left text-sm font-medium hover:bg-black/5"
      style={{ color: 'var(--text-strong)' }}
    >
      {label}
    </button>
  )
}

function IslandScene() {
  return (
    <svg className="h-full w-full" viewBox="0 0 1000 1000" preserveAspectRatio="xMidYMid slice" aria-hidden>
      <defs>
        <radialGradient id="bfw-sea-grad" cx="50%" cy="50%" r="70%">
          <stop offset="0%" stopColor="var(--sea-bottom)" />
          <stop offset="100%" stopColor="var(--sea-top)" />
        </radialGradient>
      </defs>
      <rect x="0" y="0" width="1000" height="1000" fill="url(#bfw-sea-grad)" />
      <path
        d="M 500 220 C 610 230, 700 280, 740 360 C 790 450, 780 540, 730 610 C 690 665, 630 720, 560 750 C 500 775, 430 760, 390 715 C 340 660, 300 590, 290 510 C 280 420, 320 330, 400 275 C 430 255, 465 225, 500 220 Z"
        fill="var(--land)"
      />
      <path
        d="M 470 430 L 500 380 L 535 430 L 555 470 L 445 470 Z"
        fill="var(--mountain)" opacity="0.85"
      />
    </svg>
  )
}