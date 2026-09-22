// app/api/profile/avatar-upload-url/route.ts
//
// Any signed-in user (no access_level check, unlike /api/admin/invite) —
// mints a tokenized signed upload URL for their own avatar path only.
// Server-side because the client never gets broad write access to the
// `avatars` bucket, only a scoped, short-lived upload token for
// `{user.id}/avatar`. See supabase/avatars-storage-setup.sql for the
// bucket/RLS this depends on.

import { NextRequest, NextResponse } from 'next/server'
import { supabaseAdmin } from '@/lib/supabaseAdmin'

async function requireUser(req: NextRequest) {
  const authHeader = req.headers.get('authorization') ?? ''
  const token = authHeader.startsWith('Bearer ') ? authHeader.slice(7) : null
  if (!token) return null

  const { data, error } = await supabaseAdmin.auth.getUser(token)
  if (error || !data.user) return null
  return data.user
}

export async function POST(req: NextRequest) {
  const user = await requireUser(req)
  if (!user) {
    return NextResponse.json({ error: 'Sign-in required.' }, { status: 401 })
  }

  const path = `${user.id}/avatar`
  const { data, error } = await supabaseAdmin.storage
    .from('avatars')
    .createSignedUploadUrl(path, { upsert: true })

  if (error || !data) {
    return NextResponse.json({ error: 'Could not create an upload URL.' }, { status: 500 })
  }

  return NextResponse.json({ path, signedUrl: data.signedUrl, token: data.token })
}
