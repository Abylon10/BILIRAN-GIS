// components/StaticIslandMap.tsx
//
// A genuinely separate, read-only island map for the Simulation Mode
// "User Dashboard" modal and the admin Dashboard/Barangays tabs — NOT a
// second instance of BiliranMap and not a mode/prop on it. No pan/zoom/
// pointer handlers, no view/resetToken state: just barangay polygons
// colored by mean_fsi_score, reusing the same projection helpers
// (lib/geo.ts) and same barangays.geojson BiliranMap.tsx already
// fetches. This is why it doesn't reopen this app's "one persistent map"
// architectural decision (see CLAUDE.md) — the real interactive map
// still only mounts once, in app/page.tsx.
//
// `highlightMunicipality` (optional): outlines one municipality's real
// boundary (/data/geo/municipalities.geojson — the same file
// BiliranMap.tsx's own MunicipalityLayer already fetches, same MuniProps
// shape) on top of the barangay fills, so a municipality filter elsewhere
// on the page can be "tracked" on this map — still genuinely
// non-interactive (pointerEvents stays 'none' throughout): no zoom/pan/
// click handling was added to support this, only a highlight overlay.

'use client'

import { useEffect, useMemo, useState } from 'react'
import {
  boundsOf,
  expandBounds,
  fetchGeoJSON,
  geometryToPath,
  makeProjector,
  viewBoxOf,
  type GeoFeatureCollection,
} from '@/lib/geo'
import { fsiScoreColor, type Barangay } from '@/lib/dashboardData'
import { Legend } from '@/components/BiliranMap'

interface BrgyProps {
  key: string
  barangay: string
  pgc_prefix: string
}

interface MuniProps {
  pgc_prefix: string
  municipality: string
  barangay_count: number
}

export default function StaticIslandMap({
  barangays,
  selectedKey,
  height = 180,
  highlightMunicipality = null,
}: {
  barangays: Barangay[]
  selectedKey: string | null
  // Overridable so the full-screen admin User Dashboard (a much bigger
  // surface than the old dialog) can give this more visual weight,
  // closer to the real dashboard's own map — still the same read-only
  // component either way, just resized.
  height?: number
  // The active municipality filter, if any (AdminBarangaysTab.tsx,
  // UserDashboardModal.tsx) — outlines that municipality's real boundary.
  // null/omitted: no highlight, no municipalities.geojson fetch at all
  // (lazy, same pattern as the barangay fetch itself).
  highlightMunicipality?: string | null
}) {
  const [geo, setGeo] = useState<GeoFeatureCollection<BrgyProps> | null>(null)
  const [muniGeo, setMuniGeo] = useState<GeoFeatureCollection<MuniProps> | null>(null)

  useEffect(() => {
    let cancelled = false
    fetchGeoJSON<GeoFeatureCollection<BrgyProps>>('/data/geo/barangays.geojson')
      .then((data) => {
        if (!cancelled) setGeo(data)
      })
      .catch(() => {
        // Read-only supplementary view — no dedicated error UI needed.
      })
    return () => {
      cancelled = true
    }
  }, [])

  useEffect(() => {
    if (!highlightMunicipality || muniGeo) return
    let cancelled = false
    fetchGeoJSON<GeoFeatureCollection<MuniProps>>('/data/geo/municipalities.geojson')
      .then((data) => {
        if (!cancelled) setMuniGeo(data)
      })
      .catch(() => {
        // Highlight is purely supplementary — the barangay map itself
        // still renders fine without it.
      })
    return () => {
      cancelled = true
    }
  }, [highlightMunicipality, muniGeo])

  // project/bounds/paths are expensive to rebuild (a full projector +
  // bounds scan + 115 SVG path strings) and only actually depend on `geo`
  // itself, which never changes after its one fetch — memoized so an
  // unrelated re-render (e.g. a sibling SimulationModePanel input keystroke
  // in the same modal tree) doesn't re-stringify all 115 polygons every
  // time. Must stay above the `!geo` early return below (Rules of Hooks).
  const project = useMemo(() => makeProjector(11.58), [])
  const bounds = useMemo(() => (geo ? expandBounds(boundsOf(geo.features, project), 0.04) : null), [geo, project])
  const barangayPaths = useMemo(
    () => (geo ? new Map(geo.features.map((f) => [f.properties.key, geometryToPath(f.geometry, project)])) : null),
    [geo, project],
  )
  const barangaysByKey = useMemo(() => new Map(barangays.map((b) => [b.key, b])), [barangays])

  if (!geo || !bounds || !barangayPaths) {
    return (
      <div
        className="flex h-40 items-center justify-center rounded-lg border text-xs"
        style={{ borderColor: 'var(--card-border)', color: 'var(--text-soft)' }}
      >
        Loading map…
      </div>
    )
  }

  // Thresholds are eyeballed against this component's actual callers
  // (120px thumbnail, 220px Barangays-tab map, 280-320px full maps), not
  // computed from the Legend's own measured height — same "tuned by eye"
  // precedent Legend's own comments already set for its other variants.
  const legendProps = height < 150 ? { compact: true } : height < 250 ? { size: 'md' as const } : {}

  return (
    <div className="relative overflow-hidden rounded-lg border" style={{ borderColor: 'var(--card-border)' }}>
      <svg viewBox={viewBoxOf(bounds)} width="100%" height={height} role="img" aria-label="Island-wide flood susceptibility map (read-only)">
        {geo.features.map((f) => {
          const b = barangaysByKey.get(f.properties.key)
          const selected = f.properties.key === selectedKey
          const d = barangayPaths.get(f.properties.key) ?? ''
          return (
            <path
              key={f.properties.key}
              d={d}
              fill={b ? fsiScoreColor(b.mean_fsi_score) : '#7A8A99'}
              fillOpacity={selected ? 1 : 0.85}
              stroke={selected ? '#fff' : 'rgba(11, 30, 40, 0.3)'}
              strokeWidth={selected ? 0.0016 : 0.0004}
              pointerEvents="none"
            />
          )
        })}
        {highlightMunicipality &&
          muniGeo?.features
            .filter((f) => f.properties.municipality === highlightMunicipality)
            .map((f) => (
              <path
                key={f.properties.pgc_prefix}
                d={geometryToPath(f.geometry, project)}
                fill="none"
                stroke="#E8A33D"
                strokeWidth={0.0022}
                pointerEvents="none"
              />
            ))}
      </svg>
      {/*
        Same FSI-severity Legend the real BiliranMap uses (reused, not
        reimplemented). This component now has several callers at very
        different heights (the 320px Rainfall & Scenarios map down to a
        120px "Selected Barangay" thumbnail) — picking the variant from
        `height` itself, not a prop every caller has to remember to set,
        so a new caller can't reintroduce the "legend taller than the
        map" bug a smaller height once produced with the always-'lg'
        Legend this used to render unconditionally.
      */}
      <Legend {...legendProps} />
    </div>
  )
}
