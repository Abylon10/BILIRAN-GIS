// components/StaticIslandMap.tsx
//
// A genuinely separate, read-only island map for the Simulation Mode
// "User Dashboard" modal — NOT a second instance of BiliranMap and not a
// mode/prop on it. No pan/zoom/pointer handlers, no view/resetToken
// state: just barangay polygons colored by mean_fsi_score, reusing the
// same projection helpers (lib/geo.ts) and same barangays.geojson
// BiliranMap.tsx already fetches. This is why it doesn't reopen this
// app's "one persistent map" architectural decision (see CLAUDE.md) — the
// real interactive map still only mounts once, in app/page.tsx.

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

interface BrgyProps {
  key: string
  barangay: string
  pgc_prefix: string
}

export default function StaticIslandMap({
  barangays,
  selectedKey,
}: {
  barangays: Barangay[]
  selectedKey: string | null
}) {
  const [geo, setGeo] = useState<GeoFeatureCollection<BrgyProps> | null>(null)

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
    <div className="overflow-hidden rounded-lg border" style={{ borderColor: 'var(--card-border)' }}>
      <svg viewBox={viewBoxOf(bounds)} width="100%" height={180} role="img" aria-label="Island-wide flood susceptibility map (read-only)">
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
      </svg>
    </div>
  )
}
