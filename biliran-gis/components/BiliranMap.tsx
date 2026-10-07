// components/BiliranMap.tsx
//
// Real interactive map: actual barangay/municipality polygons (projected
// from public/data/geo/*.geojson — derived from this project's own
// barangay_biliran.geojson, see CLAUDE.md) rendered as SVG paths. No map
// tile service involved. Default view is the whole island, unzoomed —
// tapping a municipality zooms into it and reveals its barangay polygons;
// tapping a barangay selects it. Maripipi has no polygon data here and
// isn't shown at all — its coordinates (lib/municipalities.ts) are only
// used to keep it inside islandBounds framing, per the project's
// documented exclusion from monitoring.

'use client'

import { memo, useCallback, useEffect, useMemo, useRef, useState } from 'react'
import {
  boundsOf,
  clampCenter,
  clientPointToSvgSpace,
  expandBounds,
  fetchGeoJSON,
  geometryCentroid,
  geometryToPath,
  lineGeometryToPath,
  makeProjector,
  viewBoxOf,
  type Bounds,
  type GeoFeature,
  type GeoFeatureCollection,
  type LineFeatureCollection,
} from '@/lib/geo'
import {
  fsiScoreColor,
  formatHoursAsCountdown,
  mostUrgentCrossing,
  municipalityWorstScore,
  type Barangay,
} from '@/lib/dashboardData'
import { MARIPIPI, municipalityForPrefix } from '@/lib/municipalities'
import { MUNICIPALITY_COORDS } from '@/lib/municipalityCoords'
import { loadWeather, conditionForWeatherCode, type WeatherBucket } from '@/lib/liveWeather'

interface MuniProps {
  pgc_prefix: string
  municipality: string
  barangay_count: number
}
interface BrgyProps {
  key: string
  barangay: string
  pgc_prefix: string
}

interface View {
  cx: number
  cy: number
  scale: number
}

// Max zoom — tightened further to 1.5x by direct request after 1.8x still
// felt laggy (was 9x originally; this is a deliberate trade-off of framing
// tightness for raw rendering cost). Real per-municipality "fill the frame"
// scales measured 1.9x-2.8x (muniFocusByPrefix below), i.e. already above
// this cap — see the muniFillScale clamp further down for why that's
// handled explicitly rather than left to clampView alone.
const MAX_SCALE = 1.5

// Tuned by feel against real trackpad/mouse-wheel input, not derived —
// wheel deltas vary a lot by device/OS, so these are starting points to
// keep adjusting if the map still feels too twitchy on a given device.
const WHEEL_ZOOM_COEFFICIENT = 0.0008
const DRAG_DAMPING = 0.7

// Module-level (not declared inside the component): pure given its own
// arguments — only touches the module-level MAX_SCALE constant and the
// imported clampCenter utility, nothing from component state/props — so
// it's already a stable reference by construction, with no useCallback
// needed, and callers (applyMuniFocus/focusMuni below) can be memoized
// without it ever invalidating their own dependency arrays.
function clampView(next: View, bounds: Bounds): View {
  const scale = Math.min(MAX_SCALE, Math.max(1, next.scale))
  const [cx, cy] = clampCenter([next.cx, next.cy], bounds, 0.15)
  return { cx, cy, scale }
}

