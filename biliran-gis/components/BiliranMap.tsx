// components/BiliranMap.tsx
//
// Real interactive map: actual barangay/municipality polygons (projected
// from public/data/geo/*.geojson — derived from this project's own
// barangay_biliran.geojson, see CLAUDE.md) rendered as SVG paths. No map
// tile service involved. Default view is the whole island, unzoomed —
// tapping a municipality zooms into it and reveals its barangay polygons;
// tapping a barangay selects it. Maripipi has no polygon data here, so it's
// shown as a plain "unmonitored" marker, per the project's documented
// exclusion from monitoring.

'use client'

import { useEffect, useMemo, useRef, useState } from 'react'
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

// Max zoom: close enough to comfortably read barangay labels on the
// smallest municipalities without a hard-coded per-municipality lookup.
const MAX_SCALE = 9

export default function BiliranMap({
  barangays,
  selectedKey,
  onSelect,
  showChrome = true,
  focusedMunicipality = null,
  onFocusMunicipality,
}: {
  barangays: Barangay[]
  selectedKey: string | null
  onSelect: (barangay: Barangay) => void
  // False while this map is the full-bleed login backdrop (see
  // app/page.tsx) — hides overlays that only make sense once there's a
  // dashboard around them (the zoom slider, the Maripipi marker, the
  // weather ribbon), leaving a cleaner decorative background. The -/+
  // zoom buttons, legend, and ambient motion still show either way.
  showChrome?: boolean
  // Two-way sync with the dashboard's municipality filter (a municipality
  // *name*, not a pgc_prefix) — mirrors selectedKey/onSelect's existing
  // barangay sync. Picking a municipality elsewhere (the dropdown) moves
  // the map; tapping a municipality on the map calls onFocusMunicipality
  // so the dropdown follows. null means "all municipalities" / full island.
  focusedMunicipality?: string | null
  onFocusMunicipality?: (name: string | null) => void
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
  const [maripipiNote, setMaripipiNote] = useState(false)

  const containerRef = useRef<HTMLDivElement>(null)
  const svgRef = useRef<SVGSVGElement>(null)
  const dragRef = useRef<{ pointerId: number; startClientX: number; startClientY: number; startView: View; capturing: boolean } | null>(null)
  const wheelTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null)

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
      const zoomFactor = Math.exp(-e.deltaY * 0.0015)

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

  // Drives the weather badge's condition — the same underlying signal as
  // the LIVE UPDATE banner above the map, not a separate/fabricated one.
  const urgentCrossing = useMemo(() => mostUrgentCrossing(barangays), [barangays])

  function clampView(next: View, bounds: Bounds): View {
    const scale = Math.min(MAX_SCALE, Math.max(1, next.scale))
    const [cx, cy] = clampCenter([next.cx, next.cy], bounds, 0.15)
    return { cx, cy, scale }
  }

  function focusBarangay(feature: GeoFeature<BrgyProps>, bounds: Bounds) {
    const b = expandBounds(boundsOf([feature], project), 0.35)
    const islandW = bounds.maxX - bounds.minX
    const islandH = bounds.maxY - bounds.minY
    const scale = Math.min(islandW / (b.maxX - b.minX), islandH / (b.maxY - b.minY))
    setInteracting(false)
    setView(clampView({ cx: (b.minX + b.maxX) / 2, cy: (b.minY + b.maxY) / 2, scale }, bounds))
  }

  // Shared by the post-guard focusMuni (fired by an actual map tap) and the
  // sync block below (fired by focusedMunicipality changing from elsewhere,
  // e.g. the dashboard's municipality filter) — both just need a prefix +
  // the current island bounds to move the view, neither needs anything
  // that's only available after the loading guard.
  function applyMuniFocus(prefix: string, bounds: Bounds) {
    const focus = muniFocusByPrefix[prefix]
    if (!focus) return
    setInteracting(false)
    setView(clampView(focus, bounds))
  }

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
  const muniFillScale = nearestPrefix ? muniFocusByPrefix[nearestPrefix].scale : 3
  const lowThreshold = muniFillScale * 0.55
  const highThreshold = muniFillScale * 0.85
  const barangayOpacity = Math.min(1, Math.max(0, (currentView.scale - lowThreshold) / (highThreshold - lowThreshold)))
  const isZoomed = currentView.scale > 1.02

  const tx = islandCx - currentView.scale * currentView.cx
  const ty = islandCy - currentView.scale * currentView.cy
  const transform = `translate(${tx},${ty}) scale(${currentView.scale})`

  function focusMuni(prefix: string) {
    if (!islandBounds) return
    applyMuniFocus(prefix, islandBounds)
    onFocusMunicipality?.(municipalityForPrefix(prefix))
  }

  function resetView() {
    setInteracting(false)
    setView({ cx: islandCx, cy: islandCy, scale: 1 })
    onFocusMunicipality?.(null)
  }

  function setScale(newScale: number) {
    if (!islandBounds) return
    setInteracting(false)
    setView(clampView({ cx: currentView.cx, cy: currentView.cy, scale: newScale }, islandBounds))
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

    const [startX, startY] = clientPointToSvgSpace(svgRef.current, drag.startClientX, drag.startClientY)
    const [curX, curY] = clientPointToSvgSpace(svgRef.current, e.clientX, e.clientY)
    const deltaX = curX - startX
    const deltaY = curY - startY
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

  function endDrag(e: React.PointerEvent<SVGSVGElement>) {
    if (dragRef.current?.pointerId === e.pointerId) {
      dragRef.current = null
      setInteracting(false)
    }
  }

  const [mLon, mLat] = project(MARIPIPI.lon, MARIPIPI.lat)

  return (
    <div
      ref={containerRef}
      className="relative h-full w-full overflow-hidden rounded-xl border shadow-xl ring-1 ring-white/10"
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
            Puffier cloud lobes (DriftingClouds, WeatherIconSVG) use this
            instead of a flat fill — a soft off-center highlight plus a
            dimmer rim gives each lobe volume instead of reading as a flat
            gray/white blob. Purely a styling gradient, not tied to any data.
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
        {currentView.scale < 1.3 && <DriftingClouds bounds={islandBounds} />}

        <g
          className="bfw-zoom-group"
          transform={transform}
          style={{ transition: interacting ? 'none' : 'transform 0.7s cubic-bezier(0.22,1,0.36,1)' }}
        >
          {/*
            Waterways — subtle context at the island overview, turned up
            continuously as barangayOpacity rises (i.e. as the view nears
            barangay-reading zoom), rather than a hard on/off switch.
          */}
          <g
            opacity={0.35 + barangayOpacity * 0.3}
            stroke="#7EC8D9"
            strokeWidth={0.0006 + barangayOpacity * 0.0003}
            fill="none"
          >
            {waterways.features.map((f, i) => (
              <path key={i} d={lineGeometryToPath(f.geometry, project)} />
            ))}
          </g>

          {/* dimmed context outlines of the rest of the island, fading in as barangayOpacity rises */}
          <g opacity={0.12 * barangayOpacity} pointerEvents="none">
            {municipalities.features.map((f) => (
              <path
                key={f.properties.pgc_prefix}
                d={geometryToPath(f.geometry, project)}
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
          */}
          <MunicipalityLayer
            municipalities={municipalities}
            barangays={barangays}
            onSelect={focusMuni}
            nearestPrefix={nearestPrefix}
            barangayOpacity={barangayOpacity}
          />
          <g
            style={{ opacity: barangayOpacity, transition: 'opacity 0.4s ease' }}
            pointerEvents={barangayOpacity > 0.5 ? 'auto' : 'none'}
          >
            <BarangayLayer
              features={nearestPrefix ? brgyGeo.features.filter((f) => f.properties.pgc_prefix === nearestPrefix) : []}
              barangaysByKey={barangaysByKey}
              selectedKey={selectedKey}
              onSelect={(key) => {
                const b = barangaysByKey.get(key)
                if (b) onSelect(b)
              }}
            />
          </g>

          {/* Maripipi — no polygon data, shown as a marker only */}
          {showChrome && (
            <g
              transform={`translate(${mLon},${mLat})`}
              onClick={() => setMaripipiNote(true)}
              style={{ cursor: 'pointer' }}
            >
              <circle r={0.0045} fill="#7A8A99" stroke="#fff" strokeWidth={0.0008} opacity={0.85} filter="url(#bfw-land-shadow)" />
            </g>
          )}
        </g>
      </svg>

      {isZoomed && (
        <button
          type="button"
          onClick={resetView}
          className="absolute left-3 top-3 rounded-full border px-3 py-1.5 text-xs font-medium shadow-lg ring-1 ring-white/10 backdrop-blur-md"
          style={{ background: 'var(--card-bg)', borderColor: 'var(--card-border)', color: 'var(--text-strong)' }}
        >
          ← All municipalities
        </button>
      )}

      <ZoomControls scale={currentView.scale} maxScale={MAX_SCALE} onChange={setScale} showSlider={showChrome} />

      {showChrome && <WeatherBadge crossing={urgentCrossing} />}
      <Legend />

      {maripipiNote && (
        <div
          className="absolute inset-0 flex items-center justify-center bg-black/30"
          onClick={() => setMaripipiNote(false)}
        >
          <div
            className="rounded-xl border px-4 py-3 text-sm shadow-lg"
            style={{ background: 'var(--card-bg)', borderColor: 'var(--card-border)', color: 'var(--text-strong)' }}
          >
            Maripipi is not monitored by this system (resource constraints) — no flood data is modeled for it.
          </div>
        </div>
      )}
    </div>
  )
}

/**
 * Purely decorative, ambient clouds drifting across the whole-island view
 * — not per-municipality data (see MunicipalityLayer for that). Island
 * overview only; showing these over a zoomed single-municipality view
 * would add motion right where the user is trying to read barangay-level
 * detail. Travel distance is computed from the real island bounds (baked
 * directly into the keyframe, not a CSS custom property) so it scales
 * with the actual map extent rather than a guessed pixel value.
 */
function DriftingClouds({ bounds }: { bounds: Bounds }) {
  const width = bounds.maxX - bounds.minX
  const height = bounds.maxY - bounds.minY
  const travel = width * 1.3
  const cx = bounds.minX + width / 2

  return (
    <g pointerEvents="none">
      <style>{`
        @keyframes bfw-cloud-cross {
          from { transform: translateX(${-travel}px); }
          to { transform: translateX(${travel}px); }
        }
      `}</style>
      <g style={{ animation: 'bfw-cloud-cross 65s linear infinite' }}>
        <g transform={`translate(${cx},${bounds.minY + height * 0.16}) scale(${width * 0.09})`} opacity={0.26}>
          <ellipse cx="-0.6" cy="0.08" rx="0.9" ry="0.55" fill="#B9C7CE" opacity={0.5} />
          <ellipse cx="0.9" cy="0.22" rx="1.1" ry="0.55" fill="url(#bfw-cloud-body)" />
          <ellipse cx="-0.65" cy="-0.05" rx="0.75" ry="0.48" fill="url(#bfw-cloud-body)" />
          <ellipse cx="0.3" cy="-0.3" rx="0.8" ry="0.5" fill="url(#bfw-cloud-body)" />
          <ellipse cx="1.35" cy="0.1" rx="0.6" ry="0.4" fill="url(#bfw-cloud-body)" />
          <ellipse cx="0.05" cy="0.05" rx="1.05" ry="0.42" fill="url(#bfw-cloud-body)" />
        </g>
      </g>
      <g style={{ animation: 'bfw-cloud-cross 82s linear infinite', animationDelay: '-35s' }}>
        <g transform={`translate(${cx},${bounds.minY + height * 0.34}) scale(${width * 0.065})`} opacity={0.2}>
          <ellipse cx="-0.5" cy="0.06" rx="0.75" ry="0.45" fill="#B9C7CE" opacity={0.5} />
          <ellipse cx="0.85" cy="0.18" rx="0.9" ry="0.45" fill="url(#bfw-cloud-body)" />
          <ellipse cx="-0.55" cy="-0.04" rx="0.6" ry="0.38" fill="url(#bfw-cloud-body)" />
          <ellipse cx="0.35" cy="-0.24" rx="0.65" ry="0.4" fill="url(#bfw-cloud-body)" />
          <ellipse cx="0.05" cy="0.04" rx="0.85" ry="0.34" fill="url(#bfw-cloud-body)" />
        </g>
      </g>
    </g>
  )
}

function MunicipalityLayer({
  municipalities,
  barangays,
  onSelect,
  nearestPrefix,
  barangayOpacity,
}: {
  municipalities: GeoFeatureCollection<MuniProps>
  barangays: Barangay[]
  onSelect: (prefix: string) => void
  // Only the municipality the current view is nearest to fades out (as
  // barangayOpacity rises toward its own barangay-level detail taking
  // over) — every other municipality stays fully visible AND clickable
  // regardless of zoom, so tapping a different one works at any zoom
  // level, not just from the full-island overview.
  nearestPrefix: string | null
  barangayOpacity: number
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
      <g filter="url(#bfw-land-shadow)">
        {municipalities.features.map((f) => {
          const score = municipalityWorstScore(barangays, f.properties.municipality)
          const d = geometryToPath(f.geometry, project)
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
      {/*
        Each municipality gets its own weather icon, not just the one
        global corner ribbon — condition is that municipality's own
        mostUrgentCrossing() (its barangays only), the exact same function
        the ribbon and the LIVE UPDATE banner already use, just pre-filtered.
      */}
      <WeatherIconStyles />
      {municipalities.features.map((f) => {
        const muniBarangays = barangays.filter((b) => b.municipality === f.properties.municipality)
        const condition = weatherConditionFor(mostUrgentCrossing(muniBarangays))
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
      {municipalities.features.map((f) => {
        const [lon, lat] = geometryCentroid(f.geometry)
        const projected = project(lon, lat)
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
            opacity={fadeFor(f.properties.pgc_prefix)}
            style={{ pointerEvents: 'none', paintOrder: 'stroke', stroke: 'rgba(0,0,0,0.55)', strokeWidth: 0.0015, transition: 'opacity 0.4s ease' }}
          >
            {f.properties.municipality}
          </text>
        )
      })}
    </g>
  )
}

function BarangayLayer({
  features,
  barangaysByKey,
  selectedKey,
  onSelect,
}: {
  features: GeoFeature<BrgyProps>[]
  barangaysByKey: Map<string, Barangay>
  selectedKey: string | null
  onSelect: (key: string) => void
}) {
  const project = useMemo(() => makeProjector(11.58), [])
  return (
    <g>
      <g filter="url(#bfw-land-shadow)">
        {features.map((f) => {
          const b = barangaysByKey.get(f.properties.key)
          const selected = f.properties.key === selectedKey
          const d = geometryToPath(f.geometry, project)
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
      {features.map((f) => {
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
}

/**
 * Zoom slider + +/- buttons, driving the same view.scale as wheel-zoom and
 * tap-a-municipality — a dedicated, always-visible control for continuous
 * zoom, alongside (not replacing) the tap-to-zoom shortcut and the
 * top-left "back to all municipalities" reset button.
 */
function ZoomControls({
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
      className="absolute bottom-3 right-3 flex items-center gap-1.5 rounded-full border px-2.5 py-1.5 shadow-lg ring-1 ring-white/10 backdrop-blur-md"
      style={{ background: 'var(--card-bg)', borderColor: 'var(--card-border)', color: 'var(--text-strong)' }}
    >
      <button
        type="button"
        onClick={() => onChange(Math.max(1, scale / 1.35))}
        aria-label="Zoom out"
        className="flex h-6 w-6 items-center justify-center rounded-full text-sm font-bold leading-none"
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
          className="h-1 w-16 accent-current sm:w-20"
        />
      )}
      <button
        type="button"
        onClick={() => onChange(Math.min(maxScale, scale * 1.35))}
        aria-label="Zoom in"
        className="flex h-6 w-6 items-center justify-center rounded-full text-sm font-bold leading-none"
      >
        +
      </button>
    </div>
  )
}

function Legend() {
  const stops: [string, number][] = [
    ['Very Low', 0.1],
    ['Low', 0.3],
    ['Moderate', 0.5],
    ['High', 0.7],
    ['Very High', 0.9],
  ]
  return (
    <div
      className="absolute bottom-3 left-3 flex items-center gap-2 rounded-full border px-3 py-1.5 text-[10px] shadow-lg ring-1 ring-white/10 backdrop-blur-md"
      style={{ background: 'var(--card-bg)', borderColor: 'var(--card-border)', color: 'var(--text-strong)' }}
    >
      {stops.map(([label, score]) => (
        <span key={label} className="flex items-center gap-1">
          <span
            className="inline-block h-2 w-2 rounded-full"
            style={{ background: fsiScoreColor(score), boxShadow: '0 1px 2px rgba(0,0,0,0.35)' }}
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
}

/**
 * Same underlying signal as the LIVE UPDATE banner above the map (the
 * single most urgent upcoming Alert/Danger crossing, from mostUrgentCrossing
 * in lib/dashboardData.ts) — not a separately fabricated "weather" value.
 * Still a modeled-storm scalar, not a live feed; the icon reflects how
 * close that one number is, nothing more.
 */
function weatherConditionFor(crossing: Crossing): WeatherCondition {
  // Darker/more saturated at every tier than the first pass — the pale
  // near-white grays used before blended straight into the light theme's
  // near-white --card-bg and were effectively invisible at a glance.
  if (!crossing) {
    return { label: 'Calm', cloud: ['#CBD5DC', '#AEBBC4', '#93A2AD'], dropColor: '#2E86C1', dropCount: 0, duration: 1.6 }
  }
  if (crossing.tier === 'Danger') {
    return { label: 'Heavy rain', cloud: ['#71828E', '#5C6C77', '#47555F'], dropColor: '#0F5A91', dropCount: 4, duration: 0.65 }
  }
  if (crossing.hours < 0.5) {
    return { label: 'Rain', cloud: ['#8B9BA6', '#71828E', '#5C6C77'], dropColor: '#1B6FA8', dropCount: 3, duration: 1.1 }
  }
  if (crossing.hours < 1) {
    return { label: 'Light rain', cloud: ['#A9B7C0', '#8B9BA6', '#71828E'], dropColor: '#2E86C1', dropCount: 2, duration: 1.6 }
  }
  return { label: 'Cloudy', cloud: ['#CBD5DC', '#AEBBC4', '#93A2AD'], dropColor: '#2E86C1', dropCount: 0, duration: 1.6 }
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
function WeatherIconSVG({ condition }: { condition: WeatherCondition }) {
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
}

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
 * Cloud/rain badge whose condition tracks the same signal as the LIVE
 * UPDATE banner — not a separate or fabricated weather feed. Still a
 * modeled-storm scalar, not live rainfall; see the banner above the map
 * for that distinction in words.
 *
 * Shaped as a corner ribbon (clip-path right-trapezoid), not a rounded
 * pill, deliberately — a pill/chip reads as clickable, like the back
 * button next to it, but this is a passive readout. Flush to the
 * container's own top-right corner: the map card's `overflow-hidden` +
 * `rounded-xl` clips the ribbon's outer corner to match the card's curve
 * for free, so the ribbon itself needs no border-radius. A plain
 * border/box-shadow doesn't follow a clip-path'd box correctly, so depth
 * comes from `filter: drop-shadow(...)` instead.
 */
function WeatherBadge({ crossing }: { crossing: Crossing }) {
  const condition = weatherConditionFor(crossing)
  const title = crossing
    ? `${condition.label} — ${crossing.barangay.barangay} (${crossing.barangay.municipality}) reaches ${crossing.tier} at ${formatHoursAsCountdown(crossing.hours)} into the modeled storm`
    : 'No modeled crossings in range'

  return (
    <div
      className="absolute right-0 top-0 flex items-center gap-2 py-2.5 pl-8 pr-4 backdrop-blur-md"
      style={{
        background: 'var(--card-bg)',
        clipPath: 'polygon(0 0, 100% 0, 100% 100%, 24px 100%)',
        filter: 'drop-shadow(0 3px 5px rgba(11,30,40,0.35))',
      }}
      title={title}
    >
      <WeatherIconStyles />
      <svg width="34" height="28" viewBox="0 0 44 36" aria-hidden>
        <WeatherIconSVG condition={condition} />
      </svg>
      <span className="text-xs font-semibold" style={{ color: 'var(--text-strong)' }}>
        {condition.label}
      </span>
    </div>
  )
}
