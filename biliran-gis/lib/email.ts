// lib/email.ts
//
// Sends the invitation-code email via Resend. This is the app's first
// self-sent transactional email — everything else (password reset) is
// Supabase's own built-in email, see CLAUDE.md's "Forgot password"
// section. Deliberately non-throwing: RESEND_API_KEY may be unset (e.g.
// this sandbox has no real key configured), and invitation creation/edit
// must still succeed even if email sending is unconfigured or the send
// itself fails — the code is still valid and the admin can always fall
// back to sharing it manually (see components/AdminInvitePanel.tsx).

import { Resend } from 'resend'

const apiKey = process.env.RESEND_API_KEY
const resend = apiKey ? new Resend(apiKey) : null

// Resend's shared sender needs no domain verification — fine for v1.
// Swap to a verified custom-domain address later via this env var alone,
// no code change needed.
const FROM_ADDRESS = process.env.RESEND_FROM_ADDRESS || 'Biliran Flood Watch <onboarding@resend.dev>'

function escapeHtml(s: string): string {
  return s.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!)
}

export async function sendInvitationEmail({
  to,
  name,
  office,
  code,
  activateUrl,
}: {
  to: string
  name: string | null
  office: string
  code: string
  activateUrl: string
}): Promise<{ ok: true } | { ok: false; error: string }> {
  if (!resend) {
    return { ok: false, error: 'Email sending is not configured (RESEND_API_KEY is unset).' }
  }

  const greeting = name ? `Hi ${name},` : 'Hello,'
  const subject = 'Your Biliran Flood Watch invitation'

  const text = `${greeting}

You've been invited to Biliran Flood Watch as ${office}.

Your invitation code: ${code}

Activate your account: ${activateUrl}

This code is single-use and tied to this email address. If you weren't expecting this, you can ignore this message.`

  const html = `<p>${escapeHtml(greeting)}</p>
<p>You've been invited to Biliran Flood Watch as <strong>${escapeHtml(office)}</strong>.</p>
<p>Your invitation code: <strong style="font-family:monospace;font-size:1.1em">${escapeHtml(code)}</strong></p>
<p><a href="${activateUrl}">Activate your account</a></p>
<p style="color:#666;font-size:0.85em">This code is single-use and tied to this email address. If you weren't expecting this, you can ignore this message.</p>`

  try {
    const { error } = await resend.emails.send({ from: FROM_ADDRESS, to, subject, text, html })
    if (error) return { ok: false, error: error.message ?? 'Resend returned an error.' }
    return { ok: true }
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : 'Unknown error sending email.' }
  }
}
