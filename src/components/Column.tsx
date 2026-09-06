import { useSyncExternalStore } from 'react'
import { useDroppable } from '@dnd-kit/core'
import { SortableContext, verticalListSortingStrategy } from '@dnd-kit/sortable'
import type { Profile, Task, TaskStatus } from '../lib/types'
import { COLUMNS } from '../lib/types'
import TaskCard from './TaskCard'
import QuickAdd from './board/QuickAdd'
import { cx } from './ui'

// ------------------------------------------------------ collapsed-state store --

const STORE_KEY = 'board:collapsed'
type CollapsedMap = Record<string, boolean>

function readStored(): CollapsedMap {
  try {
    const raw = localStorage.getItem(STORE_KEY)
    if (!raw) return {}
    const parsed: unknown = JSON.parse(raw)
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return {}
    const out: CollapsedMap = {}
    for (const [k, v] of Object.entries(parsed as Record<string, unknown>)) {
      if (typeof v === 'boolean') out[k] = v
    }
    return out
  } catch {
    return {}
  }
}

/** Module-level so every column — and any future "expand all" — sees one truth,
 *  instead of five components racing to rewrite the same localStorage key. */
let collapsedState: CollapsedMap = readStored()
const listeners = new Set<() => void>()

function subscribe(fn: () => void) {
  listeners.add(fn)
  return () => { listeners.delete(fn) }
}

export function setColumnCollapsed(id: string, collapsed: boolean) {
  if ((collapsedState[id] ?? false) === collapsed) return
  collapsedState = { ...collapsedState, [id]: collapsed }
  try {
    localStorage.setItem(STORE_KEY, JSON.stringify(collapsedState))
  } catch {
    // Private mode / storage full — the collapse still applies for this session.
  }
  for (const fn of listeners) fn()
}

export function useColumnCollapsed(id: string): boolean {
  return useSyncExternalStore(subscribe, () => collapsedState[id] ?? false, () => false)
}

// ----------------------------------------------------------------- component --

export default function Column({ status, tasks, onOpenTask, onAdd, people, onCreateTask, disabled }: {
  status: TaskStatus
  tasks: Task[]
  onOpenTask: (t: Task) => void
  onAdd: (status: TaskStatus) => void
  people?: Profile[]
  /** When given, an inline quick-add row appears at the foot of the column. */
  onCreateTask?: (title: string, status: TaskStatus) => Promise<unknown>
  disabled?: boolean
}) {
  const meta = COLUMNS.find(c => c.id === status)!
  const { setNodeRef, isOver } = useDroppable({ id: `col:${status}`, data: { status } })
  const collapsed = useColumnCollapsed(status)

  // A rail is still a drop target: dragging onto it files the card without
  // making the person expand the column first.
  if (collapsed) {
    return (
      <section className="flex w-10 shrink-0 flex-col">
        <button
          ref={setNodeRef}
          type="button"
          onClick={() => setColumnCollapsed(status, false)}
          aria-expanded={false}
          aria-label={`Expand ${meta.label} column, ${tasks.length} ${tasks.length === 1 ? 'task' : 'tasks'}`}
          title={`${meta.label} — ${tasks.length}`}
          className={cx(
            'flex flex-1 w-10 cursor-pointer flex-col items-center gap-2.5 rounded-xl py-3 transition-colors',
            'bg-slate-100/70 ring-1 ring-slate-200/80 hover:bg-slate-200/70',
            'dark:bg-slate-900/50 dark:ring-slate-800/80 dark:hover:bg-slate-800',
            'focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-indigo-600',
            isOver && 'bg-indigo-50 ring-2 ring-indigo-300 dark:bg-indigo-950/30 dark:ring-indigo-800',
          )}
        >
          <span className={cx('h-2 w-2 shrink-0 rounded-full', meta.accent)} aria-hidden />
          <span aria-hidden className="rounded-full bg-slate-200 px-1.5 text-[10px] font-medium text-slate-600 dark:bg-slate-800 dark:text-slate-400">
            {tasks.length}
          </span>
          <span aria-hidden className="text-sm font-semibold whitespace-nowrap text-slate-600 [writing-mode:vertical-rl] dark:text-slate-300">
            {meta.label}
          </span>
        </button>
      </section>
    )
  }

  return (
    <section className="flex w-64 shrink-0 flex-col sm:w-72">
      <header className="mb-2.5 flex items-center gap-2 px-1">
        <span className={cx('h-2 w-2 rounded-full', meta.accent)} aria-hidden />
        <h3 className="text-sm font-semibold">{meta.label}</h3>
        <span className="rounded-full bg-slate-200 px-1.5 text-[10px] font-medium text-slate-600 dark:bg-slate-800 dark:text-slate-400">
          {tasks.length}
        </span>

        <button
          type="button"
          onClick={() => setColumnCollapsed(status, true)}
          aria-expanded
          aria-label={`Collapse ${meta.label} column`}
          title="Collapse column"
          className="ml-auto rounded-md p-1 text-slate-400 transition hover:bg-slate-200 hover:text-slate-700 dark:hover:bg-slate-800 dark:hover:text-slate-200"
        >
          <svg viewBox="0 0 16 16" className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth="2">
            <path d="M10 3 5 8l5 5" strokeLinecap="round" strokeLinejoin="round" />
          </svg>
        </button>

        <button
          type="button"
          onClick={() => onAdd(status)}
          aria-label={`Add task to ${meta.label}`}
          className="rounded-md p-1 text-slate-400 transition hover:bg-slate-200 hover:text-slate-700 dark:hover:bg-slate-800 dark:hover:text-slate-200"
        >
          <svg viewBox="0 0 16 16" className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth="2">
            <path d="M8 3v10M3 8h10" strokeLinecap="round" />
          </svg>
        </button>
      </header>

      <div
        ref={setNodeRef}
        className={cx(
          'flex-1 overflow-y-auto rounded-xl p-2 transition-colors',
          'bg-slate-100/70 ring-1 ring-slate-200/80 dark:bg-slate-900/50 dark:ring-slate-800/80',
          isOver && 'bg-indigo-50 ring-2 ring-indigo-300 dark:bg-indigo-950/30 dark:ring-indigo-800',
        )}
      >
        <SortableContext items={tasks.map(t => t.id)} strategy={verticalListSortingStrategy}>
          <ul className="flex min-h-24 flex-col gap-2">
            {tasks.map(t => <TaskCard key={t.id} task={t} onOpen={onOpenTask} people={people} />)}
            {tasks.length === 0 && (
              <li className="flex h-24 items-center justify-center rounded-lg border border-dashed border-slate-300 text-xs text-slate-400 dark:border-slate-700">
                Drop tasks here
              </li>
            )}
          </ul>
        </SortableContext>

        {onCreateTask && (
          <QuickAdd status={status} onCreate={onCreateTask} disabled={disabled} />
        )}
      </div>
    </section>
  )
}
