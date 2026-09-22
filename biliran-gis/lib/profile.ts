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
}

export async function fetchOwnProfile(userId: string): Promise<Profile | null> {
  const { data, error } = await supabase
    .from('user_profiles')
    .select('user_id, office, access_level, avatar_path')
    .eq('user_id', userId)
    .single()

  if (error || !data) return null
  return data as Profile
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

// Bucket is private, so display always goes through a freshly-signed read
// URL (relying on the storage RLS policy scoping reads to the owner's own
// path) — never a public bucket URL.
export async function getAvatarUrl(path: string, expiresInSeconds = 3600): Promise<string | null> {
  const { data, error } = await supabase.storage.from('avatars').createSignedUrl(path, expiresInSeconds)
  if (error || !data) return null
  return data.signedUrl
}
