import { useCallback, useEffect, useId, useMemo, useRef, useState } from 'react'
import type { KeyboardEvent as ReactKeyboardEvent } from 'react'
import type { Project, Task, Team } from '../../lib/types'
import { Button, Input, cx } from '../ui'

export function projectProgress(tasks: Task[]): number {
  if (tasks.length === 0) return 0
  return Math.round((tasks.filter(t => t.status === 'done').length / tasks.length) * 100)
}

/** From this many projects on, the inline strip stops fitting a laptop header
 *  and starts crowding the search box — swap it for the switcher. */
export const SWITCHER_THRESHOLD = 6

interface Row {
  project: Project
  total: number
  blocked: number
  percent: number
  team: string | null
}

/**
 * A one-button replacement for the horizontal project strip: the current project
 * in, a searchable list of every project out. Filtering keeps focus on the search
 * field and announces the highlighted row through `aria-activedescendant`, so the
 * whole control is drivable from the keyboard without ever losing the query.
 */
export default function ProjectSwitcher({
  projects, byProject, activeProjectId, onSelect, onNewProject,
  teams, open: openProp, onOpenChange, className,
}: {
  projects: Project[]
  byProject: Map<string, Task[]>
  activeProjectId: string | null
  onSelect: (id: string) => void
  onNewProject: () => void
  teams?: Team[]
  /** Controlled open state. Left out, the switcher manages its own. */
  open?: boolean
  onOpenChange?: (open: boolean) => void
  className?: string
}) {
  const [selfOpen, setSelfOpen] = useState(false)
  const open = openProp ?? selfOpen

  const [query, setQuery] = useState('')
  const [index, setIndex] = useState(0)

  const rootRef = useRef<HTMLDivElement>(null)
  const triggerRef = useRef<HTMLButtonElement>(null)
  const listRef = useRef<HTMLUListElement>(null)
  const searchBoxRef = useRef<HTMLDivElement>(null)
  const listId = useId()

  const setOpen = useCallback((next: boolean) => {
    if (openProp === undefined) setSelfOpen(next)
    onOpenChange?.(next)
  }, [openProp, onOpenChange])

  const close = useCallback((restoreFocus = true) => {
    setOpen(false)
    if (restoreFocus) triggerRef.current?.focus()
  }, [setOpen])

  const rows = useMemo<Row[]>(() => projects.map(project => {
    const tasks = byProject.get(project.id) ?? []
    return {
      project,
      total: tasks.length,
      blocked: tasks.filter(t => t.status === 'blocked').length,
      percent: projectProgress(tasks),
      team: teams?.find(t => t.id === project.team_id)?.name ?? null,
    }
  }), [projects, byProject, teams])

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase()
    if (!q) return rows
    return rows.filter(r =>
      r.project.name.toLowerCase().includes(q) ||
      (r.team ?? '').toLowerCase().includes(q))
  }, [rows, query])

  const active = rows.find(r => r.project.id === activeProjectId) ?? null

  // Opening starts clean, on the project currently being viewed. The list is read
  // through a ref so a background refresh cannot wipe a half-typed query.
  const latest = useRef({ projects, activeProjectId })
  latest.current = { projects, activeProjectId }

  useEffect(() => {
    if (!open) return
    const { projects: list, activeProjectId: current } = latest.current
    setQuery('')
    setIndex(Math.max(0, list.findIndex(p => p.id === current)))
    searchBoxRef.current?.querySelector('input')?.focus()
  }, [open])

  // Typing shrinks the list under the cursor; keep it on a real row.
  useEffect(() => {
    setIndex(i => (i > filtered.length - 1 ? Math.max(0, filtered.length - 1) : i))
  }, [filtered.length])

  useEffect(() => {
    if (!open) return
    listRef.current
      ?.querySelector<HTMLElement>('[data-index="' + index + '"]')
      ?.scrollIntoView({ block: 'nearest' })
  }, [open, index, filtered.length])

  useEffect(() => {
    if (!open) return
    function onPointerDown(e: MouseEvent) {
      if (!rootRef.current?.contains(e.target as Node)) setOpen(false)
    }
    document.addEventListener('mousedown', onPointerDown)
    return () => document.removeEventListener('mousedown', onPointerDown)
  }, [open, setOpen])

  function choose(row: Row | undefined) {
    if (!row) return
    onSelect(row.project.id)
    close()
  }

  function onKeyDown(e: ReactKeyboardEvent<HTMLInputElement>) {
    switch (e.key) {
      case 'ArrowDown':
        e.preventDefault()
        setIndex(i => (filtered.length === 0 ? 0 : (i + 1) % filtered.length))
        break
      case 'ArrowUp':
        e.preventDefault()
        setIndex(i => (filtered.length === 0 ? 0 : (i - 1 + filtered.length) % filtered.length))
        break
      case 'Home':
        e.preventDefault()
        setIndex(0)
        break
      case 'End':
        e.preventDefault()
        setIndex(Math.max(0, filtered.length - 1))
        break
      case 'Enter':
        e.preventDefault()
        choose(filtered[index])
        break
      case 'Escape':
        e.preventDefault()
        e.stopPropagation()
        close()
        break
      case 'Tab':
        setOpen(false)
        break
      default:
        break
    }
  }

  const optionId = (i: number) => listId + '-opt-' + i

  return (
    <div ref={rootRef} className={cx('relative', className)}>
      <button
        ref={triggerRef}
        type="button"
        onClick={() => (open ? close(false) : setOpen(true))}
        aria-expanded={open}
        aria-haspopup="listbox"
        aria-label={active ? 'Project: ' + active.project.name + '. Switch project' : 'Choose a project'}
        className={cx(
          'flex max-w-64 min-w-0 items-center gap-2 rounded-lg px-2.5 py-1.5 text-sm transition',
          'ring-1 ring-slate-300 hover:bg-slate-100 dark:ring-slate-700 dark:hover:bg-slate-800',
          'focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-indigo-600',
          open && 'bg-slate-100 dark:bg-slate-800',
        )}
      >
        <span
          className="h-2 w-2 shrink-0 rounded-full"
          style={{ backgroundColor: active?.project.color ?? '#94a3b8' }}
          aria-hidden
        />
        <span className="truncate font-medium">{active?.project.name ?? 'Select a project'}</span>
        {active && (
          <span className="shrink-0 text-[10px] tabular-nums text-slate-400">{active.percent}%</span>
        )}
        <svg viewBox="0 0 16 16" className="h-3.5 w-3.5 shrink-0 text-slate-400" fill="none"
          stroke="currentColor" strokeWidth="2" aria-hidden>
          <path d="m4 6 4 4 4-4" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
      </button>

      {open && (
        <div className={cx(
          'absolute top-full left-0 z-40 mt-1.5 w-80 overflow-hidden rounded-xl bg-white shadow-xl',
          'ring-1 ring-slate-200 dark:bg-slate-900 dark:ring-slate-800',
        )}>
          <div ref={searchBoxRef} className="border-b border-slate-200 p-2 dark:border-slate-800">
            <Input
              value={query}
              onChange={e => { setQuery(e.target.value); setIndex(0) }}
              onKeyDown={onKeyDown}
              placeholder="Find a project"
              aria-label="Find a project"
              role="combobox"
              aria-expanded
              aria-controls={listId}
              aria-autocomplete="list"
              aria-activedescendant={filtered.length > 0 ? optionId(index) : undefined}
              className="py-1.5 text-sm"
            />
          </div>

          <ul
            ref={listRef}
            id={listId}
            role="listbox"
            aria-label="Projects"
            className="max-h-72 overflow-y-auto p-1"
          >
            {filtered.map((row, i) => {
              const selected = row.project.id === activeProjectId
              return (
                <li
                  key={row.project.id}
                  id={optionId(i)}
                  role="option"
                  data-index={i}
                  aria-selected={i === index}
                  aria-current={selected ? true : undefined}
                  onMouseEnter={() => setIndex(i)}
                  onClick={() => choose(row)}
                  className={cx(
                    'cursor-pointer rounded-lg px-2.5 py-2 transition-colors',
                    i === index && 'bg-slate-100 dark:bg-slate-800',
                    selected && 'ring-1 ring-indigo-300 dark:ring-indigo-800',
                  )}
                >
                  <div className="flex items-center gap-2">
                    <span className="h-2 w-2 shrink-0 rounded-full"
                      style={{ backgroundColor: row.project.color }} aria-hidden />
                    <span className={cx('min-w-0 flex-1 truncate text-sm',
                      selected ? 'font-semibold' : 'font-medium')}>
                      {row.project.name}
                    </span>
                    {row.blocked > 0 && (
                      <span title={row.blocked + ' blocked'}
                        className="shrink-0 rounded-full bg-rose-100 px-1.5 text-[10px] font-semibold text-rose-700 dark:bg-rose-950 dark:text-rose-300">
                        {row.blocked}
                      </span>
                    )}
                    <span className="shrink-0 text-[10px] tabular-nums text-slate-400">{row.percent}%</span>
                  </div>

                  <div className="mt-1.5 flex items-center gap-2">
                    <span className="h-1 flex-1 overflow-hidden rounded-full bg-slate-200 dark:bg-slate-700" aria-hidden>
                      <span className="block h-full rounded-full bg-indigo-500"
                        style={{ width: row.percent + '%' }} />
                    </span>
                    <span className="shrink-0 text-[10px] text-slate-400">
                      {row.team ?? 'No team'} &middot; {row.total} {row.total === 1 ? 'task' : 'tasks'}
                    </span>
                  </div>
                </li>
              )
            })}

            {filtered.length === 0 && (
              <li className="px-2.5 py-6 text-center text-xs text-slate-400">
                No project matches that search.
              </li>
            )}
          </ul>

          <div className="border-t border-slate-200 p-2 dark:border-slate-800">
            <Button
              variant="ghost"
              size="sm"
              className="w-full justify-start"
              onClick={() => { close(false); onNewProject() }}
            >
              <svg viewBox="0 0 16 16" className="h-3.5 w-3.5" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden>
                <path d="M8 3v10M3 8h10" strokeLinecap="round" />
              </svg>
              New project
            </Button>
          </div>
        </div>
      )}
    </div>
  )
}
