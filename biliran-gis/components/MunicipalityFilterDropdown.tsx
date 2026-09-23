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

'use client'

import { useEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { MONITORED_MUNICIPALITIES } from '@/lib/municipalities'

const ALL_LABEL = 'All municipalities'

export default function MunicipalityFilterDropdown({
  value,
  onChange,
}: {
  value: string | null
  onChange: (name: string | null) => void
}) {
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
            className="fixed z-[1000] flex max-h-72 flex-col gap-1.5 overflow-y-auto rounded-xl border p-2 shadow-2xl backdrop-blur-xl"
            style={{
              top: panelRect.top,
              left: panelRect.left,
              width: panelRect.width,
              background: 'var(--card-bg)',
              borderColor: 'var(--card-border)',
            }}
          >
            <MunicipalityOption label={ALL_LABEL} selected={value === null} onClick={() => select(null)} />
            {MONITORED_MUNICIPALITIES.map((m) => (
              <MunicipalityOption key={m} label={m} selected={value === m} onClick={() => select(m)} />
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
}: {
  label: string
  selected: boolean
  onClick: () => void
}) {
  return (
    <li role="option" aria-selected={selected}>
      <button
        type="button"
        onClick={onClick}
        className="w-full rounded-lg border px-3 py-2 text-left text-sm transition-colors"
        style={{
          background: selected ? 'rgba(232, 163, 61, 0.28)' : 'var(--card-bg)',
          borderColor: selected ? '#E8A33D' : 'var(--card-border)',
          color: 'var(--text-strong)',
        }}
      >
        {label}
      </button>
    </li>
  )
}
