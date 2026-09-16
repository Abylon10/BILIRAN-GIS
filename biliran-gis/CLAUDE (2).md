# Biliran Flood Watch — Project Context

A flood early-warning system for Biliran province, Philippines. Two connected
pieces: a Next.js/Supabase web app for MDRRMO officials, and a Python/GDAL
geospatial pipeline that computes flood susceptibility and a runoff forecast.

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

fsi_pipeline/                  # Python/GDAL geospatial processing (separate from the web app)
├── align_fsi_inputs.py        # Reprojects/aligns raw layers onto one common 25m grid
├── compute_twi.py             # Flow accumulation + Topographic Wetness Index from DEM
├── compute_fsi.py             # Weighted overlay: FSI = w1(HAND) + w2(TWI) + w3(LC) + w4(R)
├── fetch_rainfall.py          # Pulls Open-Meteo forecast, grids it via IDW onto the same 25m grid
├── compute_tc.py              # Derives linear-reservoir coefficient A via Kirpich time-of-concentration
├── compute_runoff.py          # Objective 3: linear reservoir Q2 = Q1·e^-Aδt + R(1-e^-Aδt), per municipality
├── find_outlet_basin.py       # One-off diagnostic: locates the true outlet pixel + its basin ID
├── aligned/
│   ├── hand_aligned.tif, dem_aligned.tif, lclu_score_aligned.tif, rainfall_aligned.tif
│   ├── slope_aligned.tif      # CORRECTED — see "Data quality" section, was badly corrupted originally
│   ├── twi_aligned.tif        # Needs regenerating whenever slope_aligned.tif changes
│   ├── flow_accum_aligned.tif, water_distance_aligned.tif (unused by current FSI formula, dead weight)
│   ├── drain_direction.tif, watershed_basin.tif  # r.watershed outputs — basin.tif is NOT the true watershed, see below
│   └── true_watershed.tif     # r.water.outlet output — the ACTUAL cumulative watershed, use this one
├── fsi_output/                # fsi_score.tif (continuous), fsi_class.tif (1-5) — REGENERATE after slope fix
├── rainfall_timeseries.json   # Full hourly rainfall per municipality, for compute_runoff.py
├── runoff_hydrograph.json     # Output of compute_runoff.py
└── lcm/                       # LCLU shapefile bundle (.shp/.dbf/.shx/.prj/.cpg — all required together)
```

The Python pipeline is **not** deployed inside the Next.js app (GDAL/GRASS
don't run in Vercel serverless functions). It's a separate offline process on
a Windows dev machine running QGIS; results eventually need to land in
Supabase for the web app to read. **Deployment/scheduling mechanism (cron
server? separate service?) is still not decided** — real open item.

## Key architectural decisions (don't relitigate these without reason)

**Auth is a single merged page, not separate routes.** `app/page.tsx` holds
the map (always mounted), the login card, and the dashboard shell as
different visual states of the *same* component — not `router.push`
navigation between `/login` and `/dashboard`. Login "success" flips React
state (`authState`), it does not navigate.

**Daily login gate.** Tracked via `localStorage` key `bfw_last_login_date`.
UX gate, not a security boundary — real access control is the Supabase
session + RLS.

**Account creation is fully admin-controlled — no public signup.** Only
server routes using `supabaseAdmin` (service role key) can touch
`invitation_codes` / `user_profiles`.

**Invite codes are device-bound only at redemption, never at login** —
deliberate, so MDRRMO staff can check the system from any device during an
actual emergency.

**No AI/LLM features in the product itself.** Explicitly decided against.

**Admin panel entry point is hidden** — bottom-right "+" menu (Profile /
Dashboard / Sign out), not a visible nav item.

## FSI formula

Current: **FSI = 0.30(HAND) + 0.30(TWI) + 0.20(LC) + 0.20(R)** — weights are
team-decided (matching adviser's 5→4 factor consolidation: HAND absorbs
Elevation+Distance-to-River, TWI absorbs Flow-Accumulation+Slope). Rainfall
(R) is the **live forecast**, not a climatological average — FSI is
semi-dynamic, recomputed each time the forecast updates. Don't "fix" this by
making FSI purely static.

Factor directions: HAND lower=worse (invert), TWI/LC/Rainfall higher=worse
(direct). **Classification uses FIXED thresholds (0.2/0.4/0.6/0.8) on the
normalized 0-1 FSI score — RESOLVED, no longer quantile-based.** Quantile
breaks were tried first, forced exactly 20% into each class on every run by
construction, and left Very Low/Very High almost empty under equal-interval.
More importantly, quantile breaks are fundamentally wrong for a *live*
system: they'd force the same 20%-per-class split even during an actual
severe storm, meaning the map could never show conditions genuinely
worsening or improving. Fixed thresholds fix this. **Citable justification**:
follows the precedent of Luong et al. (2025), a live flood-risk WebGIS for
the Cai Nha Trang basin, Vietnam — described as the closest published
operational (not research-only) analog, which uses this exact fixed-
threshold approach specifically because operational warnings need
threshold-anchored, not statistically-shifting, classes. Honesty note: the
specific numbers (0.2/0.4/0.6/0.8) are Vietnam's, borrowed for lack of an
equivalent Philippine standard on this exact index scale — the *approach*
is well-precedented, the *exact cutoffs* are not Philippine-specific unless
a better source is found later.

**Honesty notes for the thesis writeup, still true:**
- The 30-30-20-20 split traces to a Google AI Overview summary, not a
  peer-reviewed citation.
- `RUNOFF_SCORE` LCLU table in `align_fsi_inputs.py` is adapted from a
  similarly-sourced 5-tier scheme.
- The 7 municipality centroid coordinates in `fetch_rainfall.py` are rough
  estimates, not verified real centroids.

## Data quality — TWO corrupted teammate-supplied rasters found this way

**HAND raster (found earlier):** ~3% of pixels had garbage overflow values
with no NoData flag. Fixed by masking anything outside a physically sane
0–1000m range. `hand_aligned.tif` in the repo is already the cleaned version.

**Slope raster (found later, more severe):** The original `slope_utm51n.tif`
was corrupted **island-wide**, not just at edges. Discovered when
`compute_tc.py` returned an impossible 89.77° average slope across a
200km² watershed. A whole-island average (~52°) had looked superficially
plausible earlier — that was an aggregate hiding a severe, spatially
concentrated problem. **Confirmed and fixed** by recomputing slope directly
from the known-good DEM: `gdaldem slope dem_aligned.tif slope_recomputed.tif
-compute_edges`, which gave a sane distribution (mean 8.18°, max 64.5°).
`slope_recomputed.tif` was copied over `slope_aligned.tif`.

**Consequence: `compute_twi.py` and `compute_fsi.py` must be re-run** any
time `slope_aligned.tif` changes, since TWI is derived directly from slope.
As of the last update to this file, that rerun was in progress — **verify
`fsi_output/` was actually regenerated after the slope fix before trusting
it**, don't assume it happened automatically.

**Lesson for future data from this teammate:** don't trust a whole-island
average as a sanity check — it can hide severe regional corruption. Check
statistics on the actual sub-area you're going to use, not just the full
extent.

## GRASS watershed delineation — a real methodological trap, now resolved

`r.watershed`'s **`basin`** output does **not** give the full cumulative
watershed draining to a point — it segments the *entire* drainage network
into many small local unit-catchments. The basin containing the true outlet
(max flow-accumulation pixel) was only 4km², despite that outlet's own flow
accumulation implying ~121km² of upstream contributing area.

**The correct tool is `r.water.outlet`**, which traces the actual cumulative
watershed from one specified outlet coordinate using the flow-direction
raster (`drain_direction.tif`). Its output (`true_watershed.tif`, value=1
inside the watershed) is what `compute_tc.py` should mask against — **not**
`watershed_basin.tif` / a basin ID.

Outlet location (already found, reusable): pixel row=545, col=11 in the
25m-grid array, coordinate (643626.1, 1282839.5) in EPSG:32651. Found via
`find_outlet_basin.py` by locating flow-accumulation ≥190,000.

## Objective 3 — linear reservoir model, separate from FSI

`Q2 = Q1·e^(-A·Δt) + R·(1 - e^(-A·Δt))`, applied recursively per hour, per
municipality (`compute_runoff.py`). Answers "given the forecast, when does
runoff peak" — a complementary, not duplicate, output to FSI. Rainfall input
comes from `rainfall_timeseries.json` (full hourly series, not just FSI's
6-hour total).

**`A` (reservoir coefficient) is FINALIZED: 0.8466/hour.** Derived via
Kirpich (1940) time-of-concentration on the TRUE cumulative watershed
(`r.water.outlet`, not `r.watershed`'s "basin"), using corrected slope data,
with **ocean pixels (DEM==0) explicitly excluded** — discovered that 45% of
the *entire* aligned grid has DEM exactly 0 (the rectangular grid extends
into open water around the irregular coastline; 0 is a fill value, not
real sea-level terrain). Earlier attempts also had a **unit bug**: average
slope in degrees was fed directly into Kirpich's `S^-0.385` term without
converting to a true slope ratio (`tan` of the angle) — this changed the
result by roughly 4-5x. Both issues are fixed in the current `compute_tc.py`
and the value in `compute_runoff.py`'s `RESERVOIR_COEFFICIENT` reflects
them. **This is a real, trustworthy number now — don't re-derive it from
scratch without reading `compute_tc.py`'s comments first.**

## Dashboard UX (designed, not yet built as real code)

- Map always present as the "home screen." Risk + countdown-to-threshold
  baked directly into map labels by default.
- Tap municipality → barangays + breadcrumb; tap barangay → hydrograph +
  second breadcrumb. Last-viewed barangay persists as "recently visited."
- Bottom-right **"+" menu**: Profile / Dashboard / Sign out.
- Dashboard bottom-sheet (90% height, map dimmed behind as scrim): sortable,
  legend-filterable list ranked by urgency. Replaced an earlier time-slider
  design (rejected as too fiddly).
- Profile feature needs Supabase Storage (first feature needing it).
  "Screenshot watermark" = an always-visible attribution overlay, NOT
  screenshot detection (not reliably possible in a browser).

## Known environment gotchas (don't waste time rediscovering these)

- **PowerShell blocks npm** by default — use OSGeo4W Shell/Command Prompt, or
  `Set-ExecutionPolicy -ExecutionPolicy RemoteSigned -Scope CurrentUser`.
- **GDAL + numpy 2.x are incompatible** here — pin `numpy<2`.
- **Shapefiles need their full sidecar bundle** (.shp/.dbf/.shx/.prj/.cpg).
- **QGIS's bundled Python (OSGeo4W Shell) is the easiest working GDAL on
  Windows.**
- **`numba`/`pysheds` are permanently blocked on this machine** — Windows
  Smart App Control is fully "On" and can't be reversed without a full OS
  reinstall. This broke **both** `compute_tc.py` and `compute_twi.py`
  (the second one via `pysheds`'s `rasterio` dependency) — it's not a
  one-off, assume any `pysheds`/`rasterio` import will fail here. Both
  scripts were rewritten to use GRASS tools (`r.watershed`,
  `r.water.outlet`) via QGIS's Processing Toolbox instead — no extra
  Python packages needed.
- **QGIS's Processing GUI can silently fail** — its GDAL Raster Calculator
  wrapper reported "success" while actually leaving the output as an
  unmodified copy of the input (formula never applied). No error, no
  warning. **Always verify raster calculator results with a direct
  `gdal_calc.bat` shell command + `gdalinfo -stats`**, don't trust QGIS's
  Processing panel for this specific operation.
- **`r.watershed` requires an explicit `threshold` parameter** (minimum
  basin size in cells) or it errors on `basin`/`stream`/etc. outputs. `1000`
  was used here.
- **Leaving Processing outputs as `[Temporary Output]` loses them on a QGIS
  crash** (which happened once this project). Always save `r.watershed`
  outputs to real files in `aligned/`.
- **QGIS can show stale cached raster statistics** (histogram/Properties)
  even after the underlying file is overwritten. **Root cause, confirmed**:
  a `.tif.aux.xml` sidecar file caches GDAL statistics; a plain file
  overwrite/copy doesn't touch or clear this sidecar, so both `gdalinfo`
  and QGIS keep reporting the *old* file's stats until the sidecar is
  deleted. **Rule: whenever overwriting a `.tif`, delete its matching
  `.tif.aux.xml` too** (`del file.tif.aux.xml`), or re-verify with a fresh
  `gdalinfo -stats` only after doing so. This caused real confusion twice
  in this project (the `outlet_mask.tif` mystery, and the slope-file fix
  silently not taking effect) before the mechanism was understood.
- `ERROR 6: SetColorTable()` messages from `r.out.gdal` are cosmetic/
  harmless — the file still writes correctly (look for "complete" after it).
- **Never chain `gdal.Open(path).GetRasterBand(1).ReadAsArray()` in one
  expression** — if nothing holds a reference to the opened Dataset, Python
  can garbage-collect it before `ReadAsArray()` finishes, producing a
  confusing `TypeError: ... argument 1 of type 'GDALRasterBandShadow *'`
  that looks like a numpy/GDAL version conflict but isn't. Always do
  `ds = gdal.Open(path)` first, then use `ds` for subsequent calls.

## Data provenance

Real GIS source files (DEM-derived HAND/slope — slope later found corrupted,
2025 LCM land cover shapefile, OSM-derived waterways) came from a teammate's
QGIS project (`maplayer.qgz`) via Google Drive. That Drive connector has had
trouble listing deeply-nested folders reliably — expect to need direct
folder IDs or direct file uploads.

## NEXT STEPS (update this list as items complete — don't let it go stale)

1. ~~Confirm `compute_tc.py`'s final result~~ **DONE.** `A = 0.8466/hour`,
   derived correctly (true watershed, corrected slope, unit bug fixed,
   ocean pixels excluded). Already plugged into `compute_runoff.py`.
2. ~~Update `compute_runoff.py`'s `RESERVOIR_COEFFICIENT`~~ **DONE.**
3. `compute_twi.py` was also rewritten this session to drop `pysheds`
   entirely (now permanently blocked by Smart App Control — it broke a
   second script, not just `compute_tc.py`). It now reads flow
   accumulation from GRASS's `drain_cell.tif` instead. **Confirm this
   version is the one actually in use** — re-run `compute_twi.py` →
   `compute_fsi.py` in that order if there's any doubt, since `fsi_output/`
   is only trustworthy if built on top of the corrected slope AND the
   pysheds-free TWI script.
4. **Fix the barangay/FSI CRS mismatch for zonal statistics**: barangay
   boundary layer is EPSG:4326, FSI raster is EPSG:32651 — reproject the
   vector layer before running Zonal Statistics, or it silently returns
   NULL/0 for every barangay.
5. **Aggregate FSI per barangay** (mean/max FSI class within each boundary)
   once the CRS issue is fixed, and export as GeoJSON — this is the actual
   data `Map.tsx` needs.
6. ~~FSI's quantile classification vs. live/dynamic use~~ **RESOLVED.**
   Switched to fixed thresholds (0.2/0.4/0.6/0.8) following the precedent
   of an actual operational analog (Luong et al. 2025, Vietnam). See the
   "FSI formula" section above for the full justification and honesty
   caveat about the specific numbers being borrowed, not Philippine-
   sourced.
7. **Tell the teammate who supplied the data** about the corrupted rasters
   (HAND and slope, both found this way) — whatever tool generated them has
   a real, repeatable bug worth them knowing about.
8. **Clean up dead code**: `align_fsi_inputs.py` still generates
   `water_distance_aligned.tif`, unused by the current FSI formula.
9. Still not started: real `Map.tsx`/dashboard code, admin panel, Profile
   feature (needs Supabase Storage), and the Python pipeline's production
   deployment/scheduling mechanism.