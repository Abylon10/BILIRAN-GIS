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

**One persistent map, not a decorative login backdrop swapped for a real
one.** A single `<BiliranMap>` instance mounts in `app/page.tsx` itself
(not inside `DashboardShell`) as soon as `authState !== 'checking'` —
full-bleed behind the login card at first, the same real interactive map
throughout, not a hand-drawn placeholder (`IslandScene`, removed). Its
wrapping `.bfw-map-shell` div is `position: fixed`, sized via inline
`top/left/width/height` computed in a `useLayoutEffect` (`mapRect` state):
a full-viewport rect when not `revealed`, or `mapSlotRef.getBoundingClientRect()`
when `revealed` — `mapSlotRef` is an empty spacer div inside
`DashboardShell` (`<div ref={mapSlotRef} className="h-96 shrink-0
md:h-[70%]" />`) that reserves the map's layout slot without rendering a
map itself. `DashboardShell` is **always mounted** now (not `{revealed &&
<DashboardShell/>}`), same as its own `.bfw-dash` wrapper already was —
opacity/pointer-events hide it pre-reveal, not a conditional mount — so
`mapSlotRef` has a real, measurable position even before sign-in, which is
what lets the map animate smoothly INTO that exact spot rather than
jumping there once `DashboardShell` first exists. `.bfw-map-shell`'s CSS
transition (`top/left/width/height`, `cubic-bezier(0.22,1,0.36,1)`, same
easing family as the map's own internal zoom transition) is what actually
produces the shared-element/FLIP-style animation — verified by sampling
`getComputedStyle(el)` repeatedly right after load and confirming the
values actually interpolate between the two rects, not just checking the
CSS is present (the same verification discipline this project already
uses for CSS-driven SVG animations, for the same reason: a transition
being *present* in the DOM doesn't guarantee it's actually *running*).
`barangays`/`selectedKey` are lifted from `DashboardShell` into
`app/page.tsx` too (loaded as soon as `authState !== 'checking'`, same
early-fetch tradeoff as the map's own geojson — it's static public JSON,
no auth needed) so the persistent map and `DashboardShell`'s list/detail
panel share one fetch and one selection instead of each owning a copy.

**`BiliranMap`'s `showChrome` prop** (default `true`, passed as
`showChrome={revealed}` at its one call site in `app/page.tsx`) hides
overlays that only make sense once there's a dashboard around them: the
zoom slider inside `ZoomControls` (its own `showSlider` prop — the `-`/`+`
buttons stay either way), the Maripipi marker circle, and the
`WeatherBadge` ribbon. As a pure decorative login backdrop these were just
clutter — the ribbon specifically used to collide with the theme-toggle
button in that state (worked around earlier by pushing the toggle down),
now moot since the ribbon simply doesn't render there; the toggle is back
to a fixed `top-5`.

**Daily login gate is UX, not security.** Even with a valid Supabase session,
the login card reappears if the last successful login (tracked via
`localStorage['bfw_last_login_date']`) wasn't today. Real access control is
the Supabase session + RLS policies, not this check.

