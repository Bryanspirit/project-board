import { useEffect, useMemo, useRef, useState } from 'react'
import type { Profile, Project, Task, TaskStatus } from '../../lib/types'
import { COLUMNS, PRIORITIES } from '../../lib/types'
import { dueTone, formatDue } from '../../lib/dates'
import { Button, Modal, Spinner, cx } from '../ui'

const DUE_TONE = {
  overdue: 'bg-rose-50 text-rose-700 dark:bg-rose-950/60 dark:text-rose-300',
  today: 'bg-amber-50 text-amber-700 dark:bg-amber-950/60 dark:text-amber-300',
  soon: 'bg-slate-100 text-slate-600 dark:bg-slate-800 dark:text-slate-300',
  later: 'bg-slate-100 text-slate-500 dark:bg-slate-800 dark:text-slate-400',
}

/** Below this a horizontal drag is a swipe; above it, the finger is scrolling. */
const SWIPE_PX = 56

function initial(p?: Profile) {
  return (p?.full_name?.trim() || p?.email || '?').slice(0, 1).toUpperCase()
}

/**
 * The board as a pager, one column per screen.
 *
 * The first attempt stacked two scrolling pill rows above the cards and put a
 * move arrow on each side of every one — roughly a fifth of a 390px screen
 * spent on chrome before a single task title. This version gives the column the
 * whole width: swipe between columns the way every other phone app pages, and
 * move a task from a sheet that names where it is going.
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
  const [index, setIndex] = useState(1)          // open on To Do, not Backlog
  const [moving, setMoving] = useState<Task | null>(null)
  const [picking, setPicking] = useState(false)
  const listRef = useRef<HTMLDivElement>(null)
  const touch = useRef<{ x: number; y: number; locked: boolean } | null>(null)

  const byStatus = useMemo(() => {
    const map = new Map<TaskStatus, Task[]>(COLUMNS.map(c => [c.id, []]))
    for (const t of [...tasks].sort((a, b) => a.sort_order - b.sort_order)) {
      map.get(t.status)?.push(t)
    }
    return map
  }, [tasks])

  const column = COLUMNS[index]
  const current = byStatus.get(column.id) ?? []
  const activeProject = projects.find(p => p.id === activeProjectId) ?? null

  // A new column starts at the top rather than inheriting the last one's scroll.
  useEffect(() => { listRef.current?.scrollTo({ top: 0 }) }, [index])

  function page(delta: -1 | 1) {
    setIndex(i => Math.min(COLUMNS.length - 1, Math.max(0, i + delta)))
  }

  function onTouchStart(e: React.TouchEvent) {
    const t = e.touches[0]
    touch.current = { x: t.clientX, y: t.clientY, locked: false }
  }

  function onTouchMove(e: React.TouchEvent) {
    const start = touch.current
    if (!start || start.locked) return
    const t = e.touches[0]
    const dx = t.clientX - start.x
    const dy = t.clientY - start.y
    // Once the finger has committed to an axis, stop reconsidering — otherwise a
    // diagonal drag flickers between paging and scrolling.
    if (Math.abs(dy) > Math.abs(dx)) { touch.current = { ...start, locked: true }; return }
    if (Math.abs(dx) > SWIPE_PX) {
      page(dx < 0 ? 1 : -1)
      touch.current = { ...start, locked: true }
    }
  }

  function commitMove(to: TaskStatus) {
    if (!moving) return
    const target = (byStatus.get(to) ?? []).filter(t => t.id !== moving.id).length
    onMoveTask(moving.id, to, target)
    setMoving(null)
    setIndex(COLUMNS.findIndex(c => c.id === to))
  }

  if (loading && projects.length === 0) {
    return <div className="flex h-64 items-center justify-center text-slate-400"><Spinner className="h-6 w-6" /></div>
  }

  if (projects.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center gap-3 px-6 py-16 text-center">
        <h2 className="text-base font-semibold">No projects here yet</h2>
        <p className="text-sm text-slate-500 dark:text-slate-400">Create one to start adding tasks.</p>
        <Button onClick={onNewProject} className="min-h-11">Create a project</Button>
      </div>
    )
  }

  return (
    <div className="flex h-full min-h-0 flex-col">
      {projects.length > 1 && activeProject && (
        <button
          onClick={() => setPicking(true)}
          className="flex min-h-11 shrink-0 items-center gap-2 border-b border-slate-200 px-4 text-left dark:border-slate-800"
        >
          <span className="h-2.5 w-2.5 shrink-0 rounded-full" style={{ backgroundColor: activeProject.color }} aria-hidden />
          <span className="min-w-0 flex-1 truncate text-sm font-medium">{activeProject.name}</span>
          <span className="shrink-0 text-xs text-slate-400">{projects.length} projects</span>
          <svg viewBox="0 0 16 16" className="h-4 w-4 shrink-0 text-slate-400" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden>
            <path d="m4 6 4 4 4-4" strokeLinecap="round" strokeLinejoin="round" />
          </svg>
        </button>
      )}

      {/* One pager header, instead of a scrolling list of all five columns. */}
      <div className="flex shrink-0 items-center gap-1 border-b border-slate-200 px-1 py-1.5 dark:border-slate-800">
        <button
          onClick={() => page(-1)}
          disabled={index === 0}
          aria-label={COLUMNS[index - 1] ? `Previous column: ${COLUMNS[index - 1].label}` : 'Previous column'}
          className="flex h-11 w-11 shrink-0 items-center justify-center rounded-lg text-slate-400 transition active:bg-slate-100 disabled:opacity-25 dark:active:bg-slate-800"
        >
          <svg viewBox="0 0 16 16" className="h-5 w-5" fill="none" stroke="currentColor" strokeWidth="2">
            <path d="M10 3.5 5.5 8l4.5 4.5" strokeLinecap="round" strokeLinejoin="round" />
          </svg>
        </button>

        <div className="flex min-w-0 flex-1 flex-col items-center" aria-live="polite">
          <span className="flex items-center gap-2 text-sm font-semibold">
            <span className={cx('h-2 w-2 rounded-full', column.accent)} aria-hidden />
            {column.label}
            <span className="rounded-full bg-slate-100 px-1.5 text-xs tabular-nums text-slate-500 dark:bg-slate-800 dark:text-slate-400">
              {current.length}
            </span>
          </span>
          <span className="mt-1 flex gap-1" aria-hidden>
            {COLUMNS.map((c, i) => (
              <span key={c.id}
                className={cx('h-1 rounded-full transition-all',
                  i === index ? 'w-4 bg-indigo-600' : 'w-1 bg-slate-300 dark:bg-slate-700')} />
            ))}
          </span>
        </div>

        <button
          onClick={() => page(1)}
          disabled={index === COLUMNS.length - 1}
          aria-label={COLUMNS[index + 1] ? `Next column: ${COLUMNS[index + 1].label}` : 'Next column'}
          className="flex h-11 w-11 shrink-0 items-center justify-center rounded-lg text-slate-400 transition active:bg-slate-100 disabled:opacity-25 dark:active:bg-slate-800"
        >
          <svg viewBox="0 0 16 16" className="h-5 w-5" fill="none" stroke="currentColor" strokeWidth="2">
            <path d="M6 3.5 10.5 8 6 12.5" strokeLinecap="round" strokeLinejoin="round" />
          </svg>
        </button>
      </div>

      <div
        ref={listRef}
        onTouchStart={onTouchStart}
        onTouchMove={onTouchMove}
        onTouchEnd={() => { touch.current = null }}
        className="min-h-0 flex-1 overflow-y-auto overscroll-contain px-3 py-3"
      >
        {current.length === 0 ? (
          <div className="flex flex-col items-center justify-center gap-2 rounded-xl border border-dashed border-slate-300 py-14 text-center dark:border-slate-700">
            <p className="text-sm text-slate-500 dark:text-slate-400">Nothing in {column.label}.</p>
            <Button size="sm" variant="outline" className="min-h-11" onClick={() => onAddTask(column.id)}>
              Add a task here
            </Button>
            <p className="mt-1 text-xs text-slate-400">Swipe to see the other columns.</p>
          </div>
        ) : (
          <ul className="space-y-2 pb-28">
            {current.map(task => {
              const priority = PRIORITIES.find(p => p.id === task.priority)!
              const assignee = people.find(p => p.id === task.assignee_id)
              const tone = task.due_date && task.status !== 'done' ? dueTone(task.due_date) : 'later'

              return (
                <li key={task.id}
                  className="flex items-stretch rounded-xl bg-white shadow-sm ring-1 ring-slate-200 dark:bg-slate-900 dark:ring-slate-800">
                  <button
                    onClick={() => onOpenTask(task)}
                    aria-label={`Open ${task.title}`}
                    className="min-w-0 flex-1 px-4 py-3.5 text-left"
                  >
                    <p className={cx('text-[15px] leading-snug font-medium break-words',
                      task.status === 'done' && 'text-slate-500 line-through')}>
                      {task.title}
                    </p>

                    {task.status === 'blocked' && task.blocked_reason && (
                      <p className="mt-2 rounded-md bg-rose-50 px-2 py-1 text-xs text-rose-700 dark:bg-rose-950/60 dark:text-rose-300">
                        {task.blocked_reason}
                      </p>
                    )}

                    <div className="mt-2.5 flex flex-wrap items-center gap-1.5">
                      <span className={cx('rounded-md px-1.5 py-0.5 text-[11px] font-medium ring-1 ring-inset', priority.chip)}>
                        {priority.label}
                      </span>
                      {task.due_date && (
                        <span className={cx('rounded-md px-1.5 py-0.5 text-[11px] font-medium',
                          task.status === 'done' ? DUE_TONE.later : DUE_TONE[tone])}>
                          {formatDue(task.due_date)}
                        </span>
                      )}
                      {assignee && (
                        <span
                          title={assignee.full_name ?? assignee.email}
                          className="flex h-5 w-5 items-center justify-center rounded-full bg-indigo-600 text-[10px] font-semibold text-white"
                        >
                          {initial(assignee)}
                        </span>
                      )}
                    </div>
                  </button>

                  {/* Naming the destination beats a blind arrow, and it leaves the
                      card's own tap target the full width of the content. */}
                  <button
                    onClick={() => setMoving(task)}
                    aria-label={`Move ${task.title} to another column`}
                    className="flex w-12 shrink-0 items-center justify-center rounded-r-xl border-l border-slate-100 text-slate-400 transition active:bg-slate-100 dark:border-slate-800 dark:active:bg-slate-800"
                  >
                    <svg viewBox="0 0 16 16" className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth="1.8" aria-hidden>
                      <path d="M2 8h9M8 5l3 3-3 3M13.5 4v8" strokeLinecap="round" strokeLinejoin="round" />
                    </svg>
                  </button>
                </li>
              )
            })}
          </ul>
        )}
      </div>

      <button
        onClick={() => onAddTask(column.id)}
        aria-label={`New task in ${column.label}`}
        className="fixed right-4 bottom-[calc(4.75rem+env(safe-area-inset-bottom))] z-30 flex h-14 w-14 items-center justify-center rounded-full bg-indigo-600 text-white shadow-lg shadow-indigo-600/30 transition active:scale-95"
      >
        <svg viewBox="0 0 24 24" className="h-6 w-6" fill="none" stroke="currentColor" strokeWidth="2">
          <path d="M12 6v12M6 12h12" strokeLinecap="round" />
        </svg>
      </button>

      {moving && (
        <Modal title="Move to" onClose={() => setMoving(null)}>
          <p className="-mt-1 truncate text-sm text-slate-500 dark:text-slate-400">{moving.title}</p>
          <ul className="-mx-1 divide-y divide-slate-200 dark:divide-slate-800">
            {COLUMNS.map(c => (
              <li key={c.id}>
                <button
                  disabled={c.id === moving.status}
                  onClick={() => commitMove(c.id)}
                  className="flex min-h-14 w-full items-center gap-3 px-1 text-left transition active:bg-slate-50 disabled:opacity-40 dark:active:bg-slate-800/60"
                >
                  <span className={cx('h-2.5 w-2.5 rounded-full', c.accent)} aria-hidden />
                  <span className="flex-1 text-sm font-medium">{c.label}</span>
                  {c.id === moving.status
                    ? <span className="text-xs text-slate-400">Currently here</span>
                    : <span className="text-xs tabular-nums text-slate-400">{(byStatus.get(c.id) ?? []).length}</span>}
                </button>
              </li>
            ))}
          </ul>
        </Modal>
      )}

      {picking && (
        <Modal title="Switch project" onClose={() => setPicking(false)}>
          <ul className="-mx-1 divide-y divide-slate-200 dark:divide-slate-800">
            {projects.map(p => {
              const own = tasks.filter(t => t.project_id === p.id)
              const done = own.filter(t => t.status === 'done').length
              return (
                <li key={p.id}>
                  <button
                    onClick={() => { onSelectProject(p.id); setPicking(false) }}
                    aria-current={p.id === activeProjectId ? 'page' : undefined}
                    className="flex min-h-14 w-full items-center gap-3 px-1 text-left transition active:bg-slate-50 dark:active:bg-slate-800/60"
                  >
                    <span className="h-2.5 w-2.5 shrink-0 rounded-full" style={{ backgroundColor: p.color }} aria-hidden />
                    <span className="min-w-0 flex-1">
                      <span className="block truncate text-sm font-medium">{p.name}</span>
                      <span className="block text-xs text-slate-400">
                        {own.length === 0 ? 'No tasks yet' : `${done} of ${own.length} done`}
                      </span>
                    </span>
                    {p.id === activeProjectId && (
                      <svg viewBox="0 0 16 16" className="h-4 w-4 shrink-0 text-indigo-600" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden>
                        <path d="m3 8 3.5 3.5L13 5" strokeLinecap="round" strokeLinejoin="round" />
                      </svg>
                    )}
                  </button>
                </li>
              )
            })}
          </ul>
        </Modal>
      )}
    </div>
  )
}
