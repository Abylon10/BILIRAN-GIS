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

import { useEffect, useState } from 'react'
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

  if (!geo) {
    return (
      <div
        className="flex h-40 items-center justify-center rounded-lg border text-xs"
        style={{ borderColor: 'var(--card-border)', color: 'var(--text-soft)' }}
      >
        Loading map…
      </div>
    )
  }

  const project = makeProjector(11.58)
  const bounds = expandBounds(boundsOf(geo.features, project), 0.04)
  const barangaysByKey = new Map(barangays.map((b) => [b.key, b]))

  return (
    <div className="relative overflow-hidden rounded-lg border" style={{ borderColor: 'var(--card-border)' }}>
      <svg viewBox={viewBoxOf(bounds)} width="100%" height={height} role="img" aria-label="Island-wide flood susceptibility map (read-only)">
        {geo.features.map((f) => {
          const b = barangaysByKey.get(f.properties.key)
          const selected = f.properties.key === selectedKey
          const d = geometryToPath(f.geometry, project)
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
        reimplemented) — this map has exactly one caller (UserDashboardModal,
        height=320), always tall enough for the full labeled variant, so
        no compact (dots-only) mode is needed here.
      */}
      <Legend />
    </div>
  )
}
