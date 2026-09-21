# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project overview

Biliran Flood Watch — a flood early-warning web app for MDRRMO officials in
Biliran province, Philippines. **Not public-facing**: access is restricted to
MDRRMO personnel and barangay presidents across 7 of Biliran's 8 municipalities
(Naval, Almeria, Biliran, Cabucgayan, Caibiran, Culaba, Kawayan — **Maripipi is
excluded** for resource constraints and shown labeled "unmonitored," not
hidden). Core design intent: tell officials how much time remains safe for
evacuation before conditions become unsafe — a countdown, not just a static
risk color.

This repository (`biliran-gis/`) contains only the **Next.js/Supabase web
app**. The Python/GDAL geospatial pipeline that computes flood susceptibility
(FSI) and the runoff/threshold forecast that feeds `public/data/barangay_dashboard_data.json`
is developed outside this repo and is not checked in here — treat that data
file as an external input produced elsewhere, not something to regenerate
from source in this codebase.

## Commands

Run from `biliran-gis/` (this directory):

- `npm run dev` — start the dev server (Next.js, Turbopack default)
- `npm run build` — production build
- `npm run start` — run the production build
- `npm run lint` — ESLint via flat config (`eslint.config.mjs`, extends `next/core-web-vitals` + `next/typescript`)

There is no test runner configured in this project.

## Next.js version note

This project pins Next.js `16.3.3` — recent enough that APIs/conventions may
differ from training data. `AGENTS.md` (auto-generated/re-added by `next dev`)
points to `node_modules/next/dist/docs/` for the current docs; check there
before assuming older Next.js behavior, and don't strip that block from diffs.

## Architecture

**Single merged page, not routes.** `app/page.tsx` implements login and the
dashboard as two states (`checking` / `needsLogin` / `revealed`) of one
mounted component, so the "card opens up to reveal the map" transition works
without a hard navigation. `app/login/page.tsx` is a separate, more built-out
standalone login route (drifting island scene, corner-of-the-hour animation,
routes to `/dashboard` on success) — check whether it's actually linked from
anywhere before assuming it's live; per the architectural decision below, the
merged `app/page.tsx` is the intended design.

**Daily login gate is UX, not security.** Even with a valid Supabase session,
the login card reappears if the last successful login (tracked via
`localStorage['bfw_last_login_date']`) wasn't today. Real access control is
the Supabase session + RLS policies, not this check.

**Supabase clients are split by privilege** (`lib/supabase.ts` vs.
`lib/supabaseAdmin.ts`): the anon/browser client is safe in client components;
`supabaseAdmin` uses the service-role key and must only be used server-side
(currently only in `app/api/activate/route.ts`).

**Invitation-based account activation**, no public signup:
`app/activate/page.tsx` (reads `?code=`) → `POST /api/activate` →
`app/api/activate/route.ts` validates the `invitation_codes` row (exists, not
redeemed, not expired), creates the Supabase auth user via the admin API,
inserts a `user_profiles` row, then binds `device_id` to the invite and marks
it redeemed — only on success, in that order. The device id
(`lib/deviceId.ts`, `localStorage['bfw_device_id']`) is generated client-side
and used **only** to bind an invite at redemption time, never for ongoing
login gating.

**Dashboard data** is a static file, `public/data/barangay_dashboard_data.json`
— one JSON object keyed by `"Barangay (PGC prefix)"`, 115 barangays, each
combining an FSI score/label with runoff threshold crossing times
(`warning_time_hours`, `alert_time_hours`, `danger_time_hours`) produced by
the external Python pipeline. It's meant to be fetched client-side with a
plain cached `fetch()` — no DB wiring for this yet. Known limitation: a
`public/` file only updates on redeploy; a real rainfall-driven refresh would
need to move this into Supabase Storage or a table.

**Path alias**: `@/*` resolves to the repo root (`tsconfig.json`), e.g.
`@/lib/supabase`.

## Key architectural decisions (settled, don't relitigate)

