-- supabase/activity-logs-setup.sql
--
-- NOT auto-applied by this repo (same pattern as fsi-daily-snapshots-setup.sql,
-- avatars-storage-setup.sql, profile-name-fields-setup.sql,
-- invitation-name-field-setup.sql — no Supabase migrations/CLI here, see
-- CLAUDE.md). Run this once, by hand, in the Supabase SQL editor, before
-- the admin "Reports" and "Activity Logs" tabs will show anything —
-- without this table, app/api/admin/activity-logs/route.ts will error.
--
-- One row per logged admin action. Starts empty and only ever grows from
-- whenever this is first run forward — deliberately NOT backfilled with
-- invented historical rows, same no-fabrication rule as
-- fsi-daily-snapshots-setup.sql.
--
-- Single table serving two different admin-tab views, not two separate
-- tables: "Reports" (components/AdminReportsTab.tsx) shows simulation runs
-- as reviewable scenario cards; "Activity Logs" (components/
-- AdminActivityLogTab.tsx) shows every row from this same table as a
-- compact audit-trail line. `action_type` is a real column (not hardcoded
-- to one value) so a future admin action beyond "simulation_run" (e.g. a
-- GIS data upload, a settings change) can log into this same table later
-- without a schema change — Activity Logs would show it too; Reports,
-- which filters to action_type = 'simulation_run' client-side, would not.
--
-- Safe to re-run: every statement is guarded.

create table if not exists public.activity_logs (
  id bigint generated always as identity primary key,
  -- The admin who performed the action. Nullable (not a hard foreign-key
  -- requirement elsewhere in this app either — see fsi_daily_snapshots'
  -- own lack of an actor column) so a row never becomes unreadable if the
  -- acting account is later removed from auth.users.
  actor_user_id uuid references auth.users(id) on delete set null,
  -- Denormalized display label (e.g. "Mr. Admin User — Provincial MDRRMO"),
  -- captured at write time — kept alongside actor_user_id rather than
  -- joined against user_profiles on every read, so a log entry stays
  -- readable even if that profile's name/office is later edited or the
  -- account is removed.
  actor_label text,
  -- Extensible on purpose — see this file's own header comment. Only
  -- 'simulation_run' is ever written today.
  action_type text not null check (action_type in ('simulation_run')),
  -- Human-readable one-liner for the Activity Logs list, e.g. "Ran a
  -- 5-50mm/hr simulation, 2h duration (Rainfall base)".
  summary text not null,
  -- Full structured payload — for a 'simulation_run' row, this holds
  -- exactly what SimulationModePanel needs to reload the same scenario
  -- (minRate, maxRate, durationHours, scheme, scenarioName) plus a
  -- real, already-computed alertCounts breakdown, not re-derived later.
  details jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create index if not exists activity_logs_created_at_idx
  on public.activity_logs (created_at desc);

alter table public.activity_logs enable row level security;

-- Same reasoning as invitation_codes/fsi_daily_snapshots: every real
-- access goes through supabaseAdmin (service role) in
-- app/api/admin/activity-logs/route.ts, admin-gated via requireAdmin —
-- no anon/authenticated client ever touches this table directly.
drop policy if exists "no client access" on public.activity_logs;
create policy "no client access" on public.activity_logs
  for all using (false) with check (false);