**Admin sign-in toggle is copy only, also not a security gate.** The login
card's logo becomes a button while `authState === 'needsLogin'` (gone
entirely once signed in — no lingering control in the dashboard), toggling
a `loginMode: 'user' | 'admin'` local state that only swaps the card's
heading ("Sign in" ↔ "Welcome, Administrator"). The email/password fields
and `handleSubmit` are unchanged either way — there's only one real auth
mechanism (`supabase.auth.signInWithPassword`); actual admin authorization
is still the existing post-login `access_level === 'admin'` check
(`isAdmin` state, used elsewhere to gate the header profile button's
"Admin panel" row). A non-admin account signing in via the admin-styled
form just lands on the normal dashboard with no admin entry point, same as
any other non-admin sign-in. `loginMode` always starts (and, on sign-out,
resets to) `'user'` — plain `useState`, no persistence, so a page refresh
always shows the regular login view regardless of what was last toggled.

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
=== 'admin'` via `lib/requireAdmin.ts` (shared by every admin route —
extracted once a second admin endpoint needed the identical check, rather
than duplicating it). Before this route existed, nothing in the app could
actually produce an `invitation_codes` row, so `/activate` had no real way
to be reached. Reached from the header profile button's panel now (see
below), not a dedicated menu item of its own — "Admin panel" there opens
`components/AdminInvitePanel.tsx`, admin-gated the same way.

**Header profile button** (`components/HeaderProfileButton.tsx`) replaced
the old hidden bottom-right "+" FAB (Profile / Dashboard / Invitations /
Sign out) entirely — a persistent element next to the day/night toggle,
both `data-revealed`-driven flex siblings in one shared right-anchored row
in `app/page.tsx` (`absolute right-5 top-5 z-20 flex items-center gap-2`).
The toggle "drifts left" for free as the profile button's own width grows
on reveal — ordinary flexbox reflow, not manual position math. Two visual
states: a small plain circle pre-login (the shared `Avatar` fallback —
see below — with no url/label, so it renders a generic silhouette, since
there's no signed-in user yet to take an initial from); once revealed, the
circle grows and a reverse-trapezoid tab pops out to its left revealing
`formatDisplayName()` (see below) + office — same clip-path technique as
the weather ribbon (`components/BiliranMap.tsx`'s `WeatherBadge`), flush
top edge with the diagonal tapering the far/outer (here, bottom-left)
corner, for visual consistency between the two; its right edge tucks
behind the circle (negative margin + DOM order) so only the tapered left
edge is ever visible. The grow-then-reveal sequence is two CSS transitions
with a staggered `transition-delay` (avatar width/height, then the tab's
`max-width`/`opacity`) — confirmed via the same
`getComputedStyle`-sampled-over-time technique this project already uses
to verify CSS transitions are actually interpolating, not just present.
Clicking it opens `components/ProfilePanel.tsx` — disabled (no click) while
not revealed, since there's no profile to show yet.

**Profile** (`components/ProfilePanel.tsx`): the signed-in user's email,
editable `title`/`first_name`/`family_name`/`office` fields (`lib/profile.ts`'s
`updateOwnProfileFields()`), read-only `access_level` (never user-editable —
see the security fix below), a photo backed by a private Supabase Storage
`avatars` bucket (see `supabase/avatars-storage-setup.sql`, **not
auto-applied** — someone with Supabase dashboard/CLI access has to run it
once): upload goes through `POST /api/profile/avatar-upload-url`
(Bearer-token-authenticated, any signed-in user, no `access_level` check —
mints a tokenized `createSignedUploadUrl` scoped to `{user.id}/avatar`),
the client uploads directly to that URL via
`supabase.storage.from('avatars').uploadToSignedUrl`, then
`updateOwnAvatarPath()` in `lib/profile.ts` saves the object path on the
user's own `user_profiles` row. Display always goes through a
freshly-signed read URL (`getAvatarUrl()`), never a public bucket URL —
the bucket stays private. Also hosts, moved here from the old "+" menu, an
"Admin panel" row (`isAdmin`-gated) and "Sign out".

`ProfilePanel.tsx` exports a shared `Avatar({ url, label, sizeClassName })`
— `label` (an initial letter) when a user is known but has no photo (used
by `ProfilePanel`'s own avatar button, passed the user's email), a generic
silhouette SVG when neither is known (used by `HeaderProfileButton`
pre-login, which has no `user` at all yet) — one implementation instead of
duplicating fallback logic between the two call sites.

**Structured name fields** (`title`/`first_name`/`family_name` — not one
combined name string) were added on `user_profiles` via
`supabase/profile-name-fields-setup.sql` (same not-auto-applied pattern).
`lib/profile.ts`'s `formatDisplayName()` picks `"title first_name
family_name"` when it fits a max-length constant, else falls back to
`"title family_name"` (e.g. "Mr. Dela Cruz") — kept structured specifically
so this fallback is reliable rather than parsed from free text. That same
SQL file also fixes a real gap found while adding these columns: the
existing "update own row" RLS policy had no column restriction, so any
signed-in user could `update user_profiles set access_level = 'admin'
where user_id = auth.uid()` directly via the Supabase client — RLS
restricts which *rows* a policy covers, not which *columns*, so the fix is
a column-level `grant`/`revoke` (users can update their own `office`/
`title`/`first_name`/`family_name`/`avatar_path`, explicitly not
`access_level`), not another RLS policy.

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
- Admin sign-in toggle (the login-screen logo button) is copy/branding only, also not a security gate — real admin authorization is always the post-login `access_level === 'admin'` check
- Account creation is fully admin-controlled; no public signup
- Invite codes are device-bound only at redemption
- No AI/LLM features in the product
- Admin entry point is "Admin panel" inside the header profile button's panel (`components/HeaderProfileButton.tsx` → `ProfilePanel.tsx`), `isAdmin`-gated — not a separate menu (the old hidden bottom-right "+" FAB, with its Profile/Dashboard/Invitations/Sign out items, was removed; "Dashboard" was redundant with just being on the dashboard, "Invitations" moved into the admin panel)
- Barangays are ranked by continuous `mean_fsi_score`, never by discrete FSI class (class-based ranking was tested and rejected — it collapses most barangays into one bucket)
- Runoff thresholds are relative to each basin's own modeled peak Q (Warning 50% / Alert 75% / Danger 95%, not 100%) — disclosed as a relative proxy, not a calibrated physical threshold; there wasn't enough data (surveyed cross-sections, historical gauge records) for a calibrated approach
- A barangay touching multiple basins uses the **earliest** (most urgent) threshold crossing time across them, not an average

