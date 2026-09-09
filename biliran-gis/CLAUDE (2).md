# Biliran Flood Watch — Project Context

A flood early-warning system for Biliran province, Philippines. Two connected
pieces: a Next.js/Supabase web app for MDRRMO officials, and a Python/GDAL
geospatial pipeline that computes flood susceptibility.

## Who this is for

**Not public-facing.** Access is restricted to MDRRMO (Municipal Disaster Risk
Reduction and Management Office) personnel and barangay presidents, across 7
of Biliran's 8 municipalities — Naval, Almeria, Biliran, Cabucgayan, Caibiran,
Culaba, Kawayan. **Maripipi is excluded** (transportation/resource
constraints) and shown on the map labeled "unmonitored," not hidden.

Core design intent: the system exists to tell officials how much time remains
safe for evacuation before conditions become unsafe — not just to display a
risk color. Countdown/threshold features should be prioritized accordingly.

## Repo layout

```
biliran-gis/                  # Next.js app (App Router)
├── app/
│   ├── page.tsx               # Login + dashboard, ONE merged page (see below)
│   ├── activate/page.tsx      # Invite-code redemption, sets password
│   ├── api/activate/route.ts  # Server-side: validates code, creates account
│   └── ...
├── lib/
│   ├── supabase.ts            # Browser client (anon key) — safe for client components
│   ├── supabaseAdmin.ts       # SERVER-ONLY client (service role key) — api/ routes only, never import client-side
│   └── deviceId.ts            # Anonymous device-id cookie helper, used only at invite redemption
├── public/
│   ├── logo-light.png / logo-dark.png
└── .env.local                 # NEXT_PUBLIC_SUPABASE_URL, NEXT_PUBLIC_SUPABASE_ANON_KEY, SUPABASE_SERVICE_ROLE_KEY

fsi-pipeline/                  # Python/GDAL geospatial processing (separate from the web app)
├── align_fsi_inputs.py        # Reprojects/aligns raw layers onto one common 25m grid
├── compute_twi.py             # Flow accumulation + Topographic Wetness Index from DEM
├── compute_fsi.py             # Weighted overlay: FSI = w1(HAND) + w2(TWI) + w3(LC) + w4(R)
├── fetch_rainfall.py          # Pulls Open-Meteo forecast, grids it via IDW onto the same 25m grid
├── aligned/                   # Output: hand_aligned.tif, twi_aligned.tif, lclu_score_aligned.tif,
│                               #         rainfall_aligned.tif, flow_accum_aligned.tif, dem_aligned.tif
├── fsi_output/                # Output: fsi_score.tif (continuous), fsi_class.tif (1-5)
└── lcm/                       # LCLU shapefile bundle (.shp/.dbf/.shx/.prj/.cpg — all required together)
```

