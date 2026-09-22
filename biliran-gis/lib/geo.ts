// lib/geo.ts
//
// Minimal GeoJSON projection helpers for rendering Biliran's real barangay/
// municipality polygons (public/data/geo/*.geojson, derived from the
// project's own barangay_biliran.geojson) as SVG paths, with no map-tile
// service involved. Biliran is small enough (~30km across) that a simple
// equirectangular projection with a cos(latitude) correction is accurate
// enough for this purpose — no need for a heavier projection library.

export type Position = [number, number]
export type PolygonCoords = Position[][]
export type MultiPolygonCoords = PolygonCoords[]

export interface GeoFeature<P = Record<string, unknown>> {
  type: 'Feature'
  properties: P
  geometry:
    | { type: 'Polygon'; coordinates: PolygonCoords }
    | { type: 'MultiPolygon'; coordinates: MultiPolygonCoords }
}

export interface GeoFeatureCollection<P = Record<string, unknown>> {
  type: 'FeatureCollection'
  features: GeoFeature<P>[]
}

export interface Bounds {
  minX: number
  minY: number
  maxX: number
  maxY: number
}

/** cos(latitude) correction so east-west distances stay proportional to north-south at this latitude. */
export function makeProjector(refLatDeg: number) {
  const cosRef = Math.cos((refLatDeg * Math.PI) / 180)
  return (lon: number, lat: number): Position => [lon * cosRef, -lat]
}

type Projector = ReturnType<typeof makeProjector>

function ringToPath(ring: Position[], project: Projector): string {
  return ring
    .map(([lon, lat], i) => {
      const [x, y] = project(lon, lat)
      return `${i === 0 ? 'M' : 'L'}${x.toFixed(5)},${y.toFixed(5)}`
    })
    .join(' ') + ' Z'
}

export interface LineFeature {
  type: 'Feature'
  properties: Record<string, unknown>
  geometry:
    | { type: 'LineString'; coordinates: Position[] }
    | { type: 'MultiLineString'; coordinates: Position[][] }
}

function lineToPath(line: Position[], project: Projector): string {
  return line
    .map(([lon, lat], i) => {
      const [x, y] = project(lon, lat)
      return `${i === 0 ? 'M' : 'L'}${x.toFixed(5)},${y.toFixed(5)}`
    })
    .join(' ')
}

/** For LineString/MultiLineString features (e.g. waterways) — no closing "Z", unlike polygon rings. */
export function lineGeometryToPath(geometry: LineFeature['geometry'], project: Projector): string {
  if (geometry.type === 'LineString') {
    return lineToPath(geometry.coordinates, project)
  }
  return geometry.coordinates.map((line) => lineToPath(line, project)).join(' ')
}

export function geometryToPath(geometry: GeoFeature['geometry'], project: Projector): string {
  if (geometry.type === 'Polygon') {
    return geometry.coordinates.map((ring) => ringToPath(ring, project)).join(' ')
  }
  return geometry.coordinates
    .map((polygon) => polygon.map((ring) => ringToPath(ring, project)).join(' '))
    .join(' ')
}

export function geometryCentroid(geometry: GeoFeature['geometry']): Position {
  // Simple average of the outer ring's vertices — good enough for label/zoom
  // targeting on these polygon sizes, not a true area-weighted centroid.
  const ring = geometry.type === 'Polygon' ? geometry.coordinates[0] : geometry.coordinates[0][0]
  let sx = 0
  let sy = 0
  for (const [x, y] of ring) {
    sx += x
    sy += y
  }
  return [sx / ring.length, sy / ring.length]
}

export function boundsOf(
  features: { geometry: GeoFeature['geometry'] }[],
  project: Projector
): Bounds {
  let minX = Infinity
  let minY = Infinity
  let maxX = -Infinity
  let maxY = -Infinity

  function walkRing(ring: Position[]) {
    for (const [lon, lat] of ring) {
      const [x, y] = project(lon, lat)
      if (x < minX) minX = x
      if (x > maxX) maxX = x
      if (y < minY) minY = y
      if (y > maxY) maxY = y
    }
  }

  for (const f of features) {
    if (f.geometry.type === 'Polygon') {
      f.geometry.coordinates.forEach(walkRing)
    } else {
      f.geometry.coordinates.forEach((poly) => poly.forEach(walkRing))
    }
  }

  return { minX, minY, maxX, maxY }
}

export function expandBounds(b: Bounds, paddingFraction: number): Bounds {
  const w = b.maxX - b.minX
  const h = b.maxY - b.minY
  const px = w * paddingFraction
  const py = h * paddingFraction
  return { minX: b.minX - px, minY: b.minY - py, maxX: b.maxX + px, maxY: b.maxY + py }
}

export function viewBoxOf(b: Bounds): string {
  return `${b.minX} ${b.minY} ${b.maxX - b.minX} ${b.maxY - b.minY}`
}

export interface LineFeatureCollection {
  type: 'FeatureCollection'
  features: LineFeature[]
}

export async function fetchGeoJSON<T>(url: string): Promise<T> {
  const res = await fetch(url, { cache: 'force-cache' })
  if (!res.ok) throw new Error(`Failed to load ${url} (${res.status})`)
  return res.json()
}

/**
 * Converts a client (screen) point into an SVG element's own viewBox
 * user-space coordinates, via the browser's screen CTM — this accounts for
 * the element's actual rendered size/position and any viewBox scaling
 * (including letterboxing from an aspect-ratio mismatch) correctly, unlike
 * hand-rolled clientRect-ratio math. Deliberately does NOT account for an
 * inner <g>'s own transform — call this on the outer <svg> (whose viewBox
 * is fixed) to get coordinates in the same space as islandBounds, muni/
 * barangay bounds, etc., regardless of the current pan/zoom.
 */
export function clientPointToSvgSpace(svg: SVGSVGElement, clientX: number, clientY: number): Position {
  const ctm = svg.getScreenCTM()
  if (!ctm) return [0, 0]
  const point = svg.createSVGPoint()
  point.x = clientX
  point.y = clientY
  const transformed = point.matrixTransform(ctm.inverse())
  return [transformed.x, transformed.y]
}

/**
 * Clamps a pan/zoom view center so continuous dragging can't push the
 * island fully out of frame — allows some slack past the bounds edge
 * (so you can pan close to the coastline) without losing the island
 * entirely off-screen.
 */
export function clampCenter(center: Position, bounds: Bounds, slackFraction = 0.15): Position {
  const w = bounds.maxX - bounds.minX
  const h = bounds.maxY - bounds.minY
  const minX = bounds.minX - w * slackFraction
  const maxX = bounds.maxX + w * slackFraction
  const minY = bounds.minY - h * slackFraction
  const maxY = bounds.maxY + h * slackFraction
  return [Math.min(Math.max(center[0], minX), maxX), Math.min(Math.max(center[1], minY), maxY)]
}
