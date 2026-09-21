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
}

export async function fetchOwnProfile(userId: string): Promise<Profile | null> {
  const { data, error } = await supabase
    .from('user_profiles')
    .select('user_id, office, access_level')
    .eq('user_id', userId)
    .single()

  if (error || !data) return null
  return data as Profile
}