export default function BiliranMap({
  barangays,
  selectedKey,
  onSelect,
  showChrome = true,
  focusedMunicipality = null,
  onFocusMunicipality,
  onResetToOverview,
  resetToken = 0,
  nextForecastUpdateAt = null,
  pauseAnimations = false,
  showWaterways = true,
}: {
  barangays: Barangay[]
  selectedKey: string | null
  onSelect: (barangay: Barangay) => void
  // False while this map is the full-bleed login backdrop (see
  // app/page.tsx) — hides overlays that only make sense once there's a
  // dashboard around them (the zoom slider, the weather ribbon), leaving a
  // cleaner decorative background. The -/+ zoom buttons, legend, and
  // ambient motion still show either way.
  showChrome?: boolean
  // Two-way sync with the dashboard's municipality filter (a municipality
  // *name*, not a pgc_prefix) — mirrors selectedKey/onSelect's existing
  // barangay sync. Picking a municipality elsewhere (the dropdown) moves
  // the map; tapping a municipality on the map calls onFocusMunicipality
  // so the dropdown follows. null means "all municipalities" / full island.
  focusedMunicipality?: string | null
  onFocusMunicipality?: (name: string | null) => void
  // Fires specifically when the user taps THIS map's own "all
  // municipalities" reset button below — distinct from
  // onFocusMunicipality(null), which also fires from the dashboard's own
  // municipality-filter dropdown clearing to "all" (a different action,
  // reported directly as NOT what should clear the selected barangay).
  // app/page.tsx uses this one to clear selectedKey (and with it,
  // SelectedBarangayCorner's mini FSI card) specifically when the user
  // goes back to the full-island view from the map itself.
  onResetToOverview?: () => void
  // Forces the view back to the default whole-island framing, regardless
  // of the current selectedKey/focusedMunicipality — a monotonically
  // incrementing token (not a boolean) since app/page.tsx's handleSignOut
  // needs "reset" to fire again even if the map is already sitting
  // wherever the *previous* sign-out already left it. Neither of the
  // selectedKey/focusedMunicipality sync blocks below does this on their
  // own: a barangay selection changing to null doesn't call focusBarangay
  // at all (nothing to focus), and focusedMunicipality only resets the
  // view on a non-null-to-null *transition* — a raw wheel/drag pan never
  // touches focusedMunicipality in the first place, so if the user zoomed
  // by hand rather than by picking a municipality, neither prop change
  // would catch it.
  resetToken?: number
  // Timestamp (Date.now()-style ms) of the next scheduled live-forecast
  // refresh — app/page.tsx's own weather-fetch effect owns the actual
  // timer and recomputation (lib/liveIslandState.ts); this is display-only,
  // rendered as a small countdown in the map's bottom-right corner (see
  // NextForecastBadge below). null hides it — the pre-login backdrop and
  // any caller that hasn't wired up live weather yet just show nothing,
  // same "don't invent a placeholder" pattern as the weather icons.
  nextForecastUpdateAt?: number | null
  // Pauses the map's continuous ambient animations (sea shimmer, drifting
  // clouds, per-municipality weather icons) — OR'd together with the
  // existing Page-Visibility-driven animationsPaused state below, not a
  // second independent mechanism. Set true while the sidebar is open and
  // can cover the whole map, since there's no visual reason to keep
  // animating underneath it then.
  pauseAnimations?: boolean
  // Gates the waterway/river line overlay (~448 line features, rendered
  // as one merged <path> — see waterwayPaths below) — real rendering
  // cost, so this is a genuine lower-end-device toggle, not cosmetic.
  // Defaults true here for component-level safety; the one real caller
  // (app/page.tsx) always passes its own explicit state.
  showWaterways?: boolean
}) {
  const [municipalities, setMunicipalities] = useState<GeoFeatureCollection<MuniProps> | null>(null)
  const [brgyGeo, setBrgyGeo] = useState<GeoFeatureCollection<BrgyProps> | null>(null)
  const [waterways, setWaterways] = useState<LineFeatureCollection | null>(null)
  const [loadError, setLoadError] = useState<string | null>(null)
  // Continuous pan/zoom state (island-projected coordinate space), replacing
  // the old binary focusedMuni: string | null. null until islandBounds is
  // known, then initialized to the full-island framing (see below) — the
  // map must never auto-focus a municipality on load, only the interaction
  // is continuous now, not the starting state.
  const [view, setView] = useState<View | null>(null)
  // True while the user is directly dragging/scrolling the map — disables
  // the eased CSS transition so direct manipulation tracks the pointer
  // instantly, rather than lagging behind it. Programmatic jumps (tap a
  // municipality, pick a barangay, zoom buttons, reset) keep the transition.
  const [interacting, setInteracting] = useState(false)
  // Real viewport width — used only to pick the Legend's already-built
  // 'md' size variant on a phone-width screen instead of its full
  // desktop-sized default — same matchMedia pattern app/page.tsx already
  // uses for its own dark-mode-preference listener.
  const [isNarrowViewport, setIsNarrowViewport] = useState(
    () => typeof window !== 'undefined' && window.matchMedia('(max-width: 480px)').matches
  )
  // Drives the `bfw-anim-paused` class below (Page Visibility API) — the sea
  // shimmer, drifting clouds, and per-municipality weather-icon drift/rain
  // are all continuous CSS animations with no natural stopping point, so
  // this pauses them while the tab is backgrounded/screen-locked (zero
  // visual difference while actually looking at the map, pure CPU/battery
  // saving while not). The same class is also applied below while
  // `interacting` is true (an active drag-pan/wheel-zoom gesture) — that's
  // exactly when the browser is already busiest (pointermove handling,
  // the rAF-driven setView() re-render each frame), so freeing it from also
  // compositing these purely decorative animations is a real, measurable
  // win on lower-end devices; they resume the instant the gesture ends,
  // same "no visual cost, pure saved work" reasoning as the tab-hidden case.
  const [animationsPaused, setAnimationsPaused] = useState(
    () => typeof document !== 'undefined' && document.hidden
  )

  const containerRef = useRef<HTMLDivElement>(null)
  const svgRef = useRef<SVGSVGElement>(null)
  const dragRef = useRef<{ pointerId: number; startClientX: number; startClientY: number; startView: View; capturing: boolean } | null>(null)
  const wheelTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  // rAF-throttling for drag-pan: raw pointermove can fire well above 60Hz
  // on Android, and each setView() re-renders/re-stringifies every
  // municipality/barangay/waterway path underneath the map's transform —
  // capping the actual setView() call to once per animation frame (instead
  // of once per raw event) keeps that re-render frequency at the display's
  // real refresh rate. rafIdRef tracks whether a frame is already scheduled
  // (so a burst of pointermove events between frames only schedules one);
  // pendingPointerRef holds the latest raw pointer position for whenever
  // that frame actually runs.
  const rafIdRef = useRef<number | null>(null)
  const pendingPointerRef = useRef<{ clientX: number; clientY: number } | null>(null)

  useEffect(() => {
    Promise.all([
      fetchGeoJSON<GeoFeatureCollection<MuniProps>>('/data/geo/municipalities.geojson'),
      fetchGeoJSON<GeoFeatureCollection<BrgyProps>>('/data/geo/barangays.geojson'),
      fetchGeoJSON<LineFeatureCollection>('/data/geo/waterways.geojson'),
    ])
      .then(([m, b, w]) => {
        setMunicipalities(m)
        setBrgyGeo(b)
        setWaterways(w)
      })
      .catch((err) => setLoadError(err instanceof Error ? err.message : 'Failed to load map data.'))
  }, [])

  useEffect(() => {
    const mq = window.matchMedia('(max-width: 480px)')
    const listener = (e: MediaQueryListEvent) => setIsNarrowViewport(e.matches)
    mq.addEventListener('change', listener)
    return () => mq.removeEventListener('change', listener)
  }, [])

  useEffect(() => {
    const onVisibilityChange = () => setAnimationsPaused(document.hidden)
    document.addEventListener('visibilitychange', onVisibilityChange)
    return () => document.removeEventListener('visibilitychange', onVisibilityChange)
  }, [])

  useEffect(() => {
    return () => {
      if (rafIdRef.current != null) cancelAnimationFrame(rafIdRef.current)
    }
  }, [])

  const project = useMemo(() => makeProjector(11.58), [])

  const islandBounds: Bounds | null = useMemo(() => {
    if (!municipalities) return null
    const [mx, my] = project(MARIPIPI.lon, MARIPIPI.lat)
    const bounds = boundsOf(municipalities.features, project)
    bounds.minX = Math.min(bounds.minX, mx)
    bounds.maxX = Math.max(bounds.maxX, mx)
    bounds.minY = Math.min(bounds.minY, my)
    bounds.maxY = Math.max(bounds.maxY, my)
    return expandBounds(bounds, 0.1)
  }, [municipalities, project])

  // Waterway path strings don't depend on view/scale at all (pan/zoom is
  // applied as a transform on the wrapping <g>, not by recomputing
  // projected coordinates) — memoized here so re-renders triggered by
  // setView() during a drag (see applyPendingPointerMove above) don't
  // re-stringify all 448 line features' `d` attributes on every frame,
  // only whenever the underlying waterways data itself changes.
  //
  // Joined into ONE string (rendered as a single <path>, not 448 separate
  // ones) — measured directly (CPU-throttled Playwright profile, dragging
  // the map with waterways on): 448 individual <path> DOM nodes inside the
  // actively-transformed zoom group cost ~4.5s of main-thread long-task
  // time across a 6.5s drag (vs. ~0.3s with waterways off), the single
  // biggest lag contributor found. Each line feature's `d` already starts
  // with its own "M" (moveto), so concatenating them with a space is valid
  // SVG — multiple independent subpaths in one <path> element render
  // identically to the same paths as separate elements (same stroke, no
  // per-segment interactivity needed here), just as one DOM node for the
  // browser to paint/recomposite instead of 448.
  const waterwayPaths = useMemo(
    () => waterways?.features.map((f) => lineGeometryToPath(f.geometry, project)).join(' ') ?? '',
    [waterways, project]
  )

  // Same reasoning as waterwayPaths above, for municipality polygons —
  // computed once here (keyed only on the geojson data + the stable
  // `project` reference, never on view/scale) and reused both by the
  // dimmed context-outline layer just below and by MunicipalityLayer,
  // instead of each recomputing its own copy of the same ~7 path strings
  // on every drag frame.
  const municipalityPaths = useMemo(
    () => new Map(municipalities?.features.map((f) => [f.properties.pgc_prefix, geometryToPath(f.geometry, project)]) ?? []),
    [municipalities, project]
  )

  // Native (non-React-synthetic) wheel listener, added with { passive: false }
  // so preventDefault() actually stops page scroll — React's onWheel prop is
  // attached passively by default and can't block the native scroll.
  useEffect(() => {
    const el = containerRef.current
    if (!el || !islandBounds) return
    const bounds = islandBounds
    const icx = (bounds.minX + bounds.maxX) / 2
    const icy = (bounds.minY + bounds.maxY) / 2

    function handleWheel(e: WheelEvent) {
      e.preventDefault()
      if (!svgRef.current) return
      const zoomFactor = Math.exp(-e.deltaY * WHEEL_ZOOM_COEFFICIENT)

      setInteracting(true)
      if (wheelTimeoutRef.current) clearTimeout(wheelTimeoutRef.current)
      wheelTimeoutRef.current = setTimeout(() => setInteracting(false), 200)

      setView((prev) => {
        const base = prev ?? { cx: icx, cy: icy, scale: 1 }
        const newScale = Math.min(MAX_SCALE, Math.max(1, base.scale * zoomFactor))
        const [pointerX, pointerY] = clientPointToSvgSpace(svgRef.current!, e.clientX, e.clientY)
        const tx = icx - base.scale * base.cx
        const ty = icy - base.scale * base.cy
        const contentX = (pointerX - tx) / base.scale
        const contentY = (pointerY - ty) / base.scale
        const newCx = contentX + (icx - pointerX) / newScale
        const newCy = contentY + (icy - pointerY) / newScale
        const [cx, cy] = clampCenter([newCx, newCy], bounds, 0.15)
        return { cx, cy, scale: newScale }
      })
    }

    el.addEventListener('wheel', handleWheel, { passive: false })
    return () => el.removeEventListener('wheel', handleWheel)
  }, [islandBounds])

  // Each municipality's own "fill the frame" center + scale — used both to
  // animate the view when tapping a municipality, and as the crossfade
  // threshold for whichever municipality the current view is nearest to.
  const muniFocusByPrefix = useMemo(() => {
    if (!municipalities || !islandBounds) return {}
    const islandW = islandBounds.maxX - islandBounds.minX
    const islandH = islandBounds.maxY - islandBounds.minY
    const map: Record<string, View> = {}
    for (const f of municipalities.features) {
      const b = expandBounds(boundsOf([f], project), 0.07)
      const scale = Math.min(islandW / (b.maxX - b.minX), islandH / (b.maxY - b.minY))
      map[f.properties.pgc_prefix] = { cx: (b.minX + b.maxX) / 2, cy: (b.minY + b.maxY) / 2, scale }
    }
    return map
  }, [municipalities, islandBounds, project])

  const barangaysByKey = useMemo(() => {
    const map = new Map<string, Barangay>()
    for (const b of barangays) map.set(b.key, b)
    return map
  }, [barangays])

  // Still drives the weather badge's tooltip/countdown TEXT (the modeled
  // Alert/Danger crossing) — but no longer its icon/condition, see
  // weatherByMunicipality below.
  const urgentCrossing = useMemo(() => mostUrgentCrossing(barangays), [barangays])

  // Real weather per monitored municipality (Open-Meteo, via
  // app/api/weather — see lib/liveWeather.ts), fetched once on mount and
  // refreshed periodically. This is this app's first live external data:
  // drives the map's weather icon/ribbon, decoupled from the modeled
  // flood-risk crossing above (see CLAUDE.md for why that decoupling is
  // a deliberate honesty improvement, not an accident). A municipality
  // absent from this map (still loading, or the fetch failed) simply
  // doesn't render an icon yet — no placeholder/fake condition invented.
  const [weatherByMunicipality, setWeatherByMunicipality] = useState<Record<string, WeatherCondition | null>>({})

  useEffect(() => {
    let cancelled = false

    function refresh() {
      for (const name of Object.keys(MUNICIPALITY_COORDS)) {
        loadWeather(name).then((data) => {
          if (cancelled) return
          setWeatherByMunicipality((prev) => ({
            ...prev,
            [name]: data
              ? weatherConditionForBucket(conditionForWeatherCode(data.weatherCode), data.precipitationProbability)
              : null,
          }))
        })
      }
    }

    refresh()
    // 30 min (not 15) — a deliberate lower-background-cost tradeoff, see
    // app/page.tsx's matching interval for the same reasoning.
    const interval = setInterval(refresh, 30 * 60 * 1000)
    return () => {
      cancelled = true
      clearInterval(interval)
    }
  }, [])

  function focusBarangay(feature: GeoFeature<BrgyProps>, bounds: Bounds) {
    const b = expandBounds(boundsOf([feature], project), 0.35)
    const islandW = bounds.maxX - bounds.minX
    const islandH = bounds.maxY - bounds.minY
    const barangayScale = Math.min(islandW / (b.maxX - b.minX), islandH / (b.maxY - b.minY))
    // Cap at the parent municipality's own "fill the frame" scale so
    // selecting a barangay reveals it in context of its neighbors instead
    // of zooming in tight and losing the surrounding municipality.
    const muniFocus = muniFocusByPrefix[feature.properties.pgc_prefix]
    const scale = muniFocus ? Math.min(barangayScale, muniFocus.scale) : barangayScale
    setInteracting(false)
    setView(clampView({ cx: (b.minX + b.maxX) / 2, cy: (b.minY + b.maxY) / 2, scale }, bounds))
  }

  // Shared by the post-guard focusMuni (fired by an actual map tap) and the
  // sync block below (fired by focusedMunicipality changing from elsewhere,
  // e.g. the dashboard's municipality filter) — both just need a prefix +
  // the current island bounds to move the view, neither needs anything
  // that's only available after the loading guard.
  // useCallback (not a plain function): this is passed down as
  // MunicipalityLayer's onSelect prop (via focusMuni below), and
  // MunicipalityLayer is React.memo-wrapped — an unstable reference here
  // would silently defeat that memoization on every render.
  const applyMuniFocus = useCallback(
    (prefix: string, bounds: Bounds) => {
      const focus = muniFocusByPrefix[prefix]
      if (!focus) return
      setInteracting(false)
      setView(clampView(focus, bounds))
    },
    [muniFocusByPrefix],
  )

  // Both below moved above the early returns further down (rules-of-hooks:
  // useCallback must run unconditionally on every render, unlike the plain
  // functions these replaced, which didn't care about hook-call ordering).
  // Same reasoning as applyMuniFocus above — useCallback so MunicipalityLayer's
  // React.memo isn't defeated by a fresh onSelect reference every render.
  const focusMuni = useCallback(
    (prefix: string) => {
      if (!islandBounds) return
      applyMuniFocus(prefix, islandBounds)
      onFocusMunicipality?.(municipalityForPrefix(prefix))
    },
    [islandBounds, applyMuniFocus, onFocusMunicipality],
  )

  // Same reasoning as focusMuni above — stabilized so BarangayLayer's
  // React.memo isn't defeated by a fresh onSelect reference every render.
  const handleBarangaySelect = useCallback(
    (key: string) => {
      const b = barangaysByKey.get(key)
      if (b) onSelect(b)
    },
    [barangaysByKey, onSelect],
  )

  // Also moved above the early returns, same rules-of-hooks reasoning as
  // focusMuni/handleBarangaySelect above (replaces what used to be a plain
  // function declaration further down). Reads cx/cy from the functional
  // setView updater instead of closing over currentView directly —
  // currentView.cx/cy change on every single pan frame, so a useCallback
  // keyed on currentView would get a new function identity just as often,
  // defeating ZoomControls' React.memo below (its onChange prop) right
  // when memoizing it matters most: during an active drag, not a zoom.
  // islandBounds is already its own stable useMemo, so this reference now
  // only changes when the geojson itself changes (effectively once).
  const setScale = useCallback(
    (newScale: number) => {
      if (!islandBounds) return
      setInteracting(false)
      setView((prev) => {
        const base = prev ?? {
          cx: (islandBounds.minX + islandBounds.maxX) / 2,
          cy: (islandBounds.minY + islandBounds.maxY) / 2,
          scale: 1,
        }
        return clampView({ cx: base.cx, cy: base.cy, scale: newScale }, islandBounds)
      })
    },
    [islandBounds],
  )

  // Keep the map in sync when a barangay is selected from elsewhere (e.g.
  // the list): adjust state during render off a previous-value comparison,
  // rather than in an effect, per https://react.dev/learn/you-might-not-need-an-effect.
  const [prevSelectedKey, setPrevSelectedKey] = useState<string | null | undefined>(undefined)
  if (selectedKey !== prevSelectedKey && brgyGeo && islandBounds) {
    setPrevSelectedKey(selectedKey)
    const feature = selectedKey ? brgyGeo.features.find((f) => f.properties.key === selectedKey) : null
    if (feature) focusBarangay(feature, islandBounds)
  }

  // Same pattern, for the dashboard's municipality filter driving the map
  // (the reverse of tapping a municipality on the map, which drives the
  // filter via onFocusMunicipality below) — focusedMunicipality is a
  // municipality *name*, not a pgc_prefix, matching MONITORED_MUNICIPALITIES/
  // filterBarangays's convention.
  const [prevFocusedMunicipality, setPrevFocusedMunicipality] = useState<string | null | undefined>(undefined)
  if (focusedMunicipality !== prevFocusedMunicipality && municipalities && islandBounds) {
    setPrevFocusedMunicipality(focusedMunicipality)
    if (focusedMunicipality) {
      const feature = municipalities.features.find((f) => f.properties.municipality === focusedMunicipality)
      if (feature) applyMuniFocus(feature.properties.pgc_prefix, islandBounds)
    } else {
      setInteracting(false)
      setView({
        cx: (islandBounds.minX + islandBounds.maxX) / 2,
        cy: (islandBounds.minY + islandBounds.maxY) / 2,
        scale: 1,
      })
    }
  }

  // See resetToken's doc comment above — unconditionally forces the view
  // back to the default whole-island framing on change, independent of
  // selectedKey/focusedMunicipality (both of which app/page.tsx's
  // handleSignOut also resets to null, but neither of those prop changes
  // alone is guaranteed to reset the view — see why in that comment).
  const [prevResetToken, setPrevResetToken] = useState(resetToken)
  if (resetToken !== prevResetToken && islandBounds) {
    setPrevResetToken(resetToken)
    setInteracting(false)
    setView({
      cx: (islandBounds.minX + islandBounds.maxX) / 2,
      cy: (islandBounds.minY + islandBounds.maxY) / 2,
      scale: 1,
    })
  }

  if (loadError) {
    return (
      <div className="flex h-full items-center justify-center text-sm" style={{ color: 'var(--text-soft)' }}>
        Couldn&apos;t load the map: {loadError}
      </div>
    )
  }

  if (!municipalities || !brgyGeo || !waterways || !islandBounds) {
    return (
      <div className="flex h-full items-center justify-center text-sm" style={{ color: 'var(--text-soft)' }}>
        Loading map…
      </div>
    )
  }

  // Zoom is an SVG transform attribute on a <g>, computed against the fixed
  // island viewBox (which never itself changes), rather than animating
  // viewBox (which CSS can't transition smoothly).
  const islandCx = (islandBounds.minX + islandBounds.maxX) / 2
  const islandCy = (islandBounds.minY + islandBounds.maxY) / 2

  // Default view (full island, unzoomed) — set once, during render, the
  // first time islandBounds becomes available (same pattern as the
  // selectedKey sync above). currentView is used as a same-render fallback
  // so the rest of this render pass has a value even though React discards
  // it and re-renders immediately after this setView call.
  const currentView: View = view ?? { cx: islandCx, cy: islandCy, scale: 1 }
  if (view === null) {
    setView(currentView)
  }

  function nearestMunicipalityPrefix(cx: number, cy: number): string | null {
    let best: string | null = null
    let bestDist = Infinity
    for (const [prefix, focus] of Object.entries(muniFocusByPrefix)) {
      const d = (focus.cx - cx) ** 2 + (focus.cy - cy) ** 2
      if (d < bestDist) {
        bestDist = d
        best = prefix
      }
    }
    return best
  }

  const nearestPrefix = nearestMunicipalityPrefix(currentView.cx, currentView.cy)
  // Clamped to MAX_SCALE: muniFocusByPrefix's own per-municipality "fill the
  // frame" scale (1.9x-2.8x, measured directly) now exceeds MAX_SCALE (see
  // its comment above) for every municipality on this island — left
  // unclamped, lowThreshold/highThreshold below would sit at or past the
  // view's own hard ceiling, so barangayOpacity could never reach 1 (and,
  // since barangay polygons only become clickable past 0.5 opacity below,
  // tapping individual barangays on the map would silently stop working
  // for most municipalities). Clamping here keeps the reveal reachable
  // regardless of how low MAX_SCALE is tuned.
  const muniFillScale = Math.min(MAX_SCALE, nearestPrefix ? muniFocusByPrefix[nearestPrefix].scale : 3)
  // Anchored to the achievable [1, muniFillScale] range, not muniFillScale
  // directly from zero — with muniFillScale now uniformly clamped to
  // MAX_SCALE (above) for every municipality, the old `muniFillScale *
  // 0.55` put lowThreshold at 0.825 for MAX_SCALE=1.5, BELOW 1, the view's
  // own minimum achievable scale. Since nearestMunicipalityPrefix always
  // resolves to some municipality (even at the untouched default
  // full-island view, before any tap/zoom), that meant barangayOpacity
  // could never actually reach 0 for whichever one is nearest — reported
  // directly as that municipality's barangay-level content (polygons,
  // labels) already partially visible on first load. Starting the range at
  // 1 instead guarantees lowThreshold >= 1 always, so barangayOpacity is
  // exactly 0 at the true minimum scale regardless of MAX_SCALE's value.
  const lowThreshold = 1 + (muniFillScale - 1) * 0.55
  const highThreshold = 1 + (muniFillScale - 1) * 0.85
  const barangayOpacity = Math.min(1, Math.max(0, (currentView.scale - lowThreshold) / (highThreshold - lowThreshold)))
  const isZoomed = currentView.scale > 1.02

  const tx = islandCx - currentView.scale * currentView.cx
  const ty = islandCy - currentView.scale * currentView.cy
  const transform = `translate(${tx},${ty}) scale(${currentView.scale})`

  function resetView() {
    setInteracting(false)
    setView({ cx: islandCx, cy: islandCy, scale: 1 })
    onFocusMunicipality?.(null)
    onResetToOverview?.()
  }

  // Drag-vs-tap disambiguation: pointer capture is deferred until the
  // pointer has actually moved past DRAG_THRESHOLD_PX (handlePointerMove),
  // not grabbed unconditionally on pointerdown. Capturing eagerly on every
  // pointerdown — including a plain tap on a municipality/barangay polygon
  // — was found (via this feature's own testing) to suppress the browser's
  // synthetic 'click' event on that polygon, the same mechanism that once
  // broke clicks on sibling buttons when pointer handlers lived on an
  // ancestor container (see CLAUDE.md). A tap that never crosses the
  // threshold is left alone entirely, so its native click reaches the
  // polygon's own onClick normally.
  const DRAG_THRESHOLD_PX = 5

  function handlePointerDown(e: React.PointerEvent<SVGSVGElement>) {
    if (e.pointerType === 'mouse' && e.button !== 0) return
    dragRef.current = {
      pointerId: e.pointerId,
      startClientX: e.clientX,
      startClientY: e.clientY,
      startView: currentView,
      capturing: false,
    }
  }

  // Runs at most once per animation frame (scheduled by handlePointerMove
  // below), reading the latest raw pointer position rather than one
  // captured per-event — this is the actual setView()-triggering work,
  // decoupled from raw pointermove frequency.
  function applyPendingPointerMove() {
    rafIdRef.current = null
    const pending = pendingPointerRef.current
    const drag = dragRef.current
    if (!pending || !drag || !svgRef.current || !islandBounds) return

    const [startX, startY] = clientPointToSvgSpace(svgRef.current, drag.startClientX, drag.startClientY)
    const [curX, curY] = clientPointToSvgSpace(svgRef.current, pending.clientX, pending.clientY)
    const deltaX = (curX - startX) * DRAG_DAMPING
    const deltaY = (curY - startY) * DRAG_DAMPING
    setView(
      clampView(
        {
          cx: drag.startView.cx - deltaX / drag.startView.scale,
          cy: drag.startView.cy - deltaY / drag.startView.scale,
          scale: drag.startView.scale,
        },
        islandBounds
      )
    )
  }

  function handlePointerMove(e: React.PointerEvent<SVGSVGElement>) {
    const drag = dragRef.current
    if (!drag || drag.pointerId !== e.pointerId || !svgRef.current || !islandBounds) return

    if (!drag.capturing) {
      const movedPx = Math.hypot(e.clientX - drag.startClientX, e.clientY - drag.startClientY)
      if (movedPx < DRAG_THRESHOLD_PX) return
      drag.capturing = true
      setInteracting(true)
      e.currentTarget.setPointerCapture(e.pointerId)
    }

    pendingPointerRef.current = { clientX: e.clientX, clientY: e.clientY }
    if (rafIdRef.current == null) {
      rafIdRef.current = requestAnimationFrame(applyPendingPointerMove)
    }
  }

  function endDrag(e: React.PointerEvent<SVGSVGElement>) {
    if (dragRef.current?.pointerId === e.pointerId) {
      dragRef.current = null
      setInteracting(false)
    }
    if (rafIdRef.current != null) {
      cancelAnimationFrame(rafIdRef.current)
      rafIdRef.current = null
    }
    pendingPointerRef.current = null
  }

  return (
    <div
      ref={containerRef}
      className={`bfw-map-root relative h-full w-full overflow-hidden rounded-xl border shadow-xl ring-1 ring-white/10${animationsPaused || pauseAnimations || interacting ? ' bfw-anim-paused' : ''}`}
      style={{ borderColor: 'var(--card-border)' }}
    >
      <style>{`
        .bfw-map-poly { transition: filter 0.2s ease, stroke-width 0.2s ease; }
        .bfw-map-poly:hover { filter: brightness(1.14) saturate(1.08); }
        @keyframes bfw-sea-shimmer {
          0%, 100% { transform: translate(0px, 0px); }
          50% { transform: translate(${(islandBounds.maxX - islandBounds.minX) * 0.02}px, ${(islandBounds.maxY - islandBounds.minY) * 0.015}px); }
        }
        .bfw-sea-shimmer { animation: bfw-sea-shimmer 16s ease-in-out infinite; }

        /* Page Visibility pause — tab backgrounded/screen locked. Every
           continuous ambient animation in this map (sea shimmer,
           per-municipality weather-icon drift/rain — see WeatherIconStyles
           below) is driven by a CSS animation-name, so pausing them all is
           one blanket rule here rather than touching each @keyframes
           definition individually. */
        .bfw-anim-paused, .bfw-anim-paused * { animation-play-state: paused !important; }

        /* prefers-reduced-motion: reduce — an explicit OS-level opt-in, not
           the default experience for anyone else. Same universal
           animation-play-state trick as the visibility-pause rule above
           (works regardless of whether a given animation is driven by a
           className or an inline style="animation:..."), plus swaps the
           two feDropShadow filters (one of the costlier SVG filter
           primitives) for a flat fill, matching what a user who's told
           their OS they want less motion is actually asking for. */
        @media (prefers-reduced-motion: reduce) {
          .bfw-map-root, .bfw-map-root * { animation-play-state: paused !important; }
          .bfw-shadow-group { filter: none !important; }
        }
      `}</style>
      <svg
        ref={svgRef}
        viewBox={viewBoxOf(islandBounds)}
        className="h-full w-full"
        style={{
          background: 'linear-gradient(155deg, var(--sea-top), var(--sea-bottom) 70%)',
          touchAction: 'none',
          cursor: interacting ? 'grabbing' : 'grab',
        }}
        onPointerDown={handlePointerDown}
        onPointerMove={handlePointerMove}
        onPointerUp={endDrag}
        onPointerCancel={endDrag}
      >
        <defs>
          <filter id="bfw-land-shadow" x="-40%" y="-40%" width="180%" height="180%">
            <feDropShadow dx="0.0009" dy="0.0014" stdDeviation="0.0016" floodColor="#0B1E28" floodOpacity="0.45" />
          </filter>
          <filter id="bfw-text-shadow" x="-60%" y="-60%" width="220%" height="220%">
            <feDropShadow dx="0.0003" dy="0.0005" stdDeviation="0.0005" floodColor="#0B1E28" floodOpacity="0.6" />
          </filter>
          {/*
            userSpaceOnUse + fixed island-bounds coordinates, not the SVG
            default (objectBoundingBox): otherwise every polygon draws its
            own independent light sweep across its own bounding box, and
            Biliran's barangays are long thin coast-to-interior wedges, so
            zoomed in that reads as a shattered/striped mess instead of one
            light source across the whole scene.
          */}
          <linearGradient
            id="bfw-land-sheen"
            gradientUnits="userSpaceOnUse"
            x1={islandBounds.minX}
            y1={islandBounds.minY}
            x2={islandBounds.maxX}
            y2={islandBounds.maxY}
          >
            <stop offset="0%" stopColor="#ffffff" stopOpacity="0.28" />
            <stop offset="45%" stopColor="#ffffff" stopOpacity="0.04" />
            <stop offset="100%" stopColor="#000000" stopOpacity="0.12" />
          </linearGradient>
          <radialGradient id="bfw-sea-glow" cx="35%" cy="25%" r="75%">
            <stop offset="0%" stopColor="#ffffff" stopOpacity="0.16" />
            <stop offset="55%" stopColor="#ffffff" stopOpacity="0" />
          </radialGradient>
          {/*
            Puffier cloud lobes (WeatherIconSVG's per-municipality icons)
            use this instead of a flat fill — a soft off-center highlight
            plus a dimmer rim gives each lobe volume instead of reading as
            a flat gray/white blob. Purely a styling gradient, not tied to
            any data.
          */}
          <radialGradient id="bfw-cloud-body" cx="38%" cy="32%" r="70%">
            <stop offset="0%" stopColor="#ffffff" stopOpacity="1" />
            <stop offset="60%" stopColor="#ffffff" stopOpacity="0.88" />
            <stop offset="100%" stopColor="#DCE6EA" stopOpacity="0.75" />
          </radialGradient>
          {/*
            Stronger version of bfw-land-sheen, used only for zoomed-in
            barangay shapes (BarangayLayer) — they render much larger on
            screen than the island-overview municipalities, so the same
            subtle sheen reads as flat at that scale. Explicitly stylized
            lighting for visual depth, not a stand-in for real terrain —
            this project has no elevation/DEM data anywhere.
          */}
          <linearGradient
            id="bfw-land-sheen-strong"
            gradientUnits="userSpaceOnUse"
            x1={islandBounds.minX}
            y1={islandBounds.minY}
            x2={islandBounds.maxX}
            y2={islandBounds.maxY}
          >
            <stop offset="0%" stopColor="#ffffff" stopOpacity="0.4" />
            <stop offset="45%" stopColor="#ffffff" stopOpacity="0.05" />
            <stop offset="100%" stopColor="#000000" stopOpacity="0.2" />
          </linearGradient>
          {/*
            Island landmass clip — the union of all 7 municipality polygons
            (SVG unions multiple clipPath children by default), reused to
            keep the waterways layer below from spilling past the real
            coastline into open sea. Municipality/barangay polygons
            themselves ARE the landmass, so only waterways (raw line
            geometry, not guaranteed to stay inside it) need this.
          */}
          <clipPath id="bfw-island-clip">
            {municipalities.features.map((f) => (
              <path key={f.properties.pgc_prefix} d={municipalityPaths.get(f.properties.pgc_prefix)} />
            ))}
          </clipPath>
        </defs>

        {/* Atmospheric sea highlight — a slow, subtle shimmer for a "living" feel, not tied to zoom */}
        <rect
          className="bfw-sea-shimmer"
          x={islandBounds.minX}
          y={islandBounds.minY}
          width={islandBounds.maxX - islandBounds.minX}
          height={islandBounds.maxY - islandBounds.minY}
          fill="url(#bfw-sea-glow)"
          pointerEvents="none"
        />

        <g
          className="bfw-zoom-group"
          transform={transform}
          style={{ transition: interacting ? 'none' : 'transform 0.7s cubic-bezier(0.22,1,0.36,1)' }}
        >
          {/* dimmed context outlines of the rest of the island, fading in as barangayOpacity rises */}
          <g opacity={0.12 * barangayOpacity} pointerEvents="none">
            {municipalities.features.map((f) => (
              <path
                key={f.properties.pgc_prefix}
                d={municipalityPaths.get(f.properties.pgc_prefix)}
                fill="none"
                stroke="var(--text-strong)"
                strokeWidth={0.0004}
              />
            ))}
          </g>

          {/*
            MunicipalityLayer stays interactive at every zoom level now —
            no pointerEvents gating here — so any OTHER municipality can be
            tapped directly to jump there without resetting first; it only
            fades its own currently-focused (nearestPrefix) municipality's
            fill/label/icon per-feature (via barangayOpacity), leaving every
            other municipality at full opacity. BarangayLayer, painted
            after it in the DOM, still naturally wins hit-testing over its
            own footprint (SVG painter's-model z-order — independent of
            opacity), so this doesn't break barangay-level taps within the
            focused municipality.

            Both layers are called TWICE — shapes only in this first pass,
            weather icons + labels in a second pass further below, with
            the waterway overlay sandwiched between them. A single call-
            each-once version painted the waterway overlay either fully
            under the land (invisible, the previous bug) or fully on top
            of it INCLUDING every name label and weather icon (lines
            cutting through "Culaba", "Naval", etc. and through the cloud
            icons, both reported directly as follow-ups) — there's no
            single paint position that's "on top of the map
            but under the names (and icons)" without splitting what each
            layer renders. showLabels={false} here keeps each call doing
            its shapes exactly as before, minus its own labels/icons pass.
          */}
          <MunicipalityLayer
            municipalities={municipalities}
            municipalityPaths={municipalityPaths}
            barangays={barangays}
            onSelect={focusMuni}
            nearestPrefix={nearestPrefix}
            barangayOpacity={barangayOpacity}
            weatherByMunicipality={weatherByMunicipality}
            showWeatherIcons={currentView.scale < 1.3}
            showLabels={false}
          />
          <g
            style={{ opacity: barangayOpacity, transition: 'opacity 0.4s ease' }}
            pointerEvents={barangayOpacity > 0.5 ? 'auto' : 'none'}
          >
            <BarangayLayer
              brgyGeo={brgyGeo}
              nearestPrefix={nearestPrefix}
              barangaysByKey={barangaysByKey}
              selectedKey={selectedKey}
              onSelect={handleBarangaySelect}
              showLabels={false}
            />
          </g>

          {/*
            Waterways — off by default (showWaterways toggle in app/page.tsx,
            a real lower-end-device win — ~448 line features, merged into a
            single <path> element rather than 448 separate ones, see
            waterwayPaths' own comment above for the measured cost that fixed).
            Painted here — after both layers' SHAPES above, but before both
            layers' LABELS below (see the two-pass comment on
            MunicipalityLayer above) — SVG paints in document order, and
            MunicipalityLayer/BarangayLayer's own fills are effectively
            opaque (fillOpacity 0.85-1), so with the overlay painted before
            the shapes it was getting almost entirely covered by land,
            barely visible — reported directly ("very visible when the
            toggle is on"). Painting it after the shapes (but before the
            labels) makes it a true overlay on top of the land without also
            running over every name label.
            pointerEvents="none" — needed now that this sits on top of every
            interactive polygon instead of under them: without it, this
            stroke-only path (fill="none") would still be hit-testable
            (SVG's default pointer-events: visiblePainted catches a painted
            stroke even with no fill) and could swallow taps on a
            municipality/barangay exactly where a river line crosses it.
            When on, rendered at a fixed, fully-visible opacity/width regardless of
            zoom — an earlier version ramped both with barangayOpacity (dim
            at the island overview, more visible near barangay zoom), but
            that read as "faded into the background" rather than the
            permanently-visible overlay this toggle is meant to be, reported
            directly. The toggle itself is still the only on/off switch.
            clipPath keeps lines from spilling past the coastline into open
            sea (bfw-island-clip, defined above — reported directly, most
            visible around Culaba, but the underlying line data isn't
            guaranteed to stay inside the landmass anywhere). Color/width
            bumped further (darker, more saturated blue; thicker stroke)
            after the original pale cyan still read as washed-out against
            the warm terrain palette, reported directly — matches the
            accent color the waterways toggle button itself now lights up
            with (app/page.tsx), so the button visually previews this.
          */}
          {showWaterways && (
            <path
              d={waterwayPaths}
              opacity={1}
              stroke="#1CA7D6"
              strokeWidth={0.0015}
              fill="none"
              clipPath="url(#bfw-island-clip)"
              pointerEvents="none"
            />
          )}

          {/*
            Second pass: weather icons + labels, for both layers, on top
            of the waterway overlay painted just above — see the two-pass
            comment on the first MunicipalityLayer call above for why this
            is split out rather than called once. showShapes={false} skips
            everything these calls already rendered in the first pass.
          */}
          <MunicipalityLayer
            municipalities={municipalities}
            municipalityPaths={municipalityPaths}
            barangays={barangays}
            onSelect={focusMuni}
            nearestPrefix={nearestPrefix}
            barangayOpacity={barangayOpacity}
            weatherByMunicipality={weatherByMunicipality}
            showWeatherIcons={currentView.scale < 1.3}
            showShapes={false}
          />
          <g style={{ opacity: barangayOpacity, transition: 'opacity 0.4s ease' }} pointerEvents="none">
            <BarangayLayer
              brgyGeo={brgyGeo}
              nearestPrefix={nearestPrefix}
              barangaysByKey={barangaysByKey}
              selectedKey={selectedKey}
              onSelect={handleBarangaySelect}
              showShapes={false}
            />
          </g>
        </g>
      </svg>

      {isZoomed && (
        <button
          type="button"
          onClick={() => resetView()}
          className="bfw-btn absolute left-3 top-3 rounded-full px-3 py-1.5 text-xs font-medium"
        >
          ← All municipalities
        </button>
      )}

      {showChrome && <ZoomControls scale={currentView.scale} maxScale={MAX_SCALE} onChange={setScale} showSlider={showChrome} />}
      {showChrome && nextForecastUpdateAt != null && (
        <NextForecastBadge updateAt={nextForecastUpdateAt} />
      )}

      {showChrome && (
        <WeatherBadge
          crossing={urgentCrossing}
          condition={urgentCrossing ? weatherByMunicipality[urgentCrossing.barangay.municipality] ?? null : null}
        />
      )}
      {showChrome && <Legend size={isNarrowViewport ? 'md' : 'lg'} />}
    </div>
  )
}

