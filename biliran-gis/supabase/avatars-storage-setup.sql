-- supabase/avatars-storage-setup.sql
--
-- NOT auto-applied by this repo. This project has no Supabase
-- migrations/CLI infrastructure (see CLAUDE.md) — every piece of schema
-- here (user_profiles, invitation_codes, and now this) is inferred from
-- application code, not created by anything checked in. Run this once,
-- by hand, in the Supabase SQL editor for this project, before the
-- profile-photo-upload feature (app/api/profile/avatar-upload-url,
-- lib/profile.ts's updateOwnAvatarPath/getAvatarUrl) will work end to end.
--
-- Safe to re-run: every statement is guarded (IF NOT EXISTS / DROP POLICY
-- IF EXISTS + CREATE POLICY).

-- 1. Private bucket for profile photos. Private because access is granted
--    per-request via signed URLs (upload + read), never a public bucket URL.
insert into storage.buckets (id, name, public)
values ('avatars', 'avatars', false)
on conflict (id) do nothing;

-- 2. A user may only touch objects under their own uid-prefixed path
--    ('{auth.uid()}/...'), enforced by matching the first path segment.
drop policy if exists "avatars: users manage own folder" on storage.objects;
create policy "avatars: users manage own folder"
  on storage.objects
  for all
  to authenticated
  using (
    bucket_id = 'avatars'
    and (storage.foldername(name))[1] = auth.uid()::text
  )
  with check (
    bucket_id = 'avatars'
    and (storage.foldername(name))[1] = auth.uid()::text
  );

-- 3. New column to store the storage object path (not a public URL — the
--    bucket is private, so a fresh signed read URL is generated per view).
alter table public.user_profiles
  add column if not exists avatar_path text;

-- 4. user_profiles has had a "read own row" RLS policy assumed by
--    lib/profile.ts's fetchOwnProfile since earlier in this project, but no
--    "update own row" policy — needed now so updateOwnAvatarPath can work
--    client-side under RLS, the same pattern as the existing read.
drop policy if exists "user_profiles: users update own row" on public.user_profiles;
create policy "user_profiles: users update own row"
  on public.user_profiles
  for update
  to authenticated
  using (user_id = auth.uid())
  with check (user_id = auth.uid());
