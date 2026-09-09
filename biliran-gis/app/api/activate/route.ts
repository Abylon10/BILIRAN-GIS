// app/api/activate/route.ts

import { NextRequest, NextResponse } from 'next/server'
import { supabaseAdmin } from '@/lib/supabaseAdmin'

export async function POST(req: NextRequest) {
  const { code, password, deviceId } = await req.json()

  if (!code || !password || !deviceId) {
    return NextResponse.json({ error: 'Missing required fields.' }, { status: 400 })
  }
  if (password.length < 6) {
    return NextResponse.json({ error: 'Password must be at least 6 characters.' }, { status: 400 })
  }

  const { data: invite, error: fetchError } = await supabaseAdmin
    .from('invitation_codes')
    .select('*')
    .eq('code', code)
    .single()

  if (fetchError || !invite) {
    return NextResponse.json({ error: 'Invalid invitation code.' }, { status: 404 })
  }
  if (invite.redeemed) {
    return NextResponse.json({ error: 'This code has already been used.' }, { status: 409 })
  }
  if (invite.expires_at && new Date(invite.expires_at) < new Date()) {
    return NextResponse.json({ error: 'This code has expired.' }, { status: 410 })
  }

  // Create the auth user
  const { data: userData, error: createError } = await supabaseAdmin.auth.admin.createUser({
    email: invite.email,
    password,
    email_confirm: true, // trusted invite flow — no separate email verification step
  })

  if (createError || !userData.user) {
    return NextResponse.json(
      { error: createError?.message ?? 'Could not create account.' },
      { status: 500 }
    )
  }

  // Create the profile row
  const { error: profileError } = await supabaseAdmin.from('user_profiles').insert({
    user_id: userData.user.id,
    office: invite.office,
    access_level: 'standard',
  })

  if (profileError) {
    return NextResponse.json({ error: 'Account created but profile setup failed.' }, { status: 500 })
  }

  // Bind the code to this device, mark it redeemed — only now, on success
  await supabaseAdmin
    .from('invitation_codes')
    .update({ redeemed: true, device_id: deviceId, redeemed_at: new Date().toISOString() })
    .eq('id', invite.id)

  return NextResponse.json({ success: true })
}