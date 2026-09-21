# Biliran Flood Watch — Project Context

A flood early-warning system for Biliran province, Philippines. Two connected
pieces: a Next.js/Supabase web app for MDRRMO officials, and a Python/GDAL
geospatial pipeline that computes flood susceptibility and a runoff forecast.

## Who this is for

**Not public-facing.** Access is restricted to MDRRMO personnel and barangay
presidents, across 7 of Biliran's 8 municipalities — Naval, Almeria, Biliran,
Cabucgayan, Caibiran, Culaba, Kawayan. **Maripipi is excluded** (resource
constraints) and shown labeled "unmonitored," not hidden.

Core design intent: tell officials how much time remains safe for evacuation
before conditions become unsafe — a countdown, not just a static risk color.
**This is now real, not aspirational** — see "Threshold definition," below.

## Repo layout

```
biliran-gis/                       # Next.js app (App Router)
├── public/data/
│   └── barangay_dashboard_data.json   # THE file the dashboard reads — see below
fsi_pipeline/
├── align_fsi_inputs.py            # Reprojects/aligns raw layers onto one 25m grid
├── compute_twi.py                 # Flow accumulation + TWI (pysheds-free)
├── compute_fsi.py                 # FSI = 0.30(HAND)+0.30(TWI)+0.20(LC)+0.20(R), fixed-threshold classes
├── compute_tc.py                  # Kirpich A for the single largest watershed (A=0.8466/hr)
├── compute_runoff.py              # Objective 3 module, single-outlet version
├── aggregate_fsi_by_barangay.py   # Pixel FSI -> per-barangay stats; rank by mean_fsi_score, NEVER by class
├── multi-watershed.py             # Teammate's 6-8 named-river pipeline (see fixes below)
├── run_island_wide_expansion.py   # Island-wide basin segmentation + Kirpich per basin (PyQGIS script)
├── fix_barangay_matching.py       # Standalone re-match step, fixes the name-collision bug (see below)
├── compute_island_wide_runoff.py  # Applies the runoff formula to all island-wide basins
├── compute_basin_thresholds.py    # Warning/Alert/Danger crossing times per basin — plain Python, no GIS needed
├── barangay_biliran.geojson       # 178 raw features; 115 real, 63 contamination (double-UTF8 at SOURCE)
├── waterways_biliran.geojson      # 448 real OSM waterway lines, used for cross-validation
└── [outputs: island_basin_coefficients_CLEANED.json, island_barangay_basin_map_2235_CORRECT.json,
    island_basin_runoff_2235_CORRECT.json, island_basin_thresholds.json, barangay_dashboard_data.json]
```

Python pipeline still **not deployed inside** the Next.js app (GDAL/GRASS don't
run in Vercel functions). Production refresh mechanism still undecided —
see Next Steps.

## Key architectural decisions (unchanged, don't relitigate)

Single merged page (map+login+dashboard as states of one component, not
routes) · daily login gate is UX not security · account creation fully
admin-controlled, no public signup · invite codes device-bound only at
redemption · no AI/LLM features in the product · admin entry point is a
hidden bottom-right "+" menu.

## FSI — finalized, unchanged since last update

FSI = 0.30(HAND)+0.30(TWI)+0.20(LC)+0.20(R), fixed thresholds (0.2/0.4/0.6/0.8,
justified via Luong et al. 2025). `aggregate_fsi_by_barangay.py` confirmed:
**rank barangays by `mean_fsi_score` only** — "dominant class" collapses 76.5%
of barangays into one bucket, "max class" makes 100% read High/Very High.
Both tested and rejected; only the continuous score differentiates usefully.

## Island-wide runoff expansion — DONE, fully verified end to end

**Why**: adviser feedback — only 10 of 115 barangays had ANY time-based
forecast (the ones touching the 6 confirmed named rivers). For a
preparedness system, "9% of barangays get real data" isn't good enough.