// React.memo-wrapped (here and BarangayLayer/WeatherIconSVG below): these
// can render a large SVG subtree (up to ~500 nodes combined at worst
// case), and without memo, any unrelated parent re-render (a weather-poll
// tick, a viewport resize) forces React to reconcile that whole tree even
// when none of a given layer's own props changed. Relies on their callers
// passing stable prop references (useCallback/useMemo) — see focusMuni/
// handleBarangaySelect above and municipalityPaths/barangayPaths/
// waterwayPaths elsewhere in this file.
const MunicipalityLayer = memo(function MunicipalityLayer({
  municipalities,
  municipalityPaths,
  barangays,
  onSelect,
  nearestPrefix,
  barangayOpacity,
  weatherByMunicipality,
  showWeatherIcons,
  showShapes = true,
  showLabels = true,
}: {
  municipalities: GeoFeatureCollection<MuniProps>
  // Precomputed by the parent (BiliranMap) via useMemo, keyed only on the
  // geojson data + the stable projector — shared with its own dimmed
  // context-outline layer so the same ~7 path strings aren't computed
  // twice per render, and aren't recomputed at all just because a drag
  // frame changed nearestPrefix/barangayOpacity (neither of which the
  // path geometry itself depends on).
  municipalityPaths: Map<string, string>
  barangays: Barangay[]
  onSelect: (prefix: string) => void
  // Only the municipality the current view is nearest to fades out (as
  // barangayOpacity rises toward its own barangay-level detail taking
  // over) — every other municipality stays fully visible AND clickable
  // regardless of zoom, so tapping a different one works at any zoom
  // level, not just from the full-island overview.
  nearestPrefix: string | null
  barangayOpacity: number
  weatherByMunicipality: Record<string, WeatherCondition | null>
  // scale < 1.3 (approved decorative-cost trade-off) — up to 7 icons'
  // worth of continuous cloud-drift + rain-drop CSS animation isn't the
  // visual focus once a user has zoomed into a municipality, so they're
  // skipped entirely past that threshold rather than staying mounted
  // (and animating) underneath.
  showWeatherIcons: boolean
  // Both default true (every existing call site is unaffected) -- added so
  // BiliranMap can call this component twice, once per pass, with the
  // waterway overlay sandwiched between them: shapes first, then weather
  // icons + labels on top of that. See the waterway <path>'s own comment
  // below for why this split exists.
  showShapes?: boolean
  showLabels?: boolean
}) {
  const project = useMemo(() => makeProjector(11.58), [])
  const bounds = useMemo(() => boundsOf(municipalities.features, project), [municipalities, project])
  // Small enough to sit above a municipality's name label without dominating it.
  const iconScale = (bounds.maxX - bounds.minX) * 0.0019
  const iconOffsetY = (bounds.maxY - bounds.minY) * 0.06
  function fadeFor(prefix: string): number {
    return prefix === nearestPrefix ? Math.max(0, 1 - barangayOpacity) : 1
  }
  return (
    <g>
      {/*
        shapeRendering="optimizeSpeed" (skips anti-aliasing on these fills)
        -- tapping a municipality was measured directly (CDP CPU profiling
        under 4x throttle, isolating this group specifically by toggling it
        display:none) to be the real source of the "tapping or changing
        location is lagging" report: repainting these 7 shapes (they cover
        most of the visible map, unlike BarangayLayer's smaller zoomed-in
        ones) is what actually blocks the main thread on every single
        municipality switch, not panning/zooming itself. Against a
        production build the dominant longtask dropped from ~150-215ms to
        ~55-100ms just by testing prod instead of dev (dev's unminified
        jsxDEV runtime + Strict Mode double-render inflated earlier
        readings) -- this hint trims the remainder without touching the
        gradient sheen/drop-shadow/fade that give this layer its depth, at
        a scale (full-municipality fills, not fine detail) where slightly
        harder polygon edges aren't perceptible.
      */}
      {showShapes && (
        <g className="bfw-shadow-group" filter="url(#bfw-land-shadow)" shapeRendering="optimizeSpeed">
          {municipalities.features.map((f) => {
            const score = municipalityWorstScore(barangays, f.properties.municipality)
            const d = municipalityPaths.get(f.properties.pgc_prefix)
            return (
              <g key={f.properties.pgc_prefix} style={{ opacity: fadeFor(f.properties.pgc_prefix), transition: 'opacity 0.4s ease' }}>
                <path
                  className="bfw-map-poly"
                  d={d}
                  fill={fsiScoreColor(score)}
                  fillOpacity={0.85}
                  stroke="var(--card-bg)"
                  strokeWidth={0.0006}
                  onClick={() => onSelect(f.properties.pgc_prefix)}
                  style={{ cursor: 'pointer' }}
                >
                  <title>
                    {f.properties.municipality} — worst barangay FSI score {score.toFixed(2)} — tap to zoom in
                  </title>
                </path>
                <path d={d} fill="url(#bfw-land-sheen)" pointerEvents="none" />
              </g>
            )
          })}
        </g>
      )}
      {/*
        Each municipality gets its own weather icon, not just the one
        global corner ribbon — real current conditions from Open-Meteo
        (see weatherByMunicipality in the parent component), NOT derived
        from modeled flood-risk data anymore. A municipality still
        loading (or whose fetch failed) simply renders no icon this pass,
        rather than a fake/placeholder condition.

        Gated on showLabels (not showShapes) deliberately — these render
        in BiliranMap's second pass, after the waterway overlay, not the
        first. Bundled with the shapes pass originally, the icons were
        getting covered by river lines running on top of them, reported
        directly. Same reasoning as labels: small graphical/text content
        that needs to stay readable on top of the waterway overlay, not
        buried under it like the land fills are meant to be.
      */}
      {showLabels && showWeatherIcons && (
        <>
          <WeatherIconStyles />
          {municipalities.features.map((f) => {
            const condition = weatherByMunicipality[f.properties.municipality]
            if (!condition) return null
            const [lon, lat] = geometryCentroid(f.geometry)
            const [cx, cy] = project(lon, lat)
            return (
              <g
                key={`weather-${f.properties.pgc_prefix}`}
                pointerEvents="none"
                opacity={fadeFor(f.properties.pgc_prefix)}
                style={{ transition: 'opacity 0.4s ease' }}
                transform={`translate(${cx - 21 * iconScale},${cy - iconOffsetY - 16 * iconScale}) scale(${iconScale})`}
              >
                <WeatherIconSVG condition={condition} />
              </g>
            )
          })}
        </>
      )}
      {showLabels && municipalities.features.map((f) => {
        const [lon, lat] = geometryCentroid(f.geometry)
        const projected = project(lon, lat)
        // Hard cutoff, not the same continuous fadeFor curve the shape/icon
        // above use — a municipality's own name label sitting at/near its
        // own barangay cluster's centroid (Culaba, most visibly) means a
        // slow cross-fade leaves both readable at once for a real stretch
        // of the zoom range, reported directly. The shape/icon are
        // colored-area-over-colored-area (no legibility issue, left as
        // fadeFor's smooth fade); this text snaps to 0 the instant
        // barangayOpacity rises above 0 for this municipality, and only
        // reappears once fully back at the island-overview framing —
        // never simultaneously visible with the barangay labels underneath.
        const isFocused = f.properties.pgc_prefix === nearestPrefix
        const labelOpacity = isFocused && barangayOpacity > 0 ? 0 : fadeFor(f.properties.pgc_prefix)
        return (
          <text
            key={`label-${f.properties.pgc_prefix}`}
            x={projected[0]}
            y={projected[1]}
            fontSize={0.006}
            fontWeight={600}
            textAnchor="middle"
            fill="#fff"
            filter="url(#bfw-text-shadow)"
            opacity={labelOpacity}
            style={{ pointerEvents: 'none', paintOrder: 'stroke', stroke: 'rgba(0,0,0,0.55)', strokeWidth: 0.0015, transition: 'opacity 0.4s ease' }}
          >
            {f.properties.municipality}
          </text>
        )
      })}
    </g>
  )
})

