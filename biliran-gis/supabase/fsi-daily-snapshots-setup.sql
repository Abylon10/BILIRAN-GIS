-- supabase/fsi-daily-snapshots-setup.sql
--
-- NOT auto-applied by this repo (same pattern as avatars-storage-setup.sql,
-- profile-name-fields-setup.sql, invitation-name-field-setup.sql — no
-- Supabase migrations/CLI here, see CLAUDE.md). Run this once, by hand, in
-- the Supabase SQL editor, before the admin dashboard's "FSI Trend" chart
-- will show anything — without this table, the daily snapshot POST/GET
-- routes (app/api/admin/fsi-snapshot/route.ts) will error.
--
-- One row per calendar date, upserted by the admin Dashboard tab on view
-- (see lib/fsiTrend.ts) — this table starts empty and only ever grows
-- from whenever this is first run forward. It is deliberately NOT
-- backfilled with invented historical values: there is no real daily FSI
-- history anywhere in this app before this table exists.
--
-- Safe to re-run: every statement is guarded.

create table if not exists public.fsi_daily_snapshots (
  id bigint generated always as identity primary key,
  snapshot_date date not null unique,
  avg_fsi numeric not null,
  high_risk_count integer not null,
  -- 'live' when computed from the live Open-Meteo-driven recompute
  -- (lib/liveIslandState.ts), 'static' when live data hadn't loaded yet
  -- and the snapshot fell back to the pipeline's own mean_fsi_score
  -- average instead — kept so the chart/table can honestly label which
  -- kind of number each point is, never presenting one as the other.
  source text not null check (source in ('live', 'static')),
  created_at timestamptz not null default now()
);

alter table public.fsi_daily_snapshots enable row level security;

-- Same reasoning as invitation_codes' own policy: every real access goes
-- through supabaseAdmin (service role) in app/api/admin/fsi-snapshot's
-- routes, both admin-gated via requireAdmin — no anon/authenticated
-- client ever touches this table directly.
drop policy if exists "no client access" on public.fsi_daily_snapshots;
create policy "no client access" on public.fsi_daily_snapshots
  for all using (false) with check (false);
