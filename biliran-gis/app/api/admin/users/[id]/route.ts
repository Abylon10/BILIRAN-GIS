// app/api/admin/users/[id]/route.ts
//
// Admin-only: enable/disable a single user account. Sibling to
// app/api/admin/users/route.ts (list) — split out the same way
// app/api/admin/invite/[id]/route.ts is split from its own list route,
// since this operates on one user by id rather than the collection.
//
// Uses Supabase Auth's own real ban mechanism
// (supabaseAdmin.auth.admin.updateUserById(id, { ban_duration })) — the
// same field app/api/admin/users/route.ts's GET already reads back as
// `disabled` (banned_until in the future). '876000h' (~100 years) is the
// conventional "indefinite" ban duration; 'none' lifts it. This is a
// real account-level action, not a cosmetic label — a disabled user
// can no longer sign in at all.
//
// Guards against self-lockout: an admin can't disable their own account
// through this route. There's no equivalent guard against disabling
// another admin — this app currently has no concept of "protected"
// accounts beyond "not yourself," matching its otherwise-flat single
// access_level-gated admin model.

import { NextRequest, NextResponse } from 'next/server'
import { supabaseAdmin } from '@/lib/supabaseAdmin'
import { requireAdmin } from '@/lib/requireAdmin'

const INDEFINITE_BAN = '876000h'

export async function PATCH(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const admin = await requireAdmin(req)
  if (!admin) {
    return NextResponse.json({ error: 'Admin access required.' }, { status: 403 })
  }

  const { id } = await params
  const { disabled } = await req.json()

  if (typeof disabled !== 'boolean') {
    return NextResponse.json({ error: 'disabled (boolean) is required.' }, { status: 400 })
  }
  if (disabled && id === admin.id) {
    return NextResponse.json({ error: 'You cannot disable your own account.' }, { status: 400 })
  }

  const { error } = await supabaseAdmin.auth.admin.updateUserById(id, {
    ban_duration: disabled ? INDEFINITE_BAN : 'none',
  })

  if (error) {
    return NextResponse.json({ error: 'Could not update this user.' }, { status: 500 })
  }

  return NextResponse.json({ disabled })
}