**Method**: reused `r.watershed`'s "basin" output — the same tool
deliberately rejected earlier for finding one river's TRUE watershed
(it only gives small local sub-catchments) — but that's exactly the
property needed for full-island coverage instead of a few big rivers.
Segmented the whole island (threshold=200) into basins, applied the same
Kirpich method to each, matched every real barangay to its basin(s) by
actual polygon overlap (not centroids).

**Environment note**: this was run via a standalone PyQGIS script
(`run_island_wide_expansion.py`, pasted into QGIS's Python Console) rather
than manual GUI steps, because the user's own QGIS install was fully
blocked by Windows Smart App Control (escalated from blocking individual
packages to blocking `qgis-ltr-bin.exe` itself — a reinstall made it
*worse*, going from 3.44.12 to a fresh 3.44.14 with no prior trust history).
Work continued on a teammate's separate, working QGIS install instead.
ArcGIS (different code-signing, might avoid this class of block) was
floated as a longer-term alternative but access was never confirmed.

**Real bugs found and fixed during verification — all now resolved:**
- **Fake NoData basin (`basin_id=65535`)**: GRASS's uint16 NoData sentinel
  (2¹⁶−1) was being read as a real basin, contaminating 28 barangays with
  a nonsense entry (avg slope of -6353°). Excluded permanently.
- **Barangay name-collision bug** (mine): results were keyed by name alone;
  4 names repeat across municipalities (Poblacion, Burabod, San Roque,
  Looc) and silently overwrote each other, losing 5 real barangays. Fixed
  by keying `"Name (PGC)"` instead — confirmed all 115 present, no
  collisions, in `fix_barangay_matching.py`.
- **Basin-raster mismatch saga**: at one point THREE different files
  (coefficients, barangay map, runoff) were each built against a
  DIFFERENT basin raster — the old pre-existing 552-basin one
  (threshold=1000, IDs 2–1104, from the original multi-river work) vs. the
  fresh 2,235-basin one (threshold=200). Decision made: **standardize on
  the 2,235-basin set.** All three re-derived from the same source raster
  and cross-verified to reference identical basin IDs. If a similarly-named
  file shows up with `basin_id` maxing out at 1104, it's the OLD raster —
  don't mix it with anything else.
- **`compute_runoff_reservoir` off-by-one bug** (in `multi-watershed.py`,
  pre-existing, not something this project introduced): indexed
  `hyeto[t]` instead of `hyeto[t+1]`, causing a one-timestep lag vs. the
  already-published/verified hydrographs. Confirmed via exact numerical
  match against River_Naval's original data. Fixed and independently
  re-verified by the teammate on their own machine.
- **Euler-method numerical instability at high A** (found only once
  island-wide coverage surfaced basins the original 6-8 rivers never had):
  the explicit-Euler runoff formula is unconditionally correct only below
  `A > 2/dt` — 24.0 at the project's 5-minute timestep. 354 of 2,235
  basins (16%) produced physically impossible peak_Q values (up to
  10^16), not just the ~13 that fully diverged. **Decision: switched the
  ENTIRE runoff computation to the exact analytical formula**
  (`Q2 = Q1·e^(-AΔt) + R·(1-e^(-AΔt))`), unconditionally stable for any A.
  This is what the project's own documentation always claimed to use
  anyway. Cost, quantified: the 6 named rivers' peak Q values shift by a
  small, consistent -3% to -5% from their previously-Euler-computed
  values (e.g. River_Naval 47.93→45.72) — disclose this if citing the
  earlier numbers anywhere already written.

**Final state**: `island_basin_coefficients_CLEANED.json` (2,235 basins,
no artifacts), `island_barangay_basin_map_2235_CORRECT.json` (all 115
real barangays, zero unmatched, zero collisions), `island_basin_runoff_2235_CORRECT.json`
(exact formula, zero physically-impossible values, verified against all
2,235 basins) — all three cross-checked to reference the same basin IDs.

## Threshold definition — DONE, closes the biggest remaining gap

Previously: hydrographs existed but nothing defined "dangerous." Real-world
approaches (Nepal's Gautam & Dulal 2013, Italy's Norbiato/Toth) all need
data Biliran doesn't have — surveyed channel cross-sections or years of
historical gauge records for statistical/return-period thresholds.

**Decision: relative thresholds, as a percentage of each basin's OWN
modeled peak Q** — Warning 50%, Alert 75%, Danger 95% (not 100%; with
discrete 5-min timesteps, 95% gives real lead time instead of exactly zero).
**Disclose this plainly as a relative proxy, not a calibrated physical
threshold** — same honesty standard as the synthetic storm hyetograph.

`compute_basin_thresholds.py` — plain Python, no GDAL/QGIS needed, computes
crossing time per basin with linear interpolation between timesteps for
sub-5-minute precision. Verified: zero basins fail to reach Danger, zero
basins have tiers out of order, all confirmed by the user re-running it
independently and matching my own output exactly.

## Dashboard data — DONE, merged and ready

`barangay_dashboard_data.json`: one file, keyed by `"Name (PGC)"`, combining
FSI (`mean_fsi_score`, `dominant_fsi_label`) with runoff thresholds
(`warning_time_hours`, `alert_time_hours`, `danger_time_hours`) per barangay.
For barangays touching multiple basins, uses the **earliest** (most urgent)
crossing time across all of them — safety-first, not an average.

**Wiring plan (current step)**: static file in `public/data/`, fetched
client-side with a simple cached `fetch()` — no Supabase/DB changes needed
for now. **Known limitation to revisit later**: a `public/` file only
updates on redeploy; once a real rainfall-driven refresh pipeline exists,
this needs to move to Supabase Storage or a real table instead.

## UI structure for the dashboard (real reference confirmed — see screenshot)

Reference: a weather-monitoring SaaS dashboard (Dribbble, "Weather Monitoring
Dashboard," Product SAAS for Cansaas). Two-column layout: wide map+charts
panel on the left, narrower "Detail Overview" sidebar on the right. This
maps cleanly onto data already built — not a generic placeholder anymore.

**Top bar**: search (barangay/municipality), location selector, "synced N
min ago" indicator (honest about the static-`public/`-file staleness
limitation already noted above), profile icon = the existing hidden "+"
menu (Profile/Dashboard/Sign out).

**"LIVE UPDATE" banner** (top of main panel, high-visibility strip): maps
directly to the single most urgent upcoming threshold crossing across all
monitored barangays — e.g. *"LIVE UPDATE: Jamorawon approaching Alert at
14:52. See Details →"*. Computed as `min()` over every barangay's
`alert_time_hours`/`danger_time_hours` in `barangay_dashboard_data.json`.

**Main map** (heatmap overlay + "N Active Weather Alerts" badge): island
map colored by urgency tier (Warning/Alert/Danger), not a separate FSI
color scale — per the "one consistent color scale" decision below. Badge
= count of barangays currently past Warning. Zoom controls, pin = existing
map component, just re-skinned with this data.

**"Regional Extremes" card** → becomes **"Most Urgent Barangays"**: a
short list of barangays with the soonest countdown, sorted by
`mean_fsi_score`/earliest threshold time — this is the literal
"sortable-by-urgency" list from the original dashboard design brief,
finally with a concrete visual home. Keep the "Generate Report" button
pattern — a legitimate quick win (export the current urgency list as PDF/CSV).

**"AQI Trends" chart** → this IS a barangay's hydrograph, almost exactly
as designed already: line/step chart, `time_hours` on X, `Q` on Y,
Warning/Alert/Danger drawn as horizontal reference lines. Note the
reference's hover tooltip showing an exact value at a point — worth
replicating for reading off precise Q values along the curve.

**Right sidebar "Detail Overview"** → the barangay detail panel:
- **Hero stat** (big icon + big number + label), copying the reference's
  "26° / Heavy Rain" pattern exactly: big countdown number (e.g. "34") +
  unit label ("min to Alert") + the barangay's FSI class as the
  description line underneath.
- **Stat row below** (reference: Humidity/Wind Speed/Pressure) → FSI
  factor breakdown: HAND / TWI / LC contribution values.
- **"View Details" button** → drill into the full FSI methodology
  breakdown for that barangay.

**"7-Day Forecast" card** → doesn't map to a forecast (no multi-day
concept exists), repurpose as **"Contributing Basins"**: a horizontal
scroll row, one tile per basin affecting this barangay (relevant for
multi-basin barangays like Binohangan) — tapping one swaps the main
hydrograph to that specific basin's curve.

