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
import { fetchOwnProfile, formatDisplayName, getAvatarUrl } from '@/lib/profile'
import { loadBarangays, type Barangay } from '@/lib/dashboardData'
import DashboardShell from '@/components/DashboardShell'
import BiliranMap from '@/components/BiliranMap'
import ProfilePanel from '@/components/ProfilePanel'
import AdminInvitePanel from '@/components/AdminInvitePanel'
import HeaderProfileButton from '@/components/HeaderProfileButton'

const LAST_LOGIN_KEY = 'bfw_last_login_date'

// Must stay comfortably longer than BarangayList's own DOUBLE_TAP_WINDOW_MS
// — see selectBarangay below for why.
const BARANGAY_SELECT_COMPACT_DELAY_MS = 450

type AuthState = 'checking' | 'needsLogin' | 'revealed'
// Copy/branding only, never a security gate — the logo on the login
// screen toggles this, swapping the login card's heading between the
// regular and "administrator" framing. There's only one real auth
// mechanism (supabase.auth.signInWithPassword) regardless of this value;
// actual admin authorization is still the post-login access_level ===
// 'admin' check (isAdmin state) that already exists elsewhere in this
// file. Always resets to 'user' on mount — no persistence.
type LoginMode = 'user' | 'admin'

function prefersDark() {
  return typeof window !== 'undefined' && window.matchMedia('(prefers-color-scheme: dark)').matches
}