const BarangayLayer = memo(function BarangayLayer({
  brgyGeo,
  nearestPrefix,
  barangaysByKey,
  selectedKey,
  onSelect,
  showShapes = true,
  showLabels = true,
}: {
  // Raw collection + the current municipality prefix, rather than a
  // pre-filtered array — filtering happens inside this component's own
  // useMemo below (deliberately not done by the caller) so the result has
  // a stable identity across renders where nearestPrefix hasn't actually
  // changed. A hook call in the parent component can't do this safely
  // here (BiliranMap has conditional early returns above the point where
  // nearestPrefix becomes known, and hooks can't follow those), so this
  // needed to live in a component with no such early return instead.
  brgyGeo: GeoFeatureCollection<BrgyProps>
  nearestPrefix: string | null
  barangaysByKey: Map<string, Barangay>
  selectedKey: string | null
  onSelect: (key: string) => void
  // Same two-pass split as MunicipalityLayer's own showShapes/showLabels —
  // see its comment and the waterway <path>'s comment in BiliranMap below.
  showShapes?: boolean
  showLabels?: boolean
}) {
  const project = useMemo(() => makeProjector(11.58), [])
  const features = useMemo(
    () => (nearestPrefix ? brgyGeo.features.filter((f) => f.properties.pgc_prefix === nearestPrefix) : []),
    [brgyGeo, nearestPrefix]
  )
  // Only recomputed when `features` itself changes — i.e. when
  // nearestPrefix actually changes municipality, not on every drag frame
  // — the up-to-~24 path strings here don't depend on
  // selectedKey/barangaysByKey at all.
  const barangayPaths = useMemo(
    () => new Map(features.map((f) => [f.properties.key, geometryToPath(f.geometry, project)])),
    [features, project]
  )
  // Which barangays get a visible label — municipalities with many small,
  // tightly-packed barangays (Culaba: 34) rendered every label
  // unconditionally at a fixed size, which overlapped illegibly, reported
  // directly. No real DOM text measurement here (no extra render/measure
  // pass for up to ~48 labels per municipality switch) — an approximate
  // bounding box from character count is standard practice for SVG label
  // placement and only needs to be roughly right. Bigger barangays (by
  // their own polygon bounding-box area, via the already-imported
  // boundsOf) get label priority — they have the most room and are
  // arguably the most important to label — and a label that would overlap
  // an already-accepted one is skipped; its polygon stays exactly as
  // interactive/colored as always, only its <text> goes unlabeled.
  const labeledKeys = useMemo(() => {
    const LABEL_FONT_SIZE = 0.0032
    const CHAR_WIDTH_FACTOR = 0.62
    const LINE_HEIGHT_FACTOR = 1.4
    const PADDING_FACTOR = 1.15

    const candidates = features
      .map((f) => {
        const [lon, lat] = geometryCentroid(f.geometry)
        const [x, y] = project(lon, lat)
        const bounds = boundsOf([f], project)
        const area = (bounds.maxX - bounds.minX) * (bounds.maxY - bounds.minY)
        const halfWidth = (f.properties.barangay.length * LABEL_FONT_SIZE * CHAR_WIDTH_FACTOR * PADDING_FACTOR) / 2
        const halfHeight = (LABEL_FONT_SIZE * LINE_HEIGHT_FACTOR * PADDING_FACTOR) / 2
        return { key: f.properties.key, area, box: { minX: x - halfWidth, maxX: x + halfWidth, minY: y - halfHeight, maxY: y + halfHeight } }
      })
      .sort((a, b) => b.area - a.area)

    const accepted: typeof candidates = []
    const keys = new Set<string>()
    for (const candidate of candidates) {
      const overlaps = accepted.some(
        (a) =>
          candidate.box.minX < a.box.maxX &&
          candidate.box.maxX > a.box.minX &&
          candidate.box.minY < a.box.maxY &&
          candidate.box.maxY > a.box.minY
      )
      if (!overlaps) {
        accepted.push(candidate)
        keys.add(candidate.key)
      }
    }
    return keys
  }, [features, project])
  return (
    <g>
      {/* shapeRendering="optimizeSpeed" -- see MunicipalityLayer's own copy
          of this comment; applied here too for the same reason, even
          though profiling isolated the actual tap-lag report to
          MunicipalityLayer specifically (these shapes weren't the
          bottleneck) -- cheap and harmless to extend to this layer too. */}
      {showShapes && (
        <g className="bfw-shadow-group" filter="url(#bfw-land-shadow)" shapeRendering="optimizeSpeed">
          {features.map((f) => {
            const b = barangaysByKey.get(f.properties.key)
            const selected = f.properties.key === selectedKey
            const d = barangayPaths.get(f.properties.key)
            return (
              <g key={f.properties.key}>
                <path
                  className="bfw-map-poly"
                  d={d}
                  fill={b ? fsiScoreColor(b.mean_fsi_score) : '#7A8A99'}
                  fillOpacity={selected ? 1 : 0.88}
                  stroke={selected ? '#fff' : 'rgba(11, 30, 40, 0.3)'}
                  strokeWidth={selected ? 0.0014 : 0.0003}
                  onClick={() => onSelect(f.properties.key)}
                  style={{ cursor: 'pointer' }}
                >
                  <title>
                    {f.properties.barangay}
                    {b ? ` — ${b.dominant_fsi_label} (score ${b.mean_fsi_score.toFixed(2)})` : ''}
                  </title>
                </path>
                {/* Stronger than the island-overview sheen — these shapes render much larger zoomed in, so the same subtle version reads as flat */}
                <path d={d} fill="url(#bfw-land-sheen-strong)" pointerEvents="none" />
              </g>
            )
          })}
        </g>
      )}
      {showLabels && features.filter((f) => labeledKeys.has(f.properties.key)).map((f) => {
        const [lon, lat] = geometryCentroid(f.geometry)
        const [x, y] = project(lon, lat)
        return (
          <text
            key={`label-${f.properties.key}`}
            x={x}
            y={y}
            fontSize={0.0032}
            fontWeight={600}
            textAnchor="middle"
            fill="#fff"
            filter="url(#bfw-text-shadow)"
            style={{ pointerEvents: 'none', paintOrder: 'stroke', stroke: 'rgba(0,0,0,0.55)', strokeWidth: 0.0008 }}
          >
            {f.properties.barangay}
          </text>
        )
      })}
    </g>
  )
})

