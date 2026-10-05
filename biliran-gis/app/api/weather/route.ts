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
// `hourly` isn't consumed by any component right now (Simulation Mode's
// "Use today's forecast" prefill, its one past consumer, was removed —
// see CLAUDE.md) but stays in the response since it's already part of
// the same upstream call current needs; no cost to leaving it available
// for a future real-forecast feature.

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
  url.searchParams.set('forecast_days', '1')
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

  return NextResponse.json({
    municipality,
    current: {
      weatherCode: data.current_weather?.weathercode ?? null,
      temperatureC: data.current_weather?.temperature ?? null,
      precipitationProbability: currentPrecipitationProbability,
    },
    hourly: {
      time: data.hourly?.time ?? [],
      precipitationMm: data.hourly?.precipitation ?? [],
      precipitationProbability: data.hourly?.precipitation_probability ?? [],
      weatherCode: data.hourly?.weathercode ?? [],
    },
  })
}
