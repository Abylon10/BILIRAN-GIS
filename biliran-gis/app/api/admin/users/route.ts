// app/api/admin/users/route.ts
//
// Admin-only, read-only: lists already-activated accounts for the admin
// dashboard's Users tab (components/AdminUsersTab.tsx). user_profiles has
// no email column (see CLAUDE.md's structured-name-fields note), so this
// merges supabaseAdmin.auth.admin.listUsers() (email, created_at,
// banned_until) with user_profiles rows (office, access_level, name
// fields) by user_id — the same two-source join app/api/activate/route.ts's
// own write path already implies (it creates one row in each). No
// edit/delete here — deliberately read-only, per the user's own explicit
// scope choice for this tab: `banned_until` is surfaced as a plain
// Active/Disabled label, not a toggle this route or the UI can set —
// disabling a Supabase Auth user is done from the Supabase dashboard, not
// this app.

import { NextRequest, NextResponse } from 'next/server'
import { supabaseAdmin } from '@/lib/supabaseAdmin'
import { requireAdmin } from '@/lib/requireAdmin'

export async function GET(req: NextRequest) {
  const admin = await requireAdmin(req)
  if (!admin) {
    return NextResponse.json({ error: 'Admin access required.' }, { status: 403 })
  }

  const [{ data: authData, error: authError }, { data: profiles, error: profileError }] = await Promise.all([
    supabaseAdmin.auth.admin.listUsers({ perPage: 1000 }),
    supabaseAdmin
      .from('user_profiles')
      .select('user_id, office, access_level, title, first_name, family_name, created_at'),
  ])

  if (authError || profileError) {
    return NextResponse.json({ error: 'Could not load users.' }, { status: 500 })
  }

  const profileByUserId = new Map((profiles ?? []).map((p) => [p.user_id, p]))

  const users = authData.users.map((u) => {
    const profile = profileByUserId.get(u.id)
    return {
      id: u.id,
      email: u.email ?? null,
      office: profile?.office ?? null,
      accessLevel: profile?.access_level ?? null,
      title: profile?.title ?? null,
      firstName: profile?.first_name ?? null,
      familyName: profile?.family_name ?? null,
      // Supabase sets this to a far-future timestamp for an indefinite
      // ban and clears it (undefined) for an active user — a real signal
      // from Supabase Auth itself, not something this app tracks.
      disabled: Boolean(u.banned_until && new Date(u.banned_until).getTime() > Date.now()),
      // Prefer the profile row's own created_at (when the account was
      // actually activated in this app) over the auth user's — for every
      // real account these come from the same /api/activate transaction
      // moments apart, but falling back to the auth timestamp keeps this
      // honest for the rare case a profile row is somehow missing rather
      // than silently omitting the user.
      joinedAt: profile?.created_at ?? u.created_at,
    }
  })

  users.sort((a, b) => new Date(b.joinedAt).getTime() - new Date(a.joinedAt).getTime())

  return NextResponse.json({ users })
}
