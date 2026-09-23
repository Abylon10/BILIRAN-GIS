// components/MunicipalityFilterDropdown.tsx
//
// Replaces the old native <select> for the municipality filter. The native
// select's *open* option-list popup is rendered by the OS, not this page —
// it can't take the app's own styling at all (gradient, rounded rows,
// selected-row highlight); an earlier round could only patch its text/
// background contrast after every option rendered invisible (white text on
// the popup's own white background), not give it real design. This is a
// fully custom dropdown instead: the closed trigger keeps the same
// .bfw-btn treatment the select used, but the open panel's rows are styled
// exactly like BarangayList's rows (rounded-lg border, amber selected-row
// highlight), so picking a municipality here reads as the same design
// language as picking one from the barangay list below it.
//
// The open panel is portaled to document.body (see below), which sits
// OUTSIDE .bfw-root's [data-theme='light'/'dark'] selectors in
// app/page.tsx that actually define --card-bg/--card-border/--text-strong
// — those custom properties don't inherit across that boundary, so a
// portaled element referencing var(--card-bg) gets an invalid value, not
// the light/dark tint. Confirmed as the root cause of a reported bug:
// panel background fell back to transparent and text to the browser's
// default black in both themes, which read as "hard to read" over the
// light day scene and "not there at all" over the dark night one. Fixed
// by taking an explicit `theme` prop (threaded down from app/page.tsx's
// own theme state, via DashboardShell) and using hardcoded solid colors
// per theme instead of CSS variables — solid, not the app's usual
// translucent --card-bg, so contrast never depends on what's rendered
// behind the portal.

'use client'

import { useEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { MONITORED_MUNICIPALITIES } from '@/lib/municipalities'

const ALL_LABEL = 'All municipalities'

const DAY_COLORS = { bg: '#FFFFFF', border: 'rgba(107, 163, 190, 0.5)', text: '#031716' }
const NIGHT_COLORS = { bg: '#032F30', border: 'rgba(107, 163, 190, 0.35)', text: '#85B7CE' }

export default function MunicipalityFilterDropdown({
  value,
  onChange,
  theme,
}: {
  value: string | null
  onChange: (name: string | null) => void
  theme: 'light' | 'dark'
}) {
  const colors = theme === 'dark' ? NIGHT_COLORS : DAY_COLORS
  const [open, setOpen] = useState(false)
  // Where to portal the open panel — computed from the trigger's own
  // rect, not CSS `absolute` positioning. .bfw-dash (this component's
  // normal DOM position) is a stacking context pinned at z-index 10,
  // deliberately kept BELOW the persistent map's z-index 15 (see
  // .bfw-map-shell's comment in app/page.tsx) so the map's own
  // transparent map-slot spacer inside .bfw-dash doesn't swallow clicks
  // meant for it. That means nothing inside .bfw-dash can out-z-index the
  // map no matter what z-index it's given locally — confirmed via
  // Playwright, the map's <svg> was intercepting clicks meant for this
  // panel's options. Portaling to document.body with `position: fixed`
  // escapes that stacking context entirely.
  const [panelRect, setPanelRect] = useState<{ top: number; left: number; width: number } | null>(null)
  const rootRef = useRef<HTMLDivElement>(null)
  const triggerRef = useRef<HTMLButtonElement>(null)
  const panelRef = useRef<HTMLUListElement>(null)

  useEffect(() => {
    if (!open) return
    function handlePointerDown(e: PointerEvent) {
      const target = e.target as Node
      if (rootRef.current?.contains(target)) return
      if (panelRef.current?.contains(target)) return
      setOpen(false)
    }
    function handleKeyDown(e: KeyboardEvent) {
      if (e.key === 'Escape') setOpen(false)
    }
    function handleReposition() {
      setOpen(false)
    }
    document.addEventListener('pointerdown', handlePointerDown)
    document.addEventListener('keydown', handleKeyDown)
    window.addEventListener('resize', handleReposition)
    window.addEventListener('scroll', handleReposition, true)
    return () => {
      document.removeEventListener('pointerdown', handlePointerDown)
      document.removeEventListener('keydown', handleKeyDown)
      window.removeEventListener('resize', handleReposition)
      window.removeEventListener('scroll', handleReposition, true)
    }
  }, [open])

  function toggleOpen() {
    if (!open) {
      const rect = triggerRef.current?.getBoundingClientRect()
      if (rect) setPanelRect({ top: rect.bottom + 8, left: rect.left, width: Math.max(rect.width, 224) })
    }
    setOpen((o) => !o)
  }

  function select(name: string | null) {
    onChange(name)
    setOpen(false)
  }

  return (
    <div ref={rootRef} className="relative">
      <button
        ref={triggerRef}
        type="button"
        onClick={toggleOpen}
        aria-haspopup="listbox"
        aria-expanded={open}
        className="bfw-btn flex items-center gap-2 rounded-full px-3 py-2 text-sm"
      >
        {value ?? ALL_LABEL}
        <svg
          viewBox="0 0 20 20"
          className={`h-3.5 w-3.5 shrink-0 transition-transform ${open ? 'rotate-180' : ''}`}
          aria-hidden
        >
          <path
            d="M5.5 7.5L10 12l4.5-4.5"
            stroke="currentColor"
            strokeWidth="1.5"
            fill="none"
            strokeLinecap="round"
            strokeLinejoin="round"
          />
        </svg>
      </button>

      {open &&
        panelRect &&
        typeof document !== 'undefined' &&
        createPortal(
          <ul
            ref={panelRef}
            role="listbox"
            // No max-height/scroll — MONITORED_MUNICIPALITIES is a small,
            // fixed, curated list (7 municipalities + "All", confirmed
            // against lib/municipalities.ts), so the whole panel is sized
            // to always show every option at once rather than requiring a
            // scroll to see the rest of them (the reported problem with
            // the native <select> this replaced, and still a problem even
            // in this custom version at the original text-sm/py-2 sizing).
            className="fixed z-[1000] flex flex-col gap-1 rounded-xl border p-2 shadow-2xl"
            style={{
              top: panelRect.top,
              left: panelRect.left,
              width: panelRect.width,
              background: colors.bg,
              borderColor: colors.border,
            }}
          >
            <MunicipalityOption label={ALL_LABEL} selected={value === null} onClick={() => select(null)} colors={colors} />
            {MONITORED_MUNICIPALITIES.map((m) => (
              <MunicipalityOption key={m} label={m} selected={value === m} onClick={() => select(m)} colors={colors} />
            ))}
          </ul>,
          document.body
        )}
    </div>
  )
}

function MunicipalityOption({
  label,
  selected,
  onClick,
  colors,
}: {
  label: string
  selected: boolean
  onClick: () => void
  colors: { bg: string; border: string; text: string }
}) {
  return (
    <li role="option" aria-selected={selected}>
      <button
        type="button"
        onClick={onClick}
        // Smaller than BarangayList's own rows (text-xs/py-1.5 here vs.
        // text-sm/py-2.5 there) specifically so all 8 options are visible
        // at once without scrolling — the border still gives each row a
        // clearly separate, readable box, just a more compact one.
        className="w-full rounded-lg border px-3 py-1.5 text-left text-xs transition-colors"
        style={{
          background: selected ? 'rgba(232, 163, 61, 0.28)' : colors.bg,
          borderColor: selected ? '#E8A33D' : colors.border,
          color: colors.text,
        }}
      >
        {label}
      </button>
    </li>
  )
}
