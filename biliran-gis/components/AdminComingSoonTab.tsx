// components/AdminComingSoonTab.tsx
//
// Shared placeholder for admin sidebar nav entries with no real data or
// feature behind them yet (Reports, Activity Logs, Settings — see
// AdminShell.tsx). Kept visible in the nav rather than hidden entirely
// (a deliberate choice this round), but never fakes content: no invented
// report rows, no fabricated log entries, no editable settings that
// don't actually do anything. Each of these needs its own real,
// separately-scoped feature (a real audit table + logging on every admin
// action for Activity Logs; a defined export/report format for Reports;
// real configurable values for Settings) before it can show anything
// else here — see CLAUDE.md's open items.

export default function AdminComingSoonTab({
  title,
  description,
}: {
  title: string
  description: string
}) {
  return (
    <div className="flex flex-col items-center justify-center gap-2 rounded-lg border py-16 text-center" style={{ borderColor: 'var(--card-border)' }}>
      <h3 className="text-base font-semibold" style={{ color: 'var(--text-strong)' }}>
        {title}
      </h3>
      <p className="max-w-sm text-sm" style={{ color: 'var(--text-soft)' }}>
        {description}
      </p>
      <p className="text-xs" style={{ color: 'var(--text-soft)', opacity: 0.75 }}>
        Not built yet — no real data or feature exists behind this section.
      </p>
    </div>
  )
}