## Dashboard UI

`components/DashboardShell.tsx` (rendered by `app/page.tsx` in place of the
old `.bfw-dash` placeholder): a "modeled, not live" banner naming the single
most urgent upcoming Alert/Danger crossing (`components/LiveUpdateBanner.tsx`,
`mostUrgentCrossing()`), a municipality filter dropdown (`filterBarangays()`,
called with a constant `''` query — the free-text search input this used
to pair with was removed; `filterBarangays()` itself still takes a query
param, just always `''` from here now), an empty spacer reserving the real
map's layout slot (the map itself is mounted once, persistently, in
`app/page.tsx` — see "One persistent map" above, and
`components/BiliranMap.tsx` below), a barangay list ranked by
susceptibility (`components/BarangayList.tsx`, `sortBySeverity()`), and a
"Detail Overview" panel on selection (`components/BarangayDetailPanel.tsx`)
leading with the FSI class/score, then basin count and warning/alert/danger
times.

**Layout: the map is the dominant element**, not one of two panes sharing
a column with the list — it's a full-width row on its own (`h-96 shrink-0
md:h-[70%]`), with the barangay list and detail panel sharing a shorter
row below it (`md:grid-cols-[1fr_320px]`, same as before). This replaced
an earlier layout where the map only got `h-64`/`45%` of a column it split
with the list, back when the map was a smaller, single-fixed-zoom element;
it now supports continuous pan/zoom (see below) and earns more screen
space.

Ranking is **highest FSI score first** (`sortBySeverity()` in
`lib/dashboardData.ts`, mean_fsi_score descending, tie-broken by soonest
`danger_time_hours`) — an explicit product decision, not the time-based
"soonest crossing" order used earlier. The LIVE UPDATE banner still uses the
time-based `mostUrgentCrossing()` signal; the two are deliberately different
questions ("who's worst" vs. "what happens soonest") and aren't meant to
agree.

The map's `WeatherBadge` condition (Calm/Cloudy/Light rain/Rain/Heavy rain)
is driven by that same `mostUrgentCrossing()` call, not a separate or
fabricated weather value — see `weatherConditionFor()` in `BiliranMap.tsx`
for the hour thresholds. It's still a modeled-storm scalar, not a live
feed; the icon just reflects how close that one number is.

**The real map** (`components/BiliranMap.tsx`, `lib/geo.ts`): actual
barangay and municipality polygons, not a placeholder or a map-tile service
— rendered as SVG paths, projected client-side from real WGS84 lon/lat with
a simple cos(latitude)-corrected equirectangular projection (Biliran is
small enough, ~30km across, that this is accurate enough; see
`makeProjector()`). No MapLibre/tile dependency, works fully offline.

**Pan/zoom is continuous, hand-rolled, no new dependency** (an explicit
choice this session — `maplibre-gl`/a pan-zoom library were both
considered and rejected). A single `view: { cx, cy, scale }` state (island-
projected coordinate space) replaced an earlier binary `focusedMuni: string
| null` model; the `<svg viewBox>` never changes, zoom is still purely an
inner `<g transform>` SVG *attribute* (not CSS `style.transform` — same
cross-browser `transform-origin` reasoning as before), CSS-transitioned
except while the user is actively dragging/scrolling (`interacting` state
disables the transition so direct manipulation tracks the pointer
instantly instead of lagging behind it). Default view is the whole island,
**unzoomed and with no municipality pre-selected** — this decision is
unchanged; only the interaction is now continuous, never the starting
state. Interactions: `onWheel`-equivalent (a native, non-passive `wheel`
listener — React's `onWheel` prop is passive by default and can't
`preventDefault()`) zooms around the pointer position; `onPointerDown/
Move/Up` on the `<svg>` (Pointer Events cover single-finger touch drag too)
pan by converting a screen-pixel delta into island-space via
`clientPointToSvgSpace()` (`lib/geo.ts`, uses `getScreenCTM()` — correct
regardless of any aspect-ratio letterboxing between the viewBox and the
rendered box, unlike hand-rolled clientRect-ratio math); `clampCenter()`
(`lib/geo.ts`) keeps the view from panning the island fully out of frame.
**These pointer/wheel handlers are deliberately on the `<svg>` element, not
its wrapping container div** — attaching them to the container instead (an
actual bug hit and fixed in an earlier session) captures pointer events for
descendant buttons too (the back/reset button, the zoom slider), and a
`setPointerCapture()` call from a pointerdown that bubbled up from a button
silently breaks that button's own click. Two-finger pinch-zoom isn't
implemented (an accepted rough edge, not a rejected feature).

**A second, related bug from the same family, hit later**: `handlePointerDown`
used to call `setPointerCapture()` unconditionally on every pointerdown,
including a plain tap with zero movement — which turned out to *also*
suppress the browser's synthetic `click` event on whatever polygon was
tapped (same mechanism as the button bug above, just against a *descendant*
of the capturing element — the municipality/barangay `<path>`s — instead of
a sibling). This silently broke tap-to-zoom-a-municipality/barangay
entirely, undetected because earlier verification only exercised wheel/
drag/buttons, never an actual polygon click, after the handlers moved onto
the `<svg>`. Fixed with drag-vs-tap disambiguation: `handlePointerDown` no
longer captures immediately — `handlePointerMove` only starts a drag (and
only then calls `setPointerCapture`) once movement exceeds
`DRAG_THRESHOLD_PX` (5px); a tap that never crosses it is left alone, so
its native `click` reaches the polygon's own `onClick` normally. Lesson
generalized: verify *every* distinct interaction (not just some) against
real pointer/click events after touching this handler, not just visual
screenshots of state reached via a different interaction (e.g. wheel).

Tapping a municipality or picking a barangay (map or list) now **animates**
`view` toward that target's framing rather than a hard state switch — one
case of the general continuous view, not a separate code path.
`muniFocusByPrefix` (a `useMemo`) precomputes each municipality's own
"fill the frame" center + scale (7% padding, `expandBounds`), same numbers
used both for the tap-to-zoom animation and as the crossfade threshold
below. `nearestMunicipalityPrefix()` picks whichever municipality's own
focus-center the current `view.cx/cy` is nearest to (Euclidean, all 7
municipalities — cheap). `applyMuniFocus(prefix, bounds)` is the one shared
body both `focusMuni` (an actual map tap) and the `focusedMunicipality`
sync block (below) call, so a prefix + the current island bounds is all
either path needs.

`MunicipalityLayer` and `BarangayLayer` are **both always mounted** and
crossfade via a `barangayOpacity` value (0–1, a function of `view.scale`
relative to the nearest municipality's own fill scale) rather than a hard
swap — a sudden layer swap under free-form zoom, rather than a discrete
tap, would read as a glitch. `BarangayLayer` is filtered to
`nearestMunicipalityPrefix`'s barangays only (not the whole 115), same as
the old per-municipality filter, just continuously re-evaluated as the
view pans rather than fixed at tap time; its own `pointerEvents` still
flips off below ~0.5 opacity so a mostly-invisible barangay layer doesn't
intercept clicks. **`MunicipalityLayer` itself stays interactive (no
`pointerEvents` gating) at every zoom level** — a *different* municipality
can be tapped directly to jump there without resetting to the full-island
view first, the point of this session's second change. It fades only its
own currently-`nearestPrefix` municipality's fill/sheen/label/icon
(`fadeFor(prefix)`, per-feature, not a group-wide opacity like before) —
every *other* municipality stays at full opacity, both visible and
clickable regardless of how deep the view is zoomed into a different one;
`BarangayLayer`, painted after it in the DOM, still naturally wins
hit-testing over its own footprint (SVG painter's-model z-order —
independent of `opacity`), so this doesn't break barangay-level taps
within the focused municipality. Waterway opacity/stroke-width and the
dimmed rest-of-island context outlines still interpolate continuously with
`barangayOpacity`. Selecting a barangay (map or list) keeps both in sync —
`focusBarangay()` frames that specific barangay's own bounds (35%
padding), not just its municipality. Maripipi has no polygon data (see
provenance below) and renders as a plain marker; tapping it shows a note
that it isn't monitored, per the settled decision to label it rather than
hide it. Zoomed-in barangay shapes also carry their own name labels
(`BarangayLayer`, same `geometryCentroid()` + `#bfw-text-shadow` pattern as
the municipality labels).

