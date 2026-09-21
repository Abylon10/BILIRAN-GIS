// app/api/admin/invite/route.ts
//
// Admin-only: create and list invitation codes. Account creation is fully
// admin-controlled (see CLAUDE.md) — this is the endpoint that actually
// produces the `invitation_codes` rows that app/api/activate/route.ts
// redeems, which didn't exist anywhere in the app before this.

import { NextRequest, NextResponse } from 'next/server'
import { supabaseAdmin } from '@/lib/supabaseAdmin'

async function requireAdmin(req: NextRequest) {
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

function generateCode(): string {
  return crypto.randomUUID().replace(/-/g, '').slice(0, 8).toUpperCase()
}

export async function GET(req: NextRequest) {
  const admin = await requireAdmin(req)
  if (!admin) {
    return NextResponse.json({ error: 'Admin access required.' }, { status: 403 })
  }

  const { data, error } = await supabaseAdmin
    .from('invitation_codes')
    .select('id, code, email, office, redeemed, expires_at, redeemed_at')
    .order('id', { ascending: false })
    .limit(100)

  if (error) {
    return NextResponse.json({ error: 'Could not load invitation codes.' }, { status: 500 })
  }

  return NextResponse.json({ invitations: data })
}

export async function POST(req: NextRequest) {
  const admin = await requireAdmin(req)
  if (!admin) {
    return NextResponse.json({ error: 'Admin access required.' }, { status: 403 })
  }

  const { email, office, expiresInDays } = await req.json()

  if (!email || !office) {
    return NextResponse.json({ error: 'Email and office are required.' }, { status: 400 })
  }

  const expires_at =
    typeof expiresInDays === 'number' && expiresInDays > 0
      ? new Date(Date.now() + expiresInDays * 24 * 60 * 60 * 1000).toISOString()
      : null

  const { data, error } = await supabaseAdmin
    .from('invitation_codes')
    .insert({ code: generateCode(), email, office, redeemed: false, expires_at })
    .select('id, code, email, office, expires_at')
    .single()

  if (error) {
    return NextResponse.json({ error: 'Could not create invitation code.' }, { status: 500 })
  }

  return NextResponse.json({ invitation: data })
}
