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

import { useEffect, useMemo, useState, useCallback, type FormEvent } from 'react'
import dynamic from 'next/dynamic'
import Image from 'next/image'
import type { User } from '@supabase/supabase-js'
import { supabase } from '@/lib/supabase'
import { fetchOwnProfile, formatDisplayName, getAvatarUrl } from '@/lib/profile'
import { loadBarangays, type Barangay } from '@/lib/dashboardData'
import { loadBasinHydrographs, type RawHydrographData } from '@/lib/hydrographData'
import { loadFsiFactors, type RawFactorData } from '@/lib/fsiFactorData'
import { loadWeather, type WeatherData } from '@/lib/liveWeather'
import { MONITORED_MUNICIPALITIES } from '@/lib/municipalities'
import { computeLiveIslandState } from '@/lib/liveIslandState'
import DashboardShell from '@/components/DashboardShell'
import BiliranMap from '@/components/BiliranMap'
import ProfilePanel from '@/components/ProfilePanel'
import SelectedBarangayCorner from '@/components/SelectedBarangayCorner'
// Dynamically imported (not a static top-level import): AdminShell is a
// large multi-tab surface only ever rendered for admin accounts, so this
// keeps its code out of the bundle every non-admin visitor downloads.
const AdminShell = dynamic(() => import('@/components/AdminShell'))
import HeaderProfileButton from '@/components/HeaderProfileButton'

const LAST_LOGIN_KEY = 'bfw_last_login_date'

