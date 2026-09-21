// lib/municipalities.ts
//
// Maps a barangay's `pgc_prefix` (from barangay_dashboard_data.json) to its
// municipality. Derived from the PSGC numbering convention for Biliran
// province (080701-080708, alphabetical by municipality) and cross-checked
// against the dashboard data: it contains exactly 7 prefixes, and the one
// missing — 807807 — is Maripipi, which matches this project's documented
// exclusion of Maripipi from monitoring. Verify against an authoritative
// PSGC source before relying on this for anything beyond the UI.

export const MUNICIPALITY_BY_PREFIX: Record<string, string> = {
  '807801': 'Almeria',
  '807802': 'Biliran',
  '807803': 'Cabucgayan',
  '807804': 'Caibiran',
  '807805': 'Culaba',
  '807806': 'Kawayan',
  '807808': 'Naval',
}

export const MONITORED_MUNICIPALITIES = Object.values(MUNICIPALITY_BY_PREFIX).sort()

export function municipalityForPrefix(pgcPrefix: string): string {
  return MUNICIPALITY_BY_PREFIX[pgcPrefix] ?? 'Unknown'
}
