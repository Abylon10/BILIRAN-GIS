// lib/profile.ts
//
// Reads the signed-in user's own row from `user_profiles`. Uses the anon
// client (safe client-side) — this relies on a Supabase RLS policy that lets
// a user select the row where user_id = auth.uid(); it does not grant access
// to any other user's profile on its own.

import { supabase } from '@/lib/supabase'

export interface Profile {
  user_id: string
  office: string | null
  access_level: string
  avatar_path: string | null
  // Structured (not one combined name string) so formatDisplayName below
  // can reliably fall back to "title + family name" — see
  // supabase/profile-name-fields-setup.sql for the columns and the
  // access_level column-grant security fix that file also carries.
  title: string | null
  first_name: string | null
  family_name: string | null
}

// Uppercases only the first character, leaves the rest as typed —
// "start with a capital letter," not "capitalize every word" (which
// would mangle an acronym like "MDRRMO" into "Mdrrmo" if typed
// correctly to begin with).
export function capitalizeFirst(s: string): string {
  return s ? s.charAt(0).toUpperCase() + s.slice(1) : s
}

export async function fetchOwnProfile(userId: string): Promise<Profile | null> {
  const { data, error } = await supabase
    .from('user_profiles')
    .select('user_id, office, access_level, avatar_path, title, first_name, family_name')
    .eq('user_id', userId)
    .single()

  if (error || !data) return null
  const p = data as Profile
  // Defensive — normalizes any row saved before this capitalization was
  // added (or edited directly in Supabase), so display is always
  // capitalized without needing a data migration.
  return {
    ...p,
    title: p.title ? capitalizeFirst(p.title) : p.title,
    first_name: p.first_name ? capitalizeFirst(p.first_name) : p.first_name,
    family_name: p.family_name ? capitalizeFirst(p.family_name) : p.family_name,
    office: p.office ? capitalizeFirst(p.office) : p.office,
  }
}

// Requires the "user_profiles: users update own row" RLS policy from
// supabase/avatars-storage-setup.sql — there was no update policy before.
export async function updateOwnAvatarPath(userId: string, path: string): Promise<boolean> {
  const { error } = await supabase
    .from('user_profiles')
    .update({ avatar_path: path })
    .eq('user_id', userId)

  return !error
}

// Used by the profile edit form (ProfilePanel.tsx) — deliberately narrower
// than a generic "update any field" function: only the columns a user is
// actually allowed to edit about themselves (also enforced server-side by
// the column grant in supabase/profile-name-fields-setup.sql — this
// client-side restriction is a UX convenience, not the security boundary).
export async function updateOwnProfileFields(
  userId: string,
  fields: Partial<Pick<Profile, 'title' | 'first_name' | 'family_name' | 'office'>>
): Promise<boolean> {
  const { error } = await supabase
    .from('user_profiles')
    .update(fields)
    .eq('user_id', userId)

  return !error
}

// The header profile button's revealed tab has limited width — a long
// full name would either wrap (breaks the tab's fixed shape) or truncate
// (loses the family name, the more useful identifier at a glance), so
// past MAX_FULL_NAME_CHARS this falls back to "title + family name" (e.g.
// "Mr. Dela Cruz") instead. That threshold is a visual judgment call —
// tuned against a real rendered screenshot of the tab, not computed from
// font metrics; adjust it there if it over/underfills the tab.
const MAX_FULL_NAME_CHARS = 20

export function formatDisplayName(profile: Pick<Profile, 'title' | 'first_name' | 'family_name'>): string | null {
  // capitalizeFirst again here (fetchOwnProfile already does it) — cheap
  // second layer of defense for any caller building this from state that
  // didn't come through fetchOwnProfile (e.g. ProfilePanel's own
  // just-saved `fields` object, passed straight to this via
  // onProfileFieldsChange).
  const title = profile.title ? capitalizeFirst(profile.title) : profile.title
  const first_name = profile.first_name ? capitalizeFirst(profile.first_name) : profile.first_name
  const family_name = profile.family_name ? capitalizeFirst(profile.family_name) : profile.family_name
  if (!first_name && !family_name) return null

  const full = [title, first_name, family_name].filter(Boolean).join(' ')
  if (full.length <= MAX_FULL_NAME_CHARS) return full

  if (title && family_name) return `${title} ${family_name}`
  return family_name ?? first_name ?? full
}

// Bucket is private, so display always goes through a freshly-signed read
// URL (relying on the storage RLS policy scoping reads to the owner's own
// path) — never a public bucket URL.
export async function getAvatarUrl(path: string, expiresInSeconds = 3600): Promise<string | null> {
  const { data, error } = await supabase.storage.from('avatars').createSignedUrl(path, expiresInSeconds)
  if (error || !data) return null
  return data.signedUrl
}