type AuthState = 'checking' | 'needsLogin' | 'revealed'
// Copy/branding for most of this file — the logo on the login screen
// toggles this, swapping the login card's heading between the regular and
// "administrator" framing. There's still only one real auth mechanism
// (supabase.auth.signInWithPassword); actual admin authorization is
// always the post-login access_level === 'admin' check (isAdmin state)
// elsewhere in this file, not this value.
//
// It IS a real gate in exactly one direction, though (handleSubmit
// below): an actual admin account submitting credentials while this is
// still 'user' gets signed back out immediately rather than let through —
// admins must switch to "Welcome, Administrator" to sign in at all. A
// non-admin account is never affected by this value either way. Always
// resets to 'user' on mount — no persistence.
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
  // The three inputs lib/liveIslandState.ts needs to drive the real
  // dashboard's FSI/countdown numbers from today's live Open-Meteo
  // forecast instead of the static synthetic design storm — see that
  // file's own header comment for the full reasoning. All three load
  // independently of barangays/mapLoadError above (different files,
  // different fetches); the live recompute below simply waits for
  // whichever of these hasn't arrived yet.
  const [hydrographData, setHydrographData] = useState<RawHydrographData | null>(null)
  const [factorData, setFactorData] = useState<RawFactorData | null>(null)
  const [weatherByMunicipality, setWeatherByMunicipality] = useState<Record<string, WeatherData | null>>({})
  // Display-only — BiliranMap's own corner countdown reads this to show
  // "Next forecast update in Xm." The actual refresh is still driven
  // entirely by the effect below; this is just stamped alongside it.
  const [nextForecastUpdateAt, setNextForecastUpdateAt] = useState<number | null>(null)
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

  // Barangay list + FSI detail panel live inside a toggleable sidebar
  // (see the sidebar markup below) rather than inline beside/below the
  // map — opened/closed only via its own toggle button in the header
  // controls row, never automatically by a selection (confirmed directly:
  // tapping a barangay on the map should select/focus it without forcing
  // the sidebar open).
  const [sidebarOpen, setSidebarOpen] = useState(false)

  // The waterway/river line overlay on the map (~448 SVG <path>s, real
  // rendering cost) — off by default, since the point of this toggle is
  // specifically to give lower-end devices a lighter default, not to
  // preserve today's always-on look. No persistence: resets to off on
  // every load, matching that confirmed default exactly.
  const [showWaterways, setShowWaterways] = useState(false)

  // Selecting a barangay — from the map, the list, or the LIVE UPDATE
  // banner (all three funnel through here) — just updates selectedKey;
  // BiliranMap's own selectedKey-sync effect handles focusing/zooming to
  // it. (An earlier version also delayed-compacted the map's layout slot
  // to reclaim space for the list/detail panel below it — no longer
  // needed now that those live in the sidebar instead.)
  const selectBarangay = useCallback((key: string) => {
    setSelectedKey(key)
  }, [])

  // Stabilized wrapper for BiliranMap's onSelect prop — BiliranMap's own
  // internal layer components are React.memo-wrapped, which an inline
  // arrow function recreated on every page render would silently defeat.
  const handleMapSelect = useCallback((b: Barangay) => selectBarangay(b.key), [selectBarangay])

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
      // Every admin lands on the admin panel now, for any reveal —
      // a fresh interactive sign-in AND a returning session's
      // auto-reveal alike. Deliberately keyed on `admin` alone, not
      // `loginMode`: loginMode is local, unpersisted, copy/branding-only
      // state (see its own comment above) that resets to 'user' on every
      // mount, so it's never true on an auto-revealed returning session
      // where the login card (and its toggle) never rendered at all —
      // gating on it here used to mean a returning admin silently landed
      // on the normal dashboard instead. `isAdmin` is the real signal.
      if (admin) setShowAdminPanel(true)
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

  // basin_hydrographs.json (~800KB) + fsi_factors.json — unlike barangays
  // above, these are gated on 'revealed' (actually authenticated), not just
  // "not checking": they used to fire on the bare login screen too, but
  // that cost every visitor ~800KB before they'd even typed a password.
  // Deferring to 'revealed' costs no visible delay in the live-colored map
  // appearing, because the live-forecast recompute below is itself gated on
  // live weather data, which already takes a real async fetch to arrive —
  // so this data is never the bottleneck either way. Both loaders cache
  // themselves (loadBasinHydrographs/loadFsiFactors), so this doesn't
  // duplicate BarangayDetailPanel's own fetch — it's the same in-flight
  // promise/cache.
  useEffect(() => {
    if (authState !== 'revealed') return
    let cancelled = false
    loadBasinHydrographs()
      .then((data) => {
        if (!cancelled) setHydrographData(data)
      })
      .catch(() => {
        // Live recompute below just stays unavailable — the static
        // fields/charts already have their own honest fallback.
      })
    loadFsiFactors()
      .then((data) => {
        if (!cancelled) setFactorData(data)
      })
      .catch(() => {})
    return () => {
      cancelled = true
    }
  }, [authState])

  // Live weather for all 7 monitored municipalities — same source
  // (lib/liveWeather.ts) and refresh cadence (30 min) BiliranMap.tsx
  // already uses for its own icon, but this is a SEPARATE fetch/state:
  // that one derives a decorative WeatherCondition (icon/cloud config),
  // this one keeps the raw WeatherData (hourly precipitation) the live
  // FSI/countdown recompute actually needs. loadWeather()'s own client
  // cache means calling it from both places doesn't double the real
  // network traffic. 30 min (not 15) is a deliberate lower-background-cost
  // tradeoff — Open-Meteo's own forecast granularity is hourly, so this
  // doesn't meaningfully change data freshness in practice.
  useEffect(() => {
    if (authState === 'checking') return
    let cancelled = false

    function refresh() {
      // Stamped on every call (including the immediate one below), not
      // just once at effect-mount — this is what BiliranMap's corner
      // countdown (nextForecastUpdateAt) actually counts down to, so it
      // needs to reset each time a real refresh fires, same as the
      // fetches themselves.
      setNextForecastUpdateAt(Date.now() + 30 * 60 * 1000)
      for (const name of MONITORED_MUNICIPALITIES) {
        loadWeather(name).then((data) => {
          if (cancelled) return
          setWeatherByMunicipality((prev) => ({ ...prev, [name]: data }))
        })
      }
    }

    refresh()
    const interval = setInterval(refresh, 30 * 60 * 1000)
    return () => {
      cancelled = true
      clearInterval(interval)
    }
  }, [authState])

  const municipalityByBarangayKey = useMemo(() => {
    const m = new Map<string, string>()
    if (barangays) for (const b of barangays) m.set(b.key, b.municipality)
    return m
  }, [barangays])

  // Waits for at least one municipality's weather to have actually loaded
  // before computing anything — otherwise every barangay would silently
  // show a live FSI computed from zero rainfall (ratio=0), misrepresenting
  // "hasn't loaded yet" as "confirmed no rain," which is exactly the kind
  // of invented-looking number this app's whole design avoids elsewhere.
  const liveIslandState = useMemo(() => {
    if (!hydrographData || !factorData || !barangays) return null
    const hasAnyWeather = Object.values(weatherByMunicipality).some((w) => w != null)
    if (!hasAnyWeather) return null
    return computeLiveIslandState(hydrographData, factorData, weatherByMunicipality, municipalityByBarangayKey)
  }, [hydrographData, factorData, weatherByMunicipality, municipalityByBarangayKey, barangays])

  // Overlays each barangay's real static FSI/countdown fields with its
  // live-forecast-computed ones — every downstream consumer (sort, filter,
  // list rows, map polygon color, detail panel) only ever reads whatever
  // Barangay[] it's handed, so this one override is what actually makes
  // the ranking/map/countdowns respond to live weather, with zero changes
  // needed in BarangayList.tsx/BiliranMap.tsx's own coloring logic. Falls
  // back to each barangay's own real static countdown fields for the 2
  // basin-less barangays specifically (no discharge curve to derive a
  // live crossing time from at all) — same honest-absence pattern as
  // their missing hydrograph chart.
  const displayBarangays = useMemo(() => {
    if (!barangays || !liveIslandState) return barangays
    return barangays.map((b) => {
      const live = liveIslandState.get(b.key)
      if (!live) return b
      return {
        ...b,
        mean_fsi_score: live.liveFsi,
        dominant_fsi_label: live.liveLabel,
        warning_time_hours: live.warningTimeHours ?? b.warning_time_hours,
        alert_time_hours: live.alertTimeHours ?? b.alert_time_hours,
        danger_time_hours: live.dangerTimeHours ?? b.danger_time_hours,
      }
    })
  }, [barangays, liveIslandState])

  // The selected barangay's own live discharge curve, forwarded to
  // BarangayDetailPanel (via DashboardShell) — null while live data hasn't
  // loaded yet, or for the 2 basin-less barangays, both of which fall back
  // to the static chart inside that component.
  const liveHydrograph = selectedKey ? liveIslandState?.get(selectedKey)?.hydrograph ?? null : null
  // Same live entry's rainfall factor — forwarded to the detail panel's
  // factor-breakdown bar so it shows the same number liveFsi was actually
  // built from, not the pre-scaling static value.
  const liveRainfallFactor = selectedKey ? liveIslandState?.get(selectedKey)?.liveRainfallFactor ?? null : null

  // The selected barangay object itself — for SelectedBarangayCorner below
  // (the compact quick-glance card shown while the sidebar is closed).
  // DashboardShell does its own equivalent lookup internally for its own
  // rendering needs; this is a separate, cheap O(n) find over the same
  // already-loaded array, not a second fetch.
  const selectedBarangay = useMemo(
    () => (selectedKey ? displayBarangays?.find((b) => b.key === selectedKey) ?? null : null),
    [displayBarangays, selectedKey]
  )

  const handleSubmit = useCallback(
    async (e: FormEvent) => {
      e.preventDefault()
      setError(null)
      setLoading(true)

      const { data: authData, error: authError } = await supabase.auth.signInWithPassword({ email, password })

      if (authError) {
        setLoading(false)
        setError('Email or password is incorrect. Try again.')
        return
      }

      // Admin accounts must sign in via the administrator toggle — this is
      // the one real gate loginMode drives (see its own doc comment above):
      // a real admin authenticating while the card is still in regular
      // 'user' mode gets signed back out immediately rather than let
      // in, so the account's own access_level can never quietly bypass the
      // toggle. Non-admin accounts are unaffected either way — loginMode
      // never gates them, admin or not.
      //
      // Deliberately generic wording ("No user account exists.") rather
      // than naming this an administrator account — the same message a
      // wrong email/password gets, so a regular-mode sign-in attempt can't
      // be used to fingerprint which emails are admin accounts.
      const profile = await fetchOwnProfile(authData.user.id)
      if (profile?.access_level === 'admin' && loginMode !== 'admin') {
        await supabase.auth.signOut()
        setLoading(false)
        setError('No user account exists.')
        return
      }

      setLoading(false)
      window.localStorage.setItem(LAST_LOGIN_KEY, new Date().toDateString())
      setAuthState('revealed') // triggers the CSS transition since this happens post-mount
    },
    [email, password, loginMode]
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
    setSidebarOpen(false)
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
          /* Solid-reading (not blurred) background for the full-width
             sidebar body — see the .bfw-sidebar comment below for why
             this is a dedicated variable, not a bump to --body-bg. */
          --sidebar-body-bg: rgba(231, 241, 245, 0.96);
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
          --sidebar-body-bg: rgba(3, 23, 22, 0.96);
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

        .bfw-loading-cover { position: absolute; inset: 0; background: var(--sky-bottom, #CFE4EC); z-index: 50; transition: opacity 0.3s ease; }

        /*
          Toggleable sidebar (barangay list + FSI detail panel, plus the
          dashboard title/banners/filter) — same backdrop + translateX
          drawer pattern as AdminShell.tsx's own mobile nav drawer, reused
          byte-for-byte rather than inventing new transition mechanics.
          Slides in from the RIGHT (an explicit choice this round,
          overriding an earlier left-side choice made specifically to
          avoid covering BiliranMap's own right-side chrome — WeatherBadge/
          ZoomControls/NextForecastBadge all live on the right, only
          Legend is on the left. That overlap is now an accepted
          trade-off, not fixed here — see CLAUDE.md).
        */
        .bfw-sidebar-backdrop {
          background: rgba(0, 0, 0, 0.4);
          opacity: 0;
          pointer-events: none;
          transition: opacity 250ms cubic-bezier(0.22,1,0.36,1);
        }
        .bfw-sidebar-backdrop[data-open='true'] { opacity: 1; pointer-events: auto; }
        .bfw-sidebar {
          background: var(--body-bg);
          transform: translateX(100%);
          pointer-events: none;
          transition: transform 250ms cubic-bezier(0.22,1,0.36,1);
        }
        .bfw-sidebar[data-open='true'] { transform: translateX(0); pointer-events: auto; }

        /*
          Slide-arrow handle — opens/closes the sidebar, replacing the old
          header-row tap button. Deliberately a SEPARATE fixed sibling, NOT
          nested inside .bfw-sidebar: a CSS transform on an ancestor (the
          sidebar's own translateX above) establishes a new containing
          block for any position:fixed descendant (the same gotcha
          ProfilePanel.tsx's lightbox already hit once), so a handle nested
          inside the transformed sidebar would move off-screen WITH it
          while closed instead of staying reachable at the viewport edge.
          Its own "right" offset is animated in sync with the sidebar's
          transform instead (same duration/easing) — right:0 flush against
          the edge when closed, right:calc(100% - 28px) when open (see the
          comment on that rule below for why not a bare 100%). The sidebar
          is full-width at every viewport size now (see .bfw-sidebar
          below), so this one open-state rule covers every size — no
          desktop-only breakpoint override needed anymore.
        */
        .bfw-sidebar-handle {
          position: fixed;
          top: 50%;
          right: 0;
          transform: translateY(-50%);
          z-index: 18;
          border-radius: 12px 0 0 12px;
          transition: right 250ms cubic-bezier(0.22,1,0.36,1);
        }
        /*
          calc(100% - 28px), not a bare 100%: for a fixed element, "right:
          100%" moves its RIGHT edge to the viewport's left edge, pushing
          the whole 28px-wide handle off-screen to the left — not flush
          against it. Subtracting its own width keeps it fully visible,
          flush against the open sidebar's full-width (mobile) left edge,
          with a harmless, intentional overlap rather than disappearing.
        */
        .bfw-sidebar-handle[data-open='true'] { right: calc(100% - 28px); }
        .bfw-sidebar-handle svg { transition: transform 250ms cubic-bezier(0.22,1,0.36,1); }
        .bfw-sidebar-handle[data-open='true'] svg { transform: rotate(180deg); }

        @media (prefers-reduced-motion: reduce) {
          .bfw-sidebar-backdrop, .bfw-sidebar, .bfw-sidebar-handle, .bfw-sidebar-handle svg { transition: none !important; }
        }

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
          The one persistent map's wrapping box — always full-bleed
          (fixed inset: 0) once mounted, both pre-login (the decorative
          backdrop behind the login card) and post-login (no more boxed
          "dashboard slot" to grow into — the barangay list/FSI detail
          panel live in the toggleable sidebar below instead, not beside
          or below the map). No JS-measured rect, no shared-element
          transition between two sizes — there's only ever one size now.

          z-index: below .bfw-card (10) pre-reveal, so the login card
          floats on top of the full-bleed map as intended. Kept at 15 once
          revealed (above the sidebar's own z-index, see .bfw-sidebar
          below) mostly for continuity with the header-controls row (z-20)
          still needing to sit above everything — the original reason for
          raising it above 10 (an invisible map-slot spacer in the old
          .bfw-dash layout silently swallowing pointer events) no longer
          applies now that nothing shares the map's footprint.
        */
        .bfw-map-shell {
          position: fixed;
          inset: 0;
          z-index: 0;
          overflow: hidden;
        }
        .bfw-root[data-revealed='true'] .bfw-map-shell { z-index: 15; }
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
        card pre-reveal and full-bleed behind the sidebar/header controls
        post-reveal — one map throughout, not a decorative login backdrop
        swapped for a real map after reveal.
      */}
      {authState !== 'checking' && (
        <div className="bfw-map-shell">
          {displayBarangays && (
            <BiliranMap
              barangays={displayBarangays}
              selectedKey={selectedKey}
              onSelect={handleMapSelect}
              showChrome={revealed}
              focusedMunicipality={focusedMunicipality}
              onFocusMunicipality={setFocusedMunicipality}
              resetToken={mapResetToken}
              nextForecastUpdateAt={nextForecastUpdateAt}
              pauseAnimations={sidebarOpen}
              showWaterways={showWaterways}
            />
          )}
        </div>
      )}

      {/*
        Header row: waterways toggle (once revealed) + theme toggle +
        profile button, as flex siblings in one shared right-anchored row
        rather than independently absolutely-positioned elements — the
        theme toggle "drifts left" for free as the profile button's own
        width grows on reveal (see HeaderProfileButton.tsx), via ordinary
        flexbox reflow, no manual position math needed. Replaces the old
        hidden bottom-right "+" FAB (Profile / Dashboard / Invitations /
        Sign out) entirely — reachable here at all times, not just once
        revealed. These are "the toggles" that stay visible over the
        full-bleed map at all times — everything else (title, banners,
        barangay list, FSI detail) lives in the toggleable sidebar, opened
        via its own slide-arrow handle (below), not a button in this row.
      */}
      <div className="absolute right-5 top-5 z-20 flex items-center gap-2">
        {revealed && (
          <button
            type="button"
            onClick={() => setShowWaterways((v) => !v)}
            aria-pressed={showWaterways}
            aria-label={showWaterways ? 'Hide river/waterway lines on the map' : 'Show river/waterway lines on the map'}
            title={showWaterways ? 'Waterway lines: on' : 'Waterway lines: off (lighter for low-end devices)'}
            className="bfw-btn shrink-0 rounded-full p-2"
            // Lights up when on, rather than the old opacity-based dimming
            // when off (which read like a disabled control, reported
            // directly) — same #1CA7D6 accent the waterway lines themselves
            // use (BiliranMap.tsx), so the button previews what's on the
            // map. Icon color via currentColor + a glow box-shadow on top
            // of the shared .bfw-btn gradient background; off state is just
            // the default button appearance, same as every other icon-only
            // header button.
            style={
              showWaterways
                ? {
                    color: '#1CA7D6',
                    // Adds a glow on top of (not instead of) .bfw-btn's own
                    // embossed box-shadow, so this still reads as the same
                    // pill button, just lit up — an inline boxShadow here
                    // fully replaces the class's rather than layering with
                    // it, so the base shadow's values are repeated first.
                    boxShadow:
                      '0 3px 8px rgba(3, 23, 22, 0.35), inset 0 1px 0 rgba(255, 255, 255, 0.3), inset 0 -1px 2px rgba(3, 23, 22, 0.25), 0 0 10px 2px rgba(28, 167, 214, 0.65)',
                  }
                : undefined
            }
          >
            <svg viewBox="0 0 20 20" className="h-5 w-5" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
              <path d="M2 14c1.5-1.5 3-1.5 4.5 0s3 1.5 4.5 0 3-1.5 4.5 0 3 1.5 4.5 0" />
              <path d="M2 9c1.5-1.5 3-1.5 4.5 0s3 1.5 4.5 0 3-1.5 4.5 0 3 1.5 4.5 0" opacity="0.5" />
            </svg>
          </button>
        )}
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
                <Image
                  src={theme === 'light' ? '/logo-light.png' : '/logo-dark.png'}
                  alt="Biliran Flood Risk Monitor"
                  width={385}
                  height={420}
                  priority
                  className="h-16 w-auto select-none"
                  draggable={false}
                />
              </button>
            ) : (
              <Image
                src={theme === 'light' ? '/logo-light.png' : '/logo-dark.png'}
                alt="Biliran Flood Risk Monitor"
                width={385}
                height={420}
                priority
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
          <p className="text-center mt-1 text-sm" style={{ color: 'var(--text-soft)' }}>Biliran Flood Risk Monitor</p>

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
        Toggleable sidebar — holds everything that isn't "the toggles":
        the dashboard title/subtitle, the live-forecast/honesty banner,
        the LIVE UPDATE/MODELED ALERT banner, the municipality filter, the
        barangay list, and the FSI detail panel. Slides in from the RIGHT
        edge (see the CSS comment above for the explicit trade-off this
        overrides) via its own slide-arrow handle, not a header-row
        button. Built on AdminShell.tsx's exact mobile-drawer pattern
        (backdrop + translateX, 250ms cubic-bezier(0.22,1,0.36,1),
        reduced-motion override) rather than inventing new transition
        mechanics. Only rendered once revealed — unlike the old
        always-mounted .bfw-dash, nothing downstream needs this mounted
        early anymore (no more map-slot measurement to keep warm).
      */}
      {revealed && (
        <>
          <button
            type="button"
            onClick={() => setSidebarOpen((v) => !v)}
            aria-label={sidebarOpen ? 'Close barangay list and FSI details' : 'Open barangay list and FSI details'}
            data-open={sidebarOpen}
            className="bfw-sidebar-handle bfw-btn flex h-16 w-7 items-center justify-center"
          >
            <svg viewBox="0 0 20 20" className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
              <path d="M12 4l-7 6 7 6" />
            </svg>
          </button>
          <div
            className="bfw-sidebar-backdrop fixed inset-0 z-[16]"
            data-open={sidebarOpen}
            onClick={() => setSidebarOpen(false)}
            aria-hidden={!sidebarOpen}
          />
          <aside
            className="bfw-sidebar fixed inset-y-0 right-0 z-[17] flex w-full flex-col"
            data-open={sidebarOpen}
            aria-hidden={!sidebarOpen}
          >
            {/*
              Header and body are two distinct color panels, not one
              uniformly-padded column — a solid header-bg band
              (border-bottom in --separator marks the split) sitting
              above a separate body-bg wash the sidebar's own content
              scrolls within. Both per-theme (see the
              --header-bg/--body-bg/--separator variables above); the
              header's own text stays a fixed light tint rather than
              var(--text-strong), since --header-bg is deliberately dark
              in both themes (a branded band, not a theme-following
              surface). paddingTop: 84 reserves space under the
              header-controls row (Day/Night + Profile, z-20, top-5) —
              now that the sidebar is on the right, its own top-right
              corner sits directly under that floating row (same
              collision shape the old .bfw-dash title band once had
              against it, just rotated to the vertical axis since both
              now anchor to the same edge); same hand-tuned-constant,
              confirmed-via-screenshot discipline as that original fix.
            */}
            <div className="min-w-0 shrink-0 border-b-2 px-6 py-4" style={{ background: 'var(--header-bg)', borderColor: 'var(--separator)', paddingTop: 84 }}>
              <h1 className="truncate text-lg font-semibold" style={{ color: '#E7F1F5' }}>Biliran — flood risk dashboard</h1>
              <p className="truncate text-sm" style={{ color: '#B7D2DE' }}>MDRRMO / barangay flood early-warning conditions</p>
            </div>
            {/*
              A dedicated, solid-reading --sidebar-body-bg, not
              var(--body-bg) + backdrop-blur-xl like an earlier version
              of this div had: --body-bg is a fairly translucent wash
              (tuned for the old, narrow 380px-wide sidebar, where only a
              thin sliver of map showed through it), and backdrop-blur-xl
              over the FULL viewport is one of the most GPU-expensive CSS
              effects there is — continuously re-composited while the
              map's own ambient animations keep playing underneath it, a
              real, reported performance regression on lower-end devices.
              A plain solid-ish fill fixes the same "map bleeding through
              legibly behind every list row" legibility problem the blur
              was added for, at a fraction of the cost — no filter at all.
              See the BiliranMap pauseAnimations prop below for the other
              half of this fix (stopping those ambient animations outright
              while they're hidden behind this anyway).

              No overflow-y-auto here (unlike the single-column version this
              replaced) — DashboardShell's own two-column grid owns two
              independently-scrolling regions internally now (list and FSI
              detail panel), and this wrapper scrolling too would mean the
              page scrolling as a whole instead of each column scrolling on
              its own. flex/min-h-0 just pass a real height constraint down
              to it.
            */}
            <div className="flex min-h-0 flex-1 flex-col p-6" style={{ background: 'var(--sidebar-body-bg)' }}>
              <DashboardShell
                barangays={displayBarangays}
                loadError={mapLoadError}
                selectedKey={selectedKey}
                onSelectKey={selectBarangay}
                municipality={focusedMunicipality}
                onMunicipalityChange={setFocusedMunicipality}
                theme={theme}
                liveActive={liveIslandState != null}
                liveHydrograph={liveHydrograph}
                liveRainfallFactor={liveRainfallFactor}
              />
            </div>
          </aside>
          {/*
            Compact quick-glance card — shown whenever a barangay is
            selected and the full sidebar is closed, so its FSI score/
            class/countdown is visible immediately without opening the
            sidebar at all. Hidden while the sidebar is open: the same
            (and more complete) info is already pinned at the top of
            BarangayDetailPanel there, so showing both would be
            redundant. Tapping it opens the full sidebar.
          */}
          {selectedKey && !sidebarOpen && selectedBarangay && (
            <SelectedBarangayCorner barangay={selectedBarangay} onExpand={() => setSidebarOpen(true)} />
          )}
        </>
      )}

      {/* Loading cover, hides the pre-resolved state flash */}
      <div
        className="bfw-loading-cover"
        style={{ opacity: authState === 'checking' ? 1 : 0, pointerEvents: authState === 'checking' ? 'auto' : 'none' }}
      />

      {showAdminPanel && isAdmin && (
        <AdminShell
          theme={theme}
          onToggleTheme={() => setTheme((t) => (t === 'light' ? 'dark' : 'light'))}
          avatarUrl={avatarUrl}
          displayName={displayName}
          office={office}
          onOpenProfile={() => setShowProfile(true)}
          barangays={displayBarangays}
          liveActive={liveIslandState != null}
        />
      )}

      {/*
        Rendered AFTER AdminShell above (both z-50) so it paints on top of
        it — needed since AdminShell's own header now has its own Profile
        button (wired to this same showProfile state) that must be able to
        open this while the admin shell is showing, not just from the
        pre-admin persistent header.
      */}
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