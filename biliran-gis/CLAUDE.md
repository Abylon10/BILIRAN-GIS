# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project overview

Biliran Flood Risk Monitor — a flood early-warning web app for MDRRMO officials in
Biliran province, Philippines. **Not public-facing**: access is restricted to
MDRRMO personnel and barangay presidents across 7 of Biliran's 8 municipalities
(Naval, Almeria, Biliran, Cabucgayan, Caibiran, Culaba, Kawayan — **Maripipi is
excluded** for resource constraints and does not appear on the map at all, no
polygon data and no marker). Core design intent: tell officials how much time
remains safe for evacuation before conditions become unsafe — a countdown, not
just a static risk color.

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

**One persistent map, always full-bleed — not a decorative login backdrop
swapped for a real one, and no longer boxed into a dashboard layout slot
post-login either.** A single `<BiliranMap>` instance mounts in
`app/page.tsx` itself (not inside `DashboardShell`) as soon as `authState
!== 'checking'`, the same real interactive map throughout, not a
hand-drawn placeholder (`IslandScene`, removed long before this). Its
wrapping `.bfw-map-shell` div is a plain `position: fixed; inset: 0` CSS
rule — no JS-measured rect, no `useLayoutEffect`, no shared-element
transition between two sizes, because there's only ever one size now: the
map fills the viewport at all times once mounted, both pre-login (behind
the login card) and post-login (behind the header-controls row and the
toggleable sidebar — see "Toggleable sidebar" below). This replaced an
earlier `mapRect`/`mapSlotRef` mechanism (a `useLayoutEffect` measuring an
empty spacer div inside `DashboardShell`, CSS-transitioning the map's
`top/left/width/height` between a full-viewport rect and that spacer's
boxed rect) that existed only because `DashboardShell`'s list/detail panel
used to share screen space with the map, inline below/beside it — once
that content moved into its own toggleable sidebar instead (a separate
overlay, not a layout sibling the map needs to make room for), the whole
measurement mechanism became unnecessary and was removed, not just
simplified. `barangays`/`selectedKey` are still lifted from
`DashboardShell` into `app/page.tsx` (loaded as soon as `authState !==
'checking'`, same early-fetch tradeoff as the map's own geojson — it's
static public JSON, no auth needed) so the persistent map and
`DashboardShell`'s list/detail panel share one fetch and one selection
instead of each owning a copy.

**Toggleable sidebar — barangay list, FSI detail panel, and everything
else that isn't "the toggles."** Once revealed, the map shows nothing but
itself plus two floating controls in the top-right header-controls row —
the Day/Night theme toggle and the profile button — plus a separate
slide-arrow handle on the right edge (see below) that opens/closes the
sidebar. Everything else — the dashboard title/subtitle, the live-
forecast/honesty banner, the LIVE UPDATE/MODELED ALERT banner, the
municipality filter dropdown, the barangay list, and (once a barangay is
selected) its FSI detail panel (`BarangayDetailPanel`) — lives inside a
toggleable sidebar (`<aside className="bfw-sidebar ...">` in
`app/page.tsx`), closed by default, opened/closed only via the handle —
**never** automatically by selecting a barangay (confirmed directly:
tapping a barangay's polygon on the map selects/focuses it exactly as
before, but does not force the sidebar open — a separate compact card
handles that case instead, see "Compact FSI-corner card" below).
`DashboardShell` itself no longer owns any map-layout concerns at all —
it's purely the sidebar's scrollable content now (see its own file
header). Inside the sidebar, `BarangayDetailPanel` (when something is
selected) is now rendered **above** the barangay list, not after it — the
list can run to ~115 rows, so appending the detail panel after it meant
it was invisible without scrolling past the entire list first; pinning it
above means opening the sidebar with something selected shows the full
FSI/hydrograph/factor-breakdown detail immediately.

