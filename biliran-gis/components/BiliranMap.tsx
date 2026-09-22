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
import { fsiScoreColor, municipalityWorstScore, type Barangay } from '@/lib/dashboardData'
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
          <linearGradient id="bfw-land-sheen" x1="0" y1="0" x2="1" y2="1">
            <stop offset="0%" stopColor="#ffffff" stopOpacity="0.28" />
            <stop offset="45%" stopColor="#ffffff" stopOpacity="0.04" />
            <stop offset="100%" stopColor="#000000" stopOpacity="0.12" />
          </linearGradient>
          <radialGradient id="bfw-sea-glow" cx="35%" cy="25%" r="75%">
            <stop offset="0%" stopColor="#ffffff" stopOpacity="0.16" />
            <stop offset="55%" stopColor="#ffffff" stopOpacity="0" />
          </radialGradient>
        </defs>

        {/* Atmospheric sea highlight, fixed (not zoomed) so it always reads as lighting, not geography */}
        <rect x={islandBounds.minX} y={islandBounds.minY} width={islandBounds.maxX - islandBounds.minX} height={islandBounds.maxY - islandBounds.minY} fill="url(#bfw-sea-glow)" pointerEvents="none" />

        <g transform={transform} style={{ transition: 'transform 0.7s cubic-bezier(0.22,1,0.36,1)' }}>
          {/* Waterways, subtle context layer */}
          <g opacity={0.35} stroke="#7EC8D9" strokeWidth={0.0006} fill="none">
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
          className="absolute left-3 top-3 rounded-full border px-3 py-1.5 text-xs font-medium shadow backdrop-blur-md"
          style={{ background: 'var(--card-bg)', borderColor: 'var(--card-border)', color: 'var(--text-strong)' }}
        >
          ← All municipalities
        </button>
      )}

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
      {municipalities.features.map((f) => {
        const [lon, lat] = geometryCentroid(f.geometry)
        const projected = project(lon, lat)
        return (
          <text
            key={`label-${f.properties.pgc_prefix}`}
            x={projected[0]}
            y={projected[1]}
            fontSize={0.006}
            textAnchor="middle"
            fill="#fff"
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
              stroke={selected ? '#fff' : 'var(--card-bg)'}
              strokeWidth={selected ? 0.0014 : 0.0005}
              onClick={() => onSelect(f.properties.key)}
              style={{ cursor: 'pointer' }}
            >
              <title>
                {f.properties.barangay}
                {b ? ` — ${b.dominant_fsi_label} (score ${b.mean_fsi_score.toFixed(2)})` : ''}
              </title>
            </path>
            <path d={d} fill="url(#bfw-land-sheen)" pointerEvents="none" />
          </g>
        )
      })}
    </g>
  )
}

function Legend() {
  const stops: [string, number][] = [
    ['Low', 0.1],
    ['Moderate', 0.4],
    ['High', 0.65],
    ['Very High', 0.9],
  ]
  return (
    <div
      className="absolute bottom-3 left-3 flex items-center gap-2 rounded-full border px-3 py-1.5 text-[10px] shadow backdrop-blur-md"
      style={{ background: 'var(--card-bg)', borderColor: 'var(--card-border)', color: 'var(--text-strong)' }}
    >
      {stops.map(([label, score]) => (
        <span key={label} className="flex items-center gap-1">
          <span
            className="inline-block h-2 w-2 rounded-full"
            style={{ background: fsiScoreColor(score) }}
            aria-hidden
          />
          {label}
        </span>
      ))}
    </div>
  )
}
