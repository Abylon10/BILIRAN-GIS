# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project overview

Biliran Flood Watch — a flood early-warning web app for MDRRMO officials in
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
child. `.bfw-dash` (where this component normally lives in the tree) is a
stacking context pinned at `z-index: 10`, deliberately kept *below* the
persistent map's `z-index: 15` (see `.bfw-map-shell` below) — so nothing
inside `.bfw-dash` can out-z-index the map locally, confirmed via
Playwright when the map's own `<svg>` intercepted clicks meant for the
dropdown's options before the portal fix. Portaling to `document.body`
escapes that stacking context entirely. The panel closes on outside
click, `Escape`, window resize, or scroll (repositioning isn't tracked
live — closing and requiring a re-open is simpler than keeping a fixed
popover glued to a moving trigger).

**Dashboard header/body split** (`app/page.tsx`'s `.bfw-dash`): the
title row and the `DashboardShell` content area are now two separate
color panels — a `--header-bg` band with a `--separator`-colored
`border-b-2`, then a `--body-bg` wash beneath it — rather than one
uniformly-padded column with no background of its own. The header's own
title/subtitle text stays a fixed light tint (not `var(--text-strong)`),
since `--header-bg` is deliberately dark in both themes (a branded band,
not a theme-following surface) — using the theme-following text color
would fail contrast in light mode, where `--text-strong` is near-black.

**Compact map while the barangay list is scrolled.** Same `mapSlotRef`
mechanism as above, reused rather than duplicated: `DashboardShell` owns a
scroll listener on the barangay list's own scroll container that flips
`listScrolled` (lifted to `app/page.tsx`, same shape as `revealed`) once
the list has scrolled past a **row-count** threshold
(`ROW_COMPACT_THRESHOLD` = 8), not a pixel value — found by locating the
8th `<li>` inside the scroll container (`BarangayList`'s own rows, no
change needed there) and comparing its `getBoundingClientRect().top`
against the container's own, so it stays correct even if row height ever
varies. `SCROLL_DEBOUNCE_MS` (100) still avoids compacting a beat too
early mid-fast-scroll. This is **one-way**: `handleListScroll` only ever
calls `onListScrolledChange(true)`, and only while not already compact —
scrolling back to the top does nothing once compacted; the only way back
is an explicit tap on the compacted map (`onCompactTap`, below), which now
sets `listScrolled` false directly rather than relying on scroll position
to un-flip it (a `scrollTo({ top: 0 })` alongside that is purely a
courtesy return-to-top, not the trigger). `mapSlotRef` itself — the *same*
spacer div, not a second one — just resizes from its normal
`h-96`/`md:h-[70%]` box down to a small fixed `COMPACT_MAP_WIDTH` ×
`COMPACT_MAP_HEIGHT` box (192×144) when `listScrolled` is true; the list's
own grid row is `flex-1`, so it grows into whatever height the spacer
gives up. No transition on the spacer itself (it's invisible either way)
— re-measuring it after it's already settled at its new size is what
feeds `mapRect`, and `.bfw-map-shell`'s existing transition (above) is
what actually animates the visible map smoothly between spots, same as
the login→dashboard reveal. `LiveUpdateBanner` unmounts while
`listScrolled` (reappears once the map fully re-expands) rather than
shrinking in place.

`BiliranMap`'s `compact` prop (default `false`) turns it into a passive
thumbnail rather than a smaller version of the interactive map: the wheel
listener and `handlePointerDown`'s drag-tracking both no-op when `compact`,
and the `<svg>` gets an `onClickCapture` that calls the caller's
`onCompactTap` and `stopPropagation()`s before the tap ever reaches
`MunicipalityLayer`/`BarangayLayer`'s own per-polygon `onClick` — so
tapping the thumbnail always means "expand," never "select." `ZoomControls`
and `WeatherBadge` are hidden outright when compact (`showChrome &&
!compact`) rather than shrunk, since their own gestures/clutter don't fit
a passive thumbnail either. `Legend` is the one exception — gated on
`showChrome` alone, not `!compact` — since it has its own smaller
`compact` variant (dots-only, since the full labeled pill overflows at
this size) rather than hiding. The reset button also gets a `compact`
size variant, and its `onClick` `stopPropagation()`s when compact so
resetting the view doesn't also read as the tap-to-expand gesture on the
`<svg>` underneath it.

**Fill-the-middle layout, once compact.** As soon as `listScrolled` is
true — no separate gesture required (an earlier version gated this
behind a swipe-down pointer gesture; dropped because it only armed on
pointer drag, so it was unreachable via an ordinary mouse-wheel scroll,
leaving that space empty for anyone not touch-dragging) — the
map-spacer/list wrapper in `DashboardShell` switches from a flex column
(map row, list row below it) into a 2×2 CSS grid: the map spacer is
pinned to the top-left cell at its usual exact compact size (so
`mapSlotRef`'s measured rect — and the real map's on-screen box — never
changes because of this; only `DashboardShell`'s own layout around it
does), and the list+detail grid fills the remaining column beside the
map (and both rows, so it still extends below it too) instead of leaving
that space empty. `FSI` `Legend` itself can't move into that space — it's
rendered inside `BiliranMap`'s own box, clipped by that box's
`overflow: hidden` — so the list is just sized to sit beside the compact
map+legend without overlapping it, not literally merged with it.

**Selecting a barangay also compacts the map**, not just scrolling past
the row threshold. `app/page.tsx`'s `selectBarangay(key)` is the one
handler every selection source now funnels through — the map, the
barangay list, and the LIVE UPDATE/Modeled-alert banner all call it
(`BiliranMap`'s `onSelect`, `DashboardShell`'s `onSelectKey`) instead of
setting `selectedKey` directly — and it sets both `selectedKey` and
(after a delay, see below) `listScrolled`, reusing `listScrolled`'s
existing one-way semantics rather than a second flag. This reclaims the
same fill-the-middle layout above for the barangay's own detail panel,
FSI corner, and hydrograph corner (below), instead of leaving the detail
panel pushed below the fold on a non-compact first selection.

The `listScrolled` half of `selectBarangay` is deliberately delayed
(`BARANGAY_SELECT_COMPACT_DELAY_MS` = 450ms) rather than firing in the
same tick as `selectedKey`. Compacting moves the barangay list from below
the map to beside it — a big enough reflow that, confirmed via
Playwright, a fast double-click on a list row would have its *second*
physical click land on a completely different row once the first click's
selection had already compacted the map out from under it, filtering by
the wrong barangay's municipality. `BarangayList.tsx`'s own double-tap
detection (below) is tracked by row **key**, not screen position, but
that only helps if the same physical button is still there to be clicked
twice — the page.tsx delay is what keeps it there for the whole window.
`selectedKey` itself (and therefore the map's pan/zoom via
`focusBarangay()`) still updates immediately; only the layout-shifting
part waits.

**Double-tap/double-click a barangay row filters the list to its
municipality** (`BarangayList.tsx`) — same effect as picking it from the
filter dropdown, driven by the existing `onMunicipalityChange` prop
threaded down through `DashboardShell`'s new `onSelectMunicipality` prop.
Detected manually (tracking `{ key, time }` of the last click in a ref,
`DOUBLE_TAP_WINDOW_MS` = 350ms) rather than via the browser's native
`onDoubleClick`, precisely because native `dblclick` is a *position*-based
gesture and (see above) the first click's own selection can move the row
out from under the second one; tracking by key sidesteps that as long as
the row hasn't actually moved yet, which the paired page.tsx delay
guarantees. A single tap still just selects+focuses the barangay as
before. Not yet tested against real touch double-tap gesture recognition
across mobile browsers — desktop double-click only.

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
`Legend`, and the `WeatherBadge` ribbon. As a pure decorative login
backdrop these were just
clutter — the ribbon specifically used to collide with the theme-toggle
button in that state (worked around earlier by pushing the toggle down),
now moot since the ribbon simply doesn't render there; the toggle is back
to a fixed `top-5`. `Legend` is gated on `showChrome` alone, not
`showChrome && !compact` like `ZoomControls`/`WeatherBadge` — it has its
own dedicated compact (dots-only) variant specifically so it stays
visible at the small compact-map size, unlike those two which just
disappear outright when compact.

**Daily login gate is UX, not security.** Even with a valid Supabase session,
the login card reappears if the last successful login (tracked via
`localStorage['bfw_last_login_date']`) wasn't today. Real access control is
the Supabase session + RLS policies, not this check.

**Admin sign-in toggle drives the admin panel's only entry point, but is
still not itself a security gate.** The login card's logo becomes a
button while `authState === 'needsLogin'` (gone entirely once signed in —
no lingering control in the dashboard), toggling a `loginMode: 'user' |
'admin'` local state that swaps the card's heading ("Sign in" ↔ "Welcome,
Administrator"). The email/password fields and `handleSubmit` are
unchanged either way — there's only one real auth mechanism
(`supabase.auth.signInWithPassword`); `loginMode` itself grants nothing.
What it *does* do: `app/page.tsx`'s post-sign-in `loadUser()` effect
(`[authState, loginMode]`) checks `loginMode === 'admin' && access_level
=== 'admin'` once the profile loads, and only then calls
`setShowAdminPanel(true)` — auto-opening `AdminInvitePanel` right after
sign-in. Both conditions are required: a non-admin account signing in via
the admin-styled form still just lands on the normal dashboard with no
admin entry point at all (there's no other way in — see below), same as
any other non-admin sign-in; and an actual admin who signs in via the
*regular* form (`loginMode` still `'user'`) also just lands on the normal
dashboard, since `loginMode` alone decides nothing. `loginMode` always
starts (and, on sign-out, resets to) `'user'` — plain `useState`, no
persistence — which is also why this can't misfire on a returning-session
auto-reveal: the toggle button only renders pre-reveal, so `loginMode`
can't be `'admin'` unless this exact browser tab's session just toggled
it before an interactive sign-in.

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
- Admin sign-in toggle (the login-screen logo button) grants nothing by itself, never a security gate on its own — real admin authorization is always the post-login `access_level === 'admin'` check; the toggle only decides whether a *successful, actually-admin* sign-in auto-opens the admin panel (see below)
- Account creation is fully admin-controlled; no public signup
- Invite codes are device-bound only at redemption
- No AI/LLM features in the product
- Admin entry point is signing in via the login screen's "Welcome, Administrator" toggle, as an actual admin — `app/page.tsx` auto-opens `AdminInvitePanel` right after sign-in when both are true. There is no other way in: `ProfilePanel.tsx` has no admin-panel row anymore (an earlier version put it there, `isAdmin`-gated, alongside the old hidden bottom-right "+" FAB's Profile/Dashboard/Invitations/Sign out items being removed entirely — "Dashboard" was redundant with just being on the dashboard, "Invitations" moved into the admin panel — but the admin-panel row itself was later moved out of Profile too, to keep the login-toggle path the sole entry point)
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

**Hydrograph corner is a labeled placeholder, not a chart.**
`components/BarangayDetailPanel.tsx` renders a small dashed-border,
muted-opacity card reading "Hydrograph — No basin flow data available
yet" directly below the FSI block (dot + susceptibility label + score) —
"below the FSI corner," matching the same wording used for the existing
FSI block. This is a deliberate, honest "not yet modeled" placeholder —
asked of and confirmed by the user rather than either fabricating a curve
or silently omitting the corner — not a step toward a fake chart; it
still needs the same pipeline data as the real "Hydrograph chart" bullet
above before it can become one. Since `BarangayDetailPanel` is the one
component used for both the sidebar (`hidden md:block`) and the inline
mobile (`md:hidden`) detail views, this single placeholder covers both
without extra wiring.

An earlier version of this placeholder lived in `DashboardShell.tsx`'s
compact-map grid instead (the cell directly below the compact map
spacer) — moved here after the user reported it as still missing despite
being on-screen: "the FSI corner" turned out to mean this detail panel's
own FSI block, not the map's `Legend` chip, so a placeholder sitting
beside the map rather than below the barangay's actual FSI info wasn't
read as satisfying the request at all.

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
