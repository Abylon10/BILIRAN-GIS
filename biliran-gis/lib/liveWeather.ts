// lib/liveWeather.ts
//
// Client-side loader for /api/weather (this app's proxy in front of
// Open-Meteo — see that route's own header comment for why it's a proxy,
// not a direct browser call). Fetches real weather for a monitored
// municipality, with a short in-memory cache so switching between
// barangays in the same municipality (or the map's periodic refresh)
// doesn't refetch every time.

export interface WeatherData {
  weatherCode: number | null
  temperatureC: number | null
  precipitationProbability: number | null
  hourlyPrecipitationMm: number[]
}

const CACHE_TTL_MS = 10 * 60 * 1000 // slightly under the API route's own 15-minute revalidate

const cache = new Map<string, { data: WeatherData; fetchedAt: number }>()
const inflight = new Map<string, Promise<WeatherData | null>>()

export async function loadWeather(municipality: string): Promise<WeatherData | null> {
  const cached = cache.get(municipality)
  if (cached && Date.now() - cached.fetchedAt < CACHE_TTL_MS) {
    return cached.data
  }

  const existing = inflight.get(municipality)
  if (existing) return existing

  const promise = fetch(`/api/weather?municipality=${encodeURIComponent(municipality)}`)
    .then((res) => {
      if (!res.ok) throw new Error(`Failed to load weather for ${municipality} (${res.status})`)
      return res.json()
    })
    .then((json): WeatherData => ({
      weatherCode: json.current?.weatherCode ?? null,
      temperatureC: json.current?.temperatureC ?? null,
      precipitationProbability: json.current?.precipitationProbability ?? null,
      hourlyPrecipitationMm: json.hourly?.precipitationMm ?? [],
    }))
    .then((data) => {
      cache.set(municipality, { data, fetchedAt: Date.now() })
      return data
    })
    .catch(() => null)
    .finally(() => {
      inflight.delete(municipality)
    })

  inflight.set(municipality, promise)
  return promise
}

export type WeatherBucket = 'Calm' | 'Cloudy' | 'Light rain' | 'Rain' | 'Heavy rain'

/**
 * Maps an Open-Meteo/WMO weather code (table 4677) onto this app's
 * existing 5-bucket icon system. A documented judgment call, not an
 * exact standard mapping — same spirit as the external pipeline's own
 * documented LULC-runoff-score judgment calls (see CLAUDE.md).
 */
export function conditionForWeatherCode(code: number | null): WeatherBucket {
  if (code === null) return 'Cloudy'
  if (code === 0 || code === 1) return 'Calm'
  if (code === 2 || code === 3 || code === 45 || code === 48) return 'Cloudy'
  if (code === 51 || code === 53 || code === 55 || code === 61) return 'Light rain'
  if (code === 56 || code === 57 || code === 63 || code === 65 || code === 80 || code === 81 || code === 82) return 'Rain'
  if (code >= 95) return 'Heavy rain'
  return 'Cloudy'
}
