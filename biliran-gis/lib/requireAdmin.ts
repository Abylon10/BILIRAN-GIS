// lib/requireAdmin.ts
//
// Shared admin-gate for API routes — extracted from
// app/api/admin/invite/route.ts (the first place this check existed) so
// app/api/admin/invite/[id]/route.ts doesn't duplicate it. Decodes the
// caller's Supabase access token (Authorization: Bearer <token>, sent from
// the client after supabase.auth.getSession()) and requires
// user_profiles.access_level === 'admin' — the same mechanism used
// everywhere else in this app that needs admin authorization.

import { NextRequest } from 'next/server'
import { supabaseAdmin } from '@/lib/supabaseAdmin'

export async function requireAdmin(req: NextRequest) {
  const authHeader = req.headers.get('authorization') ?? ''
  const token = authHeader.startsWith('Bearer ') ? authHeader.slice(7) : null
  if (!token) return null

  const { data: userData, error: userError } = await supabaseAdmin.auth.getUser(token)
  if (userError || !userData.user) return null

  const { data: profile, error: profileError } = await supabaseAdmin
    .from('user_profiles')
    .select('access_level')
    .eq('user_id', userData.user.id)
    .single()

  if (profileError || !profile || profile.access_level !== 'admin') return null

  return userData.user
}
