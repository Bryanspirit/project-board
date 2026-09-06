import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react'
import type { KeyboardEvent, ReactNode } from 'react'
import type { Profile } from '../../lib/types'
import { PRIORITIES } from '../../lib/types'
import type { FiltersApi } from '../../hooks/useFilters'
import { DUE_OPTIONS, UNASSIGNED } from '../../hooks/useFilters'
import { Button, Input, cx } from '../ui'

export type FilterBarProps = FiltersApi & { people: Profile[] }

function displayName(p: Profile): string {
  return p.full_name?.trim() || p.email
}

function initial(p: Profile): string {
  return displayName(p).slice(0, 1).toUpperCase()
}

const CHIP_BASE =
  'inline-flex shrink-0 items-center gap-1.5 rounded-lg px-2.5 py-1.5 text-xs font-medium ring-1 transition ' +
  'focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-indigo-600'

const CHIP_ON =
  'bg-indigo-50 text-indigo-700 ring-indigo-300 hover:bg-indigo-100 ' +
  'dark:bg-indigo-950/60 dark:text-indigo-300 dark:ring-indigo-800 dark:hover:bg-indigo-900/60'

const CHIP_OFF =
  'bg-white text-slate-600 ring-slate-300 hover:bg-slate-100 ' +
  'dark:bg-slate-900 dark:text-slate-300 dark:ring-slate-700 dark:hover:bg-slate-800'

function Count({ n }: { n: number }) {
  if (n === 0) return null
  return (
    <span className="rounded-full bg-indigo-600 px-1.5 text-[10px] leading-4 font-semibold tabular-nums text-white">
      {n}
    </span>
  )
}

function Caret() {
  return (
    <svg viewBox="0 0 16 16" className="h-3 w-3 opacity-60" fill="none" stroke="currentColor" strokeWidth="1.75" aria-hidden>
      <path d="M4 6l4 4 4-4" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  )
}

/**
 * A chip that opens a panel. Closes on Escape (handing focus back to the chip),
 * on a click outside, and when focus leaves the panel entirely — so tabbing past
 * it behaves like any other menu. Arrow keys walk the rows inside.
 */
function Popover({ label, count, children }: { label: string; count: number; children: ReactNode }) {
  const [open, setOpen] = useState(false)
  const [alignRight, setAlignRight] = useState(false)
  const wrap = useRef<HTMLDivElement>(null)
  const trigger = useRef<HTMLButtonElement>(null)
  const panel = useRef<HTMLDivElement>(null)

  const close = useCallback((refocus: boolean) => {
    setOpen(false)
    if (refocus) trigger.current?.focus()
  }, [])

  // A chip sitting in the right half of a narrow screen has to hang its panel
  // off the right edge, or the panel runs past the viewport and clips.
  useLayoutEffect(() => {
    if (!open) return
    const rect = trigger.current?.getBoundingClientRect()
    if (rect) setAlignRight(rect.left + rect.width / 2 > window.innerWidth / 2)
    panel.current?.querySelector<HTMLElement>('[data-pop-item]')?.focus()
  }, [open])

  useEffect(() => {
    if (!open) return
    const onDown = (e: MouseEvent) => {
      if (!wrap.current?.contains(e.target as Node)) setOpen(false)
    }
    document.addEventListener('mousedown', onDown)
    return () => document.removeEventListener('mousedown', onDown)
  }, [open])

  const onPanelKeyDown = (e: KeyboardEvent<HTMLDivElement>) => {
    if (e.key === 'Escape') { e.stopPropagation(); close(true); return }
    if (e.key !== 'ArrowDown' && e.key !== 'ArrowUp') return
    const items = Array.from(panel.current?.querySelectorAll<HTMLElement>('[data-pop-item]') ?? [])
    if (items.length === 0) return
    e.preventDefault()
    const here = items.indexOf(document.activeElement as HTMLElement)
    const step = e.key === 'ArrowDown' ? 1 : -1
    items[(here + step + items.length) % items.length]?.focus()
  }

  return (
    <div className="relative" ref={wrap}>
      <button
        ref={trigger}
        type="button"
        aria-expanded={open}
        aria-haspopup="true"
        onClick={() => setOpen(o => !o)}
        onKeyDown={e => { if (e.key === 'Escape' && open) close(true) }}
        className={cx(CHIP_BASE, count > 0 ? CHIP_ON : CHIP_OFF)}
      >
        {label}
        <Count n={count} />
        <Caret />
      </button>

      {open && (
        <div
          ref={panel}
          role="group"
          aria-label={label}
          onKeyDown={onPanelKeyDown}
          onBlur={e => {
            const next = e.relatedTarget as Node | null
            if (next && !wrap.current?.contains(next)) setOpen(false)
          }}
          className={cx(
            'absolute top-full z-40 mt-2 w-60 max-w-[calc(100vw-1.5rem)] rounded-xl bg-white p-1.5 shadow-lg',
            'max-h-[min(60vh,20rem)] overflow-y-auto overscroll-contain ring-1 ring-slate-200',
            'dark:bg-slate-900 dark:ring-slate-700',
            alignRight ? 'right-0' : 'left-0',
          )}
        >
          {children}
        </div>
      )}
    </div>
  )
}