/**
 * Zoom slider + +/- buttons, driving the same view.scale as wheel-zoom and
 * tap-a-municipality — a dedicated, always-visible control for continuous
 * zoom, alongside (not replacing) the tap-to-zoom shortcut and the
 * top-left "back to all municipalities" reset button.
 *
 * memo-wrapped — scale is the one prop that legitimately changes during a
 * zoom gesture, but during a pure pan drag it doesn't, and this component
 * was re-rendering on every single pan frame anyway (BiliranMap's drag
 * handling calls setView() once per rAF tick). onChange only became a
 * stable reference once setScale above was converted to useCallback;
 * without that, memo here would have been a no-op (a fresh onChange
 * closure every render always fails the shallow prop comparison).
 */
const ZoomControls = memo(function ZoomControls({
  scale,
  maxScale,
  onChange,
  showSlider = true,
}: {
  scale: number
  maxScale: number
  onChange: (scale: number) => void
  showSlider?: boolean
}) {
  return (
    <div
      // Mobile-first: tighter gap/padding by default, growing at sm: —
      // extends the same pattern the slider below already used on its own
      // (w-16 -> sm:w-20) to the rest of this control's chrome, rather than
      // leaving the slider as the only responsive piece here. Button size
      // itself (h-6 w-6) is left alone at every width — already a small,
      // deliberately compact touch target, not something to shrink further.
      className="absolute bottom-3 right-3 flex items-center gap-1 rounded-full border px-2 py-1 shadow-lg ring-1 ring-white/10 backdrop-blur-md sm:gap-1.5 sm:px-2.5 sm:py-1.5"
      style={{ background: 'var(--card-bg)', borderColor: 'var(--card-border)', color: 'var(--text-strong)' }}
    >
      <button
        type="button"
        onClick={() => onChange(Math.max(1, scale / 1.35))}
        aria-label="Zoom out"
        className="bfw-btn flex h-6 w-6 items-center justify-center rounded-full text-sm font-bold leading-none"
      >
        −
      </button>
      {showSlider && (
        <input
          type="range"
          min={1}
          max={maxScale}
          step={0.01}
          value={scale}
          onChange={(e) => onChange(Number(e.target.value))}
          aria-label="Zoom level"
          className="h-1 w-12 accent-current sm:w-20"
        />
      )}
      <button
        type="button"
        onClick={() => onChange(Math.min(maxScale, scale * 1.35))}
        aria-label="Zoom in"
        className="bfw-btn flex h-6 w-6 items-center justify-center rounded-full text-sm font-bold leading-none"
      >
        +
      </button>
    </div>
  )
})

