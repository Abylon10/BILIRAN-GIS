// app/api/admin/fsi-snapshot/route.ts
//
// Admin-only: the real, growing "FSI Trend" history behind the admin
// Dashboard tab's chart (components/AdminDashboardTab.tsx). One row per
// calendar date in public.fsi_daily_snapshots (supabase/
// fsi-daily-snapshots-setup.sql) — starts empty, only ever grows from
// whenever that table is first created forward. Deliberately not a cron:
// the Dashboard tab itself POSTs today's snapshot once on mount (an
// idempotent upsert-if-missing, guarded by snapshot_date's own unique
// constraint), computed from whichever real data it already has loaded
// (the live-forecast island average when available, lib/liveIslandState.ts,
// falling back to the static pipeline average otherwise) — see this
// route's own POST handler for exactly which.

import { NextRequest, NextResponse } from 'next/server'
import { supabaseAdmin } from '@/lib/supabaseAdmin'
import { requireAdmin } from '@/lib/requireAdmin'

export async function GET(req: NextRequest) {
  const admin = await requireAdmin(req)
  if (!admin) {
    return NextResponse.json({ error: 'Admin access required.' }, { status: 403 })
  }

  const { data, error } = await supabaseAdmin
    .from('fsi_daily_snapshots')
    .select('snapshot_date, avg_fsi, high_risk_count, source')
    .order('snapshot_date', { ascending: true })
    .limit(30)

  if (error) {
    return NextResponse.json({ error: 'Could not load FSI history.' }, { status: 500 })
  }

  return NextResponse.json({ snapshots: data })
}

export async function POST(req: NextRequest) {
  const admin = await requireAdmin(req)
  if (!admin) {
    return NextResponse.json({ error: 'Admin access required.' }, { status: 403 })
  }

  const { avgFsi, highRiskCount, source } = await req.json()

  if (typeof avgFsi !== 'number' || typeof highRiskCount !== 'number' || (source !== 'live' && source !== 'static')) {
    return NextResponse.json({ error: 'avgFsi, highRiskCount, and source are required.' }, { status: 400 })
  }

  // Asia/Manila, matching this app's other date handling (app/api/weather/
  // route.ts requests Open-Meteo data in this timezone too) — "today" for
  // a snapshot means the same calendar day officials here actually see.
  const today = new Date().toLocaleDateString('en-CA', { timeZone: 'Asia/Manila' })

  // Upsert-if-missing, not an unconditional overwrite: once today's real
  // snapshot exists, later admin-dashboard visits the same day shouldn't
  // silently overwrite it with a possibly-different intraday value —
  // "one real number per day," not "whatever the last visit happened to
  // compute."
  const { data: existing } = await supabaseAdmin
    .from('fsi_daily_snapshots')
    .select('snapshot_date')
    .eq('snapshot_date', today)
    .maybeSingle()

  if (existing) {
    return NextResponse.json({ created: false })
  }

  const { error } = await supabaseAdmin.from('fsi_daily_snapshots').insert({
    snapshot_date: today,
    avg_fsi: avgFsi,
    high_risk_count: highRiskCount,
    source,
  })

  if (error) {
    return NextResponse.json({ error: 'Could not save today’s FSI snapshot.' }, { status: 500 })
  }

  return NextResponse.json({ created: true })
}