function CheckRow({ checked, onSelect, children }: {
  checked: boolean
  onSelect: () => void
  children: ReactNode
}) {
  return (
    <button
      type="button"
      data-pop-item
      role="menuitemcheckbox"
      aria-checked={checked}
      onClick={onSelect}
      className={cx(
        'flex w-full items-center gap-2 rounded-lg px-2 py-1.5 text-left text-xs transition',
        'hover:bg-slate-100 focus:bg-slate-100 focus:outline-none dark:hover:bg-slate-800 dark:focus:bg-slate-800',
      )}
    >
      <span
        aria-hidden
        className={cx(
          'flex h-4 w-4 shrink-0 items-center justify-center rounded ring-1 transition',
          checked
            ? 'bg-indigo-600 text-white ring-indigo-600'
            : 'bg-white text-transparent ring-slate-300 dark:bg-slate-900 dark:ring-slate-600',
        )}
      >
        <svg viewBox="0 0 16 16" className="h-3 w-3" fill="none" stroke="currentColor" strokeWidth="2.5">
          <path d="M3.5 8.5l3 3 6-6.5" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
      </span>
      {children}
    </button>
  )
}

/**
 * The board's filter bar: free text plus one chip per dimension. Everything
 * wraps, so on a phone the chips stack into rows instead of scrolling out of
 * reach, and each panel is capped to the viewport.
 */
export default function FilterBar(props: FilterBarProps) {
  const { filters, setFilter, toggle, reset, activeCount, people } = props

  const dueLabel = DUE_OPTIONS.find(d => d.id === filters.due)?.label ?? 'Any time'

  return (
    <div className="flex flex-wrap items-center gap-2">
      <div className="relative min-w-40 flex-1 sm:max-w-64">
        <svg
          viewBox="0 0 16 16"
          className="pointer-events-none absolute top-1/2 left-2.5 h-3.5 w-3.5 -translate-y-1/2 text-slate-400"
          fill="none" stroke="currentColor" strokeWidth="1.75" aria-hidden
        >
          <circle cx="7" cy="7" r="4.5" />
          <path d="M10.5 10.5L14 14" strokeLinecap="round" />
        </svg>
        <Input
          type="search"
          value={filters.text}
          onChange={e => setFilter('text', e.target.value)}
          placeholder="Search tasks…"
          aria-label="Search tasks"
          className="w-full py-1.5 pl-8 text-xs"
        />
      </div>

      <Popover label="Assignee" count={filters.assignees.length}>
        <CheckRow
          checked={filters.assignees.includes(UNASSIGNED)}
          onSelect={() => toggle('assignees', UNASSIGNED)}
        >
          <span
            aria-hidden
            className="flex h-5 w-5 shrink-0 items-center justify-center rounded-full text-[10px] font-semibold text-slate-500 ring-1 ring-dashed ring-slate-300 dark:text-slate-400 dark:ring-slate-600"
          >
            ?
          </span>
          <span className="truncate">Unassigned</span>
        </CheckRow>

        {people.length > 0 && <div className="my-1 h-px bg-slate-200 dark:bg-slate-800" />}

        {people.map(p => (
          <CheckRow
            key={p.id}
            checked={filters.assignees.includes(p.id)}
            onSelect={() => toggle('assignees', p.id)}
          >
            <span
              aria-hidden
              className="flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-indigo-600 text-[10px] font-semibold text-white"
            >
              {initial(p)}
            </span>
            <span className="truncate">{displayName(p)}</span>
          </CheckRow>
        ))}

        {people.length === 0 && (
          <p className="px-2 py-1.5 text-xs text-slate-400">Nobody else is in this workspace yet.</p>
        )}
      </Popover>

      <Popover label="Priority" count={filters.priorities.length}>
        {PRIORITIES.map(p => (
          <CheckRow
            key={p.id}
            checked={filters.priorities.includes(p.id)}
            onSelect={() => toggle('priorities', p.id)}
          >
            <span className={cx('rounded-md px-1.5 py-0.5 text-[10px] font-medium ring-1 ring-inset', p.chip)}>
              {p.label}
            </span>
          </CheckRow>
        ))}
      </Popover>

      <Popover label={filters.due === 'any' ? 'Due' : dueLabel} count={filters.due === 'any' ? 0 : 1}>
        <div role="radiogroup" aria-label="Due" className="flex flex-col gap-0.5">
          {DUE_OPTIONS.map(o => {
            const on = filters.due === o.id
            return (
              <button
                key={o.id}
                type="button"
                data-pop-item
                role="radio"
                aria-checked={on}
                onClick={() => setFilter('due', o.id)}
                className={cx(
                  'rounded-lg px-2 py-1.5 text-left text-xs transition focus:outline-none',
                  on
                    ? 'bg-indigo-600 font-medium text-white'
                    : 'text-slate-600 hover:bg-slate-100 focus:bg-slate-100 dark:text-slate-300 dark:hover:bg-slate-800 dark:focus:bg-slate-800',
                )}
              >
                {o.label}
              </button>
            )
          })}
        </div>
      </Popover>

      <button
        type="button"
        aria-pressed={filters.blockedOnly}
        onClick={() => setFilter('blockedOnly', !filters.blockedOnly)}
        className={cx(CHIP_BASE, filters.blockedOnly ? CHIP_ON : CHIP_OFF)}
      >
        <span
          aria-hidden
          className={cx('h-1.5 w-1.5 rounded-full', filters.blockedOnly ? 'bg-rose-500' : 'bg-slate-400')}
        />
        Blocked only
      </button>

      <button
        type="button"
        aria-pressed={filters.hideDone}
        onClick={() => setFilter('hideDone', !filters.hideDone)}
        className={cx(CHIP_BASE, filters.hideDone ? CHIP_ON : CHIP_OFF)}
      >
        Hide done
      </button>

      {activeCount > 0 && (
        <Button variant="ghost" size="sm" onClick={reset} className="text-xs">
          Clear
          <span className="tabular-nums opacity-70">({activeCount})</span>
        </Button>
      )}
    </div>
  )
}
