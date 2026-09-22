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
// <DashboardShell> reads public/data/barangay_dashboard_data.json plus the
// real barangay/municipality polygons in public/data/geo/ — see its and
// BiliranMap.tsx's file headers for what's included and what's still
// deferred for lack of data (hydrograph, FSI factor breakdown).

'use client'

import { useEffect, useLayoutEffect, useRef, useState, useCallback, type FormEvent } from 'react'
import type { User } from '@supabase/supabase-js'
import { supabase } from '@/lib/supabase'
import { fetchOwnProfile, getAvatarUrl } from '@/lib/profile'
import { loadBarangays, type Barangay } from '@/lib/dashboardData'
import DashboardShell from '@/components/DashboardShell'
import BiliranMap from '@/components/BiliranMap'
import ProfilePanel from '@/components/ProfilePanel'
import AdminInvitePanel from '@/components/AdminInvitePanel'

const LAST_LOGIN_KEY = 'bfw_last_login_date'

type AuthState = 'checking' | 'needsLogin' | 'revealed'

function prefersDark() {
  return typeof window !== 'undefined' && window.matchMedia('(prefers-color-scheme: dark)').matches
}

export default function HomePage() {
  const [authState, setAuthState] = useState<AuthState>('checking')
  const revealed = authState === 'revealed'
  const [theme, setTheme] = useState<'light' | 'dark'>(() => (prefersDark() ? 'dark' : 'light'))
  const [menuOpen, setMenuOpen] = useState(false)

  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [activated, setActivated] = useState(false)

  const [user, setUser] = useState<User | null>(null)
  const [isAdmin, setIsAdmin] = useState(false)
  const [avatarUrl, setAvatarUrl] = useState<string | null>(null)
  const [showProfile, setShowProfile] = useState(false)
  const [showInvitations, setShowInvitations] = useState(false)

  // Lifted up from DashboardShell so the one persistent <BiliranMap> below
  // (mounted here, not inside DashboardShell — see "one map, not two" in
  // CLAUDE.md) and DashboardShell's list/detail panel share a single fetch
  // and a single selection, instead of each owning their own copy.
  const [barangays, setBarangays] = useState<Barangay[] | null>(null)
  const [mapLoadError, setMapLoadError] = useState<string | null>(null)
  const [selectedKey, setSelectedKey] = useState<string | null>(null)

  const mapSlotRef = useRef<HTMLDivElement>(null)
  const [mapRect, setMapRect] = useState<{ top: number; left: number; width: number; height: number } | null>(null)

  // Keep theme in sync with system changes after the initial render above.
  useEffect(() => {
    const mq = window.matchMedia('(prefers-color-scheme: dark)')
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

      const params = new URLSearchParams(window.location.search)
      if (params.get('activated') === '1') {
        setActivated(true)
        window.history.replaceState(null, '', window.location.pathname)
      }

      if (session && lastLogin === today) {
        setAuthState('revealed')
      } else {
        setAuthState('needsLogin')
      }
    }
    resolve()
  }, [])

  // Load the signed-in user + admin status once the dashboard is revealed.
  useEffect(() => {
    if (authState !== 'revealed') return
    let cancelled = false

    async function loadUser() {
      const { data: { user: current } } = await supabase.auth.getUser()
      if (cancelled || !current) return
      setUser(current)
      const profile = await fetchOwnProfile(current.id)
      if (cancelled) return
      setIsAdmin(profile?.access_level === 'admin')
      if (profile?.avatar_path) {
        const url = await getAvatarUrl(profile.avatar_path)
        if (!cancelled) setAvatarUrl(url)
      }
    }
    loadUser()

    return () => {
      cancelled = true
    }
  }, [authState])

  // Loaded as soon as the map can mount (authState !== 'checking', i.e.
  // during needsLogin too) rather than waiting for 'revealed' — it's static
  // public JSON, no auth required, so fetching it early just warms the
  // cache before the dashboard needs it (an accepted tradeoff, not a bug).
  useEffect(() => {
    if (authState === 'checking') return
    let cancelled = false
    loadBarangays()
      .then((data) => {
        if (!cancelled) setBarangays(data)
      })
      .catch((err) => {
        if (!cancelled) setMapLoadError(err instanceof Error ? err.message : 'Failed to load data.')
      })
    return () => {
      cancelled = true
    }
  }, [authState])

  // Measures where the map should sit: mapSlotRef's on-screen position when
  // revealed (DashboardShell's empty spacer for it), or a full-bleed
  // viewport rect otherwise — the same numbers get applied as inline
  // top/left/width/height on the map's wrapping div below, CSS-transitioned,
  // which is what actually produces the shared-element animation between
  // the login backdrop and the boxed dashboard position. Re-measured on
  // reveal, on resize, and once barangays data arrives (it can change the
  // LIVE UPDATE banner's height above the map slot).
  useLayoutEffect(() => {
    function measure() {
      if (revealed && mapSlotRef.current) {
        const r = mapSlotRef.current.getBoundingClientRect()
        setMapRect({ top: r.top, left: r.left, width: r.width, height: r.height })
      } else {
        setMapRect({ top: 0, left: 0, width: window.innerWidth, height: window.innerHeight })
      }
    }
    measure()
    window.addEventListener('resize', measure)
    const raf1 = requestAnimationFrame(measure)
    return () => {
      window.removeEventListener('resize', measure)
      cancelAnimationFrame(raf1)
    }
  }, [revealed, barangays])

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
    setUser(null)
    setIsAdmin(false)
    setAuthState('needsLogin')
  }, [])

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
          --sea-top: #0B5C78; --sea-bottom: #2FA6B8;
          --sun-glow: rgba(253, 200, 90, 0.55); --sun-core: #FFD873;
          --cloud: rgba(255, 255, 255, 0.9);
          --card-bg: rgba(255, 255, 255, 0.72); --card-border: rgba(255, 255, 255, 0.5);
          --text-strong: #0B3654; --text-soft: #3E6664; --field-line: #C9DEDA;
        }
        .bfw-root[data-theme='dark'] {
          --sky-top: #0B1830; --sky-bottom: #1B2C46;
          --sea-top: #051E28; --sea-bottom: #0D3D48;
          --sun-glow: rgba(230, 235, 255, 0.18); --sun-core: #EDEFF7;
          --cloud: rgba(210, 220, 235, 0.35);
          --card-bg: rgba(11, 24, 40, 0.6); --card-border: rgba(255, 255, 255, 0.12);
          --text-strong: #F2F6F5; --text-soft: #A9C0C6; --field-line: rgba(255, 255, 255, 0.2);
        }
        /* Revealed state darkens the sky toward a rainy mood — still theme-aware, so night mode stays dark and day mode stays an overcast daytime gray rather than collapsing to one fixed look. */
        .bfw-root[data-theme='light'][data-revealed='true'] .bfw-sky { background: linear-gradient(to bottom, #5C7A8C, #8FA6AE) !important; }
        .bfw-root[data-theme='dark'][data-revealed='true'] .bfw-sky { background: linear-gradient(to bottom, #3B5368, #223244) !important; }
        .bfw-root[data-revealed='true'] .bfw-sun { opacity: 0; }
        .bfw-root[data-revealed='true'] .bfw-rain { opacity: 1; }

        .bfw-sky { position: absolute; inset: 0; background: linear-gradient(to bottom, var(--sky-top), var(--sky-bottom)); transition: background 1.2s ease; }
        .bfw-sun { transition: opacity 1s ease; }
        .bfw-rain { position: absolute; inset: 0; opacity: 0; transition: opacity 1.2s ease; pointer-events: none; }

        .bfw-card { transition: transform 0.6s ease, opacity 0.5s ease; }
        .bfw-root[data-revealed='true'] .bfw-card { transform: translateY(40px) scale(0.92); opacity: 0; pointer-events: none; }

        .bfw-dash { opacity: 0; transition: opacity 0.8s ease 0.4s; pointer-events: none; }
        .bfw-root[data-revealed='true'] .bfw-dash { opacity: 1; pointer-events: auto; }

        .bfw-loading-cover { position: absolute; inset: 0; background: var(--sky-bottom, #DCEFF5); z-index: 50; transition: opacity 0.3s ease; }

        /*
          The one persistent map's wrapping box — fixed + viewport-relative,
          its top/left/width/height set inline from a measured rect (see
          mapRect in HomePage: mapSlotRef's position when revealed, a
          full-bleed viewport rect otherwise). This is what produces the
          shared-element transition between the login backdrop and the
          boxed dashboard position; reuses the same easing as the map's own
          internal zoom transition (BiliranMap.tsx) for consistency.
          BiliranMap already rounds/borders its own inner container
          (rounded-xl border shadow-xl) unconditionally — left as-is in
          both states rather than conditionally stripped for full-bleed,
          to avoid coupling this shell's styling to BiliranMap's internals.
        */
        .bfw-map-shell {
          position: fixed;
          z-index: 0;
          overflow: hidden;
          transition: top 0.9s cubic-bezier(0.22,1,0.36,1), left 0.9s cubic-bezier(0.22,1,0.36,1),
            width 0.9s cubic-bezier(0.22,1,0.36,1), height 0.9s cubic-bezier(0.22,1,0.36,1);
        }

        @media (prefers-reduced-motion: reduce) { .bfw-map-shell { transition: none !important; } }
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

      {/*
        The one real, persistent map — mounted as soon as authState isn't
        'checking' (i.e. during needsLogin too), full-bleed behind the login
        card at first. On sign-in this same instance's wrapping box animates
        into its boxed dashboard spot (see .bfw-map-shell above) while the
        login card fades/slides out and the dashboard chrome fades in around
        it — one map throughout, not a decorative login backdrop swapped for
        a real map after reveal.
      */}
      {authState !== 'checking' && mapRect && (
        <div
          className="bfw-map-shell"
          style={{ top: mapRect.top, left: mapRect.left, width: mapRect.width, height: mapRect.height }}
        >
          {barangays && (
            <BiliranMap barangays={barangays} selectedKey={selectedKey} onSelect={(b) => setSelectedKey(b.key)} />
          )}
        </div>
      )}

      {/* Theme toggle */}
      <button
        type="button"
        onClick={() => setTheme((t) => (t === 'light' ? 'dark' : 'light'))}
        aria-label="Toggle day and night"
        // Pushed further down while the map is the full-bleed login
        // backdrop, so it clears BiliranMap's own top-right weather ribbon
        // (which sits flush in the actual corner it's mounted in — the
        // viewport itself, pre-reveal); back to its normal corner spot once
        // the map is boxed into the dashboard and no longer under it.
        className={`absolute right-5 z-20 rounded-full border px-3 py-1.5 text-xs font-medium backdrop-blur-md transition-colors ${revealed ? 'top-5' : 'top-14'}`}
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

          {activated && (
            <p className="mt-4 rounded-md bg-[#E7F3E9] px-3 py-2 text-center text-sm text-[#2C5F3E]">
              Account activated — sign in below.
            </p>
          )}

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

      {/*
        Dashboard shell — always mounted (not just when revealed), same as
        this wrapping .bfw-dash div already was: opacity/pointer-events
        hide it pre-reveal (see .bfw-dash CSS above), rather than a
        conditional mount, so its map-slot spacer has a real, measurable
        layout position for the map-shell transition above even before
        sign-in.
      */}
      <div className="bfw-dash absolute inset-0 z-10 flex flex-col p-6" data-revealed={revealed}>
        <div className="mb-4">
          <h1 className="text-lg font-semibold text-[#F2F6F5]">Biliran — flood risk dashboard</h1>
          <p className="text-sm text-[#CFE0DD]">MDRRMO / barangay flood early-warning conditions</p>
        </div>
        <div className="min-h-0 flex-1">
          <DashboardShell
            barangays={barangays}
            loadError={mapLoadError}
            selectedKey={selectedKey}
            onSelectKey={setSelectedKey}
            mapSlotRef={mapSlotRef}
          />
        </div>
      </div>

      {/* Bottom-right menu: Profile / Dashboard / Sign out — only relevant once logged in */}
      {revealed && (
        <div className="absolute bottom-5 right-5 z-20 flex flex-col items-end gap-2">
          {menuOpen && (
            <div className="mb-1 flex flex-col overflow-hidden rounded-2xl border shadow-lg backdrop-blur-xl" style={{ background: 'var(--card-bg)', borderColor: 'var(--card-border)' }}>
              <MenuItem label="Profile" onClick={() => { setShowProfile(true); setMenuOpen(false) }} />
              <MenuItem label="Dashboard" onClick={() => setMenuOpen(false)} />
              {isAdmin && (
                <MenuItem label="Invitations" onClick={() => { setShowInvitations(true); setMenuOpen(false) }} />
              )}
              <MenuItem label="Sign out" onClick={handleSignOut} />
            </div>
          )}
          <button
            onClick={() => setMenuOpen((v) => !v)}
            aria-label="Open menu"
            aria-expanded={menuOpen}
            className="relative flex h-12 w-12 items-center justify-center overflow-hidden rounded-full border shadow-lg backdrop-blur-xl transition-transform"
            style={{ background: 'var(--card-bg)', borderColor: 'var(--card-border)', color: 'var(--text-strong)', transform: menuOpen ? 'rotate(45deg)' : 'none' }}
          >
            {avatarUrl ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img src={avatarUrl} alt="" className="h-full w-full object-cover" style={{ transform: menuOpen ? 'rotate(-45deg)' : 'none' }} />
            ) : (
              <span className="text-2xl leading-none">+</span>
            )}
          </button>
        </div>
      )}

      {/* Loading cover, hides the pre-resolved state flash */}
      <div
        className="bfw-loading-cover"
        style={{ opacity: authState === 'checking' ? 1 : 0, pointerEvents: authState === 'checking' ? 'auto' : 'none' }}
      />

      {showProfile && user && (
        <ProfilePanel user={user} onClose={() => setShowProfile(false)} onAvatarChange={setAvatarUrl} />
      )}
      {showInvitations && isAdmin && <AdminInvitePanel onClose={() => setShowInvitations(false)} />}
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