export default function HomePage() {
  const [authState, setAuthState] = useState<AuthState>('checking')
  const revealed = authState === 'revealed'
  const [loginMode, setLoginMode] = useState<LoginMode>('user')
  const [theme, setTheme] = useState<'light' | 'dark'>(() => (prefersDark() ? 'dark' : 'light'))

  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [activated, setActivated] = useState(false)

  // Login card's "Forgot password?" flow — swaps the card's form, doesn't
  // navigate away. Shares `email` with the sign-in form above (whatever
  // the user already typed there carries over) rather than a separate
  // field. See handleForgotPassword below for what "send" actually does.
  const [authMode, setAuthMode] = useState<'signin' | 'forgotPassword'>('signin')
  const [resetSent, setResetSent] = useState(false)
  const [resetLoading, setResetLoading] = useState(false)
  const [resetError, setResetError] = useState<string | null>(null)

  const [user, setUser] = useState<User | null>(null)
  const [isAdmin, setIsAdmin] = useState(false)
  const [avatarUrl, setAvatarUrl] = useState<string | null>(null)
  // Shown in the header profile button's revealed tab — see
  // HeaderProfileButton.tsx and lib/profile.ts's formatDisplayName.
  const [displayName, setDisplayName] = useState<string | null>(null)
  const [office, setOffice] = useState<string | null>(null)
  const [showProfile, setShowProfile] = useState(false)
  const [showAdminPanel, setShowAdminPanel] = useState(false)

  // Lifted up from DashboardShell so the one persistent <BiliranMap> below
  // (mounted here, not inside DashboardShell — see "one map, not two" in
  // CLAUDE.md) and DashboardShell's list/detail panel share a single fetch
  // and a single selection, instead of each owning their own copy.
  const [barangays, setBarangays] = useState<Barangay[] | null>(null)
  const [mapLoadError, setMapLoadError] = useState<string | null>(null)
  const [selectedKey, setSelectedKey] = useState<string | null>(null)
  // Two-way synced with the map: tapping a municipality on the map sets
  // this (via BiliranMap's onFocusMunicipality), and it also drives
  // DashboardShell's municipality filter dropdown — picking one there
  // moves the map to it, same shape as selectedKey's barangay sync above.
  const [focusedMunicipality, setFocusedMunicipality] = useState<string | null>(null)
  // Bumped on sign-out (handleSignOut below) so BiliranMap's view resets
  // to the default whole-island framing even if the user got there by
  // raw wheel/drag rather than picking a municipality — see resetToken's
  // own doc comment in BiliranMap.tsx for why clearing selectedKey/
  // focusedMunicipality alone isn't enough to guarantee that.
  const [mapResetToken, setMapResetToken] = useState(0)

  const mapSlotRef = useRef<HTMLDivElement>(null)
  const [mapRect, setMapRect] = useState<{ top: number; left: number; width: number; height: number } | null>(null)

  // Compact map on barangay-list scroll (DashboardShell.tsx owns the
  // scroll listener/debounce and flips this true once the list scrolls
  // past the row threshold). One-way: scroll position alone never flips
  // it back — only an explicit tap on the compacted map does, via
  // onCompactTap below, which sets it directly. listScrollRef is used
  // both there, as the list's own scroll container, and here, purely as a
  // courtesy to scroll it back to top when the map re-expands (no longer
  // the mechanism that drives listScrolled, now that it's one-way).
  const [listScrolled, setListScrolled] = useState(false)
  const listScrollRef = useRef<HTMLDivElement>(null)

  // Selecting a barangay — from the map, the list, or the LIVE UPDATE
  // banner (all three funnel through here) — also compacts the map, same
  // as scrolling the list past the row threshold does: reclaims the space
  // for the list/FSI/hydrograph corners instead of leaving the barangay's
  // detail panel pushed below the fold. Reuses listScrolled's existing
  // one-way semantics (only an explicit tap on the compacted map expands
  // it back out) rather than a separate flag.
  //
  // The compacting itself (setListScrolled) is deliberately delayed a
  // beat rather than firing in the same tick as the selection: compacting
  // moves the barangay list from below the map to beside it, a layout
  // reflow big enough that — confirmed via Playwright — a fast double-tap
  // on a list row would have its second physical tap land on a
  // completely different row once the first tap's selection compacted the
  // map out from under it, misfiring BarangayList's double-tap-to-filter
  // against the wrong municipality. Delaying past BarangayList's own
  // DOUBLE_TAP_WINDOW_MS keeps the row stationary for the whole window a
  // double-tap needs, while still feeling instant for an ordinary single
  // tap. selectedKey itself updates immediately either way — only the
  // layout-shifting part is delayed.
  const compactDelayRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const selectBarangay = useCallback((key: string) => {
    setSelectedKey(key)
    if (compactDelayRef.current) clearTimeout(compactDelayRef.current)
    compactDelayRef.current = setTimeout(() => {
      setListScrolled(true)
    }, BARANGAY_SELECT_COMPACT_DELAY_MS)
  }, [])

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
      const admin = profile?.access_level === 'admin'
      setIsAdmin(admin)
      setDisplayName(profile ? formatDisplayName(profile) : null)
      setOffice(profile?.office ?? null)
      if (profile?.avatar_path) {
        const url = await getAvatarUrl(profile.avatar_path)
        if (!cancelled) setAvatarUrl(url)
      }
      // The only way into the admin panel now: signing in via the
      // "Welcome, Administrator" login toggle AND actually being an admin
      // (loginMode alone is copy/branding, never a security gate — see
      // its own comment above). A non-admin who picks the admin-styled
      // login form still just lands on the normal dashboard, same as
      // before. This only ever fires right after an interactive sign-in
      // (loginMode is local, unpersisted state, so it can't be 'admin' on
      // a returning-session auto-reveal where the login card is skipped).
      if (loginMode === 'admin' && admin) setShowAdminPanel(true)
    }
    loadUser()

    return () => {
      cancelled = true
    }
    // loginMode only actually changes while authState !== 'revealed' (the
    // toggle button that flips it is only rendered pre-reveal), so this
    // extra dependency can't cause a spurious re-fetch after sign-in —
    // it just lets the effect read the loginMode that was current at the
    // moment of the real 'revealed' transition, instead of a stale one.
  }, [authState, loginMode])

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
  // revealed (DashboardShell's empty spacer for it — sized/positioned by
  // DashboardShell itself based on listScrolled, so this measurement stays
  // a single codepath for both the normal and compact map spots), or a
  // full-bleed viewport rect otherwise — the same numbers get applied as
  // inline top/left/width/height on the map's wrapping div below,
  // CSS-transitioned, which is what actually produces the shared-element
  // animation, both for the login→dashboard reveal and for compacting on
  // scroll. Re-measured on reveal, on resize, once barangays data arrives
  // (it can change the LIVE UPDATE banner's height above the map slot), and
  // whenever listScrolled flips the spacer's own size.
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
  }, [revealed, barangays, listScrolled])

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

  // "Forgot password?" — entirely self-service, no admin/manual step.
  // supabase.auth.resetPasswordForEmail sends the verification email
  // itself (Supabase's own transactional email, not something this repo
  // sends); redirectTo points at app/reset-password/page.tsx, which reads
  // the recovery token the email link carries in its URL fragment.
  // Supabase deliberately doesn't reveal whether the address has an
  // account (avoids leaking which emails are registered), so this always
  // resolves the same way regardless — the confirmation message below is
  // worded to match that.
  const handleForgotPassword = useCallback(
    async (e: FormEvent) => {
      e.preventDefault()
      setResetError(null)
      setResetLoading(true)

      const { error: resetErr } = await supabase.auth.resetPasswordForEmail(email, {
        redirectTo: `${window.location.origin}/reset-password`,
      })
      setResetLoading(false)

      if (resetErr) {
        setResetError('Could not send the reset email — try again.')
        return
      }
      setResetSent(true)
    },
    [email]
  )

  const handleSignOut = useCallback(async () => {
    await supabase.auth.signOut()
    window.localStorage.removeItem(LAST_LOGIN_KEY)
    setUser(null)
    setIsAdmin(false)
    setAvatarUrl(null)
    setDisplayName(null)
    setOffice(null)
    setShowProfile(false)
    setShowAdminPanel(false)
    setLoginMode('user')
    setListScrolled(false)
    setSelectedKey(null)
    setFocusedMunicipality(null)
    setMapResetToken((t) => t + 1)
    setAuthMode('signin')
    setResetSent(false)
    setResetError(null)
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
        /*
          Palette: a single 6-tone teal/slate family (design reference:
          "Ashraf Works" color combo), used everywhere — the sky/sea/sun
          backdrop, card chrome, and buttons — rather than the old separate
          warm-sun/blue-sky scheme. Named by role below so the anchors
          (#031716 darkest -> #6BA3BE lightest) stay traceable:
            --p-darkest:  #031716   --p-dark:     #032F30
            --p-mid-dark: #0A7075   --p-mid:      #0C969C
            --p-light:    #6BA3BE  --p-slate:    #274D60
          A few gradient stops (sky-bottom, sun core/glow) are tints mixed
          toward white/transparent from these anchors, since the source
          palette has no near-white tone of its own to soften into.
        */
        .bfw-root[data-theme='light'] {
          --sky-top: #0C969C; --sky-bottom: #CFE4EC;
          --sea-top: #0C969C; --sea-bottom: #6BA3BE;
          --sun-glow: rgba(107, 163, 190, 0.5); --sun-core: #E7F1F5;
          --cloud: rgba(231, 241, 245, 0.9);
          --card-bg: rgba(231, 241, 245, 0.75); --card-border: rgba(107, 163, 190, 0.5);
          --text-strong: #031716; --text-soft: #274D60; --field-line: #B7D2DE;
          --header-bg: rgba(10, 112, 117, 0.85); --body-bg: rgba(231, 241, 245, 0.35);
          --separator: #0C969C;
          /* Buttons: lighter pairing in day mode (per the reference: day = lighter, night = darker). */
          --btn-from: #6BA3BE; --btn-to: #0C969C; --btn-text: #FBFEFF;
        }
        .bfw-root[data-theme='dark'] {
          --sky-top: #032F30; --sky-bottom: #031716;
          --sea-top: #031716; --sea-bottom: #032F30;
          --sun-glow: rgba(39, 77, 96, 0.45); --sun-core: #6BA3BE;
          --cloud: rgba(39, 77, 96, 0.35);
          --card-bg: rgba(3, 23, 22, 0.65); --card-border: rgba(107, 163, 190, 0.18);
          /* Lightened a notch from the palette's raw #6BA3BE/#508198 — both
             read a little dim against near-black backgrounds (--card-bg/
             --body-bg), so numbers and secondary labels were harder to read
             at a glance than the day theme's equivalent contrast. */
          --text-strong: #85B7CE; --text-soft: #7098AD; --field-line: rgba(107, 163, 190, 0.25);
          --header-bg: rgba(3, 47, 48, 0.9); --body-bg: rgba(3, 23, 22, 0.3);
          --separator: #0C969C;
          /* Buttons: darker pairing in night mode. */
          --btn-from: #274D60; --btn-to: #031716; --btn-text: #FBFEFF;
        }
        /*
          Day and night now live in two non-overlapping brightness bands
          (day: mid-teal -> pale tint; night: near-black -> very-dark teal)
          rather than sharing a middle tone, so the two themes stay clearly
          distinct regardless of gradient angle/stop position — an earlier
          version had night's sea-bottom equal to day's sea-top, which made
          most of the visible gradient read as the same color in both
          themes. Revealed state still darkens further toward a rainy mood.
        */
        .bfw-root[data-theme='light'][data-revealed='true'] .bfw-sky { background: linear-gradient(to bottom, #274D60, #0A7075) !important; }
        .bfw-root[data-theme='dark'][data-revealed='true'] .bfw-sky { background: linear-gradient(to bottom, #032F30, #031716) !important; }
        .bfw-root[data-revealed='true'] .bfw-sun { opacity: 0; }
        .bfw-root[data-revealed='true'] .bfw-rain { opacity: 1; }

        .bfw-sky { position: absolute; inset: 0; background: linear-gradient(to bottom, var(--sky-top), var(--sky-bottom)); transition: background 1.2s ease; }
        .bfw-sun { transition: opacity 1s ease; }
        .bfw-rain { position: absolute; inset: 0; opacity: 0; transition: opacity 1.2s ease; pointer-events: none; }

        .bfw-card { transition: transform 0.6s ease, opacity 0.5s ease; }
        .bfw-root[data-revealed='true'] .bfw-card { transform: translateY(40px) scale(0.92); opacity: 0; pointer-events: none; }

        .bfw-dash { opacity: 0; transition: opacity 0.8s ease 0.4s; pointer-events: none; }
        .bfw-root[data-revealed='true'] .bfw-dash { opacity: 1; pointer-events: auto; }

        .bfw-loading-cover { position: absolute; inset: 0; background: var(--sky-bottom, #CFE4EC); z-index: 50; transition: opacity 0.3s ease; }

        /*
          Shared "oval, not flat" button treatment (design reference: the
          embossed pill swatches) — a diagonal light-to-dark gradient plus
          an inset top highlight and a soft drop shadow for depth, instead
          of the old flat var(--card-bg) fill. --btn-from/--btn-to swap
          per theme (day lighter, night darker; see above), so the same
          class reads correctly in both without a separate dark variant.
        */
        .bfw-btn {
          background: linear-gradient(145deg, var(--btn-from), var(--btn-to));
          color: var(--btn-text);
          box-shadow: 0 3px 8px rgba(3, 23, 22, 0.35), inset 0 1px 0 rgba(255, 255, 255, 0.3), inset 0 -1px 2px rgba(3, 23, 22, 0.25);
          border: none;
          transition: filter 0.15s ease, box-shadow 0.15s ease, transform 0.15s ease;
        }
        .bfw-btn:hover:not(:disabled) { filter: brightness(1.08); }
        .bfw-btn:active:not(:disabled) { transform: translateY(1px); box-shadow: 0 1px 4px rgba(3, 23, 22, 0.35), inset 0 1px 0 rgba(255, 255, 255, 0.2); }
        .bfw-btn:disabled { opacity: 0.5; cursor: not-allowed; }

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

          z-index: below .bfw-card (10) pre-reveal, so the login card floats
          on top of the full-bleed map as intended — but ABOVE .bfw-dash
          (also 10) once revealed, otherwise .bfw-dash's own DOM content
          (specifically DashboardShell's empty map-slot spacer, which this
          shell's box exactly overlaps once boxed) sits stacked above the
          map and silently swallows every click/drag/wheel gesture meant
          for it, even though the map is still visually on top (transparent
          spacer, so you can see through it — but hit-testing follows stack
          order, not visibility). Found via this feature's own testing:
          tap-to-zoom-a-municipality never reached the map once boxed into
          the dashboard until this was raised. Nothing else in .bfw-dash
          overlaps the map's rectangle (plain flex flow, no other absolutely
          positioned siblings there), so raising it doesn't hide anything.
        */
        .bfw-map-shell {
          position: fixed;
          z-index: 0;
          overflow: hidden;
          transition: top 0.9s cubic-bezier(0.22,1,0.36,1), left 0.9s cubic-bezier(0.22,1,0.36,1),
            width 0.9s cubic-bezier(0.22,1,0.36,1), height 0.9s cubic-bezier(0.22,1,0.36,1);
        }
        .bfw-root[data-revealed='true'] .bfw-map-shell { z-index: 15; }

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
            <BiliranMap
              barangays={barangays}
              selectedKey={selectedKey}
              onSelect={(b) => selectBarangay(b.key)}
              showChrome={revealed}
              focusedMunicipality={focusedMunicipality}
              onFocusMunicipality={setFocusedMunicipality}
              compact={revealed && listScrolled}
              onCompactTap={() => {
                setListScrolled(false)
                listScrollRef.current?.scrollTo({ top: 0, behavior: 'smooth' })
              }}
              resetToken={mapResetToken}
            />
          )}
        </div>
      )}

      {/*
        Header row: theme toggle + profile button, as flex siblings in one
        shared right-anchored row rather than two independently absolutely-
        positioned elements — the toggle "drifts left" for free as the
        profile button's own width grows on reveal (see
        HeaderProfileButton.tsx), via ordinary flexbox reflow, no manual
        position math needed. Replaces the old hidden bottom-right "+" FAB
        (Profile / Dashboard / Invitations / Sign out) entirely — reachable
        here at all times, not just once revealed.
      */}
      <div className="absolute right-5 top-5 z-20 flex items-center gap-2">
        <button
          type="button"
          onClick={() => setTheme((t) => (t === 'light' ? 'dark' : 'light'))}
          aria-label="Toggle day and night"
          className="bfw-btn shrink-0 rounded-full px-3 py-1.5 text-xs font-medium"
        >
          {theme === 'light' ? '☀ Day' : '☾ Night'}
        </button>
        <HeaderProfileButton
          revealed={revealed}
          avatarUrl={avatarUrl}
          displayName={displayName}
          office={office}
          onClick={() => setShowProfile(true)}
        />
      </div>

      {/* Login card */}
      <div className="bfw-card relative z-10 flex min-h-screen items-center justify-center px-6 py-16" data-revealed={revealed}>
        <div className="w-full max-w-sm rounded-2xl border p-8 shadow-2xl backdrop-blur-xl" style={{ background: 'var(--card-bg)', borderColor: 'var(--card-border)' }}>
          <div className="flex justify-center">
            {/*
              Admin sign-in toggle, login screen only — not a security
              gate, just swaps this card's copy (see LoginMode above).
              Not a button while authState !== 'needsLogin': disappears
              once signed in (revealed) rather than lingering as a dead
              control, and there's nothing to toggle while still
              'checking' either.
            */}
            {authState === 'needsLogin' ? (
              <button
                type="button"
                onClick={() => setLoginMode((m) => (m === 'user' ? 'admin' : 'user'))}
                aria-label={loginMode === 'user' ? 'Switch to administrator sign-in' : 'Switch to regular sign-in'}
                className="rounded-md"
              >
                <img
                  src={theme === 'light' ? '/logo-light.png' : '/logo-dark.png'}
                  alt="Biliran Flood Watch"
                  className="h-16 w-auto select-none"
                  draggable={false}
                />
              </button>
            ) : (
              <img
                src={theme === 'light' ? '/logo-light.png' : '/logo-dark.png'}
                alt="Biliran Flood Watch"
                className="h-16 w-auto select-none"
                draggable={false}
              />
            )}
          </div>

          <h2 className="mt-2 text-center text-xl font-semibold" style={{ color: 'var(--text-strong)' }}>
            {authMode === 'forgotPassword'
              ? 'Reset your password'
              : loginMode === 'admin'
                ? 'Welcome, Administrator'
                : 'Sign in'}
          </h2>
          <p className="text-center mt-1 text-sm" style={{ color: 'var(--text-soft)' }}>Biliran Flood Watch</p>

          {activated && authMode === 'signin' && (
            <p className="mt-4 rounded-md bg-[#E7F3E9] px-3 py-2 text-center text-sm text-[#2C5F3E]">
              Account activated — sign in below.
            </p>
          )}

          {authMode === 'signin' ? (
            <form onSubmit={handleSubmit} className="mt-6 space-y-5">
              <Field label="Email" type="email" value={email} onChange={setEmail} valid={email.length > 0 && emailValid} />
              <Field label="Password" type="password" value={password} onChange={setPassword} valid={password.length > 0 && passwordValid} />

              {error && <p role="alert" className="rounded-md bg-[#FBEEE0]/90 px-3 py-2 text-sm text-[#8A4B12]">{error}</p>}

              <button
                type="submit"
                disabled={loading || !emailValid || !passwordValid}
                className="bfw-btn w-full rounded-md py-2.5 text-sm font-semibold"
              >
                {loading ? 'Signing in…' : 'Sign in'}
              </button>

              <button
                type="button"
                onClick={() => {
                  setAuthMode('forgotPassword')
                  setResetError(null)
                  setResetSent(false)
                }}
                className="block w-full text-center text-xs underline decoration-dotted underline-offset-2"
                style={{ color: 'var(--text-soft)' }}
              >
                Forgot password?
              </button>
            </form>
          ) : resetSent ? (
            <div className="mt-6 space-y-5">
              <p
                className="rounded-md px-3 py-2.5 text-center text-sm"
                style={{ background: 'rgba(10, 112, 117, 0.15)', color: 'var(--text-strong)' }}
              >
                If an account exists for <span className="font-medium">{email}</span>, a password reset
                link is on its way — check your inbox and follow it to set a new password.
              </p>
              <button
                type="button"
                onClick={() => setAuthMode('signin')}
                className="bfw-btn w-full rounded-md py-2.5 text-sm font-semibold"
              >
                Back to sign in
              </button>
            </div>
          ) : (
            <form onSubmit={handleForgotPassword} className="mt-6 space-y-5">
              <p className="text-sm" style={{ color: 'var(--text-soft)' }}>
                Enter your account email — we&apos;ll send you a link to reset your password.
              </p>
              <Field label="Email" type="email" value={email} onChange={setEmail} valid={email.length > 0 && emailValid} />

              {resetError && (
                <p role="alert" className="rounded-md bg-[#FBEEE0]/90 px-3 py-2 text-sm text-[#8A4B12]">
                  {resetError}
                </p>
              )}

              <button
                type="submit"
                disabled={resetLoading || !emailValid}
                className="bfw-btn w-full rounded-md py-2.5 text-sm font-semibold"
              >
                {resetLoading ? 'Sending…' : 'Send reset link'}
              </button>

              <button
                type="button"
                onClick={() => setAuthMode('signin')}
                className="block w-full text-center text-xs underline decoration-dotted underline-offset-2"
                style={{ color: 'var(--text-soft)' }}
              >
                Back to sign in
              </button>
            </form>
          )}
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
      <div className="bfw-dash absolute inset-0 z-10 flex flex-col" data-revealed={revealed}>
        {/*
          Header and body are two distinct color panels now, not one
          uniformly-padded column — a solid header-bg band (border-bottom
          in --separator marks the split) sitting above a separate
          body-bg wash the dashboard content scrolls within. Both
          per-theme (see the --header-bg/--body-bg/--separator variables
          above); the header's own text stays a fixed light tint rather
          than var(--text-strong), since --header-bg is deliberately dark
          in both themes (a branded band, not a theme-following surface).
        */}
        <div className="shrink-0 border-b-2 px-6 py-4" style={{ background: 'var(--header-bg)', borderColor: 'var(--separator)' }}>
          <h1 className="text-lg font-semibold" style={{ color: '#E7F1F5' }}>Biliran — flood risk dashboard</h1>
          <p className="text-sm" style={{ color: '#B7D2DE' }}>MDRRMO / barangay flood early-warning conditions</p>
        </div>
        <div className="min-h-0 flex-1 p-6" style={{ background: 'var(--body-bg)' }}>
          <DashboardShell
            barangays={barangays}
            loadError={mapLoadError}
            selectedKey={selectedKey}
            onSelectKey={selectBarangay}
            municipality={focusedMunicipality}
            onMunicipalityChange={setFocusedMunicipality}
            mapSlotRef={mapSlotRef}
            listScrollRef={listScrollRef}
            listScrolled={listScrolled}
            onListScrolledChange={setListScrolled}
            theme={theme}
          />
        </div>
      </div>

      {/* Loading cover, hides the pre-resolved state flash */}
      <div
        className="bfw-loading-cover"
        style={{ opacity: authState === 'checking' ? 1 : 0, pointerEvents: authState === 'checking' ? 'auto' : 'none' }}
      />

      {showProfile && user && (
        <ProfilePanel
          user={user}
          onClose={() => setShowProfile(false)}
          onAvatarChange={setAvatarUrl}
          onProfileFieldsChange={(fields) => {
            setDisplayName(formatDisplayName(fields))
            setOffice(fields.office)
          }}
          onSignOut={handleSignOut}
        />
      )}
      {showAdminPanel && isAdmin && <AdminInvitePanel onClose={() => setShowAdminPanel(false)} theme={theme} />}
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