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
from source in this codebase. The real barangay/municipality boundary
polygons under `public/data/geo/` are a similar case — see "The real map"
below for their provenance and how to regenerate them if the source data
changes.

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
name, and gives Maripipi's centroid for its map marker. Confirmed against an
official PSA/OCHA administrative-boundaries dataset (province/municipality/
barangay names, PSGC codes, and centroids) supplied for this project —
no longer just a self-validated guess.

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
old `.bfw-dash` placeholder): a "modeled, not live" banner naming the single
most urgent upcoming Alert/Danger crossing (`components/LiveUpdateBanner.tsx`,
`mostUrgentCrossing()`), search/filter by barangay or municipality
(`filterBarangays()`), the real map (`components/BiliranMap.tsx`, see below),
a barangay list ranked by susceptibility (`components/BarangayList.tsx`,
`sortBySeverity()`), and a "Detail Overview" panel on selection
(`components/BarangayDetailPanel.tsx`) leading with the FSI class/score,
then basin count and warning/alert/danger times.

Ranking is **highest FSI score first** (`sortBySeverity()` in
`lib/dashboardData.ts`, mean_fsi_score descending, tie-broken by soonest
`danger_time_hours`) — an explicit product decision, not the time-based
"soonest crossing" order used earlier. The LIVE UPDATE banner still uses the
time-based `mostUrgentCrossing()` signal; the two are deliberately different
questions ("who's worst" vs. "what happens soonest") and aren't meant to
agree.

**The real map** (`components/BiliranMap.tsx`, `lib/geo.ts`): actual
barangay and municipality polygons, not a placeholder or a map-tile service
— rendered as SVG paths, projected client-side from real WGS84 lon/lat with
a simple cos(latitude)-corrected equirectangular projection (Biliran is
small enough, ~30km across, that this is accurate enough; see
`makeProjector()`). No MapLibre/tile dependency, works fully offline. Default
view is the whole island, **unzoomed and with no municipality pre-selected**
— tapping a municipality zooms into it (an SVG `transform` on a `<g>`,
CSS-transitioned; a plain style-based CSS `transform`/`transform-origin` was
tried first and mis-centered the zoom, because SVG-vs-CSS coordinate-space
handling for `transform-origin` is inconsistent across browsers — use the
native SVG `transform` attribute for this, not `style.transform`) and shows
its barangay polygons, colored by `mean_fsi_score` via a continuous
green→yellow→orange→red scale (`fsiScoreColor()`, distinct from the
4-color discrete `urgencyTierColor()` used elsewhere for dots/badges).
Selecting a barangay (map or list) keeps both in sync. Maripipi has no
polygon data (see provenance below) and renders as a plain marker; tapping
it shows a note that it isn't monitored, per the settled decision to label
it rather than hide it.

Depth styling (all in `BiliranMap.tsx`'s `<defs>`): an SVG `feDropShadow`
filter (`#bfw-land-shadow`) applied per-layer, not per-polygon — per-polygon
would draw a visible shadow line along every internal barangay border, which
reads as messy rather than "raised"; a shared diagonal sheen gradient
(`#bfw-land-sheen`) layered on top of each polygon's fill for a glossy,
lit-from-one-corner look (deliberately stylized, not meant to read as real
terrain/hillshade — this project has no DEM data); a radial highlight on the
sea (`#bfw-sea-glow`); and a `.bfw-map-poly:hover` brightness lift. The
municipality-zoom target bounds use a tight 7% padding (`muniBoundsByPrefix`)
so tapping a municipality fills most of the frame with it, not a small shape
adrift in a lot of open sea.

**Provenance of `public/data/geo/*.geojson`**: derived from three source
files supplied directly for this project (not re-derived automatically from
anything already in this repo) — this project's own
`barangay_biliran.geojson` (178 raw polygon features; of those, exactly 115
match `barangay_dashboard_data.json` by name+municipality with zero
ambiguity, confirming the "115 real, 63 contamination" note below —
the 63 contamination features are real barangays from a neighboring Leyte
province, matched by their own separate `adm2_psgc` code, not Biliran data
gone bad), `waterways_biliran.geojson` (448 OSM waterway lines, kept as a
faint context layer on the map), and an official PSA/OCHA administrative
boundaries spreadsheet (municipality/barangay names, PSGC codes, and
centroids — used to confirm `lib/municipalities.ts` and locate Maripipi).
Processing (simplify with `shapely.simplify()`, dissolve barangays into
municipality outlines with `shapely.ops.unary_union`, join to dashboard
barangays by `pgc_prefix`+normalized name) was a one-off Python/shapely
script, **not checked into this repo** — if the source geometry or the
dashboard data's barangay set changes, that join and simplification needs
to be redone by hand; there's no `npm run` step that regenerates these
files.

**Known geo-data gap**: `barangay_biliran.geojson`'s real-Naval count is 24,
matching `barangay_dashboard_data.json` exactly — but the official PSA/OCHA
list has 26 barangays for Naval. Two real barangays, **Libertad** and
**Mabini**, aren't in the dashboard dataset (and so aren't on the map or
anywhere else in this app) at all. Not fixable from this repo; flag it if
asked why they're missing.

**Deliberately still not built**, because the data honestly doesn't exist in
this repo — building fake versions would mislead the officials this app is
for:
- **Hydrograph chart** (`time_hours` vs. `Q`): needs a Q-vs-time series per
  basin; only single crossing-time scalars exist per barangay.
- **HAND/TWI/LC factor breakdown**: only the combined `mean_fsi_score` is in
  the data, not the individual factor contributions.
- **"Contributing Basins" tiles / per-basin curves**: `basin_ids` is just a
  list of numeric IDs, no names or curves.
- **"Precipitation Overview" hyetograph**: no rainfall time series in this
  data.

Add the corresponding fields to the pipeline's JSON output before building
any of these.

**Theme**: the dashboard's post-login background is theme-aware, not one
fixed dark scene — see `.bfw-root[data-theme='light'][data-revealed='true']
.bfw-sky` vs. the `[data-theme='dark']` variant in `app/page.tsx`.

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

- Hydrograph chart, FSI factor breakdown, and precipitation view are blocked on pipeline data this repo doesn't have — see "Deliberately still not built" above.
- No regeneration path for `public/data/geo/*.geojson` exists in this repo (the join/simplify/dissolve script was one-off and not checked in) — if `barangay_biliran.geojson`, `waterways_biliran.geojson`, or the barangay set in `barangay_dashboard_data.json` change, these need to be rebuilt by hand.
- Naval's Libertad and Mabini barangays are absent from `barangay_dashboard_data.json` entirely, so they're invisible everywhere in this app, including the map — see "Known geo-data gap" above.
- Production refresh mechanism for `barangay_dashboard_data.json` (move off static `public/` file) is undecided.
- Profile has no Storage-backed fields (e.g. a photo) — no design decisions made yet.
- The "Invitations" admin panel is create/list only; no revoke/expire-early or edit UI.
- None of the new Supabase-dependent code (`/api/admin/invite`, `lib/profile.ts`'s RLS assumption) has been run against a real Supabase project — only linted, type-checked, and built. Verify the `user_profiles` "read own row" RLS policy actually exists before relying on the Profile panel.
- The map has no continuous pinch/scroll zoom, only tap-a-municipality-to-zoom and a "back to all municipalities" button.