/**
 * Small countdown to the next live-forecast refresh (app/page.tsx's own
 * weather-fetch effect owns the actual 15-minute timer — this only
 * displays it). Bottom-left, below the full-size Legend (which is
 * vertically centered via top-1/2 — a fixed bottom-left anchor sits below
 * it in practice at this map's typical proportions, same "eyeballed
 * corner slot" approach as this file's other fixed-position overlays,
 * not a measured/computed offset), same glass-chip language, smaller/
 * quieter since it's a readout, not a control. Ticks via its own
 * re-render interval rather than recomputing the countdown from scratch
 * each parent render, so the text stays live even while nothing else on
 * the map changes.
 *
 * memo-wrapped — updateAt only changes once per forecast refresh (every
 * ~15 minutes), so without this it was re-rendering on every pan/zoom
 * frame from its parent for no reason; its own countdown still ticks via
 * the interval above regardless.
 */
const NextForecastBadge = memo(function NextForecastBadge({ updateAt }: { updateAt: number }) {
  const [now, setNow] = useState(() => Date.now())

  useEffect(() => {
    const interval = setInterval(() => setNow(Date.now()), 15 * 1000)
    return () => clearInterval(interval)
  }, [])

  const msLeft = updateAt - now
  const label =
    msLeft <= 0
      ? 'Refreshing forecast…'
      : `Next forecast update in ${Math.max(1, Math.round(msLeft / 60000))}m`

  return (
    <div
      className="absolute bottom-3 left-3 rounded-full border px-2.5 py-1 text-[10px] shadow-lg ring-1 ring-white/10 backdrop-blur-md"
      style={{ background: 'var(--card-bg)', borderColor: 'var(--card-border)', color: 'var(--text-soft)' }}
    >
      {label}
    </div>
  )
})

