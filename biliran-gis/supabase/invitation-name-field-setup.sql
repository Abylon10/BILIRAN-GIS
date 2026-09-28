-- supabase/invitation-name-field-setup.sql
--
-- NOT auto-applied by this repo (same pattern as avatars-storage-setup.sql
-- and profile-name-fields-setup.sql — no Supabase migrations/CLI here, see
-- CLAUDE.md). Run this once, by hand, in the Supabase SQL editor, before
-- the "email invitation on create/edit" feature (app/api/admin/invite/
-- route.ts, app/api/admin/invite/[id]/route.ts, lib/email.ts) will work
-- end to end — without this column, invitee_name inserts/updates error
-- (unknown column), so this must run first.
--
-- Safe to re-run: the statement is guarded.

-- Recipient's display name, used to personalize the invitation email
-- (lib/email.ts's sendInvitationEmail). Nullable/optional — an invite can
-- still be created without a name, the email just falls back to a plain
-- "Hello," greeting.
alter table public.invitation_codes
  add column if not exists invitee_name text;

-- No grant/revoke changes needed here (unlike profile-name-fields-setup.sql):
-- invitation_codes is only ever written through supabaseAdmin (service
-- role) in app/api/admin/invite* — no anon/authenticated client touches
-- this table directly (see its "no client access" deny-all RLS policy),
-- so there's no RLS/column-privilege gap to close.