The Python pipeline is **not** deployed inside the Next.js app (GDAL/pysheds
don't run in Vercel serverless functions). It's a separate offline process;
results eventually need to land in Supabase for the web app to read. Exact
deployment/scheduling mechanism (cron server? separate service?) is not yet
decided.

## Key architectural decisions (don't relitigate these without reason)

**Auth is a single merged page, not separate routes.** `app/page.tsx` holds
the map (always mounted), the login card, and the dashboard shell as
different visual states of the *same* component — not `router.push`
navigation between `/login` and `/dashboard`. This is intentional: it enables
a seamless "card opens up to reveal the map" transition with no reload/flash.
Login "success" flips React state (`authState`), it does not navigate.

**Daily login gate.** After a valid Supabase session AND a successful login
today (tracked via `localStorage`, key `bfw_last_login_date`), the login card
is skipped entirely on future visits that same calendar day. A new calendar
day requires re-entering credentials even if the session is still technically
valid. This is a UX gate, not a security boundary — real access control is
the Supabase session + RLS.

**Account creation is fully admin-controlled — no public signup.** Admin
enters an official's name/office/email; the system generates an invite code
and emails it. `invitation_codes` and `user_profiles` tables have RLS
policies that block ALL direct client access — only server routes using
`supabaseAdmin` (service role key) can touch them.

**Invite codes are device-bound only at redemption, never at login.** A
device-id cookie is recorded when an account is *created*, to deter code
sharing. Ongoing login is deliberately NOT locked to a device — MDRRMO staff
need to check the system from whatever device is available during an actual
emergency; locking them out of their own device would defeat the system's
purpose.

**No AI/LLM features in the product itself.** Explicitly decided against.

**Admin panel entry point is hidden**, not a visible nav item (exact
mechanism — the "bottom-right menu" pattern — still being finalized).

## FSI formula — history matters here, don't silently revert

Current formula: **FSI = w1(HAND) + w2(TWI) + w3(LC) + w4(R)**

This is the *second* version. An earlier version used HAND + slope + water-
distance + LCLU (no TWI, no rainfall) — that version is superseded. The
change happened because:
- The actual thesis-approved formula (adviser-provided) is
  `FSI = w1·E + w2·FA + w3·DR + w4·LC + w5·R` (Elevation, Flow Accumulation,
  Distance-to-River, Land Cover, Rainfall — 5 factors).
- Flow Accumulation + Slope were consolidated into **TWI** (Topographic
  Wetness Index, `TWI = ln(a / tan(β))`) — a real, citable hydrological index
  (Beven & Kirkby, 1979), not an arbitrary simplification.
- Elevation + Distance-to-River were consolidated into **HAND** (Height
  Above Nearest Drainage) — HAND is a hydrologically-corrected substitute,
  not a literal sum of the two; this substitution needs a sentence of
  justification in the methodology write-up.
- **Rainfall (R) is the live 6-hour forecast, not a climatological average**
  — meaning FSI itself is semi-dynamic, recomputed each time the forecast
  updates. This is intentional per the adviser's formula; do not "fix" this
  by making FSI purely static.

Factor directions (for normalization): HAND lower=worse (invert), TWI
higher=worse (direct), LC higher=worse (direct), Rainfall higher=worse
(direct).

**Factor weights are decided: 30% HAND, 30% TWI, 20% LC, 20% Rainfall.**
Same 30-30-20-20 split pattern used earlier for the previous 4-factor
version, now applied to the current HAND/TWI/LC/R formula in that order.
Honesty note carried over from that earlier decision: this specific split
traces back to a Google AI Overview summary, not a peer-reviewed source —
if a panel asks "why these numbers," the honest answer is "we tested a
plausible literature-style weighting and it produced a coherent spatial
pattern," not a specific citation. Don't silently upgrade this to
"cited" without an actual traceable source.

**Still placeholder / needing real sourcing:**
- `RUNOFF_SCORE` LCLU reclassification table in `align_fsi_inputs.py` —
  adapted from a 5-tier scheme found via Google AI Overview; defensible in
  shape, but verify against the actual underlying papers if citing directly.
- 7 municipality centroid coordinates in `fetch_rainfall.py` are rough
  estimates, not verified against real barangay boundaries.

Classification uses **quantile breaks** (equal pixel count per class), not
equal-interval — equal-interval was tried first and left Very Low/Very High
almost empty (weighted sums of multiple factors cluster toward the middle).
This needs to be stated as a methodology choice in the paper.

## Objective 3 — separate from FSI, don't conflate

A **linear reservoir rainfall-runoff model** (`k·dQ/dt + Q(t) = I(t)`) is a
distinct deliverable from FSI. It answers "given the current forecast, when
exactly does runoff peak" (a detailed hydrograph) — FSI answers "how
susceptible is this place in general, adjusted for current rainfall." Both
consume the same rainfall forecast data; they are complementary outputs, not
duplicate work. `rainfall_timeseries.json` (from `fetch_rainfall.py`) is
built for this model's consumption specifically — the full hourly series,
not just the 6-hour total FSI uses.

## Dashboard UX (designed, not yet built as real code)

- Map is **always present** — the primary "home screen," not just an output
  view. Risk + countdown-to-threshold are baked directly into map labels as
  the default view, before any extra taps.
- Tap a municipality → map flies to it, shows that municipality's barangays,
  breadcrumb chip appears (tap to go back). Tap a barangay → shows its
  hydrograph, second breadcrumb chip appears. Last-viewed barangay persists
  as "recently visited" until another is selected.
- A bottom-right **"+" button** expands to Profile / Dashboard / Sign out
  (replaces earlier separate floating buttons — do not reintroduce a
  standalone sign-out button, it previously overlapped the theme toggle).
- Separately, a **dashboard bottom-sheet** (90% height, map dimmed/visible
  behind it as a scrim) shows a sortable, legend-filterable list ranked by
  urgency (soonest-to-threshold first) — this replaced an earlier time-slider
  design, which was rejected as unnecessarily fiddly for the actual use case.
- **Profile feature** (name, photo, standing, MDRRMO office) is planned but
  not built. Needs Supabase Storage — first feature in this project to need
  it. The "screenshot watermark" idea is implemented as an always-visible
  attribution overlay on the map, NOT screenshot detection (browsers can't
  detect that reliably).

## Known environment gotchas (don't waste time rediscovering these)

- **PowerShell blocks npm** by default (`running scripts is disabled`) — use
  the OSGeo4W Shell or Command Prompt instead, or
  `Set-ExecutionPolicy -ExecutionPolicy RemoteSigned -Scope CurrentUser`.
- **GDAL Python bindings + numpy 2.x are incompatible** in this setup —
  pin `numpy<2` if GDAL import errors mention `_ARRAY_API not found`.
- **Shapefiles need their full sidecar bundle** (`.shp` + `.dbf` + `.shx` +
  `.prj`, ideally `.cpg`) — a lone `.shp` has geometry but no attributes and
  no defined CRS.
- **QGIS's bundled Python (via OSGeo4W Shell) is the easiest way to get a
  working GDAL on Windows** — avoids fighting pip/conda GDAL installs.
- The original `hand_utm51n.tif` from the team had ~3% garbage pixel values
  (unmarked overflow sentinels, not a single NoData value) — always sanity-
  check raster stats after receiving new data from teammates; don't assume
  a clean NoData tag exists just because none is declared.

## Data provenance

Real GIS source files (DEM-derived HAND/slope, 2025 LCM land cover shapefile,
OSM-derived waterways) came from a teammate's QGIS project (`maplayer.qgz`),
shared via Google Drive. The Drive folder structure is deeply nested and this
connector has had trouble listing files reliably at depth — if re-fetching
anything from that Drive, expect to need direct folder IDs or direct file
uploads rather than relying on search.