**Two-way sync with the dashboard's municipality filter**
(`DashboardShell.tsx`'s `<select>`, lifted to `app/page.tsx` as
`focusedMunicipality`/`setFocusedMunicipality`, same shape as
`selectedKey`'s barangay sync): tapping a municipality on the map
(`focusMuni`) calls `onFocusMunicipality(municipalityForPrefix(prefix))`
(`lib/municipalities.ts`), which updates the dropdown; picking one from the
dropdown flows the other way via a `focusedMunicipality` prop and a
render-phase sync block (same pattern as `prevSelectedKey`'s, matching by
`f.properties.municipality === focusedMunicipality` rather than a prefix,
since the dropdown/`filterBarangays()` convention is municipality *names*)
that calls `applyMuniFocus`. `resetView()` (the "← All municipalities"
button) also calls `onFocusMunicipality(null)`, clearing the dropdown back
to "All municipalities" — otherwise the two could end up visibly
inconsistent (full-island map, still-filtered list).

**A third bug from the same pointer-capture-adjacent family, hit while
verifying the above**: once boxed into the dashboard, the map stopped
receiving ANY pointer events at all (drag/wheel/tap) — `.bfw-map-shell`
(the map's `position: fixed` wrapper, `app/page.tsx`) sits at `z-index: 0`,
below `.bfw-dash`'s `z-index: 10`; once `revealed`, `.bfw-dash` becomes
`pointer-events: auto`, and its own DOM content — specifically
`DashboardShell`'s *empty* map-slot spacer div, sitting exactly where the
map visually appears — stacks above the map and silently swallows every
gesture, even though the map is still visually on top (the spacer is
invisible/transparent, so you can *see* the map through it, but hit-testing
follows stacking order, not visibility). Latent since the "one persistent
map" refactor, never caught because that work's own verification only
checked the shell's measured rect, not actual interaction. Fixed two ways:
`.bfw-root[data-revealed='true'] .bfw-map-shell { z-index: 15; }` (above
`.bfw-dash`, but still below `.bfw-card`'s `10` pre-reveal so the login
card still floats over the full-bleed map as intended), plus
`pointer-events: none` on the spacer div itself as defense in depth.

New UI controls, alongside (not replacing) tap-a-municipality: `ZoomControls`
(bottom-right — `+`/`-` buttons and a slider, all driving the same
`view.scale`) and the existing top-left button, repurposed from "clear
focusedMuni" to a general `resetView()` (shown whenever `view.scale > 1.02`,
not just when a municipality was tapped).

**Ambient motion** — decorative, not data (the per-municipality weather
icons below ARE data-driven; these aren't): the sea highlight has a slow
`bfw-sea-shimmer` drift, and two semi-transparent clouds cross the
island-overview view on an infinite loop (`DriftingClouds`, shown only
below `view.scale < 1.3` — a rough "still at overview" threshold — so the
motion doesn't compete with barangay-level detail once zoomed in). Each
municipality also gets its own small weather icon on the overview map
(`WeatherIconSVG`, shared with the corner ribbon — see below), condition
computed the same way as the ribbon's, just pre-filtered to that
municipality's own barangays: `mostUrgentCrossing(barangays.filter(b =>
b.municipality === f.properties.municipality))`. Cloud shapes (here and in
`DriftingClouds`) use overlapping lobes plus a shared `#bfw-cloud-body`
radial gradient (soft off-center highlight, dimmer rim) instead of a flat
fill, for a puffier, more dimensional look — styling only, no new data.

Depth styling (all in `BiliranMap.tsx`'s `<defs>`): an SVG `feDropShadow`
filter (`#bfw-land-shadow`) applied per-layer, not per-polygon — per-polygon
would draw a visible shadow line along every internal barangay border, which
reads as messy rather than "raised"; a shared diagonal sheen gradient
(`#bfw-land-sheen`) layered on top of each polygon's fill for a glossy,
lit-from-one-corner look (deliberately stylized, not meant to read as real
terrain/hillshade — this project has no DEM data); a `#bfw-land-sheen-strong`
variant (higher-opacity stops than `#bfw-land-sheen`) used only for zoomed
barangay shapes, which render much larger on screen than the island
overview and made the original subtle sheen read as flat at that scale; a
radial highlight on the sea (`#bfw-sea-glow`); a `.bfw-map-poly:hover`
brightness lift; and a tighter `#bfw-text-shadow` filter (plus bolder
weight) on municipality/barangay labels for legibility over the varying
fill colors beneath them. The `Legend` and back button keep the
`rounded-full`/`shadow-lg ring-1 ring-white/10 backdrop-blur-md` glass-chip
look; `WeatherBadge` deliberately does not (see below) — it's a corner
ribbon, not a chip, on purpose. The municipality-zoom target bounds use a
tight 7% padding (`muniFocusByPrefix`) so tapping a municipality fills
most of the frame with it, not a small shape adrift in a lot of open sea.

**`WeatherBadge` is a corner ribbon, not a rounded chip** — a deliberate
departure from the `Legend`/back-button glass-chip look, because a pill
shape reads as clickable (like the back button next to it) when this is a
passive readout. `clip-path: polygon(0 0, 100% 0, 100% 100%, 24px 100%)`
on a `right-0 top-0`-positioned div (flush, not inset) makes a
right-trapezoid — top edge fully flush with the map card's top edge, the
diagonal tapering the ribbon's bottom-left corner instead (an earlier
version had this backwards, `polygon(24px 0, 100% 0, 100% 100%, 0 100%)`,
leaving a flush *bottom* and an indented *top* — a less correct read for a
badge hanging from the top-right corner; fixed after a side-thread
proposal flagged it and it was verified with a screenshot, not just
trusted). The container's own `overflow-hidden` + `rounded-xl` clips the
ribbon's outer corner to match the card's curve for free, so the ribbon
itself needs no border-radius. A plain `border`/`box-shadow` doesn't
follow a `clip-path`'d box correctly — depth comes from `filter:
drop-shadow(...)` instead. The cloud+rain-drop markup itself lives in a
shared `WeatherIconSVG` fragment (no wrapping `<svg>`/positioning), reused
both by the ribbon and, scaled way down, by each municipality's own icon
on the overview map (see above).

Three things to keep in mind if you touch this styling again: (1) `#bfw-land-sheen`
must stay `gradientUnits="userSpaceOnUse"` with `x1`/`y1`/`x2`/`y2` pinned to
`islandBounds`, not the SVG default `objectBoundingBox` — with the default,
every polygon draws its own independent light sweep across its own bounding
box, and since many of Biliran's barangays are long, thin coast-to-interior
wedges (real geometry, common here — not a data error), that reads as a
shattered-glass stripe pattern once zoomed in, rather than one light source
across the scene. (2) `BarangayLayer`'s *unselected* stroke is a translucent
dark seam (`rgba(11, 30, 40, 0.3)`, 0.0003 wide), not a bright/white one —
a bright stroke on every one of those same thin wedges is the other half of
that same "shattered" look, this time from the borders rather than the
sheen. The selected barangay's white, thicker stroke is unaffected and
should stay bright so selection still pops. (3) **CSS `transform` functions
need an explicit unit even on SVG elements** — `translateX(0.4)` (bare
number) is invalid CSS and gets silently dropped, so a `@keyframes`
animation written that way is present in the DOM but never actually
moves anything (no console error either — it just does nothing). This is
different from the SVG `transform` *attribute* (e.g. the zoom `<g
transform="...">`), which does accept bare numbers. Append `px` — for an
SVG element this is interpreted as that many SVG user units, not real
device pixels, which is exactly what the tiny fractional-degree coordinate
space here needs (`bfw-sea-shimmer`, `bfw-cloud-cross`, and the original
rain-drop-fall keyframe all rely on this). Verify a new CSS-driven SVG
animation actually runs by diffing `getComputedStyle(el).transform` at two
points in time, not by checking the CSS is present — both animations were
built once already and silently did nothing until checked this way.

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
- Profile photo upload (`supabase/avatars-storage-setup.sql`) is written but not verified against a real Supabase project — only linted, type-checked, and built (same caveat as the rest of this repo's Supabase-dependent code). Someone with dashboard/CLI access needs to run the SQL once before it works end to end.
- The "Invitations" admin panel is create/list only; no revoke/expire-early or edit UI.
- None of the new Supabase-dependent code (`/api/admin/invite`, `lib/profile.ts`'s RLS assumption) has been run against a real Supabase project — only linted, type-checked, and built. Verify the `user_profiles` "read own row" RLS policy actually exists before relying on the Profile panel.
- The map's pan/zoom has no two-finger pinch-zoom yet (single-finger touch drag-to-pan works via Pointer Events) — an accepted rough edge of the hand-rolled implementation, not a rejected feature.