The sidebar slides in from the **right** (an explicit instruction this
round, overriding an earlier round's left-side choice — see below for the
accepted trade-off), reusing `AdminShell.tsx`'s exact mobile-nav-drawer
CSS pattern (`AdminShell.tsx`'s own `.bfw-admin-drawer`/`.bfw-admin-
drawer-backdrop`) rather than inventing new transition mechanics: a
semi-transparent click-to-close backdrop (`.bfw-sidebar-backdrop`,
`rgba(0,0,0,0.4)`, opacity-faded via `data-open`) and the sliding panel
itself (`.bfw-sidebar`, `transform: translateX(100%)` → `translateX(0)`
on `data-open='true'`, 250ms `cubic-bezier(0.22,1,0.36,1)` — the one
house easing curve this app reuses for every transition — disabled under
`prefers-reduced-motion: reduce`). Full-width (`w-full`) at every
viewport size, not just narrow ones — an earlier version capped it at
`sm:max-w-[380px]` on larger screens, but the explicit ask this round was
for the open sidebar to "cover the whole map" so the list and FSI detail
have the full screen to themselves, not a cramped strip. **Accepted
trade-off**: `BiliranMap`'s own floating chrome is lopsided —
`WeatherBadge`, `ZoomControls`, and `NextForecastBadge` all live on the
right, only `Legend` is on the left — so a right-side sidebar now
overlaps that chrome more than a left-side one would have. Not
repositioned here; confirmed via screenshot the overlap is only visible
while the sidebar is actually open, same "acceptable gap" posture this
codebase already applies to other hand-placed overlay positioning.

**Slide-arrow handle, replacing the old header-row toggle button.**
`.bfw-sidebar-handle` is a separate `fixed` sibling — deliberately **not**
nested inside `.bfw-sidebar` — because a CSS `transform` on an ancestor
establishes a new containing block for any `position: fixed` descendant
(the same gotcha `ProfilePanel.tsx`'s lightbox already hit once, see
below): a handle nested inside the transformed sidebar would move
off-screen along with it while closed, instead of staying reachable at
the viewport edge. Its own `right` offset animates in sync with the
sidebar's `transform` instead (same 250ms `cubic-bezier(0.22,1,0.36,1)`):
flush against the edge (`right: 0`) when closed, `right: calc(100% - 28px)`
when open — **not** a bare `right: 100%`, which for a fixed element
moves its right edge to the viewport's left edge, pushing the whole
28px-wide handle off-screen rather than flush against it (a real bug
caught via Playwright: the handle became unclickable once opened on a
narrow viewport, confirmed by the exact math before fixing it). One rule
now covers every viewport size — the earlier desktop-only `@media
(min-width: 640px) { right: 380px }` override was removed once the
sidebar itself became full-width at every size (see above), since there's
no longer a second, narrower desktop width to track. Contains a small
chevron that rotates 180° via `data-open`. Rendered only when `revealed`,
same gating the old toggle button had.

**Compact FSI-corner card** (`components/SelectedBarangayCorner.tsx`) —
shown whenever a barangay is selected **and** the sidebar is closed, so
its FSI score/class/countdown is visible at a glance without opening the
sidebar at all. Deliberately separate from, and simpler than, the admin
dashboard's own `SelectedBarangayCard` (`components/
UserDashboardModal.tsx`) — no thumbnail map, no simulation fields, both
admin-only concepts — but follows the same established spirit already
settled there: a compact summary card kept distinct from the full detail
panel, not one component trying to do both. Positioned `fixed right-5
top-24` — below the header-controls row, deliberately **not** vertically
centered like an earlier version was: `.bfw-sidebar-handle` (above) is
vertically centered on the same right edge, so centering this card too
made it visually sit on top of (hide) the handle, reported directly and
confirmed via screenshot. Mount-triggered `@keyframes` slide-in from the
right (300ms, same house easing, respects `prefers-reduced-motion`) —
same entrance-only-animation technique as `AdminInvitePanel.tsx`'s
`.bfw-edit-row-enter`, no exit animation needed since it only unmounts
(selection changes/clears, or the sidebar opens — at which point the same
info is already pinned at the top of the open sidebar, so showing both
would be redundant). The whole card is a button; tapping it opens the
full sidebar.

z-index: `.bfw-sidebar-backdrop`/`.bfw-sidebar` sit at `z-16`/`z-17`,
`.bfw-sidebar-handle`/`SelectedBarangayCorner` at `z-18` — all above the
map (`z-15` once revealed) but below the header-controls row (`z-20`,
unchanged), so the theme/profile toggles stay reachable and visible at
all times, and below `AdminShell`/`ProfilePanel` (`z-50`) so those
full-takeover views still paint on top of everything. The sidebar's own
header band now reserves `paddingTop: 84` — now that it shares the same
(right) edge as the header-controls row, its top-right corner sits
directly under that floating row (the same collision shape the old
`.bfw-dash` title band once had against it, rotated to the vertical axis
since both now anchor to the same edge) — same hand-tuned-constant,
confirmed-via-screenshot discipline as that original fix. The sidebar is
only rendered once `revealed` — unlike the old always-mounted `.bfw-dash`
(kept mounted pre-login purely to give `mapSlotRef` a measurable position
before sign-in), nothing downstream needs this mounted early anymore,
since there's no more measurement to keep warm.

**Two-column sidebar body (list | FSI detail), `lg:` and up** — a later
round split what had been one full-width stacked column (the pinned
`BarangayDetailPanel` above a ~115-row `BarangayList`) into a
`grid grid-cols-1 lg:grid-cols-2 min-h-0 flex-1 gap-4` row inside
`DashboardShell.tsx`, now that the sidebar is full-width and has the room:
the list is `order-2 lg:order-1` (second/below on mobile, matching the
original stacked behavior exactly; first/left on desktop) and the detail
panel is `order-1 lg:order-2` (first/above on mobile, preserving the
"pinned above the list" fix; second/right on desktop). `BarangayDetailPanel`
renders unconditionally now (it already has its own "Select a barangay..."
placeholder for a null `barangay`), not gated on `selected` — no separate
placeholder needed for this column. Each column scrolls independently
(`min-h-0 overflow-y-auto` on both), the same pattern already used for the
admin Rainfall & Scenarios tab (`UserDashboardModal.tsx`) — and the same
lesson applies: the full ancestor chain needs a real height constraint for
it to work, which is why `app/page.tsx`'s sidebar body wrapper dropped its
own `overflow-y-auto` (now `flex min-h-0 flex-1 flex-col`, just passing
height down) — two scroll owners (the wrapper and the inner grid) would
have meant one shared scrollbar instead of two independent ones.
`DashboardShell`'s own root div is `flex h-full min-h-0 flex-col`.

**Sidebar body background: solid `--sidebar-body-bg`, not
`backdrop-blur-xl`** — the full-width sidebar (above) originally got
`backdrop-blur-xl` over `var(--body-bg)` to stop the map's busy terrain
geometry from reading through sharply behind every list row. Reported
directly as a lagginess regression on lower-end devices: `backdrop-filter:
blur` is one of the GPU-heaviest CSS effects, and it was running over the
entire viewport, continuously re-composited while the map's own ambient
animations (sea shimmer, drifting clouds, weather icons) kept playing
underneath it. Fixed by dropping the blur filter entirely and using a new,
dedicated, more-opaque `--sidebar-body-bg` custom property instead (defined
per-theme alongside `--header-bg`/`--body-bg`/`--separator`) — plain solid
fills are dramatically cheaper than any `backdrop-filter`, and a solid-
enough fill was the thing that actually fixed the original legibility
complaint, not blur specifically. Deliberately a new variable rather than
bumping the shared `--body-bg`, since `AdminDashboardTab.tsx` also reads
`--body-bg` for an unrelated progress-bar track that shouldn't change.

**`pauseAnimations` prop — sidebar-open also pauses the map's ambient
animations.** `BiliranMap.tsx` already had an `animationsPaused` state
(Page Visibility API — pauses sea shimmer/clouds/weather-icon drift while
the tab is backgrounded, via a `bfw-anim-paused` class forcing `animation-
play-state: paused !important` on every descendant). `app/page.tsx` now
passes `pauseAnimations={sidebarOpen}`, OR'd into the same class decision
(`animationsPaused || pauseAnimations`) rather than a second mechanism —
once the sidebar can cover the entire map (full-width, above), there's no
visual reason to keep animating underneath it, so this is pure wasted
CPU/GPU avoided while it's open, the other half of the lagginess fix above.

**Further perf pass: pause ambient animations during active pan/zoom too,
and stop three overlay components re-rendering on every pan frame.**
Reported lag persisted even with the above fixes, so investigated what
else runs continuously during an actual drag-pan gesture (not just while
the sidebar happens to be open):
- The `bfw-anim-paused` class condition above is now `animationsPaused ||
  pauseAnimations || interacting` — `interacting` is an existing state
  (`BiliranMap.tsx`) already used to disable the zoom-group's eased CSS
  `transition` during an active drag/wheel-zoom gesture (so direct
  manipulation tracks the pointer instantly). It's a Boolean, not a CSS
  `transition`, so toggling the animation-pause class doesn't fight with
  it — the sea shimmer/clouds/weather-icon-drift animations simply stop
  compositing for the gesture's duration (set once per gesture, not
  per-frame) and resume the instant it ends, same zero-visual-cost
  reasoning as the tab-hidden/sidebar-open cases above. This matters most
  exactly when the browser is already busiest: every pan frame calls
  `setView()` from a rAF-throttled `pointermove` handler.
- `ZoomControls`, `WeatherBadge`, and `NextForecastBadge` are now
  `React.memo`-wrapped, matching the pattern `DriftingClouds`/
  `MunicipalityLayer`/`BarangayLayer`/`WeatherIconSVG` already used — all
  three were previously plain functions, so they re-rendered on *every*
  `BiliranMap` re-render, including every single pan-drag frame, even
  though their actual props (`crossing`/`condition`, `updateAt`) are
  stable across a pan (nothing about panning changes the current weather
  or forecast countdown). Memoizing `ZoomControls` required one more
  fix to actually take effect: its `onChange` prop (`setScale`) was a
  plain function declaration recreated fresh every render, which would
  have failed `ZoomControls`' shallow prop comparison every time regardless
  of memo. `setScale` is now a `useCallback` reading `cx`/`cy` through the
  functional `setView(prev => ...)` form rather than closing over
  `currentView` directly — `currentView.cx/cy` change on every pan frame,
  so a naive `useCallback` keyed on it would still get a new identity just
  as often; keying only on the already-stable `islandBounds` `useMemo`
  keeps the reference fixed for the whole gesture. (Like `focusMuni`/
  `handleBarangaySelect` already did, this `useCallback` has to live above
  `BiliranMap`'s early-return loading/error guards — a Hook can't run
  conditionally — so it's declared alongside them, not where the old plain
  `setScale` function sat below those guards.)
- None of this touches the actual SVG geometry (barangay/municipality/
  waterway polygons are ~4,700 total vertices with waterways off by
  default, ~11,600 with them on — not itself the bottleneck investigated
  here) — a future pass simplifying that geometry (e.g. via `mapshaper`)
  remains a separate, bigger lever if lag is still reported after this.

**Waterways merged into one `<path>` element instead of 448 separate
ones — the single biggest measured lag contributor found.** Lag was
still reported after every pass above, with no specific repro — rather
than guess again, profiled directly: `page.context().newCDPSession()` +
`Emulation.setCPUThrottlingRate({ rate: 4 })` (simulating a lower-end
device on this fast dev machine) + injected `requestAnimationFrame`
frame-timing and a `PerformanceObserver` for `longtask` entries, run
across several real interactions. Dragging the map with waterways off
averaged ~23ms/frame with ~0.3s of main-thread long-task time over a
~2.3s drag — tolerable. Toggling waterways on and dragging the exact
same gesture: ~45ms/frame average, a 1.4s single-frame stall, and **35
long tasks totaling 4.5s of the 6.5s test — 70% of the interaction
blocked on the main thread.** By a wide margin the worst case measured,
and the only variable changed between the two runs was the waterways
toggle.

Root cause: `waterwayPaths` (`BiliranMap.tsx`) rendered each of the
~448 `LineString` features as its own `<path>` DOM element inside
`.bfw-zoom-group`, the `<g>` whose `transform` updates every pan/zoom
frame. 448 separate elements means 448 separate things for the browser
to paint/recomposite bookkeeping on every transform change, even though
they share one stroke/fill and have no per-segment interactivity
(no `onClick`, no distinct styling) — nothing requires them to be
separate DOM nodes. Fixed by concatenating all 448 `d` strings (each
already its own complete `M...L...` subpath) into one string, rendered
as a single `<path>`, via `.join(' ')` — SVG renders multiple
independent subpaths within one `<path>` element identically to the
same subpaths as separate elements, but it's one DOM node instead of
448. Re-ran the identical profiling script afterward: the waterways-on
drag test's long-task time dropped from 4.5s to 0.7s (an ~84%
reduction), dropped frames (>33ms) from 42 to 18, frames slower than
10fps from 17 to 3, and average frame time from ~45ms to ~31ms.
Confirmed visually unchanged (same screenshot, same coastline clipping)
and confirmed via DOM query that exactly one `<path
stroke="#1CA7D6">` element now exists instead of 448.

**Max zoom capped at 1.5x (`MAX_SCALE` in `BiliranMap.tsx`), down from 9x,
tightened in two steps** — lag was still reported after the fixes above,
so the next direct ask was to cut the zoom range itself: first to 1.8x
(confirmed as ~10% of the old 9x range: `1 + (9-1)*0.10 = 1.8`), then
further to 1.5x by direct request after 1.8x still felt laggy. `clampView`
already clamps every view-setting path (`focusMuni`/`focusBarangay`/
`setScale`/wheel-zoom) to `MAX_SCALE`, so changing this one constant
uniformly caps tap-to-zoom, the zoom slider, and wheel/pinch-zoom
together — no per-call-site changes needed at either step.

The first drop (to 1.8x) surfaced a real correctness trap, not just a
tightness trade-off: measured directly, every municipality's own "fill the
frame" scale (`muniFocusByPrefix[prefix].scale`, used to frame a
tap-to-zoom) is 1.9x-2.8x — already above that ceiling. `barangayOpacity`
(the fade-in that reveals barangay polygons and, past 0.5, makes them
clickable) is computed from `lowThreshold`/`highThreshold` derived from
that same per-municipality scale (`muniFillScale * 0.55`/`* 0.85`) — left
unclamped, those thresholds would sit at or past the hard ceiling for most
municipalities, so `barangayOpacity` could never cross 0.5 and tapping
individual barangays on the map would silently stop working for them.
Fixed by clamping `muniFillScale` itself to `MAX_SCALE` before deriving the
thresholds (`Math.min(MAX_SCALE, muniFocusByPrefix[...].scale)`) — since
that clamp reads `MAX_SCALE` directly, the later 1.8x→1.5x drop needed no
further code change, just re-verification (tapping each of the 7
municipalities, reading the barangay layer's own clickable-path count,
confirming every one still reveals and allows selecting its barangays at
whatever the current cap is).

**"Modeled Alert" banner removed** — `components/LiveUpdateBanner.tsx`
(the single-highest-risk-barangay banner showing a "Modeled {tier}" badge,
e.g. "MODELED ALERT") was removed from `DashboardShell.tsx`'s render (its
one call site, between the honesty banner and the municipality filter) by
direct request. The component file itself is left in place, unused, rather
than deleted outright — only its one import/call site in `DashboardShell`
changed. (`BarangayDetailPanel`'s unrelated "Modeled from a single
synthetic 2-hour design storm..." hydrograph/precipitation captions are a
different, lowercase, still-present use of the word "modeled" — not this
banner, not touched here.)

**`WeatherBadge` reshaped: shorter but wider, taper rescaled to match** —
by direct request ("fix trapezoid in the center — centralize the design,
smaller but longer"), read as reshaping the badge now that its horizontal
centering (`left-1/2 -translate-x-1/2`, from an earlier round) was already
confirmed working. Vertical padding reduced (`py-2`/`sm:py-2.5` →
`py-1`/`sm:py-1.5`), horizontal padding increased (`pl-6 pr-6`/`sm:pl-8
sm:pr-8` → `pl-9 pr-9`/`sm:pl-11 sm:pr-11`), the inner `WeatherIconSVG`
shrunk slightly to fit the tighter vertical space (`h-6 w-7 sm:h-7
sm:w-[34px]` → `h-5 w-6 sm:h-6 sm:w-7`), and the clip-path's taper scaled
down from 24px to 14px to match the flatter shape — the original 24px
diagonal was tuned for the old ~48px-tall badge; left unscaled on a
shorter badge, the diagonal would read disproportionately steep.

**Known limitation: this environment cannot play back a video the user
attaches** — confirmed directly (not assumed) when a screen recording was
used to report ongoing lag: the bundled `ffmpeg` here is a Playwright-
internal build compiled with `--disable-everything` (only
mjpeg/webm/vp8/png — no MP4/H.264 demuxer at all), and the bundled
Chromium's own `canPlayType('video/mp4; codecs="avc1...")` returns `''`
(no H.264 decoder in that browser build either). Any future round driven
by an attached video needs to work from the user's text description alone
unless a decodable format (e.g. a GIF, individual screenshots, or a webm/
vp8 recording) is provided instead — don't silently guess at video content
that was never actually viewed.

**Waterways on/off toggle, default OFF** — a new icon-only `.bfw-btn` in
the header-controls row (`app/page.tsx`, left of the Day/Night button,
only rendered once `revealed`) toggles `showWaterways` state, passed to
`BiliranMap`. The waterway/river line overlay (`waterwayPaths`, ~448 SVG
`<path>` elements — real per-frame SVG-paint cost) now only renders inside
a `{showWaterways && (...)}` gate; the underlying geojson fetch is
unchanged (cheap, still loaded eagerly via the existing `Promise.all`) —
only the expensive part of actually drawing the paths is skipped when off.
Defaults to **off** on first load, no persistence (resets every load) —
confirmed directly: the ask was specifically a lower-end-device
optimization, so the lighter-weight state is the default, not the
previous always-on look.

**When on, waterways render at a fixed, fully-visible opacity/width, not
ramped with zoom** — the original implementation ramped both `opacity`
(0.35→0.65) and `strokeWidth` with `barangayOpacity`, dim at the island
overview and only reaching full strength near barangay-level zoom (a
"subtle context" design intent from when this layer was always-on).
Reported directly as reading like the lines were "in the background"
rather than the permanently-visible overlay a deliberate toggle should be
— now `opacity={1}`, `strokeWidth={0.0009}` (the old formula's own
max value, now fixed rather than a ceiling), unconditional on zoom. The
toggle itself is still the only on/off control; this only changed what
"on" looks like.

**Waterways clipped to the island's own landmass.** The raw waterway line
geometry isn't guaranteed to stay inside the coastline — reported directly
(most visible around Culaba, but not a Culaba-specific bug: the data isn't
clipped anywhere), some segments rendered past municipality polygons into
open sea. Fixed with a `<clipPath id="bfw-island-clip">` added to the
`<svg>`'s existing `<defs>` block, containing one `<path>` per municipality
(reusing the already-memoized `municipalityPaths` map) — SVG unions
multiple `clipPath` children by default, so this clips to "inside any
municipality polygon," i.e. the real landmass (the 7 municipalities tile
the whole island with no gaps, so their union *is* the coastline). Applied
via `clipPath="url(#bfw-island-clip)"` on the waterways `<g>` only —
municipality/barangay polygons are themselves the landmass and can't
overflow it, so no other layer needs this.

**Barangay labels decluttered in dense municipalities.** `BarangayLayer`
previously rendered every barangay's name label unconditionally at a fixed
font size with no collision avoidance — municipalities with many small,
tightly-packed barangays (Culaba: 34) overlapped illegibly, reported
directly. A new `labeledKeys` `useMemo` (same `[features, project]` deps
as the existing `barangayPaths` memo) now decides which barangays get a
visible label: each candidate's label gets an *approximate* bounding box
(width ≈ `label.length * fontSize * 0.62`, height ≈ `fontSize * 1.4`, both
padded ×1.15 for a visual gap) — no real DOM text measurement (no extra
render/measure pass for up to ~48 labels per municipality switch), this
estimate is standard practice for SVG label placement and only needs to be
roughly right, confirmed directly via Playwright (zero overlapping
barangay-label pairs across the three densest municipalities after this).
Candidates are sorted by their own polygon's bounding-box area descending
(`boundsOf`, already imported) — bigger barangays get label priority, both
because they have more room and are arguably more important to label —
then walked in that order, accepting a label only if its padded box
doesn't overlap any already-accepted one. A barangay whose label loses out
keeps its polygon exactly as colored/clickable as always; only its
`<text>` goes unrendered — selecting it from the list or by its visible
neighbors still works identically.

**Follow-up: the municipality's own name label could still overlap its
barangay cluster.** The decluttering above only prevented barangay labels
from overlapping *each other* — it never accounted for the current
municipality's own big title (`MunicipalityLayer`), which shares a
continuous `fadeFor(prefix) = Math.max(0, 1 - barangayOpacity)` cross-fade
with that municipality's filled shape and weather icon as the barangay
layer fades in. Being continuous rather than a hard cutoff, there's a real
window — anywhere a zoom/scroll lands between `lowThreshold` and
`highThreshold`, not just a tap that jumps straight to max scale — where
the municipality's own name is still partially-to-fully opaque at the same
time the barangay labels underneath are too. Culaba is where this read
worst (reported directly, confirmed via screenshot) because its barangay
cluster sits right at/near its own municipality centroid, i.e. exactly
where its own label is positioned — but the mechanism itself isn't
Culaba-specific.

Fixed by giving **only the text label** (not the shape or weather icon,
which keep their existing graceful `fadeFor` cross-fade — colored-area-
over-colored-area has no legibility problem) a hard cutoff instead:
```
const labelOpacity = isFocused && barangayOpacity > 0 ? 0 : fadeFor(f.properties.pgc_prefix)
```
The moment `barangayOpacity` for the current (`nearestPrefix`-matching)
municipality rises above 0 at all, its own label snaps toward 0 (the
existing `transition: 'opacity 0.4s ease'` on that same element still
animates the snap smoothly, just targeting a binary 0/1 instead of
continuously tracking `barangayOpacity`) — it only shows again once fully
back at the island-overview framing. Confirmed via Playwright: swept the
full achievable zoom range via the slider (not a single tap, which would
skip past the transition window) while centered on Culaba, reading both
the municipality label's and every barangay label's live computed
opacity at each step — never simultaneously visible at any point.

**Follow-up: `barangayOpacity` could never actually reach 0 — Culaba's
barangay content was already showing on first page load, before any
tap/zoom.** The hard-cutoff fix above assumed `barangayOpacity` genuinely
reaches 0 at the island-overview default — reported directly that it
didn't: Culaba's barangay-level polygons/labels were partially visible
right from entering the site. Root cause, traced in the same block as
`muniFillScale` above: `lowThreshold = muniFillScale * 0.55` and
`highThreshold = muniFillScale * 0.85` were computed directly against
`muniFillScale`, which the zoom-cap rounds already left uniformly clamped
to `MAX_SCALE` (1.5) for every municipality (every real natural fill
scale, 1.9x-2.8x, exceeds it). That put `lowThreshold` at `0.825` —
**below 1, the view's own minimum achievable scale** — so
`barangayOpacity` could never reach exactly 0 for whichever municipality
`nearestMunicipalityPrefix` resolves to, which happens unconditionally
even at the untouched default view (Culaba, being geometrically nearest
the island's own center). This was also silently why the municipality-
label hard-cutoff above made Culaba's own name invisible even at the
default view — same root cause, not a separate bug.

Fixed by anchoring the two thresholds to the *achievable* range `[1,
muniFillScale]` instead of starting from zero:
```
const lowThreshold = 1 + (muniFillScale - 1) * 0.55
const highThreshold = 1 + (muniFillScale - 1) * 0.85
```
This guarantees `lowThreshold >= 1` always (since `muniFillScale >= 1` by
construction), so `barangayOpacity` is exactly 0 at the true minimum scale
regardless of whatever `MAX_SCALE` happens to be tuned to later — fixing
the mechanism generically rather than re-deriving magic numbers each time
`MAX_SCALE` changes. Confirmed via Playwright, reading the actual
opacity-bearing wrapper (`<g style={{opacity: barangayOpacity}}>` around
`BarangayLayer` — its own `<text>` children never set their own opacity,
so `getComputedStyle` on a leaf label is meaningless; CSS `opacity` isn't
inherited into a child's own computed style, only into rendering) rather
than any individual label: at a completely fresh load, that wrapper's
opacity is `0` and Culaba's own municipality name renders at opacity `1`,
matching every other municipality.

**Waterways made bolder, and the toggle button lights up when on.**
`#7EC8D9` (the waterway line color) read as a pale, washed-out cyan
against the warm terrain palette, reported directly — bumped to a more
saturated `#1CA7D6`, with `strokeWidth` increased from `0.0009` to
`0.0015` (now comparable in visual weight to a selected barangay's own
border). `app/page.tsx`'s waterways toggle button previously only dimmed
via `opacity` when off (`0.55`) — a subtle difference that read like a
disabled control, not an on/off light. When on, the icon's `currentColor`
switches to `#1CA7D6` and a glow `boxShadow` is layered on top of (not
replacing) `.bfw-btn`'s own embossed shadow values — replacing the whole
`boxShadow` instead of appending to it would have made the button look
flat/different from every other header button while lit.

**Follow-up: the off state needed its dim back — off was reading brighter
than on.** The first pass above dropped the off-state opacity entirely
(full opacity both ways, color+glow as the only differentiator), reported
directly as backwards: off looked lit, on looked dim. Root cause: `
--btn-text` (`.bfw-btn`'s default icon color) is `#FBFEFF`, a near-white,
in *both* themes — at full opacity that reads bright/crisp on its own, and
`#1CA7D6` (the on-state accent, a mid-saturation blue) is actually *less*
luminant than near-white, especially against the light theme's own
blue-teal button background (`#6BA3BE` → `#0C969C`), where it can nearly
blend in rather than pop. Fixed by restoring `opacity: 0.45` for the off
state specifically (not a revert to the original opacity-only approach —
on keeps its `#1CA7D6` color + glow) — off is now dim/muted and on is full
brightness plus the accent and glow, giving both states unambiguous
contrast regardless of theme.

**Follow-up 2: the on-state "glow" still wasn't reading as a light,
because its own accent color was too close to its surroundings.**
Reported again after the above: "no light when the waterway toggle is
on." Checked via `getComputedStyle` on the button/svg/every `<path>` in
both states — `color`, `boxShadow`, and `stroke` (inherited via
`currentColor`) all resolved exactly as coded; this was never a CSS
correctness bug. The real issue, confirmed by screenshotting the button
at 2x device-scale zoomed tight to just its own bounds: `#1CA7D6` (both
the icon and the glow) sits in the same blue-teal hue family as
`.bfw-btn`'s own gradient (`--btn-from`/`--btn-to`, teal-to-dark-teal in
both themes) *and* the page's own sky gradient background (`#274D60` →
`#0A7075`/`#032F30`→`#031716`) — a cyan glow on a teal button on a teal
page blends in rather than pops, no matter how technically correct the
box-shadow is. Fixed by swapping the on-state to a warm amber — a
near-complementary hue against all that teal — with a lit-bulb radial
background (`radial-gradient(circle at 50% 35%, #FFD166, #E8A23D 60%,
var(--btn-to))`) and a two-layer halo (tight 14px + wide 32px blur,
`rgba(255, 209, 102, …)`) layered on `.bfw-btn`'s own embossed shadow.
Confirmed visually: off is dim teal, on is an unmistakable glowing amber
bulb with a visible halo — screenshotted side by side.

**Follow-up 3: amber worked, but cyan was asked for specifically.** The
hue-contrast fix above worked, but the request was for a cyan light, not
a color change to amber. Went back to cyan without reintroducing the
original problem (a muted mid-tone cyan blending into the teal
background) by leaning on a *lightness* jump instead of a hue jump: a
bright, highly-saturated "electric" cyan (`#7DF9FF` center fading to
`#11B4D6`, icon `#E0FFFC`) well past the page/button's own darker,
desaturated teal tones, same lit-bulb radial background + two-layer
halo structure as the amber version (`rgba(94, 234, 255, …)`). Confirmed
visually: reads as a glowing cyan bulb, clearly distinct from both the
dimmed off state and the darker teal backdrop.

**Sidebar handle arrow enlarged.** `app/page.tsx`'s `.bfw-sidebar-handle`
chevron icon was `h-4 w-4` (16px) inside a `h-16 w-7` pill — too small to
read clearly at a glance, reported directly. Bumped to `h-6 w-6` (24px)
with `strokeWidth` nudged from `2` to `2.25` to keep the line weight
proportionate at the larger size; still comfortably fits inside the
pill's 28px width. No change to the pill's own size or the
`right: calc(100% - 28px)` open-state offset (both already sized for
the handle's 28px width, not the icon). Confirmed visually in both
closed and open states via a tightly-cropped 2x-scale screenshot.

**`MunicipalityLayer` tap-to-zoom stall — the real source of "tapping or
changing location is lagging," isolated to one specific layer, not the
map in general.** Reported alongside the glow issue above, with a
specific repro this time ("when tapping or changing location"), not a
vague "its laggy" — reused the CDP-throttle + longtask-profiling
methodology from the waterway-merge fix above, this time isolating a
plain municipality tap with no drag mixed in. Measured a single ~150-
220ms longtask under 4x CPU throttle purely from tapping Culaba or Naval
— no panning involved, so the earlier waterway/zoom-range fixes didn't
touch this path at all.

Bisected by toggling `display:none` on each layer independently
(content still mounts/computes, just isn't painted) rather than
guessing: hiding `BarangayLayer` entirely left the stall unchanged;
hiding only `MunicipalityLayer` eliminated it completely (0 longtasks,
steady 16.7ms frames) even with `BarangayLayer` still mounting ~24-48
fresh barangay polygons for the newly-focused municipality in the same
commit. So the barangay-level content (the layer with *more* elements)
was never the bottleneck — `MunicipalityLayer`'s own 7 shapes were,
because they cover most of the visible map (unlike `BarangayLayer`'s
smaller, already-zoomed shapes) and every tap changes `nearestPrefix`/
`barangayOpacity`, forcing a real repaint of that large on-screen area.
No single decoration (the shared `feDropShadow` filter, the gradient
"sheen" overlay, the opacity cross-fade transition, labels' own
`feDropShadow`) was individually dominant when removed in isolation —
each shaved off a modest amount, confirming the cost was spread across
several stacked rendering techniques on the same large shapes rather
than one fixable culprit.

**Also surfaced a bigger, previously-unknown confound: this entire
session's lag profiling (including the waterway-merge fix above) had
only ever been run against `npm run dev`.** Profiling the identical tap
against a real production build (`next build && next start`) dropped the
dominant longtask from ~150-215ms to ~55-100ms — dev's unminified
`jsxDEV` runtime and Strict Mode's double-invoked renders were inflating
every dev-mode measurement this session has taken by roughly 2-3x. (Not
re-litigating the waterway fix — that one's root cause, the 448-vs-1
`<path>` count, and its relative improvement hold regardless of dev vs.
prod; this just means its absolute before/after numbers were dev-mode
numbers, and real production lag was never as severe as those readings
implied.) Future lag investigations in this repo should profile against
a production build, not dev, to avoid chasing dev-only overhead.

Fixed by adding `shapeRendering="optimizeSpeed"` (skip anti-aliasing,
no visual-effect change — same fill/gradient/shadow/stroke, just harder
polygon edges at a scale too small to notice) to both layers'
`.bfw-shadow-group` — the one lever that measurably helped without
touching any of the layer's visual design (gradient sheen, drop-shadow,
cross-fade all left intact, unlike the individually-tested-and-reverted
alternative of stripping those effects outright). Verified against a
production build, same CDP-throttled methodology: Culaba's longtask
dropped from 55ms to 0ms (no longtask at all) across 3 repeated runs;
Naval's dropped from ~55-87ms to ~53-67ms. Confirmed visually unchanged
(full-island overview and a zoomed-into-Culaba screenshot, both at 2x
device scale) — gradient sheen, drop-shadows, and label text all still
render identically.

**`WeatherBadge` moved to upper-center.** Previously a right-leaning
trapezoid flush against the map's top-right corner (`absolute right-0
top-0`, clip-path tapering only the bottom-left corner). Now `absolute
left-1/2 top-0 -translate-x-1/2`, with a **symmetric** trapezoid clip-path
(`polygon(0 0, 100% 0, calc(100% - 24px) 100%, 24px 100%)`, both bottom
corners taper inward) and matching symmetric left/right padding — a flush-
edge clip-path read correctly only when anchored to that edge; floating
detached in the center needed both sides to taper the same way. Content,
`drop-shadow`, and `WeatherIconSVG` unchanged.

`handleSignOut` resets the sidebar closed (`setSidebarOpen(false)`)
alongside its existing `selectedKey`/`focusedMunicipality`/`mapResetToken`
resets, so a fresh sign-in always starts from the same closed-sidebar,
full-map state.

**Map resets to the default whole-island view on sign-out**
(`handleSignOut` in `app/page.tsx`), not left wherever the previous
session's pan/zoom happened to leave it. `handleSignOut` clears
`selectedKey`/`focusedMunicipality` to `null` (both already lifted state)
and bumps a new `mapResetToken` counter, passed to `<BiliranMap>` as
`resetToken`. Clearing those two alone isn't sufficient on its own:
`BiliranMap`'s `selectedKey`-sync block only calls `focusBarangay` when
the new value is truthy (nothing to focus when it goes to `null`, so the
view doesn't move), and its `focusedMunicipality`-sync block only resets
the view on a non-null-to-null *transition* — a raw wheel-zoom/drag-pan
never touches `focusedMunicipality` at all, so if the user got the map
into some arbitrary zoomed state by hand rather than by picking a
municipality, neither prop change would catch it. `resetToken` is a
monotonically incrementing number rather than a boolean specifically so
"reset" can fire again even if the map is already sitting wherever the
*previous* sign-out already left it (a boolean flip back to the same
value wouldn't register as a change); `BiliranMap` watches it with the
same "sync-during-render, compare against previous value" pattern already
used for `selectedKey`/`focusedMunicipality`, and unconditionally sets
`view` back to the island-centered, `scale: 1` framing on change,
regardless of current state.

**Color system: one teal/slate palette, day/night as two brightness
bands within it** (`app/page.tsx`, the `.bfw-root[data-theme='light'/
'dark']` CSS custom-property blocks). Both the decorative sky/sea/sun/
cloud backdrop and the "chrome" (card/button/text colors) are built from
the same six anchors (design reference: a teal color-combo swatch) —
`#031716`/`#032F30` (near-black/very-dark teal), `#0A7075`/`#0C969C`
(dark-medium/medium-bright teal), `#6BA3BE` (light blue-teal), `#274D60`
(slate blue) — rather than the app's old separate warm-sun/sky-blue
scheme. Day and night are kept in **non-overlapping brightness bands**
(day: `#0C969C` → pale tint; night: near-black → `#032F30`) rather than
sharing a middle tone — an earlier pass had night's `--sea-bottom` equal
to day's `--sea-top`, which made most of the visible gradient read as
the same color in both themes since a 2-stop gradient's later portion is
a solid fill, not a full traverse. A few gradient stops (sky-bottom, sun
core/glow, the pale card-bg tint) are tints mixed toward white from these
anchors, since the source palette has no near-white tone to soften into.

Dark mode's `--text-strong`/`--text-soft` are lightened tints of their
raw palette anchors (`#6BA3BE` → `#85B7CE`, `#508198` → `#7098AD`), not
the anchors themselves — the raw values read a little dim against the
near-black `--card-bg`/`--body-bg`, since every number/label in
`BarangayList.tsx`/`BarangayDetailPanel.tsx`/`LiveUpdateBanner.tsx`
already routes through these two variables (nothing hardcoded to touch
per-component), so this one change is what actually fixed legibility
everywhere at once. Light mode's text colors are unchanged — the
contrast issue was dark-mode-specific.

New variables beyond the original `--card-bg`/`--card-border`/
`--text-strong`/`--text-soft`/`--field-line` set: `--header-bg`/
`--body-bg`/`--separator` (the dashboard's header band vs. content area,
below), and `--btn-from`/`--btn-to`/`--btn-text` (the shared button
gradient — lighter pairing in day mode, darker in night, per the design
reference's own day/night button guidance).

**`.bfw-btn`** (same `<style>` block) is the shared "oval, not flat"
button treatment — a diagonal `linear-gradient(145deg, var(--btn-from),
var(--btn-to))` fill plus an inset top highlight and a soft drop shadow,
replacing the old flat `var(--card-bg)` fill on primary buttons. Applied
to buttons meant to read as CTAs/controls: theme toggle, sign-in, the
map's zoom `−`/`+` and "All municipalities" reset, `DashboardShell`'s
municipality filter trigger button (see below), and every primary action
in `ProfilePanel`/`AdminInvitePanel` (Save changes, Sign out, Create
invitation, the inline row's Save) — not text-link-style actions (Cancel,
Edit, Revoke, the `Modal` `×` close, "Upload/Change photo") or the
avatar-photo button, which stay in their existing understated styles
since gradient-pill styling would misrepresent them as primary actions.

**Municipality filter is a custom dropdown** (`components/
MunicipalityFilterDropdown.tsx`), not a native `<select>` anymore. The
`<select>` version's *open* option-list popup was OS-rendered and
couldn't take the app's own styling at all — an earlier round could only
patch its text/background contrast (`select.bfw-btn option { color:
#031716; background: #ffffff; }`, after every option had rendered
invisible: white `--btn-text` inherited onto the popup's own always-white
background), never give it real design. Replaced entirely: the closed
trigger keeps the same `.bfw-btn` look the select had, but the open panel
is plain React, so its rows are styled exactly like `BarangayList`'s rows
(rounded-lg border, amber selected-row highlight) — "same design as the
list," not just a contrast patch.

The open panel is rendered via `createPortal` into `document.body` with
`position: fixed` coordinates computed from the trigger's own
`getBoundingClientRect()`, **not** as a normal `absolute`-positioned
child. This component now lives inside the toggleable sidebar
(`.bfw-sidebar`, `z-17` — see "Toggleable sidebar" above), itself already
above the persistent map's `z-15`; the original motivation for portaling
(confirmed via Playwright: the map's own `<svg>`, at a higher local
z-index than this component's old container, intercepted clicks meant for
the dropdown's options before the portal fix) predates the sidebar
redesign and no longer applies the same way — but portaling to
`document.body` is kept regardless, since it's still the simpler, more
robust choice (escapes any ancestor's stacking context or `overflow:
hidden` outright, rather than depending on the current z-index ordering
staying correct). The panel closes on outside
click, `Escape`, window resize, or scroll (repositioning isn't tracked
live — closing and requiring a re-open is simpler than keeping a fixed
popover glued to a moving trigger).

**The portaled panel can't use the app's `--card-bg`/`--card-border`/
`--text-strong` CSS variables** — those are only defined under
`.bfw-root[data-theme='light'/'dark']` in `app/page.tsx`, and
`document.body` (the portal target) sits *outside* `.bfw-root`, so custom
properties don't inherit across that boundary. A reported bug traced to
exactly this: the panel and options originally used those variables
anyway, silently resolving to invalid values everywhere it rendered —
background fell back to transparent and text to the browser's default
black in both themes, reading as "hard to read" over the light day scene
and "not there at all" over the dark night one. Fixed by threading the
app's `theme` state down as an explicit prop (`app/page.tsx` →
`DashboardShell` → `MunicipalityFilterDropdown`) and using hardcoded
**solid** colors per theme (`DAY_COLORS`/`NIGHT_COLORS` — solid white or
solid `#032F30`, not the app's usual translucent `--card-bg`) instead of
CSS variables, so the panel's contrast never depends on what's rendered
behind it. Any future portaled-to-`document.body` UI in this app needs
the same treatment — CSS variables won't reach it either.

The panel has no `max-height`/scroll — deliberately: `MONITORED_MUNICIPALITIES`
is a small, fixed, curated list (7 municipalities + "All"), so it's sized
to show every option at once. Rows are smaller than `BarangayList`'s own
(`text-xs`/`py-1.5` here vs. `text-sm`/`py-2.5` there) specifically so all
8 fit on-screen without needing to scroll to see the rest — confirmed via
Playwright that the panel's `scrollHeight` equals its `clientHeight` at
this sizing. The border around each row still gives clear separation
between options at the smaller size, just a more compact box.

**Sidebar header/body split** (`app/page.tsx`'s `.bfw-sidebar`, see
"Toggleable sidebar" above): the title row and `DashboardShell`'s
scrollable content are two separate color panels — a `--header-bg` band
with a `--separator`-colored `border-b-2`, then a `--body-bg` wash
beneath it — rather than one uniformly-padded column with no background
of its own. The header's own title/subtitle text stays a fixed light
tint (not `var(--text-strong)`), since `--header-bg` is deliberately dark
in both themes (a branded band, not a theme-following surface) — using
the theme-following text color would fail contrast in light mode, where
`--text-strong` is near-black. (This used to live in `app/page.tsx`'s
`.bfw-dash` wrapper, before the sidebar redesign below replaced it.)

**Removed: compact map while the barangay list is scrolled, and
`BiliranMap`'s `compact`/`onCompactTap` props.** An earlier version of
this app reclaimed screen space by shrinking the map into a small
top-left thumbnail (`ROW_COMPACT_THRESHOLD`/`SCROLL_DEBOUNCE_MS`/
`COMPACT_MAP_WIDTH`/`COMPACT_MAP_HEIGHT` in `DashboardShell.tsx`,
`BiliranMap`'s own `compact`/`onCompactTap` props suppressing wheel/drag
and swapping the `<svg>`'s tap gesture to "expand" instead of "select")
whenever the barangay list scrolled past 8 rows, or whenever a barangay
was selected (`BARANGAY_SELECT_COMPACT_DELAY_MS` = 450ms, deliberately
delayed past `BarangayList`'s own double-tap window to avoid a fast
double-tap's second click landing on a different row mid-reflow). All of
this existed specifically to make room below/beside the map for the list
and detail panel. Once those moved into the toggleable sidebar instead
(an overlay, not a layout sibling the map shares space with — see
"Toggleable sidebar" above), there was no more space to reclaim, so the
entire mechanism — the thumbnail mode, the scroll-triggered compacting,
the selection-triggered compacting and its delay — was removed outright
as dead code, not just left unused. `BiliranMap` is now always its full
interactive self; `ZoomControls`/`WeatherBadge`/`NextForecastBadge`/
`Legend` now all gate on `showChrome` alone (previously `ZoomControls`/
`WeatherBadge`/`NextForecastBadge` also required `!compact`; `Legend`
already gated on `showChrome` alone, since it had its own dots-only
`compact` variant rather than hiding — `Legend`'s `compact` prop/variant
itself is unchanged and still exists on the component, just never
receives `compact={true}` from `BiliranMap` anymore).

Selecting a barangay (map, list, or the LIVE UPDATE banner) now just
updates `selectedKey` — `app/page.tsx`'s `selectBarangay(key)` is `{
setSelectedKey(key) }`, nothing more. `BarangayList.tsx`'s own
double-tap-to-filter-by-municipality detection (tracking `{ key, time }`
of the last click in a ref, `DOUBLE_TAP_WINDOW_MS` = 350ms, rather than
the browser's native `onDoubleClick`) is unchanged and still correct, but
its original motivating concern — a fast double-tap's second click
landing on a different row because the first click's selection had
already reflowed the list out from under it — no longer applies: nothing
about selecting a barangay moves the sidebar's layout anymore, so the row
simply never moves between the two taps in the first place.

**Legend (full-size variant) is left-edge, vertically centered, and
~4x larger** — moved off the bottom-left corner because it read as too
small/hard to parse there. `absolute left-3 top-1/2 -translate-y-1/2`,
`flex flex-col` (a vertical stack of the five severity rows) instead of
the old horizontal `flex items-center` row, since a row at this size
wouldn't fit the map's width. Dots grew from `h-2 w-2` (8px) to `h-8 w-8`
(32px, ~400%); text grew from `text-[10px]` to `text-sm` (14px) —
deliberately a much smaller bump than the dots', so labels stay legible
next to the map rather than a literal 4-5x blow-up (which would put
~45px-tall labels next to a mid-sized map and dominate it). `rounded-2xl`
now, not `rounded-full` — a giant pill wrapped around a tall column of
varying-width rows read oddly, unlike the compact variant's small dot row
where a pill still makes sense. The `compact` (dots-only, tiny thumbnail)
variant is untouched — still `absolute bottom-1.5 left-1.5`, still tiny —
there's no room for anything close to this size in the 192×144px compact
map box (the `compact` thumbnail mode has since been removed, see above —
this variant just stays defined on the component, unused for now). No
collision-avoidance logic added for the taller stack against the top-left
reset button/top-right `WeatherBadge`/bottom-right `ZoomControls` —
confirmed via screenshot there's a comfortable gap at typical map
heights, since each of those overlays is independently
`absolute`-positioned into its own corner-ish region rather than sharing
a layout that would need to shrink around the enlarged legend.

When a barangay outside the currently-focused municipality is selected
(e.g. tapped from the severity-ranked list while a different municipality
is in view), the map already auto-recenters/rescales to its own
municipality context regardless of what was shown before — this was
already true of `BiliranMap.tsx`'s `focusBarangay()` before this round,
not new behavior.

**`BiliranMap`'s `showChrome` prop** (default `true`, passed as
`showChrome={revealed}` at its one call site in `app/page.tsx`) hides
overlays that only make sense once there's a dashboard around them: the
entire `ZoomControls` pill (both the `−`/`+` buttons and its slider — an
earlier version kept the buttons showing either way, since only the
slider itself had its own `showSlider` gate; both are gone pre-login now),
`Legend`, `WeatherBadge`, and `NextForecastBadge` — all four now gate on
`showChrome` alone (previously `ZoomControls`/`WeatherBadge`/
`NextForecastBadge` also required `!compact`; `Legend` already gated on
`showChrome` alone before — see "Removed: compact map..." above for why
`compact` is gone entirely now). As a pure decorative login backdrop
these were just clutter — the weather ribbon specifically used to
collide with the theme-toggle button in that state (worked around
earlier by pushing the toggle down), now moot since the ribbon simply
doesn't render there; the toggle is back to a fixed `top-5`.

**Daily login gate is UX, not security.** Even with a valid Supabase session,
the login card reappears if the last successful login (tracked via
`localStorage['bfw_last_login_date']`) wasn't today. Real access control is
the Supabase session + RLS policies, not this check.

**Forgot password is entirely self-service** — no admin/manual step
anywhere in the flow. The login card's "Forgot password?" link swaps its
form (`authMode: 'signin' | 'forgotPassword'` in `app/page.tsx`, sharing
the same `email` state as the sign-in form) to an email-only form whose
submit (`handleForgotPassword`) calls
`supabase.auth.resetPasswordForEmail(email, { redirectTo:
`${origin}/reset-password` })`. Supabase sends the verification email
itself (its own transactional email, nothing this repo sends or
templates) and deliberately doesn't reveal whether the address has an
account, to avoid leaking which emails are registered — so the
confirmation shown (`resetSent`) is worded to match that ambiguity
("If an account exists for `<email>`…") rather than asserting success.

The email's link lands on `app/reset-password/page.tsx`, a standalone
route outside the login/dashboard state machine (deliberately simple: one
fixed light palette, no day/night theming, same spirit as
`app/activate/page.tsx`'s own standalone simplicity — though unlike that
page's `/api/activate` server route, there's no server-side token
handling here at all). The link's URL fragment carries a recovery token
that `lib/supabase.ts`'s browser client parses and exchanges for a
session automatically (`createClient`'s `detectSessionInUrl` defaults to
`true`) before this page's own code runs; the page just calls
`supabase.auth.getSession()` on mount; a session existing means the token
was valid, going to a `'ready'` status. From there,
`supabase.auth.updateUser({ password })` sets the new password, then the
page immediately signs out — a recovery session isn't the app's normal
signed-in state (no `bfw_last_login_date` set on this device for today),
so signing out lets `/` fall through to its own ordinary login card
rather than half-reusing this session as if the user had just signed in
there. Landing on the page without a valid token (missing, already used,
or expired) shows a "Link expired" state pointing back to `/` instead of
a broken form.

**Admin sign-in toggle drives the admin panel's only entry point — and is
now a real gate for admin accounts specifically, not just copy.** The
login card's logo becomes a button while `authState === 'needsLogin'`
(gone entirely once signed in — no lingering control in the dashboard),
toggling a `loginMode: 'user' | 'admin'` local state that swaps the
card's heading ("Sign in" ↔ "Welcome, Administrator"). There's still only
one real auth mechanism (`supabase.auth.signInWithPassword`) — `handleSubmit`
always calls it first, regardless of `loginMode`.

**What changed**: `handleSubmit` now fetches the just-authenticated
user's profile immediately after a successful `signInWithPassword` call
(`fetchOwnProfile`, same helper `loadUser()` below already uses) and
checks `profile?.access_level === 'admin' && loginMode !== 'admin'`. If
true, it calls `supabase.auth.signOut()` right away and shows "No user
account exists." instead of revealing the dashboard — deliberately the
same generic wording a wrong email/password gets, not naming this an
administrator account, so a regular-mode sign-in attempt can't be used to
fingerprint which emails belong to admin accounts. An admin account can
no longer sign in at all through the regular "Sign in" form. This *does* mean a
brief real authentication happens before the rejection (there's no way to
know `access_level` without it — nothing pre-auth can query
`user_profiles` for an arbitrary email), immediately undone by the
`signOut()`. A non-admin account is completely unaffected either way —
this check only ever fires for `access_level === 'admin'`, so `loginMode`
still decides nothing for a regular sign-in, admin-styled form or not.

This supersedes the previous "toggle grants nothing, never a security
gate" framing for admin accounts specifically — verified via mocked-auth
Playwright: admin credentials submitted with the card still in "Sign in"
mode get rejected (error shown, `auth.signOut` fires, login card stays
up, no dashboard/admin-panel reveal); the same credentials succeed once
toggled to "Welcome, Administrator".

Separately, `app/page.tsx`'s post-sign-in `loadUser()` effect (still
keyed on `admin` alone, not `loginMode` — see its own comment there) is
what actually opens `AdminInvitePanel` once a *successful* admin sign-in
lands: any admin reveal opens it, whether from a fresh interactive
sign-in or a returning session's auto-reveal (which never went through
`handleSubmit` or `loginMode` at all, since the login card and its toggle
don't render on that path). `loginMode` always starts (and, on sign-out,
resets to) `'user'` — plain `useState`, no persistence.

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
to be reached. Reached by signing in via the login screen's "Welcome,
Administrator" toggle as an actual admin (`app/page.tsx` auto-opens
`components/AdminInvitePanel.tsx` right after sign-in when both are
true) — not via the header profile button's panel, which has no
admin-panel entry point (see below and "Key architectural decisions").

**Invitations are emailed automatically now — this app's first
self-sent transactional email.** Contrast with "Forgot password is
entirely self-service" above, where Supabase sends its own verification
email and this repo sends/templates nothing itself — this is the
opposite case: `lib/email.ts`'s `sendInvitationEmail()` owns both the
copy and the send, via [Resend](https://resend.com) (the `resend` npm
package). Both `app/api/admin/invite/route.ts` (POST/create) and
`app/api/admin/invite/[id]/route.ts` (PATCH/edit) call it after a
successful database write, building the activation link as
`${req.nextUrl.origin}/activate?code=${code}` (no new env var needed for
this — `req.nextUrl.origin` is free on the `NextRequest` already passed
in, and adapts automatically across preview/prod deployments, unlike a
hardcoded site-URL var would). **Resend-on-edit is intentional and safe
by construction**: PATCH already refuses any redeemed row (409 via
`loadUnredeemedInvite`), so a PATCH-triggered resend can never re-notify
someone who already activated. Revoke (`DELETE`) sends nothing — not
asked for, out of scope.

**Graceful degradation is the actual design, not an afterthought.**
`lib/email.ts` reads `RESEND_API_KEY` at module scope but — unlike
`lib/supabaseAdmin.ts`'s `!`-asserted vars — treats it as an optional,
handled case: unset means `sendInvitationEmail()` returns `{ ok: false,
error: '...' }` rather than throwing, and the same happens if the actual
`resend.emails.send()` call fails (wrapped in try/catch, since the SDK
can throw on network-level failures too). Either way, creating or
editing the invitation row **always succeeds regardless of email
outcome** — the POST/PATCH responses add `emailSent`/`emailError`
fields alongside the existing `{ invitation }` shape, and
`components/AdminInvitePanel.tsx` surfaces both: "Emailed to X." on
success, or "Created/Updated, but the email couldn't be sent (...) —
share the code manually" on failure, with the raw code always still
shown either way (that fallback already existed and must never regress).

**A real bug shipped after the first real deployment, found and fixed
this session**: `resend.emails.send()` has no built-in timeout — the SDK
just awaits its own `fetch()` indefinitely. Once a real `RESEND_API_KEY`
was actually configured for the first time (previously this sandbox
could never reach `api.resend.com` at all, so this path was never
exercised for real), a slow real network round trip could run this
route's whole response past the serverless platform's own timeout,
which then returns a non-JSON error page instead of this route's own
`NextResponse.json(...)`. `components/AdminInvitePanel.tsx`'s
`handleSubmit`/`saveEdit`/`revoke` had no `try/catch` around their
`fetch`/`res.json()` calls, so that thrown parse error skipped past
`setLoading(false)`/`setRowBusyId(null)` entirely — the "Creating…"
button (or the edit/revoke row) got stuck forever with no error shown,
reported directly from the live site. Fixed two ways: (1) `lib/email.ts`
now races `resend.emails.send()` against an explicit 8-second timeout
(`Promise.race`), so this route always responds well within any
reasonable platform limit regardless of how the real network call goes
— invitation creation/edit still always succeeds either way, per the
graceful-degradation design above, just faster and more predictably now;
(2) all three handlers in `AdminInvitePanel.tsx` now wrap their
fetch/parse logic in `try/catch/finally`, so ANY thrown failure (network
drop, malformed response, anything) always clears the busy/loading state
and shows a plain "Could not reach the server — check your connection
and try again" message, never hangs silently again. Verified via mocked
Playwright: a route mocked to return a non-JSON 504 (reproducing the
exact failure mode) no longer leaves the button stuck — it resets and
shows the new error message within seconds.

The email is personalized by an optional **recipient name** — a new
nullable `invitee_name` column (`supabase/invitation-name-field-setup.sql`,
same "not auto-applied, run by hand in the Supabase SQL editor" pattern
as `avatars-storage-setup.sql`/`profile-name-fields-setup.sql` — **this
one must be run before the feature works end to end**, or the insert/
update will error on the unknown column) and a new "Recipient name
(optional)" field on both the create form and the inline edit row in
`AdminInvitePanel.tsx`. A present name produces "Hi {name},"; absent
falls back to "Hello,". `office`/`name`/`code` are HTML-escaped before
interpolation into the email's HTML body.

**`api.resend.com` is blocked from this sandbox — same restriction as
Open-Meteo, not an exception to it.** An initial runtime check with a
deliberately fake `RESEND_API_KEY` got back a 403 shaped like a real
Resend API error (`{ name: 'application_error', ... }`) and was
misread as one. A follow-up check with a **real** key (provided by the
user) reproduced the identical response — and inspecting the raw
response headers this time surfaced `x-deny-reason: host_not_allowed`,
which is this sandbox's own egress proxy, not Resend: its README
(`/root/.ccr/README.md`) confirms a 403/407 from the proxy means the
destination host isn't on this session's organization-allowed list, and
explicitly says not to retry or route around it, only report it.
**So: real delivery through Resend could not be verified from this
sandbox at all** — this corrects the earlier claim here (and in
[Abylon10/BILIRAN-GIS#15](https://github.com/Abylon10/BILIRAN-GIS/pull/15)'s
description) that Resend was reachable; it wasn't, the proxy's block
page just happened to resemble a real API error closely enough to be
mistaken for one on first read. The code itself is unaffected — this is
purely a limitation of verifying it from *this* environment, not a bug
in `lib/email.ts`. A real send still needs to be exercised once from a
deployed environment without this restriction (e.g. the actual Vercel/
production deployment) before this feature's delivery path is
considered proven, not just code-reviewed.

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

Both the avatar circle and the trapezoid tab use the same oval/gradient
treatment as `.bfw-btn` (above) — `linear-gradient(145deg, var(--btn-from),
var(--btn-to))` plus the matching inset-highlight/drop-shadow box-shadow —
so they read as the same family of control as the day/night toggle they
sit beside, rather than the plain `var(--card-bg)` fill they used before.
Reuses `.bfw-btn`'s CSS variables directly rather than the class itself,
since the tab needs its own `clip-path`/width transitions that `.bfw-btn`
doesn't define; the name/office text switched from `var(--text-strong)`/
`var(--text-soft)` to `var(--btn-text)` (office at `opacity: 0.85`) to
stay readable against the now-gradient (rather than theme-following card)
background.

The tab's `max-width` (240px) is sized to comfortably fit
`formatDisplayName()`'s worst case (`lib/profile.ts`'s
`MAX_FULL_NAME_CHARS` = 20, e.g. "Mr. Juan Dela Cruz") plus a realistic
office line below it, with headroom to spare — an earlier value (180px)
was tuned close to the name line's own width alone and both lines ended
up truncating in practice. The tab itself is content-sized (not stretched
to the cap), so this is a safety ceiling, not a fixed width — confirmed
via `scrollWidth`/`clientWidth` comparison (no truncation) against a
realistic long name + office pairing, not just a visual guess.

**Profile** (`components/ProfilePanel.tsx`): the signed-in user's email,
editable `title`/`first_name`/`family_name`/`office` fields (`lib/profile.ts`'s
`updateOwnProfileFields()`), a photo backed by a private Supabase Storage
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
the bucket stays private. Also hosts a "Sign out" row, moved here from
the old "+" menu — no admin-panel row (see "Key architectural
decisions"): an earlier version had one here, `isAdmin`-gated, but it was
removed once the login-toggle auto-open became the sole admin entry
point, so `ProfilePanel` no longer needs to know `isAdmin` at all.

`ProfilePanel.tsx` exports a shared `Avatar({ url, label, sizeClassName })`
— `label` (an initial letter) when a user is known but has no photo (used
by `ProfilePanel`'s own avatar button, passed the user's email), a generic
silhouette SVG when neither is known (used by `HeaderProfileButton`
pre-login, which has no `user` at all yet) — one implementation instead of
duplicating fallback logic between the two call sites.

`ProfilePanel.tsx` also exports the shared `Modal` (used by both
`ProfilePanel` and `AdminInvitePanel`). It's mounted/unmounted entirely by
the caller's own `{flag && <Panel/>}` conditional in `app/page.tsx`
(`showProfile`/`showAdminPanel`), so an exit transition needs its own beat
before the real unmount happens: `Modal` keeps an internal `open` boolean
(false at mount, flipped true one `requestAnimationFrame` later to drive
the entrance), and its own backdrop-click/×-button handlers call a local
`requestClose()` that flips `open` back to `false` and only calls the
caller's real `onClose` after `MODAL_TRANSITION_MS` (300ms) — same
`cubic-bezier(0.22,1,0.36,1)` family as `BiliranMap.tsx`'s zoom transform,
`HeaderProfileButton.tsx`'s avatar/tab grow, and `app/page.tsx`'s map-shell
transition. Scoped entirely inside `Modal`; neither caller needed to
change. Other close-adjacent actions (`onSignOut` in `ProfilePanel`) call
their own callback directly, not `requestClose` — intentionally out of
scope for this pass, since that isn't a "close the modal" affordance.
`AdminInvitePanel.tsx`'s inline edit-row (swapping a
row into an editable form, `editingId === inv.id`) gets a lighter
`@keyframes` entrance-only animation (`.bfw-edit-row-enter`, same easing)
on mount — not a two-phase state toggle like `Modal`, since there's no
exit to animate (it swaps back to the display row immediately on
cancel/save) and not a height animation (the list has its own
`overflow-y-auto`, which would fight with animating height). Both respect
`prefers-reduced-motion: reduce`, same as `HeaderProfileButton.tsx` and
`app/page.tsx`'s map-shell.

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
`access_level`), not another RLS policy. `ProfilePanel.tsx` used to also
*display* `access_level` (read-only) below the editable fields; removed
per a later UI request — this was never itself a security control (the
grant/revoke above is what actually blocks writes), so removing the
display changes nothing about authorization, only what the user sees.
`access_level` still drives every real check (`lib/requireAdmin.ts`, the
post-login admin-panel auto-open in `app/page.tsx`) exactly as before.

**Dashboard data**'s baseline is a static file, `public/data/
barangay_dashboard_data.json` — one JSON object keyed by `"Barangay (PGC
prefix)"`, 115 barangays, each combining an FSI score/label with runoff
threshold crossing times (`warning_time_hours`, `alert_time_hours`,
`danger_time_hours`) produced by the external Python pipeline. It's
fetched client-side with a plain cached `fetch()` (`lib/dashboardData.ts`,
`loadBarangays()`) — no DB wiring for this yet. **This baseline is what's
actually shown only until live data arrives, or for the 2 basin-less
barangays' countdown fields specifically** — `app/page.tsx` now overrides
every other field with a live-forecast-computed one by default; see
`lib/liveIslandState.ts` and its own extensive documentation further down
this file for the full mechanism. Known limitation of the static file
itself: a `public/` file only updates on redeploy; that's no longer the
active constraint for FSI/countdown (those are recomputed live client-side
on every load now) but still applies to anything not yet covered by the
live path — e.g. the barangay roster/geometry itself, which would still
need a redeploy to add/remove a barangay. That loader also repairs the two
barangay names hit by the known
source-level double-UTF-8 bug ("Capiñahan," "Santo Niño") — see
`fixMojibake()` — but the fix is cosmetic and client-side only; the
underlying `barangay_biliran.geojson` bug (outside this repo) is still open.

`lib/municipalities.ts` maps each barangay's `pgc_prefix` to a municipality
name, and gives Maripipi's centroid (used only to keep it inside the map's
`islandBounds` framing — Maripipi itself isn't shown). Confirmed against an
official PSA/OCHA administrative-boundaries dataset (province/municipality/
barangay names, PSGC codes, and centroids) supplied for this project —
no longer just a self-validated guess.

**Path alias**: `@/*` resolves to the repo root (`tsconfig.json`), e.g.
`@/lib/supabase`.

## Key architectural decisions (settled, don't relitigate)

- Single merged page (map + login + dashboard as states of one component, not routes)
- Daily login gate is UX, not security
- Admin sign-in toggle (the login-screen logo button) grants nothing by itself for a non-admin account — real admin authorization is always the post-login `access_level === 'admin'` check. For an admin account specifically, though, the toggle is now a real precondition: `handleSubmit` rejects (and immediately signs back out) an admin credential pair submitted while the card is still in regular "Sign in" mode, requiring "Welcome, Administrator" to actually sign in (see "Admin sign-in toggle..." below). The toggle separately still decides whether a *successful, actually-admin* sign-in auto-opens the admin panel (see below)
- Account creation is fully admin-controlled; no public signup
- Invite codes are device-bound only at redemption
- No AI/LLM features in the product
- Admin entry point is signing in via the login screen's "Welcome, Administrator" toggle, as an actual admin — `app/page.tsx` auto-opens `AdminInvitePanel` right after sign-in when both are true. There is no other way in: `ProfilePanel.tsx` has no admin-panel row anymore (an earlier version put it there, `isAdmin`-gated, alongside the old hidden bottom-right "+" FAB's Profile/Dashboard/Invitations/Sign out items being removed entirely — "Dashboard" was redundant with just being on the dashboard, "Invitations" moved into the admin panel — but the admin-panel row itself was later moved out of Profile too, to keep the login-toggle path the sole entry point)
- Barangays are ranked by continuous `mean_fsi_score`, never by discrete FSI class (class-based ranking was tested and rejected — it collapses most barangays into one bucket)
- Runoff thresholds are relative to each basin's own modeled peak Q (Warning 50% / Alert 75% / Danger 95%, not 100%) — disclosed as a relative proxy, not a calibrated physical threshold; there wasn't enough data (surveyed cross-sections, historical gauge records) for a calibrated approach
- A barangay touching multiple basins uses the **earliest** (most urgent) threshold crossing time across them, not an average
- Severity colors for Moderate/High were relightened/reddened (`#D9B23C`/`#E8A33D` → `#F2D24D`/`#E8592D`) for readability — changed in the one shared pair of functions (`urgencyTierColor()` and `fsiScoreColor()`'s `SCORE_COLOR_STOPS`, both `lib/dashboardData.ts`) that colors the map polygons, the `Legend`, and the `BarangayList`/`BarangayDetailPanel` severity dots, so all four stay in sync rather than the legend silently drifting from what's actually drawn on the map

## Dashboard UI

`components/DashboardShell.tsx` (rendered inside `app/page.tsx`'s
toggleable sidebar — see "Toggleable sidebar" earlier in this file): a
"modeled, not live" banner naming the single most urgent upcoming
Alert/Danger crossing (`components/LiveUpdateBanner.tsx`,
`mostUrgentCrossing()`), a municipality filter dropdown (`filterBarangays()`,
called with a constant `''` query — the free-text search input this used
to pair with was removed; `filterBarangays()` itself still takes a query
param, just always `''` from here now), a barangay list ranked by
susceptibility (`components/BarangayList.tsx`, `sortBySeverity()`), and a
"Detail Overview" panel on selection (`components/BarangayDetailPanel.tsx`)
leading with the FSI class/score, then basin count and warning/alert/danger
times. The map itself is mounted once, persistently, in `app/page.tsx` —
see "One persistent map, always full-bleed" above, and
`components/BiliranMap.tsx` below — and is no longer rendered anywhere
near this component's own layout at all.

**Layout: the map is the dominant element**, full-bleed behind everything
— `DashboardShell` itself is a single scrolling column (banner, filter,
list, then the selected barangay's detail panel inline below it) inside
the sidebar, not a layout that shares screen space with the map at all
anymore (see "Toggleable sidebar" above for why — an earlier version had
the map as a large row the list/detail sat below/beside, with a scroll-
triggered "compact" thumbnail mode to reclaim space; both are gone now
that the list/detail live in their own overlay instead).

Ranking is **highest FSI score first** (`sortBySeverity()` in
`lib/dashboardData.ts`, mean_fsi_score descending, tie-broken by soonest
`danger_time_hours`) — an explicit product decision, not the time-based
"soonest crossing" order used earlier. **The LIVE UPDATE/MODELED ALERT
banner now uses the same risk-based criterion as the list**
(`highestRiskCrossing()`, `lib/dashboardData.ts` — reuses
`sortBySeverity()[0]`, paired with whichever of that one barangay's own
Alert/Danger crossings comes sooner) — originally this banner used the
time-based `mostUrgentCrossing()` signal instead, deliberately answering a
different question ("what happens soonest" vs. the list's "who's worst");
the user later asked for the banner to show the highest-risk barangay
too, so it no longer disagrees with the list on purpose. `BiliranMap.tsx`'s
`WeatherBadge` still uses the original time-based `mostUrgentCrossing()`
unchanged, for its own separate purpose (picking which municipality's
real-weather icon appears in the corner ribbon) — that one wasn't asked
to change and still deliberately answers "what happens soonest," not
"who's worst."

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
padding) for its center, but **caps the resulting scale at the parent
municipality's own `muniFocusByPrefix` scale**
(`Math.min(barangayScale, muniFocus.scale)`) — selecting a barangay reveals
it in context of its neighbors rather than zooming in tight and losing the
surrounding municipality. The cap typically binds (a barangay's own tight
frame is usually more zoomed-in than its municipality's), so it doesn't
need special-casing in the crossfade above: the resulting scale still sits
above `highThreshold`, so the barangay stays fully opaque/selected-styled
rather than fading toward the overview look. Maripipi has no polygon data
(see provenance below) and isn't shown on the map at all — its coordinates
are only used to keep it inside `islandBounds` framing. Zoomed-in barangay
shapes also carry their own name labels
(`BarangayLayer`, same `geometryCentroid()` + `#bfw-text-shadow` pattern as
the municipality labels).

Wheel-zoom and drag-pan sensitivity are both tunable constants near the top
of the file — `WHEEL_ZOOM_COEFFICIENT` (multiplies `deltaY` inside
`Math.exp(-deltaY * coef)`) and `DRAG_DAMPING` (multiplies the pointer's
translated screen distance before it's applied to `view`) — lowered from
their original values (`0.0015`/`1.0`, effectively) because both felt too
twitchy, especially wheel-zoom on a trackpad. Re-tune by feel/device
testing, not by re-deriving from first principles — wheel deltas vary a lot
by device/OS.

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

(Historical: `.bfw-dash` and its map-slot spacer no longer exist — see
"One persistent map, always full-bleed" and "Toggleable sidebar" near the
top of this file for the current architecture, which removed the boxed
layout slot this bug was about entirely. `.bfw-map-shell`'s `z-15` is kept
for continuity, now mostly to stay above the toggleable sidebar's own
`z-16`/`z-17`, not to beat an invisible spacer.)

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
- **The canonical, raster-based full per-basin FSI recompute** (re-running
  the pipeline's own raster-to-barangay zonal aggregation against a live
  rainfall raster) is still blocked on that aggregation and the original
  design storm's rainfall baseline — nobody has rebuilt the actual GIS
  pipeline's raster workflow to accept live input. **This is different
  from the live, ratio-based FSI approximation that now drives the real
  dashboard by default** (see `lib/liveIslandState.ts` above) — that one
  reuses the already-computed, already-validated `fsi_factors.json`
  zonal averages and scales just the rainfall term by a live/design-storm
  ratio; it was accepted by the user as a disclosed approximation, not a
  substitute for eventually building the real thing.

Add the corresponding fields/UI before building any of these.

**Hydrograph corner is a real chart now, for 113 of 115 barangays.**
`components/BarangayDetailPanel.tsx` lazily fetches
`public/data/basin_hydrographs.json` (via `lib/hydrographData.ts`'s
`loadBasinHydrographs()`/`hydrographForBarangay()`) and renders a
hand-rolled inline SVG polyline chart of basin discharge (`Q`, m³/s) vs.
time for the selected barangay's largest-overlap-area basin — a barangay
can touch several basins (up to 36 island-wide); showing only the
primary one is a documented simplification, not hidden data. The chart is
labeled with the basin id, its peak discharge, and the real storm
assumption (`Modeled from a single synthetic {duration}-hour design
storm, {peak}mm/hr peak.`, pulled from the data's own `storm_params`, not
hardcoded).

The other 2 of the 115 official barangays — **Kawayan/Burabod** and
**Kawayan/Poblacion** — keep the original dashed-border, muted-opacity
"Hydrograph — No basin flow data available for this barangay" placeholder,
unchanged. This is not a data gap: real polygon-to-raster overlap found
**zero** pixel intersection between either barangay and any basin (see
`corrections_applied` in the source JSON below), so there's honestly no
river-risk curve to show for them — the placeholder is the correct,
honest state, same as it always was for every barangay before this data
existed. Since `BarangayDetailPanel` is the one component used for both
the sidebar (`hidden md:block`) and the inline mobile (`md:hidden`)
detail views, this covers both without extra wiring.

**Precipitation chart is real too now, gated identically to the
hydrograph.** A second `DischargeChart` right below the first renders
`entry.hydrograph.rainfallMmHr` against the same `timeHours` — both
already present on `PrimaryHydrograph` from the same
`basin_hydrographs.json` fetch, so this needed no new data, no new fetch,
and no new loading state: it appears/disappears together with the
hydrograph (same 113-of-115 coverage, same honest absence for the 2
FSI-only barangays). `DischargeChart` (`components/DischargeChart.tsx`)
picked up an optional `ariaLabel` prop for this (defaulting to the exact
original hardcoded text, so the real hydrograph and Simulation Mode's
simulated chart are unaffected) and is given a distinct cyan
(`#0891B2`) so the two series read as clearly different at a glance —
distinct from both the hydrograph's blue (`#3B82C4`) and Simulation
Mode's amber (`#D97706`).

**Provenance of `public/data/basin_hydrographs.json`**: built (one-off,
not checked into this repo as a script) from three files the user
generated and shared via Google Drive — island-wide `r.watershed` basin
delineation at `threshold=200` (2,235 raw basins), Kirpich (1940)
time-of-concentration per basin (`A = 1/Tc`, slope converted from degrees
via `tan()`, not used directly — an earlier, ~4-5x version of this had a
unit-conversion bug), and each of the 115 official barangays matched to
its overlapping basin(s) by actual polygon-to-raster overlap (not
centroids or name-matching). Only **434 of 2,235** delineated basins
actually overlap a barangay and have a valid positive reservoir
coefficient; those are the ones embedded in this file, each with a full
72-point (`0h`→`~5.9h`, 5-minute step) hydrograph from a single symmetric
triangular design storm (`peak_mm_hr: 50`, `duration_hours: 2`).

**Hard constraint for future re-imports**: the Drive folder has **two
non-identical basin delineation runs** whose `basin_id` numbers collide
but represent different geometries (confirmed by direct value comparison
— e.g. basin 864 is `A=2.5021` in one run, `A=4.0809` in the other). Only
the `island_wide_output` folder's files (`island_barangay_basin_map_FIXED
.json`, `island_basin_runoff.json`, `island_basin_runoff_summary.json` —
all dated 2026-09-21, explicitly `_FIXED`-suffixed, carrying their own
`corrections_applied` field) are canonical. The older, top-level
`island_barangay_basin_map_2235_CORRECT.json` is a superseded draft
despite its name — it's actually a mislabeled per-basin scalar summary
with no barangay linkage at all, not a barangay map. Never re-import
from the older set.

An earlier version of this placeholder lived in `DashboardShell.tsx`'s
compact-map grid instead (the cell directly below the compact map
spacer) — moved here after the user reported it as still missing despite
being on-screen: "the FSI corner" turned out to mean this detail panel's
own FSI block, not the map's `Legend` chip, so a placeholder sitting
beside the map rather than below the barangay's actual FSI info wasn't
read as satisfying the request at all.

**HAND/TWI/LC/rainfall factor breakdown is real now too.**
`components/BarangayDetailPanel.tsx` lazily fetches
`public/data/fsi_factors.json` (via `lib/fsiFactorData.ts`) and renders a
four-row bar breakdown (HAND inverted, TWI, LCLU runoff score, 6-hour
rainfall forecast, each 0-1) below the hydrograph. Unlike the hydrograph,
there's no dedicated placeholder for missing data here — it's purely
additive UI that only appears once fetched, matching this file's
"supplementary, not a replacement" framing for `fsi_recomputed`.

**Provenance and how this was built** (from the same Google Drive project
the user shared, a separate, earlier — Sept 7-11 — single-watershed FSI
pipeline than the Sept 19-21 island-wide hydrograph one above):
`compute_fsi.py`'s own real formula (confirmed by reading it directly) is
exactly this repo's already-documented `FSI = 0.30·HAND(inverted) +
0.30·TWI + 0.20·LCLU + 0.20·Rainfall`, each factor min-max normalized
**globally across the island**, not per-barangay. `fsi_factors.json` was
built by recomputing that same normalization from the four aligned input
rasters and reprojected barangay polygons (Python + `rasterio`/`shapely`/
`pyproj`, one-off, not checked into this repo), then zonal-averaging each
normalized layer per barangay.

**Two inputs couldn't be downloaded at their canonical size** (the
Drive MCP connector used to fetch them hard-fails above ~6MB; both the
canonical `twi_aligned.tif` and `rainfall_aligned.tif` are ~7MB and
never transferred, retried repeatedly) **and were reconstructed instead**:
- **Rainfall**: `fetch_rainfall.py`'s own source confirms
  `rainfall_aligned.tif` is nothing but a 7-point (one per monitored
  municipality, Maripipi excluded) inverse-distance-weighted
  interpolation of a 6-hour forecast total, read from the tiny (14KB)
  `rainfall_timeseries.json`. Recomputing this IDW surface directly from
  that JSON (same formula, same municipality coordinates) needed no
  raster download at all.
- **TWI**: `compute_twi.py` needs flow accumulation (`drain_cell.tif`,
  16.7MB, also undownloadable) and slope (`slope_aligned.tif`, ~7MB).
  Substituted **`flow_accum_aligned.tif`** (2.3MB, confirmed identical
  grid/transform/CRS to the reference `hand_aligned.tif`) for
  `drain_cell.tif` — this is an **older (Sept 8) artifact than the
  pipeline's actual Sept 10 `drain_cell.tif`**, so it may not be
  bit-identical to the canonical flow accumulation, though both come from
  the same `r.watershed` run on the same DEM. Slope was rebuilt by
  reprojecting the original, smaller (4.15MB) `slope_utm51n.tif` (EPSG:4326)
  onto the reference grid with bilinear resampling — the exact same
  operation `align_fsi_inputs.py`'s `warp_raster()` does to produce the
  real `slope_aligned.tif`, just run here instead of read pre-built.

**Validated, not just assumed**: the recomputed per-barangay
`fsi_recomputed` (the weighted recombination of the four factor means)
was cross-checked against the 115 barangays' authoritative
`mean_fsi_score` in `barangay_dashboard_data.json` — **correlation 0.85,
mean signed difference −0.0003 (unbiased), mean absolute difference
0.038** on the 0-1 scale, largest single outlier +0.23 (San Roque,
Naval). That level of agreement is consistent with the known
approximations above (stale flow-accumulation raster, IDW-reconstructed
rainfall, possibly a different `all_touched` rasterization rule than the
original pipeline used) rather than a broken join — but it means
`fsi_factors.json`'s numbers are a good-faith approximation, not a
byte-for-byte match to whatever the original pipeline would have
produced with its own canonical rasters. `mean_fsi_score` remains the
one authoritative score everywhere else in this app; nothing here
changes it.

**Theme**: the dashboard's post-login background is theme-aware, not one
fixed dark scene — see `.bfw-root[data-theme='light'][data-revealed='true']
.bfw-sky` vs. the `[data-theme='dark']` variant in `app/page.tsx`.

**Simulation Mode is real now too — admin-launched, client-side, ephemeral,
and island-wide.** (Reached differently today than described just below —
see the "Superseded" note earlier in this file and "Full admin dashboard
redesign": there's no "Open User Dashboard" button anymore, it's the admin
shell's own "Rainfall & Scenarios" tab.) `components/UserDashboardModal.tsx`
is a self-contained snapshot of the real dashboard (map + barangay list +
detail panel, including the real
hydrograph and factor breakdown, via the same `BarangayList`/
`BarangayDetailPanel` components the live dashboard uses, reused as-is)
plus a "Simulation Mode" button that opens a slide-out sidebar containing
`components/SimulationModePanel.tsx`. There an admin types a min/max rain
rate (mm/hr) and a storm duration (hours, capped at 12 via both the
input's `max` and a clamping `onChange`, plus an explicit `minRate >= 0 &&
maxRate >= minRate && durationHours > 0` guard before "Start simulation"
is even enabled — a bad input used to only break one barangay's chart; now
it drives the whole island's ranking, so it needed a real check, not just
a soft clamp) and clicks "Start simulation" to run that storm against
**every barangay at once** (`lib/islandSimulation.ts`'s `simulateIsland()`
— see its own extensive header comment for the full reasoning), not just
whichever one happened to be selected. Output is clearly banner-labeled
`SIMULATED` throughout (a deliberately higher-contrast amber than the
first version shipped — see "Redesigned as a full-screen view" below).

**The recompute reuses the real basin and the real formula, not a new
one.** `lib/simulationMode.ts`'s `simulateForBarangay()` calls the exact
same `hydrographForBarangay()` used for the real chart (same largest-
overlap-basin selection, so a simulation always targets the identical
basin the real chart shows for that barangay), then feeds that basin's
own `A` (now exposed on `PrimaryHydrograph` — previously loaded but
dropped on the way out) through the exact same analytical recurrence
documented above: `Q[t+1] = Q[t]·e^(-AΔt) + R[t+1]·(1-e^(-AΔt))`, `Q[0] =
0`. The only new thing is the rainfall series fed into it: a **raised**
triangular hyetograph (`buildRaisedTriangularHyetograph()`) — ramps from
the admin's `minRate` up to `maxRate` over half the duration, back down to
`minRate` over the other half, then holds at `minRate` (a background
rate, not a fabricated drop to zero) for the rest of a fixed 6-hour
display window (same window/step as the real storm, so both charts share
an x-axis). This is a literal generalization of the real pipeline's
single-peak `0 → peak → 0` triangle, not an invented shape — setting
`minRate = 0` reproduces it exactly.

**Sanity-checked, not just written and shipped**: running a simulation
with `minRate=5, maxRate=50, duration=2h` for Esperanza (Cabucgayan)
against its real basin 866 produced a peak of 42.5 m³/s, versus the real
static hydrograph's 43.3 m³/s for the same basin — close, as expected
given the floor-vs-zero-tail and narrower-ramp-range differences, not
suspiciously identical or wildly off. Confirms the basin/`A`/formula
plumbing is correct end to end.

**Island-wide countdown times reuse a real, disclosed formula — FSI
recompute is a disclosed approximation the user explicitly chose, after
being told plainly no real one exists.** Two genuinely different claims,
not one: CLAUDE.md already documents the real pipeline's Warning/Alert/
Danger method as "relative to each basin's own modeled peak Q (50%/75%/
95%, not 100%)" — `lib/islandSimulation.ts`'s `crossingTimeHours()` reuses
that exact same relative-threshold method against a simulated discharge
curve instead of the real one, which is a legitimate reuse of a real
formula, not an invention (no code implementing this crossing-time scan
existed anywhere before this — it's newly written, but the *formula* was
already real). Guards `max(q) ~ 0` (a flat/no-rain simulation) by
returning the end of the modeled window rather than `0` — without this, a
barangay simulated with zero rain would trivially "cross" a 0 threshold
at `t=0` and misreport "Danger in 0 hours," actively misleading for a
disaster-response tool.

FSI score/label is different: the real formula
(`0.30·hand + 0.30·twi + 0.20·lclu + 0.20·rainfall`, confirmed by reading
`fsi_factors.json` directly) combines three genuinely storm-independent
terrain factors (elevation, wetness, land cover — static rasters, don't
change with a storm) with a rainfall factor that's already stored
pre-normalized 0-1, with no raw mm total anywhere in this repo to rescale
a simulated value against. This was disclosed to the user plainly before
building anything — full per-basin FSI recompute has been flagged
"deliberately still not built" elsewhere in this doc for exactly this
reason — and they chose to build an approximate recompute anyway,
understanding it's an approximation layered on an approximation (the
existing `fsi_recomputed` in `fsi_factors.json` is itself already
disclosed as not replacing the authoritative `mean_fsi_score`). The
approach: build the real design storm's own hyetograph (reconstructed
from its own stored `storm_params`, not hardcoded numbers) and the
simulated one the same way over the identical 6-hour window, so their
total rainfall depths are directly comparable; `ratio =
simulatedTotalMm / realTotalMm`. Each barangay's own **real** rainfall
factor is scaled by that one island-wide ratio (not replaced by a single
flat value for all 115 — that would erase the real per-municipality
spatial variation the stored factor already encodes) and reclamped to
[0,1]; `hand`/`twi`/`lclu` stay untouched. This is self-consistent by
construction, not just asserted: an admin who inputs the real design
storm's own exact parameters gets `ratio = 1` and reproduces the existing
`fsi_recomputed` value exactly — verified directly (Esperanza's real
`fsi_recomputed` is `0.5816`; running the simulation with
`minRate=0, maxRate=50, duration=2` — the real storm's own params —
produced a displayed score of `0.582`, matching to the UI's own 3-decimal
rounding). `dominant_fsi_label` reuses the exact class thresholds already
documented elsewhere in this file (0.2/0.4/0.6/0.8 — see
`fsiLabelForScore()` in `lib/dashboardData.ts`), not invented boundaries.

**How the override actually reaches the UI — zero changes needed in
`BarangayList.tsx`/`BarangayDetailPanel.tsx`/`StaticIslandMap.tsx`.**
`UserDashboardModal.tsx` builds a `displayBarangays` array (a `useMemo`
over the real `barangays` + the active `islandSim` result, if any) that
clones each barangay and overwrites its `mean_fsi_score`/
`dominant_fsi_label`/`warning_time_hours`/`alert_time_hours`/
`danger_time_hours` with the simulated ones — falling back to the real
countdown values for the 2 basin-less barangays specifically (no
discharge curve to derive a crossing time from at all; same honest-
absence pattern as their missing hydrograph chart). Every downstream
consumer (`sortBySeverity`, `filterBarangays`, the list rows, the map's
`fsiScoreColor`) only ever reads whatever `Barangay[]` it's handed — so
re-sorting the list and re-coloring the map by the simulated scenario
falls out for free from this one override, no changes needed to any of
those shared components. **Disclosure**: a persistent "⚠ SIMULATED ·
Clear" chip lives in `UserDashboardModal`'s header row (never scrolls out
of view, unlike the fuller amber banner in the scrollable body below it)
the entire time a simulation is active — clicking it resets to the real
static data without needing to reopen the sidebar.

**Why a second map component (`components/StaticIslandMap.tsx`) doesn't
reopen the "one persistent map" decision** (see below): it is a
genuinely separate, read-only renderer — no pan/zoom/pointer handlers, no
`view`/`resetToken` state, not a mode or prop on `BiliranMap` — that
fetches the same `/data/geo/barangays.geojson` and reuses the same
`lib/geo.ts` projection helpers `BiliranMap.tsx` already uses, just to
color barangay polygons by `mean_fsi_score` inside the modal. The one
real, interactive, persistent `<BiliranMap>` still only ever mounts once,
in `app/page.tsx`.

It also renders the same FSI-severity `Legend` the real map uses —
`Legend` was module-private in `BiliranMap.tsx`, exported (no signature/
behavior change) so `StaticIslandMap.tsx` can import and reuse it rather
than reimplementing the same five color stops a second time. Always the
full (non-compact) variant — `StaticIslandMap` has exactly one caller
(`UserDashboardModal.tsx`, `height={320}`), always tall enough for it, so
there's no need for the `compact` dots-only mode `BiliranMap`'s own small
compact-map state uses.

**Redesigned as a full-screen view, not a dialog — fixing a real double-
blur bug, not just a style pass.** The original version rendered
`UserDashboardModal` as a JSX *sibling* of the still-open Invitations
`Modal` (both wrapped in a fragment) rather than nesting it inside —
deliberately, to dodge a `backdrop-filter`-establishes-a-new-containing-
block bug (nesting put the inner modal's `fixed inset-0` backdrop inside
an ancestor with `backdrop-blur-xl`, squashing its content into the outer
dialog's small `max-w-sm` box). But neither modal actually closed the
other, so **both stayed mounted at once**, each painting its own
independent `bg-black/40` + `backdrop-blur-xl` backdrop at the same
`z-50` — a compounding double-blur, reported and fixed this round.
`AdminInvitePanel.tsx` now renders one or the other, never both
(`if (showUserDashboard) return <UserDashboardModal .../>`), and
`UserDashboardModal.tsx` no longer uses the shared `Modal` at all — it's
its own `fixed inset-0 z-50` full-screen takeover (closer to "a database
dashboard" than a small dialog, per the redesign brief), with a bigger
`StaticIslandMap` (`height={320}`, up from the old modal's `180`) and its
own close control: an `×` pinned **top-left** (not the shared `Modal`'s
top-right convention — deliberate, since this reads as "exit this view,"
not "dismiss a dialog").

**A second real bug this surfaced**: this app's `--card-bg`/`--header-bg`/
`--body-bg` CSS variables are all deliberately translucent (paired with
`backdrop-blur`, meant to tint over the always-present map scene behind
every other panel) — using `var(--card-bg)` for this new full-screen
view's own background (an early draft did) let the still-mounted
persistent dashboard/map bleed through visibly underneath it. Fixed with
explicit, fully-opaque colors keyed by the theme, now factored into a
small shared `lib/opaqueTheme.ts` (`DAY_BG`/`NIGHT_BG`/`opaqueBg(theme)`
— same reasoning as `MunicipalityFilterDropdown`'s own `DAY_COLORS`/
`NIGHT_COLORS`, same RGB channels as `--card-bg` at alpha 1) once
`AdminInvitePanel.tsx` needed the identical technique for its own landing
(see below) — extracted rather than duplicated a second time.

**The Simulation Mode sidebar** (`fixed right-0 top-0 h-full w-80`,
slide-in-from-the-right transition, same `data-open` + CSS-transition
technique as the shared `Modal`'s own open/close animation) stays mounted
at all times, just transformed off-screen when closed — so its input
values survive being closed and reopened, matching the requested "auto-
close after Start simulation, reopen by pressing Simulation Mode again"
behavior without losing whatever the admin had typed. Its own "Exit"
button (top of the sidebar, `bfw-btn` pill) closes without running
anything; "Start simulation" runs the whole-island recompute (see above)
and hands the full `Map<barangayKey, IslandSimResult>` up to
`UserDashboardModal` via `onSimulate`, which stores it and closes the
sidebar itself. No longer gated on a selected barangay at all — the
button used to be `disabled={!selected}` back when a simulation only
targeted one; now it's `disabled={!barangays}` (just needs the roster
loaded), since the recompute always covers the whole island regardless of
what's currently selected in the list.

**Superseded — see "Full admin dashboard redesign" near the end of this
file.** The `AdminInvitePanel.tsx`-as-full-screen-landing architecture
described in this paragraph and the several below it (the `z-[18]`
takeover, "Open User Dashboard" swapping it for `UserDashboardModal`,
`showUserDashboard`) no longer reflects the current code — `AdminShell.tsx`
is the admin landing now, `AdminInvitePanel.tsx` is just its "Invitations"
tab's plain content, and `UserDashboardModal` is its "Rainfall &
Scenarios" tab (via a new `embedded` prop), not a button-triggered
overlay. Left in place as a historical record of the bugs found/fixed at
the time (the double-blur bug, the opaque-background fix, the z-index
click-interception bug) since those fixes and their reasoning (especially
`lib/opaqueTheme.ts`) are still directly relevant today.

**Admin sign-in now lands directly on a full-screen "Invitations"
view — not a modal over the live map.** Reported bug: the shared `Modal`
`AdminInvitePanel.tsx` used to render with is translucent by design (same
class of bug as above), so the live map/dashboard visibly bled through
behind the Invitations dialog. Fixed the same way `UserDashboardModal`
already was: `AdminInvitePanel.tsx` is now its own `fixed inset-0 z-[18]
flex flex-col` opaque takeover (`opaqueBg(theme)`, no shared `Modal`) —
**`z-18`, deliberately not `z-50`**: a full z-index inventory of
`app/page.tsx` (`.bfw-map-shell` 15, `.bfw-dash` 10, the persistent header
row with Profile/sign-out/day-night 20) confirmed nothing occupies 16-19,
so this sits above the map+dashboard (fully occluding them) but *below*
the header, which stays reachable the whole time an admin is on this
landing — unlike `UserDashboardModal`, which still fully occludes the
header while open (an accepted, pre-existing tradeoff for a temporary
snapshot view, not changed here). No close/X on this landing itself —
closing `UserDashboardModal` (its own top-left `×`) already returns here,
never to the raw map/dashboard, so there's nothing else to close back to;
the `onClose` prop was dropped from `AdminInvitePanel` entirely, not left
unused. **A real layout bug found via Playwright, not assumed away**:
the admin landing's own header row initially put "Open User Dashboard" at
the same top-right screen position as the persistent Profile/day-night
row (`z-20`, `absolute right-5 top-5`) — since that row sits *above* the
landing's `z-18`, it silently intercepted every click meant for the
button underneath it, confirmed by an actual failed automated click, not
a visual guess. Fixed with a `paddingRight: 260` reservation on the
landing's header row, sized with margin to spare for every name/office
length this app actually shows (eyeballed, not computed exactly — same
style as this file's other hand-tuned layout constants, e.g.
`COMPACT_MAP_WIDTH`).

Also: the admin landing now opens for **any** admin session reveal, not
just a fresh interactive admin-toggle sign-in. The old condition
(`loginMode === 'admin' && admin`) meant a *returning* admin whose session
auto-revealed (daily login gate already satisfied, login card and its
toggle skipped entirely) never got the admin landing at all — `loginMode`
is local, unpersisted, copy/branding-only state that resets to `'user'`
on every mount, so it could never be `'admin'` on that path. Now keyed on
`admin` alone (`app/page.tsx`'s post-login effect), the real, durable
signal — `loginMode` still exists purely for the login card's own "Sign
in" vs. "Welcome, Administrator" copy, unrelated to this now.

**The real (non-admin) dashboard had a genuine height-mismatch bug too**,
reported alongside the above: `DashboardShell.tsx`'s barangay-list column
had `min-h-0 overflow-y-auto` (bounded, scrolls within the shared grid
row), but the detail-panel column next to it had no height/overflow
styling at all — its height was just whatever its own content added up
to, so it could visibly grow taller or shorter than the list beside it.
Fixed with the same `min-h-0 overflow-y-auto` treatment on that column too
— a one-line change, verified via Playwright to produce pixel-identical
heights for both columns.

**Real, live weather is connected now — this app's first live external
API call.** Everything else in this app is static JSON or Supabase;
`app/api/weather/route.ts` is the one exception, proxying Open-Meteo's
free, no-key forecast API (the same one the external pipeline's
`fetch_rainfall.py` already used) server-side, cached ~15 minutes via
Next's `fetch(..., { next: { revalidate: 900 } })`. `lib/liveWeather.ts`
fetches it client-side (`loadWeather(municipality)`, with its own short
client-side cache) and maps Open-Meteo's WMO weather code onto this app's
existing 5-bucket icon system (`conditionForWeatherCode` — a documented
judgment call, not an exact standard mapping, same spirit as
`align_fsi_inputs.py`'s own documented LULC-runoff-score judgment calls).
Coordinates for the 7 monitored municipalities live in the new
`lib/municipalityCoords.ts` — **not invented**: the exact same 7 points
already read directly from the external pipeline's own
`rainfall_timeseries.json` during the FSI factor breakdown work earlier
this session (Maripipi intentionally absent, same exclusion as
everywhere else in this app).

**The map's weather icon changed meaning — a deliberate, discussed
decision, not an accident.** Before this, `BiliranMap.tsx`'s per-
municipality icon and corner ribbon were driven by
`weatherConditionFor(crossing)` — the *modeled flood-risk crossing time*,
explicitly documented as "not a separately fabricated weather value."
That function is gone; `weatherConditionForBucket()` replaces it, driven
by real Open-Meteo data instead (fetched once for all 7 municipalities on
mount, refreshed every ~15 minutes, via a `weatherByMunicipality` state in
the main `BiliranMap` component). At the time this was written, the
modeled Alert/Danger countdown text (`LiveUpdateBanner.tsx`,
`WeatherBadge`'s tooltip) stayed exactly as it was — the two signals
were deliberately decoupled (confirmed with the user, who chose this
over adding a second parallel weather element) so the icon would stop
silently proxying flood risk as weather; `WeatherBadge`'s tooltip named
both signals separately so neither implied the other. **The countdown
side of that decoupling no longer holds** — see the live-forecast
section further down this file: the real dashboard's Alert/Danger times
are now also live-computed by default. The two are still genuinely
separate code paths, though, computing different things from the same
underlying Open-Meteo data: this icon derives a coarse Calm/Cloudy/Rain
*bucket* for a representative location from `weatherByMunicipality`
(`BiliranMap.tsx`'s own state), while the countdown is a precise
per-basin discharge-threshold crossing time from
`lib/liveIslandState.ts` (`app/page.tsx`'s separate state) — so seeing,
say, "Light rain" on the icon while a specific barangay's Danger
countdown reads differently is expected, not a bug: one is an ambient
readout, the other is that barangay's own basin's actual modeled
response to its own municipality's forecast.
A municipality whose weather hasn't loaded yet (or whose fetch failed)
simply shows no icon that pass — no placeholder/fake condition invented.

**Live Open-Meteo connectivity is now confirmed for real, not just
expected.** This sandbox's own outbound network policy blocks
`api.open-meteo.com` (confirmed via the proxy's own diagnostic as an
organization-policy 403, not a bug), so everything through the previous
paragraph was only verified against **mocked** `/api/weather` responses
via Playwright. Once the app was actually deployed (Vercel, first
production deploy this session), hitting the real route directly —
`GET /api/weather?municipality=Naval` against the live deployment —
returned genuine Open-Meteo data: `weatherCode: 3`, `temperatureC: 28.4`,
`precipitationProbability: 92`, plus 24 hourly entries with naturally
varying (not placeholder/flat) `precipitationMm`/`precipitationProbability`/
`weatherCode` values. Confirms the route, the WMO-code mapping, and the
whole fetch/cache path all work unmodified outside this sandbox — the
"should work once deployed" hedge above is resolved, not just still
believed.

**A planned research pass didn't happen this session, for the same
reason**: comparing real Open-Meteo data against `fsi_factors.json`'s
stored rainfall values, to help answer the still-blocked full-FSI-
recompute rainfall-baseline question (see "Deliberately still not built"
above), needed the same blocked network access. Still open — worth
revisiting from an environment that can actually reach Open-Meteo.

**`WeatherBadge` now also shows Open-Meteo's hourly chance-of-rain** (the
`%` under the condition label, e.g. "Rain" / "62% rain") — purely a
readout, requested explicitly even though the modeled Alert/Danger
countdown never consults it (that's computed entirely from the static
hydrograph/FSI pipeline — "if it rains, here's how risky it is",
independent of whether a real forecast says it will). `current_weather`
itself has no precipitation-chance field; `app/api/weather/route.ts` now
also requests `hourly=precipitation_probability` and picks out the value
for whichever hour matches `current_weather.time`, exposed as
`current.precipitationProbability`. `lib/liveWeather.ts`'s `WeatherData`
and `BiliranMap.tsx`'s `WeatherCondition` both carry the field through;
null (hidden, no "0%" shown) while loading or if Open-Meteo omits it. Not
added to the per-municipality map icons (`MunicipalityLayer`) — those are
small icon-only glyphs with no room for text, and the user's request was
specifically about the corner ribbon. Verified via `npm run lint`/
`npm run build` (type-checked end to end) and by tracing the data path
manually; not exercised against a live browser render in this session —
same blocked-network limitation as the rest of this section, and no
mocked-auth Playwright harness was set up for this small an addition.

**The real (non-admin) dashboard's FSI/countdown numbers are now
live-forecast-driven by default — a deliberate reversal of this file's
earlier framing that they'd stay static/synthetic "until a real forecast
is wired in."** The user explicitly asked for this once live weather was
confirmed reachable from a real deployment (see the Open-Meteo
verification note above) — not an admin-only sandbox like Simulation
Mode, but the actual default view every signed-in user sees.
`lib/liveIslandState.ts`'s `computeLiveIslandState()` is the new
orchestration point; `app/page.tsx` now eagerly loads
`basin_hydrographs.json`/`fsi_factors.json` (previously lazy, fetched
only once a barangay was selected — `BarangayDetailPanel.tsx` still does
that independently for its own factor-breakdown display and as a
fallback, sharing the same cached loaders) plus live weather for all 7
monitored municipalities (`lib/liveWeather.ts`, same 15-minute refresh
`BiliranMap.tsx`'s own icon fetch already uses — a separate fetch/state,
not shared, though `loadWeather()`'s own client cache means this doesn't
double the real network traffic), and overlays every barangay's
`mean_fsi_score`/`dominant_fsi_label`/`warning_time_hours`/
`alert_time_hours`/`danger_time_hours` with the live-computed ones —
exactly the same override pattern Simulation Mode's `displayBarangays`
already established (`UserDashboardModal.tsx`), just applied to the main
`app/page.tsx`/`DashboardShell.tsx`/`BiliranMap.tsx` path instead of an
admin-only modal, so the barangay list, its ranking, and the map's
polygon colors all update for free — no changes needed to
`BarangayList.tsx`, `sortBySeverity()`, or `BiliranMap.tsx`'s own
coloring logic.

**Countdown times reuse the exact same real, disclosed formula
Simulation Mode already established** — `crossingTimeHours()` and
`recomputeHydrograph()` (both already existed, in
`lib/islandSimulation.ts`/`lib/simulationMode.ts`) are called unchanged;
the only difference from Simulation Mode is the rainfall series fed in:
each barangay's own municipality's real Open-Meteo hourly forecast
(`dtHours = 1`, the recurrence is unconditionally stable at any step
size — no change needed there either) instead of an admin-typed
synthetic hyetograph. `crossingTimeHours()` already guarded
`max(q) ~ 0` (no rain) by returning the window's end rather than `0`;
that guard is exactly what keeps a dry-forecast municipality from
misreporting "Danger in 0 hours."

**FSI score is still an approximation — same honest limitation as
before, now generalized rather than solved.** No real formula exists
that turns live rainfall into the terrain-factor recombination directly
(the "Deliberately still not built" full per-basin recompute below is
about the *canonical, raster-based* version of this, which remains
unbuilt). What's live now is the same kind of approximation Simulation
Mode's island-wide recompute already used and the user already accepted
once — generalized from "one ratio for the whole island" (an admin's
single typed scenario) to **one ratio per municipality** (real per-
municipality forecasts are now available, so this is strictly more
spatially faithful, not less): each barangay's own real, static rainfall
factor (`fsi_factors.json`) is scaled by
`liveTotalMm(barangay's municipality, next 6h) / designStormTotalMm`
(the real design storm's own total rainfall, computed analytically as
`0.5 * peak_mm_hr * duration_hours` — a symmetric triangle's area, exact
regardless of time-step) and reclamped to `[0, 1]`; `hand`/`twi`/`lclu`
stay untouched, since terrain doesn't respond to weather. Self-consistent
by construction, same as Simulation Mode's version: a municipality
forecasting exactly the design storm's own total reproduces `ratio = 1`
unchanged. **Verified working end-to-end**, not just written and shipped
— mocked-auth Playwright with a fabricated heavy-rain forecast (25mm/hr
for 6 hours) produced Esperanza's FSI moving from its static `0.5734` to
a live `0.661` (label Moderate → High), matching the hand-computed
expected value exactly (`0.3·0.9831 + 0.3·0.1649 + 0.2·0.5816 +
0.2·1.0` — the rainfall term clamped to `1.0` at that rain level); the
barangay list re-sorted, the map recolored, and the selected barangay's
hydrograph/precipitation charts and factor-breakdown "rainfall" row all
showed the same live numbers, not a mix of live and stale static ones
(see below).

**No message-tone disclaimer, per the user's own explicit choice** — a
plain informational banner (`DashboardShell.tsx`, replacing the old red
"not a live rainfall feed" framing) instead: *"Computed from today's live
Open-Meteo forecast — FSI = 0.30·HAND + 0.30·TWI + 0.20·LCLU + 0.20·live
rainfall; Warning/Alert/Danger = 50%/75%/95% of each basin's live-forecast
peak discharge."* Neutral teal styling, not the old alarm-red — this
isn't a caution, it's a factual note on computation basis, which the
user asked for directly ("no need [for a warning], maybe just a message
that it is from this and that computation from the files"). Falls back
to the old red "loading" framing (worded honestly — "showing the static
synthetic design-storm baseline until it arrives," not silently showing
stale numbers with the live banner already up) for the brief window
before the first weather fetch resolves, or if it fails entirely.

**A real inconsistency was caught and fixed during verification, not
shipped**: an early version left `BarangayDetailPanel.tsx`'s factor-
breakdown "rainfall" row showing the *pre-scaling* static value while the
headline FSI score above it was already built from the *live-scaled,
clamped* one — e.g. a real static factor of `0.6045` scaled by a live
ratio of `3.0` clamps to `1.0` for the actual score, but the row still
read `0.60`, a visible contradiction a careful reader would notice.
Fixed by exposing `liveRainfallFactor` on `lib/liveIslandState.ts`'s
`LiveComputedState` (the same number that fed `liveFsi`) and threading it
down (`app/page.tsx` → `DashboardShell.tsx` → `BarangayDetailPanel.tsx`)
to override just that one row — `hand`/`twi`/`lclu` stay the static
values, correctly, since only rainfall is live-scaled. The row's label
also switches ("Today's live rainfall forecast" vs. the original
"6-hour rainfall forecast") so it's clear which mode is showing. The
panel's own countdown caption ("Times are hours into...") was similarly
stale in an early version — read "not a live countdown" directly
contradicting the live banner above it — now conditioned on the same
`liveHydrograph != null` signal the charts above it already use, so it
stays in sync with them for free rather than needing a separate flag.

**The 2 genuinely basin-less barangays (Kawayan/Burabod, Kawayan/
Poblacion) keep their real static countdown times even with live data
active** — `app/page.tsx`'s override falls back to each barangay's own
static `warning_time_hours`/etc. specifically when
`liveIslandState.get(key)?.warningTimeHours` is `null` (no discharge
curve to derive a live crossing time from at all), same honest-absence
pattern as their missing hydrograph chart everywhere else in this app —
not a new gap, the same one, now correctly inherited into the live path
too.

**A small countdown badge in the map's bottom-right corner** (`BiliranMap.tsx`'s
new `NextForecastBadge`, "Next forecast update in Xm") shows when the
live data above will next refresh — display-only, sitting just above
`ZoomControls` in the same corner, same glass-chip styling, hidden under
the same `showChrome && !compact` gating. It does NOT own a timer itself:
`app/page.tsx`'s existing weather-refresh effect stamps a new
`nextForecastUpdateAt = Date.now() + 15min` on every real refresh
(including the initial one), passed down as a prop; the badge just
re-renders its own countdown text every 15 seconds from that timestamp.
`null` (the pre-login backdrop, or before the first weather fetch has
even started) hides it entirely rather than showing a placeholder count.

## Known gotchas from the external GIS pipeline (context only, not this repo's code)

These affect the data pipeline that produces `barangay_dashboard_data.json`,
which lives outside this repo — relevant if you're asked about the data's
provenance or oddities, not for changes here: GDAL+numpy2.x incompatible
(pin `numpy<2`); `numba`/`pysheds`/`rasterio` blocked by Windows Smart App
Control on the dev machine (GRASS via QGIS Processing used instead);
`r.watershed`'s "basin" output is small local sub-catchments, not a true
cumulative watershed — reused island-wide (at `threshold=200`, 2,235
basins) for the per-basin hydrograph data described above, the opposite
of its original rejected use for finding one big river; explicit-Euler
numerical schemes need `A > 2/dt` to stay stable (the project switched to
the exact analytical formula `Q2 = Q1·e^(-AΔt) + R·(1-e^(-AΔt))` for this
reason — first found as a ~3-5% shift down from earlier Euler-computed
peak Q values for the original 6 named rivers, then found to be load-
bearing rather than cosmetic once the same pipeline was extended
island-wide: the Euler approximation produced physically impossible
peak-Q values, exceeding the input storm's own peak, for 354 of the 2,235
basins); other bugs found and fixed during that same island-wide
expansion: a fake "basin" that was actually unassigned NoData pixels
misread as real, a barangay-name collision that silently dropped 5
barangays from an earlier join attempt, and three files at one point
built from two incompatible basin rasters (see the hard constraint on
`_FIXED` vs. `_2235_CORRECT` files above); a known open bug is
source-level UTF-8 double-encoding in `barangay_biliran.geojson` (affects
names like "Capiñahan," "Santo Niño").

## Full admin dashboard redesign (multi-tab, matching a reference mockup)

The user shared a ChatGPT-generated mockup of a much larger admin UI
(top-nav tabs: Dashboard, Barangays, GIS/FSI Data, Rainfall & Scenarios,
Users, Invitations, Reports, Activity Logs, Settings; stat cards; a flood
map; FSI tables/charts; a "System Status" panel; Activity/Alerts feeds)
and asked for a full redesign to match it. Most of the mockup's own
numbers/panels were generic placeholders with no real backing data in
this repo (10 barangays where the real count is 115, a fabricated 7-day
FSI trend, a "System Status" panel reporting on services that don't exist
here) — confirmed directly with the user before building anything, per
this project's established no-fabrication discipline (see this file's own
history above): **System Status was dropped entirely** (nothing real to
report), **FSI Trend was built for real, starting from the day this
shipped** (not backfilled or invented), **Activity Logs were deferred**
(a genuinely separate feature — a real audit-log table plus logging on
every admin action — scoped on its own later), and **the Users tab is
read-only** (no edit/promote/demote from this tab). Reports and Settings
were left out too, for the same reason as System Status — no real content
or data to back either yet, not silently dropped but explicitly flagged
as omitted.

**`components/AdminShell.tsx` is the admin landing now**, replacing
`AdminInvitePanel.tsx` as what `app/page.tsx` mounts for
`showAdminPanel && isAdmin` — see the "Superseded" note earlier in this
file for what changed structurally. It owns its own header (title/
subtitle left; Day/Night toggle + `HeaderProfileButton` right, wired to
the exact same `theme`/`showProfile` state `app/page.tsx` already had) and
a horizontal tab bar (Dashboard / Barangays / GIS & FSI Data / Rainfall &
Scenarios / Invitations / Users), swapping tab content below it via plain
`useState` — not routes, since this whole shell only ever exists behind
the same `showAdminPanel && isAdmin` gate already enforced upstream, so
nothing here needs to survive a reload/deep-link. Fully occludes the
persistent app header and the real dashboard/map while open, same
precedent `UserDashboardModal.tsx` already established (a temporary
admin-only view, not permanent app chrome) — `z-50`, `opaqueBg(theme)`
for its own background **and** its header/tab-bar bands (NOT the
`--body-bg`/`--header-bg` CSS variables `DashboardShell`'s persistent
header uses — those are deliberately translucent, and using them here let
the still-mounted real dashboard/map visibly ghost through behind the
shell, caught via this feature's own Playwright screenshot pass before
shipping, same bug class documented at length earlier in this file for
`UserDashboardModal`/`AdminInvitePanel`). `app/page.tsx`'s `ProfilePanel`
is rendered **after** `AdminShell` in the JSX now (previously it came
first) so it paints on top of the shell at the same `z-50` when opened
from `AdminShell`'s own Profile button — otherwise it would render
underneath and be invisible.

**Dashboard tab** (`components/AdminDashboardTab.tsx`, the new default):
4 stat cards — total barangays (`115`, hardcoded fact, not fetched),
registered users (a real count from the new `GET /api/admin/users`, see
below), GIS/FSI factors (`4`, hardcoded — HAND/TWI/LCLU/Rainfall), and
High+Very High risk count (computed live from whichever `barangays` prop
AdminShell was handed). **`barangays` is not fetched independently here
— it's the exact same live-forecast-overlaid list `app/page.tsx` already
computes for the real dashboard** (`displayBarangays`, threaded through
`AdminShell` as a prop, alongside `liveActive={liveIslandState != null}`)
rather than a second independent fetch/recompute — a deliberate
simplification from the original plan (which suggested the tab load
`basin_hydrographs.json`/`fsi_factors.json`/live weather itself): reusing
the app's one already-computed live state means the admin view can never
show a different number than the public dashboard for the same barangay,
and avoids a second full set of Open-Meteo calls. Below the stat cards:
the same `highestRiskCrossing()` line the public dashboard's banner uses,
a `StaticIslandMap` + FSI class-percentage breakdown (computed from the
real barangay set), a "Recent FSI by barangay" table (`sortBySeverity()`,
top 10, click-through to the Barangays tab), and the FSI Trend chart
(below).

**FSI Trend — the one genuinely new data source.** New table
`public.fsi_daily_snapshots` (`supabase/fsi-daily-snapshots-setup.sql`,
same "NOT auto-applied, run by hand in the Supabase SQL editor" convention
as every other `supabase/*.sql` file here — **not yet run against the
real project**, so the chart shows nothing until someone with dashboard
access runs it): one row per calendar date (`snapshot_date` unique,
`avg_fsi`, `high_risk_count`, `source: 'live'|'static'`), RLS-enabled with
a blanket deny-all policy (same reasoning as `invitation_codes` — every
real access goes through `supabaseAdmin` in the new admin-gated route
below, never a direct client). New `app/api/admin/fsi-snapshot/route.ts`:
`GET` returns the last 30 rows; `POST` is an **idempotent upsert-if-missing**
keyed on today's date (`Asia/Manila`, matching this app's other date
handling) — it only ever inserts if today's row doesn't already exist, so
calling it repeatedly (every Dashboard-tab mount) never overwrites an
already-recorded day with a possibly-different intraday value. New
`lib/fsiTrend.ts` (`fetchFsiHistory`/`postTodaySnapshot`, both take a
bearer token as a parameter rather than fetching their own session —
matching `AdminInvitePanel.tsx`'s existing pattern). `AdminDashboardTab`
POSTs today's snapshot once per mount (`avgFsi`/`highRiskCount` computed
from the same `barangays` prop above, `source` set from `liveActive`),
then GETs the history to render `components/FsiTrendChart.tsx` — a new
hand-rolled SVG line chart, same polyline technique as
`components/DischargeChart.tsx` (this repo's own "no charting library"
convention), fixed `[0, 1]` FSI y-axis, points colored via the same
`fsiScoreColor()` every other FSI visualization in this app uses. Starts
empty and only ever grows from whenever the table is first created
forward — **deliberately not backfilled** with invented historical
values, and the chart says so explicitly when it has fewer than one
point.

**Barangays tab** (`components/AdminBarangaysTab.tsx`): a browsable list
of all 115 (`MunicipalityFilterDropdown` for filtering, `BarangayList`
for the ranked rows), selecting one reuses `BarangayDetailPanel`
unchanged — same real hydrograph/precipitation/factor-breakdown content
the public dashboard and Rainfall & Scenarios tab both already show, zero
duplicated logic.

**GIS & FSI Data tab** (`components/AdminGisDataTab.tsx`): a static,
purely informational page — the real FSI formula
(`0.30·HAND(inverted) + 0.30·TWI + 0.20·LCLU + 0.20·Rainfall`), the 4
input factors and their real provenance, and the real validation numbers
already computed and documented earlier in this file (correlation 0.85,
mean absolute difference 0.038 against `mean_fsi_score`). Nothing new is
computed or claimed here — this just surfaces already-true, already-
documented facts in the admin UI instead of leaving them buried in this
file, which is exactly why the mockup's own fabricated "6 GIS Datasets"
card was dropped rather than reproduced.

**Rainfall & Scenarios tab**: `UserDashboardModal` rendered directly with
a new `embedded` prop (default `false`, preserving the old fixed-overlay/
close-`×`/fade-in-transition behavior for any future non-embedded caller,
though none currently exists — `AdminShell` is the only caller now, and
always passes `embedded`). Embedded mode drops the `fixed inset-0`
wrapper, the opaque background (the surrounding tab-content area already
provides one), the fade-in transition, and the top-left `×`/"User
Dashboard" heading (the tab bar itself is the way in and out — there's
nothing for this view to close back to on its own). The Simulation Mode
sidebar keeps its own `fixed right-0 top-0` positioning either way, since
that's relative to the viewport regardless of embedding context. This
replaces the old "Open User Dashboard" button + `showUserDashboard`
toggle inside `AdminInvitePanel.tsx` entirely — there is no longer a
button that opens this as an overlay; it's just always-available tab
content now.

**Invitations tab**: `AdminInvitePanel.tsx` lost its own `fixed inset-0
z-[18]` opaque wrapper, its own header row, and the "Open User Dashboard"
button/`showUserDashboard` state entirely (see the "Superseded" note
earlier in this file) — it's now plain tab content, just a heading plus
the create/list/edit/revoke form and logic.

**Follow-up round — status badges, search/filter, explicit Resend** (a
separate request, referencing a second ChatGPT-drafted spec the user
shared for an "Account Invitations" admin page). Confirmed directly
before building: `revoke` (`DELETE`, `app/api/admin/invite/[id]/route.ts`)
**hard-deletes** the row — there's no persisted state left once revoked,
so a `Revoked` status can't be shown afterward without a real schema
change (a `revoked_at` column, plus a new guard in
`app/api/activate/route.ts` so a revoked code can't still redeem). Given
the choice, the user picked keeping revoke as a hard delete rather than
adding that column — so the list now derives exactly **three** statuses,
computed client-side, nothing new stored: `Pending` (not redeemed, not
expired), `Accepted` (`redeemed`), `Expired` (not redeemed,
`expires_at` in the past) — see `inviteStatus()` in `AdminInvitePanel.tsx`,
rendered as a small colored badge per row. A search box (matches
email/office/`invitee_name`, case-insensitive) and a status `<select>`
filter narrow the list client-side (`filteredInvitations`), same
in-memory data, no new fetch. A dedicated **Resend** button sits next to
Edit/Revoke on every unredeemed row: it calls the existing `PATCH`
endpoint with the row's own current values completely unchanged — PATCH
already re-sends the invitation email on every successful edit (see
above), so this is just that same effect exposed as its own one-click
action, with **no new backend route**. Safe by the same construction as
edit/revoke: PATCH already refuses a redeemed row (409), so Resend can
only ever appear on, and only ever target, an unredeemed invitation.

**Users tab** (new, read-only — `components/AdminUsersTab.tsx`). New
`app/api/admin/users/route.ts` (`GET`, admin-gated via `requireAdmin`,
mirroring `app/api/admin/invite/route.ts`'s own pattern): `user_profiles`
has no email column (see this file's structured-name-fields note), so
this merges `supabaseAdmin.auth.admin.listUsers({ perPage: 1000 })` (for
email/`created_at`/`banned_until`) with `user_profiles` rows (office,
access_level, name fields) by `user_id` — the same two-source join
`app/api/activate/route.ts`'s own write path already implies (it creates
one row in each), sorted by joined-date descending. No edit/delete
affordance in the UI at all — a deliberate scope choice, not an
oversight; user management (promote/demote) remains an open item, same as
before this redesign. **Active/Disabled status column** (same follow-up
round as the Invitations changes above): derived from Supabase Auth's own
real `banned_until` field on the `listUsers()` response (confirmed via
`@supabase/auth-js`'s own types — `banned_until?: string`, set to a
far-future timestamp for an indefinite ban, absent for an active user) —
a genuine signal from Supabase Auth itself, not something this app tracks
or invents. Deliberately a **label, not a toggle**: this tab stays
read-only, so disabling/re-enabling a user is still only done from the
Supabase dashboard directly, not from this app.

**Not built here, same as the mockup's own unsupported panels**: a
"System Status" panel, an Activity Log tab, Reports, Settings. All
flagged above, all addable later if a real data source/feature exists to
back them.

## Admin UI polish round 2: left sidebar nav, stat cards, map highlighting, Rainfall & Scenarios redesign

The user shared 4 more detailed mockups (Rainfall & Scenarios, Barangays,
Users, Invitations) built around a persistent left sidebar, asking to
apply what's applicable and neglect CRUD functions. Four real conflicts
were confirmed directly before building, same no-fabrication discipline
as every prior round:

- **Nav layout**: switched from the top tab bar (previous round) to a
  left sidebar. `components/AdminShell.tsx`'s `TabId` gained `'reports'
  | 'activity' | 'settings'` alongside the 6 real ones — all three render
  the new `components/AdminComingSoonTab.tsx` ("Not built yet — no real
  data or feature exists behind this section"), a real nav entry with an
  honest placeholder, not omitted and not faked. Icons are small
  hand-rolled inline-SVG paths (`NavIcon`/`ICONS` in `AdminShell.tsx`) —
  this repo has no icon library, same "no charting library" spirit as
  `DischargeChart.tsx`'s own inline SVG.
- **Revoked status**: the Invitations mockup showed a persisted
  "Revoked" row, conflicting with the previous round's explicit decision
  that revoke hard-deletes the row. **Re-confirmed staying with hard
  delete** — `AdminInvitePanel.tsx`'s status badges/filter are still only
  Pending/Accepted/Expired.
- **Invite role selection**: the mockup lets the admin pick an account's
  role at invite time; today every invite always creates a `'standard'`
  account (`app/api/activate/route.ts`, hardcoded). **Skipped** — a real
  new capability with security implications (granting admin access via
  invite), not built.
- **Rainfall & Scenarios**: approved a full two-column redesign (below).

**Stat cards** — `components/AdminDashboardTab.tsx`'s `StatCard` is now
`export`ed and reused (not duplicated) by `AdminBarangaysTab.tsx` (Total/
Very High/High+Moderate/Low+Very Low risk counts), `AdminUsersTab.tsx`
(Total/Active/Disabled), and `AdminInvitePanel.tsx` (Total/Pending/
Accepted/Expired, computed client-side from the already-fetched
`invitations` array via the existing `inviteStatus()` helper — no new
fetch). No "With Data"/"Status: Active" cards anywhere — no real
per-barangay active/inactive concept exists in this app to back one.

**Municipality highlighting on the map** — `components/
StaticIslandMap.tsx` gained an optional `highlightMunicipality?: string
| null` prop: lazily fetches `/data/geo/municipalities.geojson` (same
file/shape `BiliranMap.tsx`'s own `MunicipalityLayer` already uses —
`MuniProps { pgc_prefix, municipality, barangay_count }`) only when the
prop is first set, and draws that municipality's real boundary outline
(thicker amber stroke, no fill change) above the barangay layer —
`pointerEvents` stays `'none'` throughout, so this stays genuinely
non-interactive; no zoom/pan/layer-toggle controls were added anywhere
(those would imply real interactivity, which would reopen this app's
"one persistent interactive map" rule — `BiliranMap.tsx` only). Wired up
in `AdminBarangaysTab.tsx` (which had no map at all before this round)
and in `UserDashboardModal.tsx`'s embedded layout, both passing the
active municipality filter through.

**`AdminBarangaysTab.tsx`** also gained a real text search box, wired to
`filterBarangays(sorted, query, municipality)` — the `query` param
already existed in `lib/dashboardData.ts` and was simply always called
with `''` before this round. No "+ Add Barangay" button, no per-row
Edit/Delete, no "Recent Activity" feed — barangay data comes from a
fixed external pipeline (see "Deliberately still not built" above), not
an admin-editable database, and Activity Logs are their own deferred
placeholder (above).

**`AdminUsersTab.tsx`** gained a real "Last Login" column —
`app/api/admin/users/route.ts` now also returns `lastLoginAt:
u.last_sign_in_at ?? null`, Supabase Auth's own real field (same
confirmation method as `banned_until` last round: checked
`@supabase/auth-js`'s own types), shown as "Never" when null (possible
right after `/activate`, before a first real sign-in) — plus a search
box and an access-level filter dropdown. Still fully read-only, no "+
Add User", no row-actions menu.

**Rainfall & Scenarios — full two-column redesign.**
`components/UserDashboardModal.tsx`'s embedded case (the non-embedded
case is untouched, kept for any future non-embedded caller) now renders
a `lg:grid-cols-[1fr_360px]` layout instead of the old single-column
stack: left column is the map (with the new municipality highlight) plus
a new `BarangayRankingTable` (a real `<table>`, same column pattern as
`AdminDashboardTab.tsx`'s own "Recent FSI by barangay" table — #,
Barangay, Municipality, FSI Score, Class, Countdown, no "Status" column
— replacing `BarangayList`'s row-button rendering for this tab
specifically; `BarangayList`'s other callers are unaffected) plus a
search box; right column is `SimulationModePanel`, now **always
visible** instead of a dismissable slide-out sidebar for the embedded
case (the non-embedded case still uses the original `fixed right-0
top-0` slide-out — `SimulationModePanel` itself branches on whichever of
`onExit`/`onReset` its caller passes, both now optional), plus a new
`SelectedBarangayCard` — a compact summary (small map thumbnail, FSI
score, predicted countdown, and — only while a simulation is active —
the scenario's rainfall range/duration) with a "View full details"
toggle that expands the real `BarangayDetailPanel` below it, rather than
duplicating its content. Every field on this card is already available
on the `Barangay`/`SimulationRunResult`/`islandSim` objects this
component already computes — nothing new is fetched or invented.

`SimulationModePanel.tsx` gained a **"Scenario name"** text field (local
component state only — never sent to `onSimulate`, never persisted
anywhere; a session-only label for the admin's own reference, cleared on
Reset) and a **"Predicted alert count"** breakdown: real counts of Very
Low/Low/Moderate/High/Very High derived from the same
`Map<string, IslandSimResult>` `simulateIsland()` already returns
(`lastResults`, a local copy kept purely to render this summary — the
full map is still handed to the caller via `onSimulate` as before). A
new **"Reset"** button (alongside "Start simulation") restores the
default inputs, clears this local summary, and — via the new optional
`onReset` callback the embedded caller passes — tells
`UserDashboardModal` to clear `islandSim` too, consolidating what used
to be a separate "⚠ SIMULATED · Clear" header chip (only relevant to the
old always-in-view sidebar arrangement) into this one action. The
non-embedded slide-out sidebar still passes `onExit` instead (closes
without running anything, unchanged behavior).

## Profile: capitalized name/office, viewable photo, bigger avatar circle

Three small fixes to the profile UI (`components/ProfilePanel.tsx`,
`components/HeaderProfileButton.tsx`, `lib/profile.ts`):

- **Capitalization**: `lib/profile.ts` gained `capitalizeFirst(s)` —
  uppercases only the first character, leaving the rest untouched
  (deliberately not a "capitalize every word" title-case, which would
  mangle an acronym like "MDRRMO" into "Mdrrmo" if it was already typed
  correctly). Applied in three places: `fetchOwnProfile()` now
  capitalizes `title`/`first_name`/`family_name`/`office` before
  returning (so older rows saved before this change, or edited directly
  in Supabase, still display correctly — no data migration needed);
  `formatDisplayName()` applies it again to whatever it's given, a cheap
  second layer for any caller that builds a name from state that didn't
  come through `fetchOwnProfile` (e.g. `ProfilePanel`'s own just-saved
  `fields` object, passed straight to it via `onProfileFieldsChange`);
  and `ProfilePanel.tsx`'s 4 `FieldInput`s wrap their `onChange` with it
  too, so it capitalizes live as typed, and `handleSaveFields` runs the
  same transform before saving, not just relying on the live-typing path.
- **Viewable photo**: the avatar circle used to be *only* a file-picker
  trigger — clicking it always immediately opened the OS file dialog to
  replace the photo, with no way to just look at the current one bigger.
  Now it's conditional: if a photo exists, clicking the circle opens a
  lightbox (`viewingPhoto` state) instead; the separate "Change photo"/
  "Upload photo" text link is the only trigger for the file picker now.
  No photo yet → the circle still opens the file picker directly (same
  as before — nothing to view). The lightbox itself is rendered as a
  **sibling of `<Modal>`**, not nested inside it — `Modal`'s own dialog
  box animates via a CSS `transform`, which establishes a new containing
  block for any `position: fixed` descendant (the same class of bug this
  app already hit once with `backdrop-filter` elsewhere), so a `fixed
  inset-0` lightbox placed inside it would be boxed into the dialog
  instead of covering the viewport — confirmed via Playwright before
  shipping (the lightbox's image only rendered full-size once moved
  outside `<Modal>`).
- **Circle vs. trapezoid sizing**: `HeaderProfileButton.tsx`'s
  `.bfw-header-profile-avatar` (the circle) grew from 32px/44px
  (not-revealed/revealed) to 50px/68px — roughly +55-56%, tuned to read
  as clearly bigger than `.bfw-header-profile-tab` (the reverse-trapezoid
  name/office tab) beside it. `.bfw-header-profile-tab` itself (240px
  max-width, padding, clip-path, the `-14px` seam-hiding overlap) is
  completely unchanged — the seam overlap only needs to cover the seam
  width, not scale with the circle, and `align-items: center` keeps both
  shapes vertically centered together as the circle grows past the tab's
  own height.

## Three follow-up fixes from live-site testing: legend size, FSI/hydrograph separation, real user disable toggle

Testing the deployed build (PR #21) surfaced 3 more issues:

- **Size-aware `Legend`**: `components/BiliranMap.tsx`'s `Legend` only
  had two variants — a large labeled column tuned for ~280px+ maps, and
  a dots-only `compact` pill tuned for BiliranMap's own ~144-192px
  compact state. `components/StaticIslandMap.tsx` always rendered the
  large variant regardless of its own `height`, so at the Barangays
  tab's 220px map the legend (≈272px tall) was literally taller than the
  map — confirmed by a screenshot of the live site. `Legend` gained a
  `size?: 'lg' | 'md'` prop (default `'lg'`, so `BiliranMap.tsx`'s own
  two call sites are unaffected — neither passes it): `'md'` is a
  smaller labeled column (14px dots, tighter gaps/padding/text), not the
  dots-only `compact` pill — Barangays-tab-sized maps still want real
  labels, just sized to fit. `StaticIslandMap.tsx` now picks the variant
  from its own `height` automatically (`< 150` → `compact`, `< 250` →
  `size="md"`, else the unchanged `'lg'` default) rather than a prop
  every caller has to remember — this also fixes a legend-vs-map-size
  bug the 120px "Selected Barangay" thumbnail (below) would otherwise
  have hit, never separately reported but real.
- **FSI summary and full detail are separate cards again**: the
  Rainfall & Scenarios two-column redesign had nested the full
  `BarangayDetailPanel` (hydrograph, factor breakdown) *inside*
  `SelectedBarangayCard`'s own bordered box in
  `components/UserDashboardModal.tsx`, behind a "View full details"
  toggle. Per direct feedback ("separate the FSI and hydrograph, just
  like before"), that toggle/nesting is gone —
  `SelectedBarangayCard` is back to being only the compact summary
  (thumbnail, FSI score, countdown, rainfall range while simulated), and
  `BarangayDetailPanel` renders as its own separate sibling card
  immediately after it once a barangay is selected, always visible, no
  toggle. `BarangayDetailPanel` itself is unchanged.
- **Users tab: Active/Disabled is a real toggle now**: a status label
  with nothing to change it read as broken next to columns that are real
  data. New `app/api/admin/users/[id]/route.ts` (`PATCH`, admin-gated):
  uses Supabase Auth's own real ban mechanism —
  `supabaseAdmin.auth.admin.updateUserById(id, { ban_duration })`,
  confirmed via `@supabase/auth-js`'s own types (`'none'` lifts a ban,
  any other duration string bans; this route uses `'876000h'`, ~100
  years, as the conventional "indefinite" value) — the same field the
  `GET` route already reads back as `disabled`
  (`banned_until` in the future). **Guarded against self-lockout twice**:
  server-side, the route rejects `disabled: true` when the target id
  matches the calling admin's own id; client-side,
  `components/AdminUsersTab.tsx` simply disables the toggle button on
  the signed-in admin's own row (with an explanatory `title`) rather
  than letting them click into a guaranteed error. No guard against
  disabling a *different* admin — this app has no "protected account"
  concept beyond "not yourself," matching its otherwise-flat
  `access_level`-gated admin model. Name/email/office/access level stay
  non-editable — only status is actionable now, so the tab's own
  explanatory copy was reworded away from a blanket "Read-only" claim.

## Independent scroll for each column in Rainfall & Scenarios

The user reported the FSI corner + simulated charts as "still not present" — actually just scroll behavior:
`components/UserDashboardModal.tsx`'s embedded two-column grid had `overflow-y-auto` on the **outer** grid
only, so both columns (map/search/list on the left; Simulation Mode/FSI-corner/detail-charts on the right)
scrolled together as one shared unit — once the right column's content grew taller than the visible area,
seeing the rest meant scrolling the whole grid, taking the map/list out of view too. Fixed by moving
`overflow-y-auto` onto each column individually (`min-h-0 overflow-y-auto` on both inner `<div>`s instead of
the shared one on the grid) — matching the non-embedded "Open User Dashboard" path's own list/detail split,
which already did this correctly.

That alone wasn't sufficient, though: the columns' own `min-h-0`/`overflow-y-auto` only creates a real
scroll region if every ancestor in the flex chain also constrains height rather than just growing to fit
content. `UserDashboardModal`'s own root wrapper div (`className={embedded ? 'flex flex-col' : ...}`) had
neither `h-full` nor `min-h-0` — so it simply grew to its natural content height (confirmed via a DOM-chain
inspection: `scrollHeight` matched `clientHeight` all the way up until `AdminShell.tsx`'s own generic
per-tab content wrapper, which ended up being the thing that actually scrolled, sharing scroll across both
columns exactly as before — just one level higher up than originally suspected). Added `h-full min-h-0` to
that root wrapper (embedded case only) so it respects the height `AdminShell` actually gives it, propagating
the constraint down to the grid and finally to each column's own scroll region. Verified via Playwright:
scrolling the right column independently leaves the left column's `scrollTop` at 0, and vice versa.

## SelectedBarangayCard's FSI corner + Simulated precipitation chart

Two more small additions to Rainfall & Scenarios, per direct feedback:

- **`SelectedBarangayCard`** (`components/UserDashboardModal.tsx`): FSI score + Predicted countdown moved out
  of the 2-column stat grid and into a right-aligned "corner" block next to the barangay name/municipality
  header — the exact same stacked treatment (bold score, class badge, muted countdown beneath) `BarangayList`'s
  own rows and the ranking list already use, applied here too for consistency. The stat grid below now only
  ever shows Rainfall/Duration, and only while a simulation is active.
- **`BarangayDetailPanel`**: Precipitation gained its own "Simulated precipitation" chart alongside the
  existing "Simulated hydrograph" — previously only the hydrograph got a simulated counterpart, so
  Precipitation stayed showing only the real/live rainfall curve even while a scenario was running.
  `SimulatedHydrograph` (`lib/simulationMode.ts`) already carries `rainfallMmHr` (the same raised-triangular
  hyetograph `simulationResult.sim.q` was itself recomputed from) — no new computation needed, just a second
  `DischargeChart` reading that existing field.

Verified via a mocked-auth Playwright pass: selecting a barangay and running a simulation shows both new
"Simulated hydrograph" and "Simulated precipitation" charts (confirmed via direct DOM queries, not
`.innerText()` — this session hit the documented CSS-`uppercase`-transform false-negative pitfall again
partway through verifying this, self-corrected the same way as before).

## Rainfall & Scenarios' ranking list now reuses BarangayList directly (BarangayRankingTable removed)

The admin's Rainfall & Scenarios tab originally showed a distinct `BarangayRankingTable` (a real `<table>`,
`#`/Barangay/Municipality/Class/FSI/Countdown as flat columns) instead of the `BarangayList.tsx` rows every
other barangay list in this app uses (Barangays tab, the "Open User Dashboard" path). A first round grouped
FSI score + Countdown into one merged table column to read as more separated from the rest of the row; the
user then clarified they wanted the full row treatment `BarangayList.tsx` already has elsewhere (shown via
a screenshot of the Barangays tab, which already renders `BarangayList`) — colored severity dot, barangay
name + "{municipality} · {class}" on the left, and the FSI score (bold) + countdown (muted, beneath it)
stacked as one block on the right, each row its own bordered/rounded item, not a table.

Rather than re-implement that look a second time, `components/UserDashboardModal.tsx`'s embedded layout now
renders `BarangayList` directly (already imported in this file for the non-embedded "Open User Dashboard"
path) in place of `BarangayRankingTable`, which was deleted entirely — same `barangays`/`selectedKey`/
`onSelect`/`onSelectMunicipality` wiring the non-embedded path already used, so both paths' ranking lists
are now the exact same component, not two components trying to look alike.

## Real-device phone fixes: header overlap, oversized map chrome, pan/zoom lag

**Partially superseded** — see "One persistent map, always full-bleed" and "Toggleable sidebar" near the top of
this file: the header-overlap fix below (`.bfw-dash`'s title band, the `paddingRight: 260` reservation) no
longer applies, since that title band now lives inside the toggleable sidebar instead, which sits on the
opposite (left) edge from the Day/Night+Profile+sidebar-toggle row and needs no collision-avoidance padding at
all. The map-chrome and pan/zoom-performance fixes below are unaffected and still accurate.

A phone screenshot showed the public (non-admin) dashboard's header title/subtitle overlapping the Day/Night
toggle and Profile button, plus the map's FSI severity Legend dominating the screen — and the user separately
reported the map feels "laggy and pretty much not usable" on a real Android phone. This is the public dashboard
(`app/page.tsx` + `components/BiliranMap.tsx`) — a different surface from the admin-shell mobile audit earlier
this session, which never touched this file. Three Explore agents read the actual code and confirmed three real,
distinct bugs (not assumptions):

- **Header overlap**: `app/page.tsx`'s Day/Night+Profile controls (`absolute right-5 top-5 z-20`) and the title/
  subtitle band (`.bfw-dash`'s header, a plain full-width block) were independent elements with no shared layout
  and no space reservation — the higher-`z-20` controls simply painted over the subtitle text once it reached
  that corner. Fixed the same way this exact collision shape was already solved once elsewhere in this app
  (`AdminInvitePanel`'s old "Open User Dashboard" button): a `paddingRight: 260` reservation on the title band,
  plus `truncate`/`min-w-0` as a safety net. `components/HeaderProfileButton.tsx`'s avatar/tab (deliberately
  enlarged ~55-56% for desktop in an earlier round) also gained a `@media (max-width: 480px)` override scaling
  both back down for phone widths only (68px→54px avatar, 240px→150px tab max-width) — purely additive, the
  desktop sizing above that breakpoint is untouched.
- **Oversized map chrome**: `Legend` already had a `size?: 'lg' | 'md'` prop (built for `StaticIslandMap.tsx`'s
  medium-height maps), but `BiliranMap.tsx`'s own call site never passed it, always rendering the full `'lg'`
  variant regardless of viewport — the existing `compact` mode is driven by barangay-list scroll state, a
  different question from "is this a narrow screen," so it did nothing for a first-load phone view. Added a
  `isNarrowViewport` state (`window.matchMedia('(max-width: 480px)')`, same listener pattern `app/page.tsx`
  already uses for its own dark-mode-preference sync) and pass `size={isNarrowViewport ? 'md' : 'lg'}` to
  `Legend` — reusing the already-built, already-tested variant rather than inventing new markup.
  `ZoomControls`/`WeatherBadge` gained the same "smaller by default, `sm:` grows it" mobile-first treatment the
  zoom slider already used on its own (`w-16 sm:w-20`) — extended to the rest of `ZoomControls`' padding/gap and
  to `WeatherBadge`'s icon/padding, via plain responsive Tailwind classes (no new state needed for these two).
- **Pan/zoom lag on a real device**: `handlePointerMove` called `setView()` synchronously on every raw
  `pointermove` event (uncapped — Android can fire these well above 60Hz), and none of the per-feature SVG path
  `d`-string generation (`geometryToPath`/`lineGeometryToPath`, `lib/geo.ts`) for ~7 municipalities, up to ~24
  barangays, and 448 waterway line features was memoized — so every one of those events forced a full
  re-stringification of hundreds of paths, even though none of those coordinates actually depend on `view`/
  `scale` at all (pan/zoom is applied cheaply as a `transform` on one wrapping `<g>`, which was already correct
  and never the bottleneck). Two fixes:
  1. **rAF-throttled drag updates**: `handlePointerMove` now stores the latest pointer position in a ref
     (`pendingPointerRef`) and schedules at most one `setView()` per animation frame via `requestAnimationFrame`
     (`rafIdRef` tracks whether one's already pending, so a burst of events between frames only schedules once);
     cancelled on `pointerup`/`pointercancel` (`endDrag`) and on unmount. Caps re-render frequency to the
     display's actual refresh rate instead of raw event rate.
  2. **Memoized path generation**: waterway and municipality path strings are now computed once via `useMemo`
     in `BiliranMap` itself, keyed only on the geojson data + the already-stable `project` reference (never on
     `view`/`scale`) — `municipalityPaths` (a precomputed `Map<prefix, d>`) is shared between the dimmed
     context-outline layer and `MunicipalityLayer` instead of each recomputing the same ~7 paths separately.
     `BarangayLayer` was restructured to accept the raw `brgyGeo` collection + `nearestPrefix` (rather than a
     pre-filtered `features` array from the parent) and do its own `useMemo`'d filter + path-string generation
     internally — this was necessary, not just a style choice: `BiliranMap` has conditional early returns
     (loading/error states) above the point where `nearestPrefix` becomes computable, so a `useMemo` hook for
     the filtered array couldn't live in the parent without violating React's rules of hooks; moving both the
     filter and the path memoization into `BarangayLayer` (which has no such early return) gives the filtered
     array a stable identity across renders where `nearestPrefix` hasn't actually changed, which is what makes
     its own internal path-memoization actually effective during a drag.
  - `feDropShadow` filter cost over the polygon layers is a secondary, compounding factor, not fixed here.
    `BarangayList.tsx`'s non-virtualized 115-row render is a sibling of the map, not nested under it, so it
    doesn't compound with drag frame rate and was left alone.

**Honest limitation**: real on-device frame-rate/jank can't be measured from this sandbox (no physical Android
device, no profiler attached) — verified instead by code review confirming the re-render/re-stringify cascade is
actually eliminated, and by a functional regression check (drag-pan still lands at the correct clamped position
after the drag ends, at both a phone and a desktop viewport). Flagged to the user as something to confirm
themselves on their own phone after this ships, same as real Resend delivery and real Supabase RLS behavior were
flagged as sandbox-unverifiable earlier this session.

## "Copy link" button for manual invitation sharing

No domain is verified in Resend yet, so invitation emails currently only deliver to the Resend account's own
address — any other recipient hits Resend's sandbox-mode restriction and the email fails, falling back to the
existing "share the code manually" message. `app/activate/page.tsx` only ever reads its invitation code from a
`?code=` URL param (there's no manual code-entry field there), so what actually needs sharing by hand is the full
activation link, not the bare code — previously the admin had to hand-build that URL themselves every time.

`components/AdminInvitePanel.tsx` gained a "Copy link" button, purely client-side (`activationLink(code)` builds
`` `${window.location.origin}/activate?code=${code}` ``, referenced only inside the click handler, never during
render — no new prop or server data needed): it appears right after the code in the post-create success message
and in every still-pending row's own action list (before Resend/Edit/Revoke), copies the full link via
`navigator.clipboard.writeText`, and self-confirms by swapping its own label to "Copied!" for ~1.6s before
reverting (or "Couldn't copy" on a clipboard failure, e.g. an insecure context) — a single `copyFeedback: { id,
ok } | null` state shared by both locations, keyed by the invitation's own numeric id (the just-created
invitation and its later list row share the same id). A redeemed row still shows no copy button — there's no
link left to share for an already-activated account.

## Light-theme (day) honesty-banner contrast fix

The disclosure banner above the map on the Rainfall & Scenarios tab (`components/UserDashboardModal.tsx`'s
`disclosureBanner`, "Modeled from a single synthetic design storm...") was unreadable in Day (light) theme —
reported via screenshot. Root cause, confirmed by reading the code: a translucent red background
(`rgba(192, 57, 43, 0.15)`) paired with a hardcoded **pale** `#F2D9D5` (near-white pink) text color — tuned to
read against a dark-theme composite, but in light theme the translucent red barely tints the light card
background, so pale-on-near-white was nearly invisible. This is the mirror case of the night-mode SIMULATED
banner bug fixed just above (there: translucent background + hardcoded *dark* text, illegible in dark theme;
here: translucent background + hardcoded *pale* text, illegible in light theme) — same root class of bug,
opposite direction.

The exact same `rgba(192, 57, 43, 0.15)` + `#F2D9D5` pairing was copy-pasted in three more places, all with the
identical bug, none reported yet but all real: `components/DashboardShell.tsx`'s own "loading the live forecast"
banner (shown on the real public dashboard whenever `!liveActive`, i.e. on every fresh page load until the live
forecast arrives) and its `loadError` text (bare pale-red text with no box, even harder to read); and
`components/AdminDashboardTab.tsx`'s equivalent loading-state banner. Confirmed this was fixable with the
already-proven pattern already sitting three lines below the broken one in `AdminDashboardTab.tsx` itself — its
own "highest-risk barangay" alert banner uses the identical translucent-red background but pairs it with
`color: 'var(--text-strong)'` instead, and reads fine in both themes; `var(--text-strong)` is the same
theme-aware token the `liveActive` branch of these same ternaries already used successfully. Fixed all four
spots the same way: swapped the hardcoded `#F2D9D5` for `var(--text-strong)` in the three box-background
instances (`UserDashboardModal.tsx`, `DashboardShell.tsx`'s loading banner, `AdminDashboardTab.tsx`), and swapped
`DashboardShell.tsx`'s bare `loadError` text color to a solid `#C0392B` (matching the existing solid-red
convention already used for plain alert/error text elsewhere, e.g. `SimulationModePanel.tsx`'s validation error)
rather than `var(--text-strong)`, since that one is specifically an error message and should stay visually
red-coded rather than blending into the page's normal text color. No border color, background tint, box shape,
or copy changed anywhere — text color only. Verified via mocked-auth Playwright in both themes: light theme now
resolves the banner text to `rgb(3, 23, 22)` (dark, legible against the light pink tint) and dark theme still
resolves to `rgb(133, 183, 206)` (the same light-blue `var(--text-strong)` value, confirming no regression).

## Night-mode banner contrast fix + mobile/phone responsive audit

Two more rounds of feedback, both resolved this round:

- **Night-mode SIMULATED banner was illegible**: `components/SimulationModePanel.tsx` (the "SIMULATED" chip and
  the info banner below it) and `components/UserDashboardModal.tsx`'s "⚠ SIMULATED · Clear" header chip all used
  a **translucent** amber background (`rgba(184, 134, 11, 0.35)`) with a hardcoded **dark** text color
  (`#3D2B00`). In light theme this composited over a light card background and read fine; in dark theme it
  composited over a dark background instead, producing a near-illegible dark-on-dark box — confirmed by a
  screenshot. Fixed by switching all three spots to a **solid, fixed** `#B8860B` background instead of the
  translucent rgba — a solid background gives the same fixed contrast ratio against the paired `#3D2B00` text
  regardless of which theme it's compositing over, so no `theme` prop needed to thread through either component
  for this. Same class of bug this codebase has hit before in the *opposite* direction (background too pale,
  text too pale) — this is the first time it was made genuinely theme-independent rather than re-tuned for one
  theme only.
- **Mobile/phone responsive audit** (the user's own written proposal, actually executed rather than just filed):
  a code audit (not a rendered viewport check) found the admin left sidebar (`components/AdminShell.tsx`) was
  the one genuine structural blocker — a fixed `w-56` (224px), always-visible, zero responsive classes, leaving
  only ~151px for the entire page at a 375px phone width. Everything else audited was already in better shape
  than assumed: `UserDashboardModal.tsx`'s embedded two-column layout already stacks to one column below
  `lg:` (1024px); `AdminBarangaysTab.tsx`/`AdminDashboardTab.tsx`/`AdminInvitePanel.tsx`'s stat-card grids
  already had responsive breakpoints and their tables already sit inside `overflow-x-auto` wrappers; only
  `AdminUsersTab.tsx`'s stat grid was a bare `grid-cols-3` with no responsive variant, the one inconsistency
  among the four admin tabs — fixed to `grid-cols-1 sm:grid-cols-3` (a single-column stack below `sm:`, not a
  2-up middle step like the others, since this tab only has 3 cards total and an uneven 2-up split reads worse
  than a clean stack). `BiliranMap.tsx`'s pan/zoom already uses the Pointer Events API uniformly with
  `touchAction: 'none'` — single-finger drag-to-pan already works correctly on a real phone; only two-finger
  pinch-zoom is unimplemented, already a documented, deliberately-accepted rough edge (see "Open items" below),
  reconfirmed out of scope here rather than newly found.
  - **`components/AdminShell.tsx` sidebar fix**: the desktop `<aside>` is now `hidden md:flex` (off-canvas below
    768px). Its inner content (logo/title, nav buttons, footer tagline) was extracted into a shared `SidebarNav`
    component (`tab`/`onSelect`/`sidebarBg`/`theme` props) so the exact same JSX renders for both the
    always-visible desktop sidebar and the new mobile drawer — not a second parallel nav definition. A new
    `sidebarOpen` boolean state plus a hamburger icon button in the top bar (`md:hidden`) opens an
    always-mounted, `fixed inset-y-0 left-0 z-[60]` drawer version of `SidebarNav`, transformed off-screen via
    `data-open` + a CSS transition when closed (same technique as `UserDashboardModal.tsx`'s own slide-out
    Simulation Mode sidebar, `.bfw-sim-sidebar`) — nothing to remount on repeated toggles. A semi-transparent
    click-to-close backdrop (`.bfw-admin-drawer-backdrop`) sits behind the drawer, and selecting a nav item in
    the drawer both navigates and auto-closes it (the desktop `<aside>`'s own `SidebarNav` just navigates,
    no auto-close needed there). Body scroll is locked (`document.body.style.overflow = 'hidden'`) while the
    drawer is open, same as any other full-screen overlay in this app. The top bar's title block got
    `truncate`/`min-w-0` so long page titles don't force overflow next to the new hamburger button on narrow
    screens.
  - Verified at a real 375×812 Playwright viewport (not just static code review): the hamburger is visible and
    the desktop `<aside>` is hidden below `md:`; the drawer opens, shows all 9 nav items, and both navigates and
    closes itself on a nav click; no admin tab (Dashboard, Barangays, Rainfall & Scenarios, Users) produces
    horizontal page overflow (`document.documentElement.scrollWidth` never exceeds `clientWidth`) — table/map
    content scrolling within their own `overflow-x-auto`/fixed-height wrappers is expected and fine, only the
    page itself was checked for overflow; the Users tab's stat cards visibly stack to one column. Re-ran the
    same mocked-auth pass at a 1500px desktop viewport afterward and confirmed no regression: the sidebar still
    always-visible, hamburger absent, Users tab still switches correctly.

## "?" explainer buttons on each Factor Breakdown row

`components/BarangayDetailPanel.tsx`'s `FactorBreakdown` (HAND/TWI/Land cover runoff/rainfall) previously
showed only a label + 0-1 bar/value with one short caption below the whole group — nothing explained what
those numbers actually represent unless someone asked directly. Each row now has a small `h-4 w-4` (16px)
circular "?" button next to its label (`aria-expanded`/`aria-label` wired, tap-to-expand only — no
hover-only behavior, so it works identically on phone and desktop) that toggles a short explanation block
directly under that row, using the same `useState<string | null>(null)` "at most one open" pattern already
used elsewhere in this app (`AdminInvitePanel.tsx`'s `editingId`, `AdminUsersTab.tsx`'s `busyId`). Rows are
keyed by a stable `'hand'`/`'twi'`/`'lclu'`/`'rainfall'` string (not the row's own display `label`, since the
rainfall row's label text changes between "6-hour rainfall forecast" and "Today's live rainfall forecast"
depending on whether live weather is active, so it isn't safe to key toggle state on).

Each expansion shows a shared general-framing sentence (explaining these are relative 0-1 island-wide ranks,
not physical units — also now used to replace the group's own shorter caption, so the two don't say slightly
different things) plus a factor-specific sentence, plus a weight clause built from the real, loaded
`factor_weights` (`{ hand: 0.30, twi: 0.30, lclu: 0.20, rainfall: 0.20 }`, from `lib/fsiFactorData.ts`'s
`RawFactorData.factor_weights` — already fetched by the existing `loadFsiFactors()` call, just not previously
captured into this component's own state) — e.g. `"This factor contributes 30% to the FSI score."` — computed
from the real value (`Math.round(weight * 100)`), never a hardcoded "30%"/"20%" string, so it can't drift from
the actual data (same "not hardcoded, in case the data ever changes" discipline `lib/islandSimulation.ts`
already established for these same weights). Confirmed via mocked-auth Playwright: all four buttons render
independently, clicking one shows its explanation (framing + factor sentence + correct weight %), clicking a
second collapses the first (only one open at a time), re-clicking the same one collapses it, and the caption
now reads the shared framing sentence.

**Follow-up: per-factor text shortened.** The initial version above prepended the full shared
`FACTOR_SCORE_FRAMING` sentence in front of every factor's own explanation, so tapping through all four in one
session meant reading that same long sentence four times in a row. Each factor's `explanation` string now
stands on its own (no shared-framing prefix at render time), folding the "relative 0-1 rank" idea directly
into its own shorter sentence and dropping the "not a measurement in X" comparison entirely (per direct
confirmation — the caption beneath all four rows already carries that framing once, so the per-factor text
doesn't need to repeat it). The weight clause is unchanged (still `Math.round(row.weight * 100)`, computed,
never hardcoded). `FACTOR_SCORE_FRAMING` itself is untouched and keeps its one remaining use: the group's own
caption. Confirmed via mocked-auth Playwright: the framing sentence now appears exactly once in the panel
regardless of which row (if any) is open — never duplicated per-row — while each factor's shortened
explanation + correct weight percentage still renders correctly on click.

## "?" explainer buttons on the Basins/Danger/Warning/Alert stat grid

Same ask extended to the other stat-row group in `components/BarangayDetailPanel.tsx`: the `<dl>` grid below
the Factor Breakdown (`Basins`/`Danger at`/`Warning at`/`Alert at`) had no explanation of what those four
numbers meant either. `Stat` (previously just `{ label, value }`, no interactivity) now takes `statKey`,
`explanation`, `openStat`, and `onToggle`, rendering the identical real-tap-target "?" button pattern
`FactorBreakdown` already established (16px circle, `aria-expanded`/`aria-label`, tap not hover). Deliberately
a **separate** `openStat` state in the parent component rather than reusing `FactorBreakdown`'s own
`openFactor` — these are two different row groups, and opening one group's explanation has no reason to close
whichever row is open in the other.

Explanations use the exact Warning/Alert/Danger percentages this app's own honesty banner already states
elsewhere (`DashboardShell.tsx`: "Warning/Alert/Danger = 50%/75%/95% of each basin's live-forecast peak
discharge") rather than inventing new wording that could drift from it: Warning = 50%, Alert = 75%, Danger =
95% of peak discharge. `Basins`' explanation covers the one real edge case the raw count doesn't convey on its
own — a barangay can overlap more than one basin, but `BarangayDetailPanel` only ever shows a single "primary"
hydrograph (`hydrographForBarangay` returns one `PrimaryHydrograph`, not one per overlapping basin), so the
explanation says so explicitly rather than leaving that gap implicit.

## Performance pass: lowest-spec devices, mobile and desktop

The user asked to "optimize the system to the lowest spec possible, both mobile and desktop" — confirmed via two
questions: target both platforms equally **without changing visual design**, and the accepted trade-offs are
simplifying/removing *decorative* animation cost and slowing the live-data refresh interval (both explicitly
approved, alongside also explicitly keeping "everything exactly as it looks/behaves today" — read together as
"maximize zero-visual-difference wins first, then apply only these two narrow, pre-approved trade-offs," never a
redesign). Three Explore passes read the actual code before proposing anything; two of their claims were
independently re-verified by direct read rather than trusted: (1) `app/page.tsx`'s hydrograph/FSI-factor fetch
was firing on the bare login screen, before any credentials were entered, pre-dating this round — safe to defer
because the live-forecast recompute these feed (`lib/liveIslandState.ts`) is itself gated on a real async weather
fetch, so deferring doesn't change when the live-colored map visibly appears, while sparing every visitor who
never completes login from downloading ~812KB; (2) `BarangayLayer`/`MunicipalityLayer`'s `onSelect` handlers were
recreated every render, confirming `React.memo` alone would be a no-op without pairing it with `useCallback`.

**Network payload**:
- `app/page.tsx`: the `basin_hydrographs.json`/`fsi_factors.json` fetch now gates on `authState === 'revealed'`
  instead of `authState !== 'checking'` — only starts once a user is actually authenticated, not on the bare
  login screen. The three fetches that render the login-screen map backdrop (`barangays.geojson`, etc.) are
  untouched — deferring those would visibly blank the backdrop, out of scope per "don't change visual design."
- `package.json`: removed the unused `maplibre-gl` dependency (confirmed zero imports repo-wide via grep).
- `app/page.tsx`: both logo `<img>` tags (above-the-fold on the login screen) now use `next/image` with
  `priority` (no lazy-load regression) and their real pixel dimensions (385×420, confirmed via `file`).
- `app/page.tsx`: `AdminShell` is now `next/dynamic`-imported instead of a static top-level import, so its code
  only ships to sessions that actually reveal an admin account — a zero-visual-difference win, not one of the
  two pre-approved trade-offs, included because it costs nothing the user asked to avoid.
- **Approved trade-off**: both independent 15-minute live-weather poll intervals (`app/page.tsx` and
  `components/BiliranMap.tsx`'s own) bumped to 30 minutes — Open-Meteo's own forecast granularity is hourly, so
  this doesn't meaningfully change data freshness in practice. `app/api/weather/route.ts`'s own cache
  (`REVALIDATE_SECONDS`) bumped to match (1800s).

**Map/SVG rendering**:
- `components/StaticIslandMap.tsx`: the projector, bounds computation, and all 115 barangays' SVG path strings
  are now `useMemo`'d (previously recomputed from scratch on every render, unlike `BiliranMap.tsx`, which already
  memoized this) — mirrors `BiliranMap.tsx`'s own `municipalityPaths`/`barangayPaths` pattern. This had to move
  above the component's `!geo` early return (Rules of Hooks — hooks can't follow a conditional `return`, unlike
  a plain function, which was the earlier, non-memoized version's shape).
- `components/BiliranMap.tsx`: `focusMuni` and a new `handleBarangaySelect` are now `useCallback`-wrapped
  (both had to move to immediately after `applyMuniFocus`, before either of the component's two early returns —
  the first placement attempt tripped `react-hooks/rules-of-hooks` for the same reason as above); `clampView`
  moved to module scope (a pure function with no component-state dependency, so no `useCallback` needed at all).
  `MunicipalityLayer`, `BarangayLayer`, `DriftingClouds`, and `WeatherIconSVG` are now `React.memo`-wrapped —
  this only actually skips re-renders because the callback-stabilization above landed first; memoizing without
  it would have been a no-op (confirmed by tracing the full prop chain, not assumed).
- `components/BiliranMap.tsx`: ambient CSS animations (sea shimmer, drifting clouds, per-municipality weather-icon
  drift/rain) now pause via the Page Visibility API (`document.visibilitychange` → a `bfw-anim-paused` class
  applied to the map root, `animation-play-state: paused !important`) whenever the tab is backgrounded — zero
  visual difference while actually being looked at, pure CPU/battery saving while hidden/locked. Verified via
  Playwright: forcing `document.hidden = true` and dispatching `visibilitychange` adds the class; reverting
  removes it.
- **Approved trade-off**: a `@media (prefers-reduced-motion: reduce)` rule pauses the same animations and drops
  the two `feDropShadow` filters (`.bfw-shadow-group`, a new className added to both filtered `<g>`s) to `none`
  — changes nothing for the default experience (confirmed only one such query existed anywhere in this codebase
  before this, so this is purely additive), but lightens the map automatically for anyone who's told their OS
  they want less motion. Verified via Playwright with `page.emulateMedia({ reducedMotion: 'reduce' })`: the
  filter resolves to `none` and `animation-play-state` resolves to `paused`; the default (no preference set)
  case is confirmed unaffected (filter still `url(#bfw-land-shadow)`, no paused class).

**List rendering**:
- `components/DashboardShell.tsx`: the `onSelect` handler passed to `BarangayList` is now `useCallback`-wrapped.
- `components/BarangayList.tsx`: each row is now its own `React.memo`-wrapped `BarangayRow` component, with the
  double-tap-detection logic staying in the parent as one stable `useCallback`'d `handleRowClick` shared by every
  row — so selecting one barangay (or an unrelated parent re-render, e.g. the 30-min weather poll) only
  reconciles the rows whose own `selected`/data prop actually changed, not all up to 115.

**Verified, not just implemented**: a dedicated 3-part mocked-auth Playwright pass confirmed
`basin_hydrographs.json`/`fsi_factors.json` are genuinely absent from the network log pre-login and present
post-login, the login-screen map backdrop still renders (507 SVG paths), barangay selection and the
double-tap-to-filter gesture both still work, the dynamically-imported admin shell still loads with all its
tabs, `StaticIslandMap` still renders all its barangay polygons correctly post-memoization (136 paths on the
Barangays tab), and rapid-fire typing in Simulation Mode's rainfall input — the exact scenario the
`StaticIslandMap` memoization targeted, since every keystroke there re-renders the whole `UserDashboardModal`
tree — no longer breaks or blanks the detail panel. `npm run lint`/`npm run build` both clean throughout.

Not touched, per the plan's own scope: `DischargeChart.tsx` (confirmed non-hot-path), the two independent
weather-poll loops' architecture (only their interval literal changed, not merged into one shared source), and
no virtualization library was added for `BarangayList.tsx` (115 rows is a modest, bounded count — memoization
was judged the right-sized fix, matching this app's existing "no new dependency unless necessary" posture).

## Open items

- Hydrograph chart is now real for 113 of 115 barangays (`public/data/basin_hydrographs.json`, `lib/hydrographData.ts`), alongside it a real precipitation/hyetograph chart too (same data, same gating, see above), the HAND/TWI/LC/rainfall factor breakdown is now real too (`public/data/fsi_factors.json`, `lib/fsiFactorData.ts` — an approximation, see its provenance/validation notes above), interactive Simulation Mode now exists too (admin-only, reached via the admin shell's "Rainfall & Scenarios" tab — see "Full admin dashboard redesign" above, and `UserDashboardModal.tsx`/`SimulationModePanel.tsx`/`lib/simulationMode.ts` and their provenance notes above), and the map's weather icon now shows real, live conditions (Open-Meteo, verified against a real deployment — see above) instead of proxying modeled flood risk. **The real (non-admin) dashboard's FSI/countdown numbers are also live-forecast-driven by default now** (`lib/liveIslandState.ts`, see its own extensive section above) — a live, ratio-based FSI approximation, not the canonical raster-based recompute, which is still not built (see "Deliberately still not built" above for the distinction). The admin experience got a full multi-tab redesign too (Dashboard/Barangays/GIS & FSI Data/Rainfall & Scenarios/Invitations/Users — see "Full admin dashboard redesign" above), including a real, growing FSI-trend history — its own `supabase/fsi-daily-snapshots-setup.sql` has **not yet been run** against the real project, so that chart is empty until someone with dashboard access does. A Supabase-verification pass against the real project (item 3 of the open-items sequencing) is queued next, pending the abylonmonsales@gmail.com invitation being redeemed and its credentials shared (this has since happened this session — see the account-fix note elsewhere, but the actual real-browser sign-in/CRUD verification pass itself hasn't been separately re-run); the geojson regeneration script, the missing Naval barangays, and a real audit/Activity Log (deferred again during the admin redesign above) are still open.
- No regeneration path for `public/data/geo/*.geojson` exists in this repo (the join/simplify/dissolve script was one-off and not checked in) — if `barangay_biliran.geojson`, `waterways_biliran.geojson`, or the barangay set in `barangay_dashboard_data.json` change, these need to be rebuilt by hand.
- Naval's Libertad and Mabini barangays are absent from `barangay_dashboard_data.json` entirely, so they're invisible everywhere in this app, including the map — see "Known geo-data gap" above.
- Production refresh mechanism for `barangay_dashboard_data.json` (move off static `public/` file) is undecided.
- Profile photo upload (`supabase/avatars-storage-setup.sql`) is written but not verified against a real Supabase project — only linted, type-checked, and built (same caveat as the rest of this repo's Supabase-dependent code). Someone with dashboard/CLI access needs to run the SQL once before it works end to end.
- The "Invitations" tab (inside the admin shell — see "Full admin dashboard redesign" above) has create/list/edit/revoke **and expire-early** — `AdminInvitePanel.tsx`'s edit-row includes an `expires_at` field (`<input type="datetime-local">`, with a "Clear" button to null it back to "no expiry"), PATCHed via `app/api/admin/invite/[id]/route.ts`, which now accepts `expires_at` in its body alongside `email`/`office`. Can set/shorten/extend/clear freely (no one-way-only restriction — an arbitrary editable expiry isn't a meaningful new privilege given the admin already has full edit/revoke control over unredeemed rows). `app/api/activate/route.ts`'s existing expiry check (a plain `Date` comparison) needed no changes to honor it. A read-only Users tab now exists (real registered accounts, no edit/promote/demote) — full user management (promote/demote, deactivate) and a real audit log of admin actions are still open, deliberately deferred during the admin redesign above.
- **`user_profiles`'s "read own row" and "update own row" RLS policies are now verified real, not just assumed** — confirmed directly against the live "Biliran-flood" Supabase project (`qlkkengqkyjljzvtuoqh`) via `pg_policies` (both exist, both scoped `auth.uid() = user_id`, matching `avatars-storage-setup.sql`'s source exactly) **and** by actually exercising them: `SET LOCAL ROLE authenticated; SET LOCAL request.jwt.claims = '{"sub": "<uuid>", ...}'` (simulating PostgREST's own JWT-claims mechanism) inside a read-only/rolled-back transaction — querying as the real admin's own `user_id` returned exactly their one row and nothing else; querying as a fabricated `user_id` returned zero rows; a rolled-back self-`UPDATE` under the same simulated claims succeeded for the real `user_id`. `storage.objects`'s `"avatars: users manage own folder"` policy was checked the same way (exists, matches its source file exactly) — though for this app's actual upload flow it's supplementary defense-in-depth, not the real enforcement boundary: `app/api/profile/avatar-upload-url/route.ts` mints a service-role-signed upload URL already scoped server-side to `{user.id}/avatar`, so the client never gets broad `storage.objects` access to begin with. `invitation_codes` has a blanket `"no client access"` deny-all policy, correct since every real access goes through `supabaseAdmin` in `app/api/admin/*`. `get_advisors(security)` surfaced one unrelated finding — "Leaked Password Protection Disabled" (HaveIBeenPwned check off) — a Supabase Dashboard Auth-settings toggle, not fixable via SQL/migration tools, worth flipping manually. **Still not verified**: the actual browser sign-in/session flow, the `/api/admin/invite` create/edit/revoke/expire cycle with a real admin JWT, and a real `/activate` redemption — those need a real signed-in session, still blocked on an invited account (abylonmonsales@gmail.com, code `5E6B059D`) being redeemed and its credentials shared.
- The map's pan/zoom has no two-finger pinch-zoom yet (single-finger touch drag-to-pan works via Pointer Events) — an accepted rough edge of the hand-rolled implementation, not a rejected feature; reconfirmed still deliberately deferred during the mobile-responsive audit above.