export function Legend({
  compact = false,
  size = 'lg',
}: {
  compact?: boolean
  // 'lg' (default, unchanged) is tuned for a map around this app's usual
  // ~280px+ heights (the Dashboard tab, BiliranMap.tsx's own two call
  // sites — neither passes this, so both stay byte-for-byte unaffected).
  // 'md' is a smaller labeled variant for StaticIslandMap.tsx's
  // medium-height uses (e.g. the Barangays tab's 220px map), where 'lg'
  // measured taller than the map itself. Distinct from `compact`
  // (dots-only, no labels at all) — this still shows text, just smaller.
  size?: 'lg' | 'md'
}) {
  const stops: [string, number][] = [
    ['Very Low', 0.1],
    ['Low', 0.3],
    ['Moderate', 0.5],
    ['High', 0.7],
    ['Very High', 0.9],
  ]

  // At ~50% map size (compact) the full text-labeled pill overflows and
  // reads as clutter — collapse to dots-only (still legible via title
  // tooltips) rather than shrinking text past reading size.
  if (compact) {
    return (
      <div
        className="absolute bottom-1.5 left-1.5 flex items-center gap-1 rounded-full border px-1.5 py-1 shadow-lg ring-1 ring-white/10 backdrop-blur-md"
        style={{ background: 'var(--card-bg)', borderColor: 'var(--card-border)' }}
      >
        {stops.map(([label, score]) => (
          <span
            key={label}
            className="inline-block h-1.5 w-1.5 rounded-full"
            style={{ background: fsiScoreColor(score), boxShadow: '0 1px 2px rgba(0,0,0,0.35)' }}
            title={label}
          />
        ))}
      </div>
    )
  }

  // A scaled-down version of the 'lg' variant below (same left-edge,
  // vertically-centered, labeled-column layout), not the dots-only
  // `compact` pill — StaticIslandMap.tsx's medium-height uses still want
  // real labels, just sized to actually fit inside a ~200-250px map
  // instead of overflowing taller than it.
  if (size === 'md') {
    return (
      <div
        className="absolute left-2 top-1/2 flex -translate-y-1/2 flex-col items-start gap-1.5 rounded-xl border px-3 py-2 text-xs shadow-lg ring-1 ring-white/10 backdrop-blur-md"
        style={{ background: 'var(--card-bg)', borderColor: 'var(--card-border)', color: 'var(--text-strong)' }}
      >
        {stops.map(([label, score]) => (
          <span key={label} className="flex items-center gap-1.5">
            <span
              className="inline-block h-3.5 w-3.5 shrink-0 rounded-full"
              style={{ background: fsiScoreColor(score), boxShadow: '0 1px 2px rgba(0,0,0,0.35)' }}
              aria-hidden
            />
            {label}
          </span>
        ))}
      </div>
    )
  }

  // Left edge, vertically centered (was bottom-left corner) — stacked in
  // a column rather than the old horizontal row, since a row at this
  // size wouldn't fit the map's width. Dots are ~400% of the old 8px
  // size; text is a smaller, deliberate bump (10px -> 14px, not a
  // literal 400-500%) so labels stay legible/proportionate next to the
  // map rather than dominating it. rounded-2xl (not rounded-full, unlike
  // the compact pill above) since a giant pill around a tall column of
  // varying-width rows reads oddly — a large rounded rectangle matches
  // this app's other enlarged card-style chrome instead.
  return (
    <div
      className="absolute left-3 top-1/2 flex -translate-y-1/2 flex-col items-start gap-4 rounded-2xl border px-5 py-4 text-sm shadow-lg ring-1 ring-white/10 backdrop-blur-md"
      style={{ background: 'var(--card-bg)', borderColor: 'var(--card-border)', color: 'var(--text-strong)' }}
    >
      {stops.map(([label, score]) => (
        <span key={label} className="flex items-center gap-3">
          <span
            className="inline-block h-8 w-8 shrink-0 rounded-full"
            style={{ background: fsiScoreColor(score), boxShadow: '0 1px 3px rgba(0,0,0,0.35)' }}
            aria-hidden
          />
          {label}
        </span>
      ))}
    </div>
  )
}