- Single merged page (map + login + dashboard as states of one component, not routes)
- Daily login gate is UX, not security
- Account creation is fully admin-controlled; no public signup
- Invite codes are device-bound only at redemption
- No AI/LLM features in the product
- Admin entry point is a hidden bottom-right "+" menu (Profile / Dashboard / Sign out)
- Barangays are ranked by continuous `mean_fsi_score`, never by discrete FSI class (class-based ranking was tested and rejected — it collapses most barangays into one bucket)
- Runoff thresholds are relative to each basin's own modeled peak Q (Warning 50% / Alert 75% / Danger 95%, not 100%) — disclosed as a relative proxy, not a calibrated physical threshold; there wasn't enough data (surveyed cross-sections, historical gauge records) for a calibrated approach
- A barangay touching multiple basins uses the **earliest** (most urgent) threshold crossing time across them, not an average

## Dashboard UI — target design (not yet built)

Reference: a weather-monitoring SaaS dashboard layout (wide map+charts panel
left, narrower "Detail Overview" sidebar right). Mapping of that reference
onto this project's real data, for whoever builds `app/page.tsx`'s dashboard
shell next:

- **Top bar**: search (barangay/municipality), location selector, "synced N min ago" indicator (honest about the static-file staleness), profile icon = the existing hidden "+" menu.
- **"LIVE UPDATE" banner**: the single most urgent upcoming threshold crossing across all barangays — `min()` over every barangay's `alert_time_hours`/`danger_time_hours`.
- **Main map**: island map colored by urgency tier (Warning/Alert/Danger) — one consistent color scale, not a separate FSI scale. Badge = count of barangays past Warning.
- **"Most Urgent Barangays" list** (was "Regional Extremes"): sorted by soonest countdown / `mean_fsi_score`. Keep a "Generate Report" export button (PDF/CSV of the current urgency list).
- **Hydrograph chart** (was "AQI Trends"): `time_hours` on X, `Q` on Y, Warning/Alert/Danger drawn as horizontal reference lines; hover tooltip for exact values.
- **Right sidebar "Detail Overview"**: hero stat = big countdown number + unit ("min to Alert") + FSI class as the description line; stat row below = HAND/TWI/LC factor contributions; "View Details" drills into the full FSI methodology for that barangay.
- **"Contributing Basins"** (was "7-Day Forecast"): horizontal scroll, one tile per basin affecting the barangay (relevant for multi-basin barangays); tapping a tile swaps the main hydrograph to that basin's curve.
- **"Precipitation Overview"**: the synthetic storm hyetograph (or live forecast once wired up) as an hourly bar chart.
- Card pattern throughout: header row (title + overflow dots), light shadow, one primary metric per card, one action button at the bottom.
- Map stays mounted as the base layer at all times; bottom-right hidden "+" menu unchanged.

## Known gotchas from the external GIS pipeline (context only, not this repo's code)

These affect the data pipeline that produces `barangay_dashboard_data.json`,
which lives outside this repo — relevant if you're asked about the data's
provenance or oddities, not for changes here: GDAL+numpy2.x incompatible
(pin `numpy<2`); `numba`/`pysheds`/`rasterio` blocked by Windows Smart App
Control on the dev machine (GRASS via QGIS Processing used instead);
`r.watershed`'s "basin" output is small local sub-catchments, not a true
cumulative watershed; explicit-Euler numerical schemes need `A > 2/dt` to
stay stable (the project switched to the exact analytical formula
`Q2 = Q1·e^(-AΔt) + R·(1-e^(-AΔt))` for this reason — a ~3-5% shift down
from earlier Euler-computed peak Q values for the 6 named rivers); a
known open bug is source-level UTF-8 double-encoding in
`barangay_biliran.geojson` (affects names like "Capiñahan," "Santo Niño").

## Open items

- Dashboard UI (map + countdown panels per the design above) is not yet built — `app/page.tsx`'s `.bfw-dash` section is still a placeholder.
- Whether `app/login/page.tsx` is still wired into the app or superseded by the merged `app/page.tsx` flow hasn't been resolved — check before building on either.
- Production refresh mechanism for `barangay_dashboard_data.json` (move off static `public/` file) is undecided.
- Admin panel and Profile feature (needs Supabase Storage) are not started.
