// components/HeaderProfileButton.tsx
//
// Replaces the old hidden bottom-right "+" FAB (Profile / Dashboard /
// Invitations / Sign out) — a persistent header element next to the day/
// night toggle instead, both states driven by the same data-revealed flag
// app/page.tsx already uses for sky/card/dashboard transitions.
//
// Not revealed (no signed-in user yet): a small plain circle — the shared
// Avatar fallback (components/ProfilePanel.tsx) with no url/label, so it
// renders the generic silhouette rather than an email initial (there's no
// user to take an initial from pre-login).
//
// Revealed: the circle grows, and a reverse-trapezoid tab pops out to its
// left revealing the display name + office — same clip-path technique as
// the weather ribbon (components/BiliranMap.tsx's WeatherBadge), flush top
// edge with the diagonal tapering the far/outer (here, bottom-left)
// corner, for visual consistency between the two. The tab's right edge
// tucks behind the circle (negative margin + DOM order — the circle,
// painted after, covers the seam), so only the tapered left edge is ever
// actually visible.
//
// Rendered as a flex sibling of the theme toggle in one shared
// right-anchored row (see app/page.tsx) — the toggle "drifts left" for
// free as this button's own width grows via CSS transition (flexbox
// reflow), no manual position math needed for that part of the sequence.

'use client'

import { Avatar } from '@/components/ProfilePanel'

export default function HeaderProfileButton({
  revealed,
  avatarUrl,
  displayName,
  office,
  onClick,
}: {
  revealed: boolean
  avatarUrl: string | null
  displayName: string | null
  office: string | null
  onClick: () => void
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-label={revealed ? 'Open profile' : 'Sign in first'}
      disabled={!revealed}
      data-revealed={revealed}
      className="bfw-header-profile flex items-center disabled:cursor-default"
    >
      <style>{`
        .bfw-header-profile-tab {
          max-width: 0;
          opacity: 0;
          overflow: hidden;
          white-space: nowrap;
          margin-right: -14px;
          padding: 8px 22px 8px 12px;
          clip-path: polygon(0 0, 100% 0, 100% 100%, 10px 100%);
          background: var(--card-bg);
          border: 1px solid var(--card-border);
          transition: max-width 0.4s cubic-bezier(0.22,1,0.36,1), opacity 0.25s ease;
        }
        .bfw-header-profile[data-revealed='true'] .bfw-header-profile-tab {
          max-width: 180px;
          opacity: 1;
          transition-delay: 0.15s, 0.2s;
        }
        .bfw-header-profile-avatar {
          width: 32px;
          height: 32px;
          transition: width 0.35s cubic-bezier(0.22,1,0.36,1), height 0.35s cubic-bezier(0.22,1,0.36,1);
        }
        .bfw-header-profile[data-revealed='true'] .bfw-header-profile-avatar {
          width: 44px;
          height: 44px;
        }
        @media (prefers-reduced-motion: reduce) {
          .bfw-header-profile-tab, .bfw-header-profile-avatar { transition: none !important; }
        }
      `}</style>

      <span className="bfw-header-profile-tab text-left">
        <span className="block truncate text-xs font-semibold leading-tight" style={{ color: 'var(--text-strong)' }}>
          {displayName ?? 'Profile'}
        </span>
        {office && (
          <span className="block truncate text-[10px] leading-tight" style={{ color: 'var(--text-soft)' }}>
            {office}
          </span>
        )}
      </span>

      <span
        className="bfw-header-profile-avatar relative shrink-0 overflow-hidden rounded-full border-2 shadow-lg backdrop-blur-md"
        style={{ borderColor: 'var(--card-border)', background: 'var(--card-bg)' }}
      >
        <Avatar url={avatarUrl} sizeClassName="h-full w-full" />
      </span>
    </button>
  )
}
