// app/api/admin/invite/[id]/route.ts
//
// Admin-only: edit or revoke a single invitation code. Sibling to
// app/api/admin/invite/route.ts (create/list) — split out because these
// two operate on one row by id rather than the collection. Both refuse to
// touch a redeemed invitation: editing a used code's email/office after
// the fact would misrepresent what was actually redeemed, and revoking
// (deleting) one would erase real redemption history. An unredeemed code
// has no such history yet, so both are safe there.

import { NextRequest, NextResponse } from 'next/server'
import { supabaseAdmin } from '@/lib/supabaseAdmin'
import { requireAdmin } from '@/lib/requireAdmin'

async function loadUnredeemedInvite(id: number) {
  const { data, error } = await supabaseAdmin
    .from('invitation_codes')
    .select('id, redeemed')
    .eq('id', id)
    .single()

  if (error || !data) return { error: 'Invitation not found.' as const, status: 404 as const }
  if (data.redeemed) return { error: 'Cannot modify a redeemed invitation.' as const, status: 409 as const }
  return { error: null }
}

export async function PATCH(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const admin = await requireAdmin(req)
  if (!admin) {
    return NextResponse.json({ error: 'Admin access required.' }, { status: 403 })
  }

  const id = Number((await params).id)
  if (!Number.isInteger(id)) {
    return NextResponse.json({ error: 'Invalid invitation id.' }, { status: 400 })
  }

  const guard = await loadUnredeemedInvite(id)
  if (guard.error) {
    return NextResponse.json({ error: guard.error }, { status: guard.status })
  }

  const { email, office } = await req.json()
  if (!email || !office) {
    return NextResponse.json({ error: 'Email and office are required.' }, { status: 400 })
  }

  const { data, error } = await supabaseAdmin
    .from('invitation_codes')
    .update({ email, office })
    .eq('id', id)
    .select('id, code, email, office, expires_at')
    .single()

  if (error) {
    return NextResponse.json({ error: 'Could not update invitation.' }, { status: 500 })
  }

  return NextResponse.json({ invitation: data })
}

export async function DELETE(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const admin = await requireAdmin(req)
  if (!admin) {
    return NextResponse.json({ error: 'Admin access required.' }, { status: 403 })
  }

  const id = Number((await params).id)
  if (!Number.isInteger(id)) {
    return NextResponse.json({ error: 'Invalid invitation id.' }, { status: 400 })
  }

  const guard = await loadUnredeemedInvite(id)
  if (guard.error) {
    return NextResponse.json({ error: guard.error }, { status: guard.status })
  }

  const { error } = await supabaseAdmin.from('invitation_codes').delete().eq('id', id)
  if (error) {
    return NextResponse.json({ error: 'Could not revoke invitation.' }, { status: 500 })
  }

  return NextResponse.json({ ok: true })
}
