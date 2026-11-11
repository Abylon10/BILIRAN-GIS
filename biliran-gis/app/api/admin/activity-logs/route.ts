// app/api/admin/activity-logs/route.ts
//
// Admin-only: the real, growing log behind both the "Reports" tab
// (components/AdminReportsTab.tsx, filters to action_type ===
// 'simulation_run' client-side) and the "Activity Logs" tab
// (components/AdminActivityLogTab.tsx, shows every row) — one table,
// two views, see supabase/activity-logs-setup.sql's own header comment
// for why. Today only SimulationModePanel.tsx writes here (every real
// "Start simulation" run and every tap-to-simulate), via lib/activityLog.ts.

import { NextRequest, NextResponse } from 'next/server'
import { supabaseAdmin } from '@/lib/supabaseAdmin'
import { requireAdmin } from '@/lib/requireAdmin'

const VALID_ACTION_TYPES = ['simulation_run']

export async function GET(req: NextRequest) {
  const admin = await requireAdmin(req)
  if (!admin) {
    return NextResponse.json({ error: 'Admin access required.' }, { status: 403 })
  }

  const { data, error } = await supabaseAdmin
    .from('activity_logs')
    .select('id, actor_label, action_type, summary, details, created_at')
    .order('created_at', { ascending: false })
    .limit(200)

  if (error) {
    return NextResponse.json({ error: 'Could not load activity logs.' }, { status: 500 })
  }

  return NextResponse.json({ logs: data })
}

export async function POST(req: NextRequest) {
  const admin = await requireAdmin(req)
  if (!admin) {
    return NextResponse.json({ error: 'Admin access required.' }, { status: 403 })
  }

  const { actionType, summary, details } = await req.json()

  if (typeof actionType !== 'string' || !VALID_ACTION_TYPES.includes(actionType) || typeof summary !== 'string' || !summary) {
    return NextResponse.json({ error: 'actionType and summary are required.' }, { status: 400 })
  }

  // Denormalized at write time (see supabase/activity-logs-setup.sql's own
  // comment on actor_label) — a best-effort label, not required for the
  // insert to succeed, since a profile row existing for every admin isn't
  // guaranteed to hold here any more strictly than it is elsewhere in this
  // app.
  const { data: profile } = await supabaseAdmin
    .from('user_profiles')
    .select('office, title, first_name, family_name')
    .eq('user_id', admin.id)
    .maybeSingle()

  const name = profile ? [profile.title, profile.first_name, profile.family_name].filter(Boolean).join(' ') : ''
  const actorLabel = [name || admin.email, profile?.office].filter(Boolean).join(' — ') || admin.email || null

  const { error } = await supabaseAdmin.from('activity_logs').insert({
    actor_user_id: admin.id,
    actor_label: actorLabel,
    action_type: actionType,
    summary,
    details: details ?? {},
  })

  if (error) {
    return NextResponse.json({ error: 'Could not save this activity log entry.' }, { status: 500 })
  }

  return NextResponse.json({ created: true })
}
