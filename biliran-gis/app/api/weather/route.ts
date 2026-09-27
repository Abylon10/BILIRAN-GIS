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
// One response covers both real uses of this data: `current` drives the
// map's weather icon (components/BiliranMap.tsx), `hourly` drives
// Simulation Mode's "Use today's forecast" prefill
// (components/SimulationModePanel.tsx) — no need for two endpoints.

import { NextRequest, NextResponse } from 'next/server'
import { MUNICIPALITY_COORDS } from '@/lib/municipalityCoords'

// Open-Meteo's forecast updates roughly hourly — 15 minutes is generous
// caching, not a necessity (its free tier allows ~10k calls/day, and this
// app only ever queries 7 municipalities).
const REVALIDATE_SECONDS = 900

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
  url.searchParams.set('hourly', 'precipitation,weathercode')
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

  return NextResponse.json({
    municipality,
    current: {
      weatherCode: data.current_weather?.weathercode ?? null,
      temperatureC: data.current_weather?.temperature ?? null,
    },
    hourly: {
      time: data.hourly?.time ?? [],
      precipitationMm: data.hourly?.precipitation ?? [],
      weatherCode: data.hourly?.weathercode ?? [],
    },
  })
}
