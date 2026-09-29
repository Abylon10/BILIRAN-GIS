// components/LiveUpdateBanner.tsx
//
// The single highest-risk barangay (same ranking the list below it uses —
// sortBySeverity()'s continuous mean_fsi_score descending), paired with
// whichever of its own Alert/Danger crossings comes sooner
// (highestRiskCrossing() in lib/dashboardData.ts) — deliberately a
// risk-based question ("who's worst"), not the time-based "what happens
// soonest" mostUrgentCrossing() still answers for BiliranMap.tsx's own
// weather-icon selection (unaffected by this file).

import { formatHoursAsCountdown, highestRiskCrossing, type Barangay } from '@/lib/dashboardData'

export default function LiveUpdateBanner({
  barangays,
  onSelect,
}: {
  barangays: Barangay[]
  onSelect: (barangay: Barangay) => void
}) {
  const urgent = highestRiskCrossing(barangays)
  if (!urgent) return null

  return (
    <button
      type="button"
      onClick={() => onSelect(urgent.barangay)}
      className="w-full rounded-xl border px-4 py-3 text-left shadow-lg backdrop-blur-xl transition-transform hover:scale-[1.01]"
      style={{ background: 'var(--card-bg)', borderColor: 'var(--card-border)' }}
    >
      <span
        className="mr-2 rounded-full px-2 py-0.5 text-[10px] font-bold uppercase tracking-wide text-white"
        style={{ background: urgent.tier === 'Danger' ? '#C0392B' : '#E8A33D' }}
      >
        Modeled {urgent.tier}
      </span>
      <span className="text-sm font-semibold" style={{ color: 'var(--text-strong)' }}>
        {urgent.barangay.barangay} ({urgent.barangay.municipality})
      </span>{' '}
      <span className="text-sm" style={{ color: 'var(--text-soft)' }}>
        reaches {urgent.tier} at {formatHoursAsCountdown(urgent.hours)} into the modeled storm
        — see details →
      </span>
    </button>
  )
}
