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

import { useEffect, useMemo, useState } from 'react'
import {
  boundsOf,
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
import { MARIPIPI } from '@/lib/municipalities'

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

export default function BiliranMap({
  barangays,
  selectedKey,
  onSelect,
}: {
  barangays: Barangay[]
  selectedKey: string | null
  onSelect: (barangay: Barangay) => void
}) {
  const [municipalities, setMunicipalities] = useState<GeoFeatureCollection<MuniProps> | null>(null)
  const [brgyGeo, setBrgyGeo] = useState<GeoFeatureCollection<BrgyProps> | null>(null)
  const [waterways, setWaterways] = useState<LineFeatureCollection | null>(null)
  const [loadError, setLoadError] = useState<string | null>(null)
  const [focusedMuni, setFocusedMuni] = useState<string | null>(null)
  const [maripipiNote, setMaripipiNote] = useState(false)

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

  // Keep the map in sync when a barangay is selected from elsewhere (e.g. the
  // list): adjust state during render off a previous-value comparison,
  // rather than in an effect, per https://react.dev/learn/you-might-not-need-an-effect.
  const [prevSelectedKey, setPrevSelectedKey] = useState<string | null | undefined>(undefined)
  if (selectedKey !== prevSelectedKey && brgyGeo) {
    setPrevSelectedKey(selectedKey)
    const feature = selectedKey ? brgyGeo.features.find((f) => f.properties.key === selectedKey) : null
    if (feature && feature.properties.pgc_prefix !== focusedMuni) {
      setFocusedMuni(feature.properties.pgc_prefix)
    }
  }

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

  const muniBoundsByPrefix = useMemo(() => {
    if (!municipalities) return {}
    const map: Record<string, Bounds> = {}
    for (const f of municipalities.features) {
      map[f.properties.pgc_prefix] = expandBounds(boundsOf([f], project), 0.07)
    }
    return map
  }, [municipalities, project])

  const barangaysByKey = useMemo(() => {
    const map = new Map<string, Barangay>()
    for (const b of barangays) map.set(b.key, b)
    return map
  }, [barangays])

  // Drives the weather badge's condition — the same underlying signal as
  // the LIVE UPDATE banner above the map, not a separate/fabricated one.
  const urgentCrossing = useMemo(() => mostUrgentCrossing(barangays), [barangays])

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

  // Zoom is a CSS transform on a <g>, computed against the fixed island viewBox,
  // rather than animating viewBox itself (which CSS can't transition smoothly).
  const islandCx = (islandBounds.minX + islandBounds.maxX) / 2
  const islandCy = (islandBounds.minY + islandBounds.maxY) / 2

  let transform = 'translate(0,0) scale(1)'
  if (focusedMuni && muniBoundsByPrefix[focusedMuni]) {
    const target = muniBoundsByPrefix[focusedMuni]
    const scale = Math.min(
      (islandBounds.maxX - islandBounds.minX) / (target.maxX - target.minX),
      (islandBounds.maxY - islandBounds.minY) / (target.maxY - target.minY)
    )
    const tcx = (target.minX + target.maxX) / 2
    const tcy = (target.minY + target.maxY) / 2
    const tx = islandCx - scale * tcx
    const ty = islandCy - scale * tcy
    transform = `translate(${tx},${ty}) scale(${scale})`
  }

  const [mLon, mLat] = project(MARIPIPI.lon, MARIPIPI.lat)

  return (
    <div
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
        viewBox={viewBoxOf(islandBounds)}
        className="h-full w-full"
        style={{ background: 'linear-gradient(155deg, var(--sea-top), var(--sea-bottom) 70%)' }}
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
        {focusedMuni === null && <DriftingClouds bounds={islandBounds} />}

        <g transform={transform} style={{ transition: 'transform 0.7s cubic-bezier(0.22,1,0.36,1)' }}>
          {/*
            Waterways — subtle context at the island overview, turned up
            once zoomed into a municipality where there's room for them to
            read clearly without cluttering the whole-island view.
          */}
          <g
            opacity={focusedMuni ? 0.65 : 0.35}
            stroke="#7EC8D9"
            strokeWidth={focusedMuni ? 0.0009 : 0.0006}
            fill="none"
            style={{ transition: 'opacity 0.4s ease, stroke-width 0.4s ease' }}
          >
            {waterways.features.map((f, i) => (
              <path key={i} d={lineGeometryToPath(f.geometry, project)} />
            ))}
          </g>

          {focusedMuni === null ? (
            <MunicipalityLayer
              municipalities={municipalities}
              barangays={barangays}
              onSelect={(prefix) => setFocusedMuni(prefix)}
            />
          ) : (
            <>
              {/* dimmed context outlines of the rest of the island */}
              <g opacity={0.12}>
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
              <BarangayLayer
                features={brgyGeo.features.filter((f) => f.properties.pgc_prefix === focusedMuni)}
                barangaysByKey={barangaysByKey}
                selectedKey={selectedKey}
                onSelect={(key) => {
                  const b = barangaysByKey.get(key)
                  if (b) onSelect(b)
                }}
              />
            </>
          )}

          {/* Maripipi — no polygon data, shown as a marker only */}
          <g
            transform={`translate(${mLon},${mLat})`}
            onClick={() => setMaripipiNote(true)}
            style={{ cursor: 'pointer' }}
          >
            <circle r={0.0045} fill="#7A8A99" stroke="#fff" strokeWidth={0.0008} opacity={0.85} filter="url(#bfw-land-shadow)" />
          </g>
        </g>
      </svg>

      {focusedMuni && (
        <button
          type="button"
          onClick={() => setFocusedMuni(null)}
          className="absolute left-3 top-3 rounded-full border px-3 py-1.5 text-xs font-medium shadow-lg ring-1 ring-white/10 backdrop-blur-md"
          style={{ background: 'var(--card-bg)', borderColor: 'var(--card-border)', color: 'var(--text-strong)' }}
        >
          ← All municipalities
        </button>
      )}

      <WeatherBadge crossing={urgentCrossing} />
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
        <g transform={`translate(${cx},${bounds.minY + height * 0.16}) scale(${width * 0.09})`} opacity={0.22} fill="#fff">
          <ellipse cx="-0.6" cy="0" rx="0.9" ry="0.55" />
          <ellipse cx="0.3" cy="-0.25" rx="0.8" ry="0.5" />
          <ellipse cx="0.9" cy="0.15" rx="1.1" ry="0.55" />
        </g>
      </g>
      <g style={{ animation: 'bfw-cloud-cross 82s linear infinite', animationDelay: '-35s' }}>
        <g transform={`translate(${cx},${bounds.minY + height * 0.34}) scale(${width * 0.065})`} opacity={0.16} fill="#fff">
          <ellipse cx="-0.5" cy="0" rx="0.75" ry="0.45" />
          <ellipse cx="0.35" cy="-0.2" rx="0.65" ry="0.4" />
          <ellipse cx="0.85" cy="0.1" rx="0.9" ry="0.45" />
        </g>
      </g>
    </g>
  )
}

function MunicipalityLayer({
  municipalities,
  barangays,
  onSelect,
}: {
  municipalities: GeoFeatureCollection<MuniProps>
  barangays: Barangay[]
  onSelect: (prefix: string) => void
}) {
  const project = useMemo(() => makeProjector(11.58), [])
  const bounds = useMemo(() => boundsOf(municipalities.features, project), [municipalities, project])
  // Small enough to sit above a municipality's name label without dominating it.
  const iconScale = (bounds.maxX - bounds.minX) * 0.0019
  const iconOffsetY = (bounds.maxY - bounds.minY) * 0.06
  return (
    <g>
      <g filter="url(#bfw-land-shadow)">
        {municipalities.features.map((f) => {
          const score = municipalityWorstScore(barangays, f.properties.municipality)
          const d = geometryToPath(f.geometry, project)
          return (
            <g key={f.properties.pgc_prefix}>
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
            style={{ pointerEvents: 'none', paintOrder: 'stroke', stroke: 'rgba(0,0,0,0.55)', strokeWidth: 0.0015 }}
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
        <ellipse cx="21" cy="19" rx="14" ry="7.5" fill={condition.cloud[0]} stroke="rgba(11,30,40,0.25)" strokeWidth="0.75" />
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
        clipPath: 'polygon(24px 0, 100% 0, 100% 100%, 0 100%)',
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
