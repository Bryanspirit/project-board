import { useEffect, useMemo, useRef, useState } from 'react'
import type { Profile, Project, Task, TaskStatus } from '../../lib/types'
import { COLUMNS, PRIORITIES } from '../../lib/types'
import { dueTone, formatDue } from '../../lib/dates'
import { Button, Spinner, cx } from '../ui'

const DUE_TONE = {
  overdue: 'bg-rose-50 text-rose-700 dark:bg-rose-950/60 dark:text-rose-300',
  today: 'bg-amber-50 text-amber-700 dark:bg-amber-950/60 dark:text-amber-300',
  soon: 'bg-slate-100 text-slate-600 dark:bg-slate-800 dark:text-slate-300',
  later: 'bg-slate-100 text-slate-500 dark:bg-slate-800 dark:text-slate-400',
}

function initial(p?: Profile) {
  return (p?.full_name?.trim() || p?.email || '?').slice(0, 1).toUpperCase()
}

/**
 * The board, one status at a time.
 *
 * Dragging a card between five columns is a desktop gesture; on a phone the
 * columns become a segmented control and moving a task is a tap on the arrow
 * either side of it. Nothing here uses @dnd-kit — a long-press drag fights the
 * browser's own scroll on touch.
 */
export default function MobileBoard({
  projects, activeProjectId, onSelectProject,
  tasks, loading, people = [], onOpenTask, onAddTask, onMoveTask, onNewProject,
}: {
  projects: Project[]
  activeProjectId: string | null
  onSelectProject: (id: string) => void
  tasks: Task[]
  loading: boolean
  people?: Profile[]
  onOpenTask: (t: Task) => void
  onAddTask: (status: TaskStatus) => void
  onMoveTask: (id: string, status: TaskStatus, index: number) => void
  onNewProject: () => void
}) {
  const [status, setStatus] = useState<TaskStatus>('todo')
  const pillsRef = useRef<HTMLDivElement>(null)

  const byStatus = useMemo(() => {
    const map = new Map<TaskStatus, Task[]>(COLUMNS.map(c => [c.id, []]))
    for (const t of [...tasks].sort((a, b) => a.sort_order - b.sort_order)) {
      map.get(t.status)?.push(t)
    }
    return map
  }, [tasks])

  const current = byStatus.get(status) ?? []
  const statusIndex = COLUMNS.findIndex(c => c.id === status)

  // Keep the selected pill in view when the status changes from a card arrow
  // rather than from the pill itself.
  useEffect(() => {
    const el = pillsRef.current?.querySelector('[aria-current="page"]')
    el?.scrollIntoView({ block: 'nearest', inline: 'center', behavior: 'smooth' })
  }, [status])

  function move(task: Task, delta: -1 | 1) {
    const next = COLUMNS[COLUMNS.findIndex(c => c.id === task.status) + delta]
    if (!next) return
    const target = (byStatus.get(next.id) ?? []).length
    onMoveTask(task.id, next.id, target)
  }

  if (loading && projects.length === 0) {
    return <div className="flex h-64 items-center justify-center text-slate-400"><Spinner className="h-6 w-6" /></div>
  }

  if (projects.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center gap-3 px-6 py-16 text-center">
        <span className="text-4xl" aria-hidden>🗂️</span>
        <h2 className="text-base font-semibold">No projects here yet</h2>
        <p className="text-sm text-slate-500 dark:text-slate-400">Create one to start adding tasks.</p>
        <Button onClick={onNewProject} className="min-h-11">Create a project</Button>
      </div>
    )
  }

  return (
    <div className="flex h-full min-h-0 flex-col">
      {projects.length > 1 && (
        <div className="shrink-0 overflow-x-auto border-b border-slate-200 px-3 py-2 dark:border-slate-800">
          <div className="flex gap-1.5">
            {projects.map(p => (
              <button
                key={p.id}
                onClick={() => onSelectProject(p.id)}
                aria-current={p.id === activeProjectId ? 'page' : undefined}
                className={cx(
                  'flex min-h-9 shrink-0 items-center gap-1.5 rounded-full px-3 text-xs transition',
                  p.id === activeProjectId
                    ? 'bg-slate-900 font-medium text-white dark:bg-slate-100 dark:text-slate-900'
                    : 'bg-slate-100 text-slate-600 dark:bg-slate-800 dark:text-slate-300',
                )}
              >
                <span className="h-2 w-2 shrink-0 rounded-full" style={{ backgroundColor: p.color }} aria-hidden />
                <span className="max-w-32 truncate">{p.name}</span>
              </button>
            ))}
          </div>
        </div>
      )}

      <div ref={pillsRef} className="shrink-0 overflow-x-auto border-b border-slate-200 px-3 py-2 dark:border-slate-800">
        <div className="flex gap-1.5" role="tablist" aria-label="Board columns">
          {COLUMNS.map(c => {
            const n = (byStatus.get(c.id) ?? []).length
            const on = c.id === status
            return (
              <button
                key={c.id}
                role="tab"
                aria-selected={on}
                aria-current={on ? 'page' : undefined}
                onClick={() => setStatus(c.id)}
                className={cx(
                  'flex min-h-9 shrink-0 items-center gap-1.5 rounded-full px-3 text-xs font-medium transition',
                  on ? 'bg-indigo-600 text-white' : 'bg-slate-100 text-slate-600 dark:bg-slate-800 dark:text-slate-300',
                )}
              >
                <span className={cx('h-1.5 w-1.5 rounded-full', on ? 'bg-white/70' : c.accent)} aria-hidden />
                {c.label}
                <span className={cx('tabular-nums', on ? 'text-white/70' : 'text-slate-400')}>{n}</span>
              </button>
            )
          })}
        </div>
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain px-3 py-3">
        {current.length === 0 ? (
          <div className="flex flex-col items-center justify-center gap-2 rounded-xl border border-dashed border-slate-300 py-12 text-center dark:border-slate-700">
            <p className="text-sm text-slate-500 dark:text-slate-400">
              Nothing in {COLUMNS[statusIndex].label}.
            </p>
            <Button size="sm" variant="outline" className="min-h-11" onClick={() => onAddTask(status)}>
              Add a task here
            </Button>
          </div>
        ) : (
          <ul className="space-y-2 pb-24">
            {current.map(task => {
              const priority = PRIORITIES.find(p => p.id === task.priority)!
              const assignee = people.find(p => p.id === task.assignee_id)
              const tone = task.due_date && task.status !== 'done' ? dueTone(task.due_date) : 'later'

              return (
                <li key={task.id}
                  className="rounded-xl bg-white shadow-sm ring-1 ring-slate-200 dark:bg-slate-900 dark:ring-slate-800">
                  <div className="flex items-stretch">
                    <button
                      aria-label={`Move “${task.title}” to ${COLUMNS[statusIndex - 1]?.label ?? 'previous'}`}
                      disabled={statusIndex === 0}
                      onClick={() => move(task, -1)}
                      className="group flex w-11 shrink-0 items-center justify-center rounded-l-xl transition disabled:opacity-25"
                    >
                      <span className="flex h-7 w-7 items-center justify-center rounded-lg bg-slate-100 text-slate-500 group-active:bg-slate-200 dark:bg-slate-800 dark:text-slate-400">
                      <svg viewBox="0 0 16 16" className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth="2">
                        <path d="M10 3.5 5.5 8l4.5 4.5" strokeLinecap="round" strokeLinejoin="round" />
                      </svg>
                      </span>
                    </button>

                    <button
                      onClick={() => onOpenTask(task)}
                      aria-label={`Open ${task.title}`}
                      className="min-w-0 flex-1 py-3 text-left"
                    >
                      <p className={cx('text-sm leading-snug font-medium break-words',
                        task.status === 'done' && 'text-slate-500 line-through')}>
                        {task.title}
                      </p>

                      {task.status === 'blocked' && task.blocked_reason && (
                        <p className="mt-1.5 rounded-md bg-rose-50 px-2 py-1 text-xs text-rose-700 dark:bg-rose-950/60 dark:text-rose-300">
                          {task.blocked_reason}
                        </p>
                      )}

                      <div className="mt-2 flex flex-wrap items-center gap-1.5">
                        <span className={cx('rounded-md px-1.5 py-0.5 text-[10px] font-medium ring-1 ring-inset', priority.chip)}>
                          {priority.label}
                        </span>
                        {task.due_date && (
                          <span className={cx('rounded-md px-1.5 py-0.5 text-[10px] font-medium',
                            task.status === 'done' ? DUE_TONE.later : DUE_TONE[tone])}>
                            {formatDue(task.due_date)}
                          </span>
                        )}
                        {assignee && (
                          <span
                            title={assignee.full_name ?? assignee.email}
                            className="ml-auto flex h-5 w-5 items-center justify-center rounded-full bg-indigo-600 text-[10px] font-semibold text-white"
                          >
                            {initial(assignee)}
                          </span>
                        )}
                      </div>
                    </button>

                    <button
                      aria-label={`Move “${task.title}” to ${COLUMNS[statusIndex + 1]?.label ?? 'next'}`}
                      disabled={statusIndex === COLUMNS.length - 1}
                      onClick={() => move(task, 1)}
                      className="group flex w-11 shrink-0 items-center justify-center rounded-r-xl transition disabled:opacity-25"
                    >
                      <span className="flex h-7 w-7 items-center justify-center rounded-lg bg-slate-100 text-slate-500 group-active:bg-slate-200 dark:bg-slate-800 dark:text-slate-400">
                        <svg viewBox="0 0 16 16" className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth="2">
                          <path d="M6 3.5 10.5 8 6 12.5" strokeLinecap="round" strokeLinejoin="round" />
                        </svg>
                      </span>
                    </button>
                  </div>
                </li>
              )
            })}
          </ul>
        )}
      </div>

      <button
        onClick={() => onAddTask(status)}
        aria-label={`New task in ${COLUMNS[statusIndex].label}`}
        className="fixed right-4 bottom-[calc(4.5rem+env(safe-area-inset-bottom))] z-30 flex h-14 w-14 items-center justify-center rounded-full bg-indigo-600 text-white shadow-lg shadow-indigo-600/30 transition active:scale-95"
      >
        <svg viewBox="0 0 24 24" className="h-6 w-6" fill="none" stroke="currentColor" strokeWidth="2">
          <path d="M12 6v12M6 12h12" strokeLinecap="round" />
        </svg>
      </button>
    </div>
  )
}
