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
without a hard navigation. The standalone `app/login/page.tsx` route (an
alternate, more built-out login screen) was removed — it pushed to a
`/dashboard` route that never existed and duplicated the merged-page login
UI, contradicting this settled decision. `app/activate/page.tsx` now
redirects to `/?activated=1` (not `/login`) after activating an account;
`app/page.tsx` reads that query param to show a one-time "Account activated"
message on the login card.

**Daily login gate is UX, not security.** Even with a valid Supabase session,
the login card reappears if the last successful login (tracked via
`localStorage['bfw_last_login_date']`) wasn't today. Real access control is
the Supabase session + RLS policies, not this check.

**Supabase clients are split by privilege** (`lib/supabase.ts` vs.
`lib/supabaseAdmin.ts`): the anon/browser client is safe in client components;
`supabaseAdmin` uses the service-role key and must only be used server-side
(`app/api/activate/route.ts`, `app/api/admin/invite/route.ts`).

**Invitation-based account activation**, no public signup:
`app/activate/page.tsx` (reads `?code=`) → `POST /api/activate` →
`app/api/activate/route.ts` validates the `invitation_codes` row (exists, not
redeemed, not expired), creates the Supabase auth user via the admin API,
inserts a `user_profiles` row, then binds `device_id` to the invite and marks
it redeemed — only on success, in that order. The device id
(`lib/deviceId.ts`, `localStorage['bfw_device_id']`) is generated client-side
and used **only** to bind an invite at redemption time, never for ongoing
login gating.

Invitation codes are created via `app/api/admin/invite/route.ts` (`GET` to
list, `POST` to create) — admin-only, checked by decoding the caller's
Supabase access token (`Authorization: Bearer <token>`, sent from the client
after `supabase.auth.getSession()`) and requiring `user_profiles.access_level
=== 'admin'`. Before this route existed, nothing in the app could actually
produce an `invitation_codes` row, so `/activate` had no real way to be
reached. Surfaced in the UI as "Invitations" in the hidden "+" menu, shown
only to admins (`components/AdminInvitePanel.tsx`).

**Profile**: "Profile" in the "+" menu opens `components/ProfilePanel.tsx`,
which shows the signed-in user's email plus `office`/`access_level` fetched
via `lib/profile.ts` (`fetchOwnProfile`, anon client — relies on a Supabase
RLS policy letting a user read their own `user_profiles` row). No
Storage-backed fields (e.g. a photo) yet.

**Dashboard data** is a static file, `public/data/barangay_dashboard_data.json`
— one JSON object keyed by `"Barangay (PGC prefix)"`, 115 barangays, each
combining an FSI score/label with runoff threshold crossing times
(`warning_time_hours`, `alert_time_hours`, `danger_time_hours`) produced by
the external Python pipeline. It's fetched client-side with a plain cached
`fetch()` (`lib/dashboardData.ts`, `loadBarangays()`) — no DB wiring for this
yet. Known limitation: a `public/` file only updates on redeploy; a real
rainfall-driven refresh would need to move this into Supabase Storage or a
table. That loader also repairs the two barangay names hit by the known
source-level double-UTF-8 bug ("Capiñahan," "Santo Niño") — see
`fixMojibake()` — but the fix is cosmetic and client-side only; the
underlying `barangay_biliran.geojson` bug (outside this repo) is still open.

`lib/municipalities.ts` maps each barangay's `pgc_prefix` to a municipality
name via the PSGC numbering convention for Biliran province — derived, not
sourced from an authoritative table in this repo, though it self-validates
against the data (exactly 7 prefixes present, and the one missing —
`807807`, Maripipi — matches this project's documented exclusion). Verify
against a real PSGC source before depending on it for anything beyond the
UI.

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

## Dashboard UI

`components/DashboardShell.tsx` (rendered by `app/page.tsx` in place of the
old `.bfw-dash` placeholder) implements the parts of the original design
spec below that `barangay_dashboard_data.json` actually supports:
search-by-barangay/municipality (`components/BarangayList.tsx` +
`lib/dashboardData.ts` `filterBarangays()`), a "modeled, not live" banner
naming the single most urgent upcoming Alert/Danger crossing
(`components/LiveUpdateBanner.tsx`, `mostUrgentCrossing()`), an
urgency-sorted barangay list standing in for the map (sorted by soonest
`danger_time_hours`, see `sortByUrgency()`), and a "Detail Overview"-style
panel on selection (`components/BarangayDetailPanel.tsx`) showing the
countdown, FSI score/label, basin count, and warning/alert times.

**Deliberately not built**, because the data to build them honestly doesn't
exist in this repo — building fake versions would mislead the officials this
app is for:
- **Choropleth map**: needs barangay boundary geometry
  (`barangay_biliran.geojson`, part of the external pipeline, not checked in
  here) and/or per-barangay coordinates, neither of which
  `barangay_dashboard_data.json` carries.
- **Hydrograph chart** (`time_hours` vs. `Q`): needs a Q-vs-time series per
  basin; only single crossing-time scalars exist per barangay.
- **HAND/TWI/LC factor breakdown**: only the combined `mean_fsi_score` is in
  the data, not the individual factor contributions.
- **"Contributing Basins" tiles / per-basin curves**: `basin_ids` is just a
  list of numeric IDs, no names or curves.
- **"Precipitation Overview" hyetograph**: no rainfall time series in this
  data.

Add the corresponding fields to the pipeline's JSON output before building
any of these — see the original reference-mapping notes this section used to
carry, still useful for whoever does that: a weather-monitoring SaaS layout
(wide map+charts left, narrower "Detail Overview" sidebar right), card
pattern = header row + light shadow + one primary metric + one action
button, map mounted as the base layer at all times.

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

- Choropleth map, hydrograph chart, FSI factor breakdown, and precipitation view are blocked on pipeline data this repo doesn't have — see "Deliberately not built" above.
- Production refresh mechanism for `barangay_dashboard_data.json` (move off static `public/` file) is undecided.
- Profile has no Storage-backed fields (e.g. a photo) — no design decisions made yet.
- The "Invitations" admin panel is create/list only; no revoke/expire-early or edit UI.
- None of the new Supabase-dependent code (`/api/admin/invite`, `lib/profile.ts`'s RLS assumption) has been run against a real Supabase project — only linted, type-checked, and built. Verify the `user_profiles` "read own row" RLS policy actually exists before relying on the Profile panel.
