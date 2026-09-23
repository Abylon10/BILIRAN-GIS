-- supabase/profile-name-fields-setup.sql
--
-- NOT auto-applied by this repo (same pattern as
-- avatars-storage-setup.sql — no Supabase migrations/CLI infra here, see
-- CLAUDE.md). Run this once, by hand, in the Supabase SQL editor, before
-- the header profile button / profile name-edit form
-- (components/HeaderProfileButton.tsx, lib/profile.ts's
-- updateOwnProfileFields/formatDisplayName) will work end to end.
--
-- Safe to re-run: every statement is guarded.

-- 1. Structured name fields — title (honorific, free text: "Mr.", "Mrs.",
--    "Ms.", "Engr.", etc.), first name, family name. Kept separate rather
--    than one combined name string so display logic (formatDisplayName in
--    lib/profile.ts) can reliably fall back to "title + family name" when
--    the full name won't fit the header button's revealed tab, instead of
--    parsing a single free-text field.
alter table public.user_profiles
  add column if not exists title text;
alter table public.user_profiles
  add column if not exists first_name text;
alter table public.user_profiles
  add column if not exists family_name text;

-- 2. Security fix, not routine schema — found while reviewing this table
--    for the above. The "user_profiles: users update own row" policy from
--    avatars-storage-setup.sql is a blanket
--    FOR UPDATE USING/WITH CHECK (user_id = auth.uid()) with no column
--    restriction. RLS only restricts which ROWS a policy applies to, not
--    which COLUMNS — as written, any signed-in user could already run
--    `update user_profiles set access_level = 'admin' where user_id =
--    auth.uid()` directly via the Supabase client, bypassing this app's
--    own UI entirely (nothing in the app ever intended to let users set
--    their own access_level — only app/api/admin/invite's admin-gated
--    flow and direct Supabase dashboard access should ever touch it).
--    Column-level privileges are the correct tool for this, alongside the
--    row-level policy: ensure the table-level grant covers the columns
--    users SHOULD be able to update themselves, then explicitly revoke
--    access_level specifically.
grant update (office, title, first_name, family_name, avatar_path)
  on public.user_profiles to authenticated;
revoke update (access_level) on public.user_profiles from authenticated;