type Crossing = { barangay: Barangay; tier: 'Alert' | 'Danger'; hours: number } | null

interface WeatherCondition {
  label: string
  cloud: [string, string, string]
  dropColor: string
  dropCount: number
  duration: number
  // Open-Meteo's hourly chance-of-rain for the current hour, 0-100 —
  // shown alongside the icon purely as a readout. The modeled Alert/Danger
  // crossing below never consults this: that's computed entirely from the
  // static hydrograph/FSI pipeline ("if it rains, here's how risky it
  // is"), independent of any real forecast. Null while loading/unavailable.
  precipitationProbability: number | null
}

/**
 * Real weather now (Open-Meteo, via lib/liveWeather.ts's WeatherBucket) —
 * NOT derived from the modeled flood-risk crossing anymore. Reuses the
 * exact same cloud-color palettes/dropCount/duration values this app
 * already had per severity level, just re-keyed by real condition.
 */
function weatherConditionForBucket(bucket: WeatherBucket, precipitationProbability: number | null): WeatherCondition {
  switch (bucket) {
    case 'Heavy rain':
      return { label: 'Heavy rain', cloud: ['#71828E', '#5C6C77', '#47555F'], dropColor: '#0F5A91', dropCount: 4, duration: 0.65, precipitationProbability }
    case 'Rain':
      return { label: 'Rain', cloud: ['#8B9BA6', '#71828E', '#5C6C77'], dropColor: '#1B6FA8', dropCount: 3, duration: 1.1, precipitationProbability }
    case 'Light rain':
      return { label: 'Light rain', cloud: ['#A9B7C0', '#8B9BA6', '#71828E'], dropColor: '#2E86C1', dropCount: 2, duration: 1.6, precipitationProbability }
    case 'Calm':
    case 'Cloudy':
    default:
      return { label: bucket, cloud: ['#CBD5DC', '#AEBBC4', '#93A2AD'], dropColor: '#2E86C1', dropCount: 0, duration: 1.6, precipitationProbability }
  }
}

function dropX(count: number, index: number): number {
  const step = 18 / (count + 1)
  return 12 + step * (index + 1)
}

/**
 * Cloud + rain-drop shapes only — no wrapping <svg>/positioning — so it can
 * be reused both inside WeatherBadge's own small <svg> and, scaled way
 * down inside a <g transform>, at each municipality's centroid on the
 * overview map (see MunicipalityLayer).
 */
const WeatherIconSVG = memo(function WeatherIconSVG({ condition }: { condition: WeatherCondition }) {
  return (
    <>
      <g className="bfw-weather-cloud">
        <ellipse cx="15" cy="16" rx="10" ry="8" fill={condition.cloud[2]} stroke="rgba(11,30,40,0.25)" strokeWidth="0.75" />
        <ellipse cx="26" cy="13" rx="9" ry="7.5" fill={condition.cloud[1]} stroke="rgba(11,30,40,0.25)" strokeWidth="0.75" />
        <ellipse cx="10" cy="20" rx="7" ry="5.5" fill={condition.cloud[2]} stroke="rgba(11,30,40,0.2)" strokeWidth="0.6" />
        <ellipse cx="21" cy="19" rx="14" ry="7.5" fill={condition.cloud[0]} stroke="rgba(11,30,40,0.25)" strokeWidth="0.75" />
        {/* Soft top-left gloss for a puffier, more dimensional look, closer to a glossy weather-icon-sheet style */}
        <ellipse cx="19" cy="12" rx="8" ry="4" fill="#ffffff" opacity={0.22} />
      </g>
      {Array.from({ length: condition.dropCount }).map((_, i) => {
        const x = dropX(condition.dropCount, i)
        return (
          <line
            key={i}
            className="bfw-weather-drop"
            x1={x}
            y1={25}
            x2={x - 2}
            y2={31}
            stroke={condition.dropColor}
            strokeWidth={3}
            strokeLinecap="round"
            style={{
              animationDuration: `${condition.duration}s`,
              animationDelay: `${(i * condition.duration) / condition.dropCount}s`,
            }}
          />
        )
      })}
    </>
  )
})

/** Shared keyframes for WeatherIconSVG instances — cloud drift + rain-drop fall. */
function WeatherIconStyles() {
  return (
    <style>{`
      @keyframes bfw-cloud-drift { 0%, 100% { transform: translateX(0); } 50% { transform: translateX(1.5px); } }
      @keyframes bfw-drop-fall {
        0% { transform: translateY(-2px); opacity: 0; }
        25% { opacity: 1; }
        85% { opacity: 0; }
        100% { transform: translateY(8px); opacity: 0; }
      }
      .bfw-weather-cloud { animation: bfw-cloud-drift 4s ease-in-out infinite; }
      .bfw-weather-drop { animation-name: bfw-drop-fall; animation-timing-function: linear; animation-iteration-count: infinite; }
    `}</style>
  )
}

/**
 * Cloud/rain badge — now shows REAL current weather (Open-Meteo) for
 * whichever municipality the modeled Alert/Danger crossing below belongs
 * to, decoupled from that crossing's own severity (previously the same
 * scalar drove both the icon and the text — see CLAUDE.md for why they
 * were split). The tooltip is careful to name both signals separately so
 * neither implies the other.
 *
 * Shaped as a corner ribbon (clip-path right-trapezoid), not a rounded
 * pill, deliberately — a pill/chip reads as clickable, like the back
 * button next to it, but this is a passive readout. Flush to the
 * container's own top-right corner: the map card's `overflow-hidden` +
 * `rounded-xl` clips the ribbon's outer corner to match the card's curve
 * for free, so the ribbon itself needs no border-radius. A plain
 * border/box-shadow doesn't follow a clip-path'd box correctly, so depth
 * comes from `filter: drop-shadow(...)` instead.
 *
 * memo-wrapped — crossing is already a stable useMemo (mostUrgentCrossing)
 * and condition is a direct weatherByMunicipality[...] lookup (same object
 * reference until the next weather poll), so without this it was
 * re-rendering — including its mount-independent drop-shadow filter and
 * nested WeatherIconSVG — on every pan/zoom frame for no reason.
 */
const WeatherBadge = memo(function WeatherBadge({ crossing, condition }: { crossing: Crossing; condition: WeatherCondition | null }) {
  if (!condition) return null

  const chance = condition.precipitationProbability
  // Shown purely as a readout of the real forecast — the modeled
  // Alert/Danger countdown text never factors this in (it's computed
  // entirely from the static hydrograph/FSI pipeline: "if it rains, here's
  // how risky it is", regardless of whether it actually will), so the
  // title makes clear this chance is a separate, real-forecast number.
  const chanceText = chance !== null ? `${Math.round(chance)}% chance of rain` : null

  const title = crossing
    ? `${condition.label}${chanceText ? ` (${chanceText})` : ''} (real current weather) in ${crossing.barangay.municipality} — separately, ${crossing.barangay.barangay} reaches ${crossing.tier} at ${formatHoursAsCountdown(crossing.hours)} into the modeled storm`
    : `${condition.label}${chanceText ? ` (${chanceText})` : ''} (real current weather) — no modeled crossings in range`

  return (
    <div
      // Mobile-first sizing, same reasoning as ZoomControls above — tighter
      // padding by default, growing at sm:. Upper-center, not flush against
      // an edge, so the clip-path below is a symmetric trapezoid (both
      // bottom corners taper inward) rather than the old flush-right shape
      // (only the bottom-left corner tapered). Shorter/wider ribbon by
      // direct request — reduced vertical padding, increased horizontal
      // padding, with the clip-path's taper scaled down to match the
      // shorter height (the old 24px diagonal looked proportionate at the
      // old ~48px height; unscaled it would read too steep on this flatter
      // shape) and the icon shrunk slightly to fit the tighter vertical space.
      className="absolute left-1/2 top-0 flex -translate-x-1/2 items-center gap-1.5 py-1 pl-9 pr-9 backdrop-blur-md sm:gap-2 sm:py-1.5 sm:pl-11 sm:pr-11"
      style={{
        background: 'var(--card-bg)',
        clipPath: 'polygon(0 0, 100% 0, calc(100% - 14px) 100%, 14px 100%)',
        filter: 'drop-shadow(0 3px 5px rgba(11,30,40,0.35))',
      }}
      title={title}
    >
      <WeatherIconStyles />
      <svg className="h-5 w-6 sm:h-6 sm:w-7" viewBox="0 0 44 36" aria-hidden>
        <WeatherIconSVG condition={condition} />
      </svg>
      <span className="flex flex-col leading-tight">
        <span className="text-xs font-semibold" style={{ color: 'var(--text-strong)' }}>
          {condition.label}
        </span>
        {chance !== null && (
          <span className="text-[10px] font-medium" style={{ color: 'var(--text-soft)' }}>
            {Math.round(chance)}% rain
          </span>
        )}
      </span>
    </div>
  )
})
