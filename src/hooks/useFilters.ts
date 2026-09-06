import { useCallback, useEffect, useMemo, useState } from 'react'
import type { Task, TaskPriority } from '../lib/types'
import { daysUntil } from '../lib/dates'

/** Stands in for "nobody owns this" inside `filters.assignees`. A real user id
 *  is a uuid, so this can never collide with one. */
export const UNASSIGNED = '__unassigned__'

export type DueFilter = 'any' | 'overdue' | 'today' | 'week' | 'none'

export const DUE_OPTIONS: { id: DueFilter; label: string }[] = [
  { id: 'any',     label: 'Any time' },
  { id: 'overdue', label: 'Overdue' },
  { id: 'today',   label: 'Today' },
  { id: 'week',    label: 'Next 7 days' },
  { id: 'none',    label: 'No due date' },
]

export interface FilterState {
  /** User ids, plus `UNASSIGNED` for tasks nobody owns. Empty means "everyone". */
  assignees: string[]
  priorities: TaskPriority[]
  due: DueFilter
  blockedOnly: boolean
  hideDone: boolean
  text: string
}

/** The two multi-select filters — the only keys `toggle` accepts. */
export type ArrayFilterKey = 'assignees' | 'priorities'

export const EMPTY_FILTERS: FilterState = {
  assignees: [],
  priorities: [],
  due: 'any',
  blockedOnly: false,
  hideDone: false,
  text: '',
}

export interface FiltersApi {
  filters: FilterState
  setFilter: <K extends keyof FilterState>(key: K, value: FilterState[K]) => void
  toggle: <K extends ArrayFilterKey>(key: K, value: FilterState[K][number]) => void
  reset: () => void
  /** How many filters are actually narrowing the board — drives the "Clear" button. */
  activeCount: number
  apply: (tasks: Task[]) => Task[]
}

// ------------------------------------------------------------- persistence --

const PREFIX = 'board:filters:'

function storageKey(scopeId: string | null): string | null {
  return scopeId ? PREFIX + scopeId : null
}

/** Narrow whatever survived a page reload back to a `FilterState`. Anything
 *  unrecognised falls back to the default rather than poisoning the board. */
function sanitize(raw: unknown): FilterState {
  if (!raw || typeof raw !== 'object') return EMPTY_FILTERS
  const r = raw as Record<string, unknown>
  const strings = (v: unknown) => (Array.isArray(v) ? v.filter((x): x is string => typeof x === 'string') : [])
  const dues: DueFilter[] = ['any', 'overdue', 'today', 'week', 'none']
  const prios: TaskPriority[] = ['low', 'medium', 'high', 'urgent']
  return {
    assignees: strings(r.assignees),
    priorities: strings(r.priorities).filter((p): p is TaskPriority => (prios as string[]).includes(p)),
    due: (dues as string[]).includes(r.due as string) ? (r.due as DueFilter) : 'any',
    blockedOnly: r.blockedOnly === true,
    hideDone: r.hideDone === true,
    text: typeof r.text === 'string' ? r.text : '',
  }
}

function read(scopeId: string | null): FilterState {
  const key = storageKey(scopeId)
  if (!key) return EMPTY_FILTERS
  try {
    const raw = window.localStorage.getItem(key)
    return raw ? sanitize(JSON.parse(raw) as unknown) : EMPTY_FILTERS
  } catch {
    return EMPTY_FILTERS
  }
}

function write(scopeId: string | null, filters: FilterState) {
  const key = storageKey(scopeId)
  if (!key) return
  try {
    if (countActive(filters) === 0) window.localStorage.removeItem(key)
    else window.localStorage.setItem(key, JSON.stringify(filters))
  } catch { /* private mode — filters just do not survive the reload */ }
}

// ------------------------------------------------------------------ logic --

function countActive(f: FilterState): number {
  return (
    (f.assignees.length > 0 ? 1 : 0) +
    (f.priorities.length > 0 ? 1 : 0) +
    (f.due !== 'any' ? 1 : 0) +
    (f.blockedOnly ? 1 : 0) +
    (f.hideDone ? 1 : 0) +
    (f.text.trim() ? 1 : 0)
  )
}

/**
 * Due-date matching, on the plain 'YYYY-MM-DD' string. `new Date(iso)` would
 * parse it as UTC midnight and shift the day for anyone west of Greenwich, so
 * every comparison goes through `daysUntil` instead.
 *
 * The window is deliberately date-only: a completed task that was late still
 * counts as overdue here, and "Hide done" is what removes it.
 */
function matchesDue(due: string | null, mode: DueFilter): boolean {
  if (mode === 'any') return true
  if (mode === 'none') return due === null
  if (!due) return false
  const d = daysUntil(due)
  if (mode === 'overdue') return d < 0
  if (mode === 'today') return d === 0
  return d >= 0 && d <= 7 // 'week' — today plus the next seven days
}

/**
 * Filter state for one board, remembered per `scopeId` in localStorage.
 *
 * `scopeId` is whatever identifies the board the caller is looking at (a
 * project id, or `workspace:team`). Changing it swaps the whole filter set for
 * the one that scope was left with, so switching boards never carries a
 * stranger's assignee filter across with it.
 */
export function useFilters(scopeId: string | null): FiltersApi {
  // The scope travels with the state so a scope change can be reconciled during
  // render — an effect would paint one frame of the previous board's filters.
  const [state, setState] = useState<{ scope: string | null; filters: FilterState }>(
    () => ({ scope: scopeId, filters: read(scopeId) }),
  )

  if (state.scope !== scopeId) {
    setState({ scope: scopeId, filters: read(scopeId) })
  }

  const filters = state.scope === scopeId ? state.filters : EMPTY_FILTERS

  useEffect(() => {
    write(scopeId, filters)
  }, [scopeId, filters])

  const setFilter = useCallback(<K extends keyof FilterState>(key: K, value: FilterState[K]) => {
    setState(s => ({ scope: s.scope, filters: { ...s.filters, [key]: value } as FilterState }))
  }, [])

  const toggle = useCallback(<K extends ArrayFilterKey>(key: K, value: FilterState[K][number]) => {
    setState(s => {
      const list = s.filters[key] as string[]
      const next = list.includes(value) ? list.filter(x => x !== value) : [...list, value]
      return { scope: s.scope, filters: { ...s.filters, [key]: next } as FilterState }
    })
  }, [])

  const reset = useCallback(() => {
    setState(s => ({ scope: s.scope, filters: EMPTY_FILTERS }))
  }, [])

  const activeCount = useMemo(() => countActive(filters), [filters])

  const apply = useCallback((tasks: Task[]): Task[] => {
    const q = filters.text.trim().toLowerCase()
    return tasks.filter(t => {
      // Trashed rows are never a board's business, filtered or not.
      if (t.deleted_at) return false
      if (filters.hideDone && t.status === 'done') return false
      if (filters.blockedOnly && t.status !== 'blocked') return false
      if (filters.priorities.length > 0 && !filters.priorities.includes(t.priority)) return false
      if (filters.assignees.length > 0 && !filters.assignees.includes(t.assignee_id ?? UNASSIGNED)) return false
      if (!matchesDue(t.due_date, filters.due)) return false
      if (q) {
        const haystack = `${t.title} ${t.description ?? ''}`.toLowerCase()
        if (!haystack.includes(q)) return false
      }
      return true
    })
  }, [filters])

  return { filters, setFilter, toggle, reset, activeCount, apply }
}
