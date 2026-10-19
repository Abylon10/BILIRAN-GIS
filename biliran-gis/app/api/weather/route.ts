// app/api/weather/route.ts
//
// This app's first live external API call — everything else here is
// static JSON (barangay_dashboard_data.json, basin_hydrographs.json,
// fsi_factors.json) or Supabase. Proxies Open-Meteo's free, no-key
// forecast API (https://open-meteo.com/en/docs) server-side rather than
// calling it from the browser, so the third-party dependency and its
// caching live in one place. Unauthenticated (unlike every other route
// in app/api/*) — this only reads public weather data, no user data
// involved, so there's nothing to gate behind requireAdmin.
//
// `current` drives the map's weather icon (components/BiliranMap.tsx).
// `hourly` feeds lib/liveIslandState.ts's live rainfall factor/countdown
// recompute — paired with `currentHourIndex` below so that consumer can
// slice forward from "now" instead of assuming the array starts there
// (see CLAUDE.md's "live rainfall factor always reads midnight" fix).

import { NextRequest, NextResponse } from 'next/server'
import { MUNICIPALITY_COORDS } from '@/lib/municipalityCoords'

// Open-Meteo's forecast updates roughly hourly — 30 minutes is generous
// caching, not a necessity (its free tier allows ~10k calls/day, and this
// app only ever queries 7 municipalities). Matches the client poll interval
// in app/page.tsx and BiliranMap.tsx (both also 30 min).
const REVALIDATE_SECONDS = 1800

export async function GET(req: NextRequest) {
  const municipality = req.nextUrl.searchParams.get('municipality')
  if (!municipality) {
    return NextResponse.json({ error: 'municipality is required.' }, { status: 400 })
  }

  const coords = MUNICIPALITY_COORDS[municipality]
  if (!coords) {
    return NextResponse.json({ error: `Unknown municipality: ${municipality}` }, { status: 400 })
  }

  const url = new URL('https://api.open-meteo.com/v1/forecast')
  url.searchParams.set('latitude', String(coords.lat))
  url.searchParams.set('longitude', String(coords.lon))
  url.searchParams.set('current_weather', 'true')
  url.searchParams.set('hourly', 'precipitation,precipitation_probability,weathercode')
  // 2 days, not 1 — lib/liveIslandState.ts reads a forward-looking window
  // anchored to currentHourIndex below; a visit late in the day would
  // otherwise run out of array before completing a real 6-hour window.
  url.searchParams.set('forecast_days', '2')
  url.searchParams.set('timezone', 'Asia/Manila')

  let upstream: Response
  try {
    upstream = await fetch(url, { next: { revalidate: REVALIDATE_SECONDS } })
  } catch {
    return NextResponse.json({ error: 'Could not reach the weather service.' }, { status: 502 })
  }

  if (!upstream.ok) {
    return NextResponse.json({ error: 'Weather service returned an error.' }, { status: 502 })
  }

  const data = await upstream.json()

  // Open-Meteo's `current_weather` block doesn't carry a precipitation
  // chance itself (only temperature/windspeed/weathercode) — that only
  // exists in the hourly series, so the "current" chance shown on the map
  // is the hourly value for whichever hour current_weather.time falls in.
  const hourlyTimes: string[] = data.hourly?.time ?? []
  const currentHourIndex = hourlyTimes.indexOf(data.current_weather?.time ?? '')
  const currentPrecipitationProbability =
    currentHourIndex >= 0 ? data.hourly?.precipitation_probability?.[currentHourIndex] ?? null : null
  // Same currentHourIndex lookup as the probability above, just against the
  // hourly precipitation-amount series instead — Open-Meteo's hourly
  // resolution means this mm value already reads as an mm/h rate.
  const currentPrecipitationMm =
    currentHourIndex >= 0 ? data.hourly?.precipitation?.[currentHourIndex] ?? null : null

  return NextResponse.json({
    municipality,
    // Index into the `hourly` arrays below where "now" actually falls —
    // -1 if current_weather.time genuinely isn't in hourly.time (should be
    // rare; consumers should treat that as "no live data," not silently
    // read from the wrong offset). Exposed so lib/liveIslandState.ts can
    // slice forward from here instead of assuming hourly starts at "now".
    currentHourIndex,
    current: {
      weatherCode: data.current_weather?.weathercode ?? null,
      temperatureC: data.current_weather?.temperature ?? null,
      precipitationProbability: currentPrecipitationProbability,
      precipitationMm: currentPrecipitationMm,
    },
    hourly: {
      time: data.hourly?.time ?? [],
      precipitationMm: data.hourly?.precipitation ?? [],
      precipitationProbability: data.hourly?.precipitation_probability ?? [],
      weatherCode: data.hourly?.weathercode ?? [],
    },
  })
}
