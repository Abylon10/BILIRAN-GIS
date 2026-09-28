// lib/opaqueTheme.ts
//
// This app's --card-bg/--header-bg/--body-bg CSS variables are all
// deliberately translucent (paired with backdrop-blur, meant to tint
// over the always-present map scene behind every other panel) — fine
// for a small card, but a full-screen takeover needs a genuinely opaque
// background or the persistent map/dashboard underneath bleeds through
// as visible ghosting (found and fixed once for UserDashboardModal.tsx,
// needed again for AdminInvitePanel.tsx). Same RGB channels as
// --card-bg, just alpha 1 — keyed directly by the theme prop rather than
// a CSS variable, same reasoning as MunicipalityFilterDropdown's own
// DAY_COLORS/NIGHT_COLORS, so this never depends on what's rendered
// behind it.

export const DAY_BG = '#E7F1F5'
export const NIGHT_BG = '#031716'

export function opaqueBg(theme: 'light' | 'dark'): string {
  return theme === 'dark' ? NIGHT_BG : DAY_BG
}