**"Precipitation Overview" card** (big number + hourly bar chart) → maps
directly to the actual rainfall input driving the model: the synthetic
storm hyetograph (or live forecast, once wired up) as an hourly bar chart,
giving transparency into *why* a given countdown looks the way it does.

**Card design pattern to copy throughout**: consistent header row (title +
overflow-menu dots), light card shadow, one primary metric per card,
one clear action button at the bottom (View Details / Export / Analyze) —
this consistency is what makes the reference read as one coherent system.

**Still true from before, unchanged**: map always mounted as base layer;
bottom-right hidden "+" menu unchanged; a barangay in multiple basins
shows its earliest/most urgent countdown as the headline number.

## Known environment gotchas (cumulative — don't rediscover these)

PowerShell blocks npm · GDAL+numpy2.x incompatible (pin `numpy<2`) ·
shapefiles need full sidecar bundle · `numba`/`pysheds`/`rasterio`
permanently blocked by Smart App Control (use GRASS via QGIS Processing) ·
**QGIS's own executable can also get blocked** — this escalates over time
on some machines, a reinstall can make it worse not better, different
Qt major versions (5 vs 6) are worth trying since they're different
binaries with no shared trust history · a GDAL import can fail in one
specific subfolder and work fine elsewhere (stray/conflicting local file,
not a real system-wide block) · QGIS Processing GUI's Raster Calculator
can silently no-op — verify with `gdal_calc.bat`+`gdalinfo -stats` directly ·
`r.watershed` needs explicit `threshold`; its "basin" output is small
local sub-catchments, not a true cumulative watershed (use `r.water.outlet`
for that specifically) · `.tif.aux.xml` sidecars cache stale stats after
overwrite · never chain `gdal.Open().GetRasterBand().ReadAsArray()` ·
GDAL 3.x axis ordering: set `OAMS_TRADITIONAL_GIS_ORDER` on both SRS
objects before `CoordinateTransformation` or reprojection throws
"Invalid latitude" · **explicit-Euler numerical schemes are only
conditionally stable** — always check `A > 2/dt` (or the equivalent for
whatever method is used) before trusting a wider parameter range than
what was originally tested, this exact issue cost real time during the
island-wide expansion.

## NEXT STEPS (keep this current — a lot just got marked done)

1. **Build the actual dashboard UI** (`Map.tsx` and related components) per
   the UI structure above — now grounded in a real reference image, this
   is the next concrete, un-started work.
2. **Regenerate the 6 named rivers' hydrographs** through the same exact
   formula now used island-wide, for full internal consistency (currently
   only the island-wide basins use it; the named-river files predate this
   fix and still reflect the old Euler numbers).
3. Move `barangay_dashboard_data.json` from a static `public/` file to
   Supabase once/if a real automatic refresh pipeline is built.
4. **Rename `River_Naval` → reflect "Bagongbong River"** in final
   outputs/thesis (confirmed via 3-way validation: geometry, real OSM
   waterway name, and Chapter IV interview testimony — it flows through
   Almeria, not Naval).
5. Fix the source-level UTF-8 double-encoding in `barangay_biliran.geojson`
   itself (affects "Capiñahan," "Santo Niño" at minimum).
6. Complete the `[VERIFY full citation]` placeholders in the thesis's
   Related Studies references.
7. Naval's MDRRMO interview still needed for Chapter IV (6 of 7 done).
8. Admin panel, Profile feature (needs Supabase Storage), production
   pipeline deployment/scheduling — all still not started.