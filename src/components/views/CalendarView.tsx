import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type { DragEvent, KeyboardEvent } from 'react'
import type { Milestone, Profile, Project, Task, TaskPriority } from '../../lib/types'
import { MILESTONE_KINDS, PRIORITIES } from '../../lib/types'
import { todayISO } from '../../lib/dates'
import { Button, Input, Modal, Spinner, cx } from '../ui'
import {
  addDaysISO, addMonthsISO, daysInMonth, diffDaysISO, formatISODate,
  isoParts, monthStartISO, useSchedule, weekdayISO,
} from '../../hooks/useSchedule'

/** How many chips fit in a day cell before it collapses into "+N more". */
const MAX_CHIPS = 3

/** 2024-01-01 was a Monday — the anchor for locale-aware weekday headers. */
const REFERENCE_MONDAY = '2024-01-01'

const PRIORITY_TINT: Record<TaskPriority, string> = {
  low: 'bg-slate-100 text-slate-700 ring-slate-200 hover:bg-slate-200 dark:bg-slate-800 dark:text-slate-200 dark:ring-slate-700 dark:hover:bg-slate-700',
  medium: 'bg-sky-50 text-sky-800 ring-sky-200 hover:bg-sky-100 dark:bg-sky-950 dark:text-sky-200 dark:ring-sky-900 dark:hover:bg-sky-900',
  high: 'bg-amber-50 text-amber-800 ring-amber-200 hover:bg-amber-100 dark:bg-amber-950 dark:text-amber-200 dark:ring-amber-900 dark:hover:bg-amber-900',
  urgent: 'bg-rose-50 text-rose-800 ring-rose-200 hover:bg-rose-100 dark:bg-rose-950 dark:text-rose-200 dark:ring-rose-900 dark:hover:bg-rose-900',
}

const OVERDUE_TINT =
  'bg-rose-100 text-rose-900 ring-rose-300 hover:bg-rose-200 dark:bg-rose-950/80 dark:text-rose-200 dark:ring-rose-800 dark:hover:bg-rose-900/80'

function isOverdue(task: Task, today: string): boolean {
  return task.status !== 'done' && !!task.due_date && task.due_date.slice(0, 10) < today
}

function milestoneEmoji(m: Milestone): string {
  return MILESTONE_KINDS.find(k => k.id === m.kind)?.emoji ?? '📌'
}

function personName(people: Profile[], id: string | null): string | null {
  if (!id) return null
  const p = people.find(x => x.id === id)
  return p ? (p.full_name ?? p.email) : null
}

// ------------------------------------------------------------------ chip --

interface ChipProps {
  task: Task
  project: Project | undefined
  today: string
  dragging: boolean
  onOpen: (task: Task) => void
  onDragStart: (e: DragEvent<HTMLElement>, task: Task) => void
  onDragEnd: () => void
}

function TaskChip({ task, project, today, dragging, onOpen, onDragStart, onDragEnd }: ChipProps) {
  const overdue = isOverdue(task, today)
  const label = [
    task.title,
    project ? `in ${project.name}` : null,
    overdue ? 'overdue' : null,
    task.status === 'done' ? 'done' : null,
  ].filter(Boolean).join(', ')

  return (
    <button
      type="button"
      draggable
      onDragStart={e => onDragStart(e, task)}
      onDragEnd={onDragEnd}
      onClick={() => onOpen(task)}
      title={project ? `${project.name} — ${task.title}` : task.title}
      aria-label={label}
      className={cx(
        'flex w-full cursor-grab items-center gap-1.5 rounded-md px-1.5 py-1 text-left text-[11px]',
        'font-medium ring-1 ring-inset transition active:cursor-grabbing motion-reduce:transition-none',
        'focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-indigo-500',
        overdue ? OVERDUE_TINT : PRIORITY_TINT[task.priority],
        task.status === 'done' && 'opacity-60',
        dragging && 'opacity-40',
      )}
    >
      <span
        aria-hidden="true"
        className="h-2 w-2 shrink-0 rounded-full ring-1 ring-black/10"
        style={{ backgroundColor: project?.color ?? '#94a3b8' }}
      />
      <span className={cx('truncate', task.status === 'done' && 'line-through')}>{task.title}</span>
    </button>
  )
}

function MilestoneBanner({ milestone }: { milestone: Milestone }) {
  return (
    <div
      className="w-full truncate rounded-md bg-indigo-600/90 px-1.5 py-0.5 text-[10px] font-semibold text-white ring-1 ring-indigo-700/50 dark:bg-indigo-500/90"
      title={milestone.name}
    >
      <span aria-hidden="true">{milestoneEmoji(milestone)}</span>{' '}
      <span className="sr-only">Milestone: </span>{milestone.name}
    </div>
  )
}

// ------------------------------------------------------------------ view --

export interface CalendarViewProps {
  workspaceId: string | null
  teamId?: string | null
  people: Profile[]
  onOpenTask: (task: Task) => void
  className?: string
}

export default function CalendarView({
  workspaceId, teamId = null, people, onOpenTask, className,
}: CalendarViewProps) {
  const {
    tasksByDate, projectById, milestonesByDate, loading, error, moveTaskToDate,
  } = useSchedule({ workspaceId, teamId })

  const today = todayISO()
  const [cursor, setCursor] = useState(() => monthStartISO(todayISO()))
  const [detailDay, setDetailDay] = useState<string | null>(null)
  const [draggingId, setDraggingId] = useState<string | null>(null)
  const [dragOver, setDragOver] = useState<string | null>(null)
  const [focusDay, setFocusDay] = useState(() => todayISO())

  const dayRefs = useRef(new Map<string, HTMLButtonElement>())
  const pendingFocus = useRef<string | null>(null)

  useEffect(() => {
    if (!pendingFocus.current) return
    dayRefs.current.get(pendingFocus.current)?.focus()
    pendingFocus.current = null
  })

  const { gridStart, days, monthLength } = useMemo(() => {
    const { year, month } = isoParts(cursor)
    const length = daysInMonth(year, month)
    const lead = weekdayISO(cursor)
    const start = addDaysISO(cursor, -lead)
    const weeks = Math.ceil((lead + length) / 7)
    return {
      gridStart: start,
      monthLength: length,
      days: Array.from({ length: weeks * 7 }, (_, i) => addDaysISO(start, i)),
    }
  }, [cursor])

  const monthDays = useMemo(
    () => Array.from({ length: monthLength }, (_, i) => addDaysISO(cursor, i)),
    [cursor, monthLength],
  )

  const weekdayHeaders = useMemo(
    () => Array.from({ length: 7 }, (_, i) => {
      const iso = addDaysISO(REFERENCE_MONDAY, i)
      return {
        short: formatISODate(iso, { weekday: 'short' }),
        long: formatISODate(iso, { weekday: 'long' }),
      }
    }),
    [],
  )

  const monthLabel = formatISODate(cursor, { month: 'long', year: 'numeric' })

  const goMonth = useCallback((delta: number) => {
    const next = monthStartISO(addMonthsISO(cursor, delta))
    setCursor(next)
    setFocusDay(next)
  }, [cursor])

  const goToday = useCallback(() => {
    setCursor(monthStartISO(today))
    setFocusDay(today)
    pendingFocus.current = today
  }, [today])

  // ------------------------------------------------------------- dragging --
  const handleDragStart = useCallback((e: DragEvent<HTMLElement>, task: Task) => {
    e.dataTransfer.effectAllowed = 'move'
    e.dataTransfer.setData('text/plain', task.id)
    setDraggingId(task.id)
  }, [])

  const handleDragEnd = useCallback(() => {
    setDraggingId(null)
    setDragOver(null)
  }, [])

  const handleDragOver = useCallback((e: DragEvent<HTMLElement>, iso: string) => {
    if (!draggingId) return
    e.preventDefault()
    e.dataTransfer.dropEffect = 'move'
    setDragOver(iso)
  }, [draggingId])

  const handleDrop = useCallback((e: DragEvent<HTMLElement>, iso: string) => {
    e.preventDefault()
    const id = e.dataTransfer.getData('text/plain') || draggingId
    setDraggingId(null)
    setDragOver(null)
    if (id) void moveTaskToDate(id, iso)
  }, [draggingId, moveTaskToDate])

  // ------------------------------------------------------------- keyboard --
  const handleGridKeyDown = useCallback((e: KeyboardEvent<HTMLDivElement>) => {
    const step = e.key === 'ArrowLeft' ? -1
      : e.key === 'ArrowRight' ? 1
      : e.key === 'ArrowUp' ? -7
      : e.key === 'ArrowDown' ? 7
      : e.key === 'PageUp' ? -monthLength
      : e.key === 'PageDown' ? monthLength
      : 0
    if (step === 0) return
    e.preventDefault()

    const next = addDaysISO(focusDay, step)
    setFocusDay(next)
    pendingFocus.current = next
    // Walking off the rendered grid pages the month rather than dead-ending.
    if (diffDaysISO(gridStart, next) < 0 || diffDaysISO(next, days[days.length - 1]) < 0) {
      setCursor(monthStartISO(next))
    }
  }, [days, focusDay, gridStart, monthLength])

  const registerDay = useCallback((iso: string, el: HTMLButtonElement | null) => {
    if (el) dayRefs.current.set(iso, el)
    else dayRefs.current.delete(iso)
  }, [])

  // ---------------------------------------------------------- day content --
  const dayLabel = useCallback((iso: string) => {
    const tasks = tasksByDate.get(iso) ?? []
    const milestones = milestonesByDate.get(iso) ?? []
    const parts = [formatISODate(iso, { weekday: 'long', month: 'long', day: 'numeric', year: 'numeric' })]
    if (iso === today) parts.push('today')
    parts.push(tasks.length === 1 ? '1 task' : `${tasks.length} tasks`)
    if (milestones.length > 0) parts.push(`${milestones.length} milestone${milestones.length === 1 ? '' : 's'}`)
    return parts.join(', ')
  }, [milestonesByDate, tasksByDate, today])

  if (loading) {
    return (
      <div className={cx('flex min-h-64 items-center justify-center', className)}>
        <Spinner className="h-6 w-6 text-indigo-500" />
        <span className="sr-only">Loading calendar</span>
      </div>
    )
  }

  const detailTasks = detailDay ? tasksByDate.get(detailDay) ?? [] : []
  const detailMilestones = detailDay ? milestonesByDate.get(detailDay) ?? [] : []

  return (
    <div className={cx('flex min-w-0 flex-col gap-3', className)}>
      {/* ------------------------------------------------------- toolbar -- */}
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex items-center gap-1.5">
          <Button variant="outline" size="sm" onClick={() => goMonth(-1)} aria-label="Previous month">
            <svg viewBox="0 0 20 20" className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth="2">
              <path d="M12 4l-5 6 5 6" strokeLinecap="round" strokeLinejoin="round" />
            </svg>
          </Button>
          <Button variant="outline" size="sm" onClick={goToday}>Today</Button>
          <Button variant="outline" size="sm" onClick={() => goMonth(1)} aria-label="Next month">
            <svg viewBox="0 0 20 20" className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth="2">
              <path d="M8 4l5 6-5 6" strokeLinecap="round" strokeLinejoin="round" />
            </svg>
          </Button>
        </div>
        <h2 aria-live="polite" className="text-base font-semibold text-slate-900 dark:text-slate-100">
          {monthLabel}
        </h2>
        <p className="text-xs text-slate-500 dark:text-slate-400">
          Drag a task to another day to reschedule it.
        </p>
      </div>

      {error && (
        <p role="alert" className="rounded-lg bg-rose-50 px-3 py-2 text-xs text-rose-700 dark:bg-rose-950/60 dark:text-rose-300">
          {error}
        </p>
      )}

      {/* ---------------------------------------------------- month grid -- */}
      <div
        role="grid"
        aria-label={`${monthLabel} calendar`}
        onKeyDown={handleGridKeyDown}
        className="hidden overflow-hidden rounded-xl ring-1 ring-slate-200 sm:block dark:ring-slate-800"
      >
        <div role="row" className="grid grid-cols-7 border-b border-slate-200 bg-slate-100 dark:border-slate-800 dark:bg-slate-900">
          {weekdayHeaders.map(w => (
            <div
              key={w.long}
              role="columnheader"
              aria-label={w.long}
              className="px-2 py-1.5 text-center text-[11px] font-semibold tracking-wide text-slate-500 uppercase dark:text-slate-400"
            >
              {w.short}
            </div>
          ))}
        </div>

        {Array.from({ length: days.length / 7 }, (_, week) => (
          <div role="row" key={days[week * 7]} className="grid grid-cols-7">
            {days.slice(week * 7, week * 7 + 7).map(iso => {
              const tasks = tasksByDate.get(iso) ?? []
              const milestones = milestonesByDate.get(iso) ?? []
              const outside = iso.slice(0, 7) !== cursor.slice(0, 7)
              const overflow = tasks.length - MAX_CHIPS

              return (
                <div
                  key={iso}
                  role="gridcell"
                  aria-label={dayLabel(iso)}
                  onDragOver={e => handleDragOver(e, iso)}
                  onDragLeave={() => setDragOver(prev => (prev === iso ? null : prev))}
                  onDrop={e => handleDrop(e, iso)}
                  className={cx(
                    'flex min-h-28 flex-col gap-1 border-b border-r border-slate-200 p-1.5 last:border-r-0 dark:border-slate-800',
                    outside && 'bg-slate-50/70 dark:bg-slate-950/40',
                    dragOver === iso && 'bg-indigo-50 ring-2 ring-inset ring-indigo-400 dark:bg-indigo-950/40',
                  )}
                >
                  <div className="flex items-center justify-between gap-1">
                    <button
                      type="button"
                      ref={el => registerDay(iso, el)}
                      tabIndex={iso === focusDay ? 0 : -1}
                      onFocus={() => setFocusDay(iso)}
                      onClick={() => setDetailDay(iso)}
                      aria-label={`Open ${dayLabel(iso)}`}
                      className={cx(
                        'inline-flex h-6 min-w-6 items-center justify-center rounded-full px-1 text-xs font-semibold transition',
                        'focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-indigo-500 motion-reduce:transition-none',
                        iso === today
                          ? 'bg-indigo-600 text-white'
                          : outside
                            ? 'text-slate-400 hover:bg-slate-200 dark:text-slate-600 dark:hover:bg-slate-800'
                            : 'text-slate-700 hover:bg-slate-200 dark:text-slate-200 dark:hover:bg-slate-800',
                      )}
                    >
                      {isoParts(iso).day}
                    </button>
                    {tasks.length > 0 && (
                      <span className="text-[10px] text-slate-400 dark:text-slate-500">{tasks.length}</span>
                    )}
                  </div>

                  {milestones.map(m => <MilestoneBanner key={m.id} milestone={m} />)}

                  <div className="flex flex-col gap-1">
                    {tasks.slice(0, MAX_CHIPS).map(t => (
                      <TaskChip
                        key={t.id}
                        task={t}
                        project={projectById.get(t.project_id)}
                        today={today}
                        dragging={draggingId === t.id}
                        onOpen={onOpenTask}
                        onDragStart={handleDragStart}
                        onDragEnd={handleDragEnd}
                      />
                    ))}
                    {overflow > 0 && (
                      <button
                        type="button"
                        onClick={() => setDetailDay(iso)}
                        className="rounded-md px-1.5 py-0.5 text-left text-[11px] font-medium text-indigo-600 hover:bg-indigo-50 hover:underline dark:text-indigo-400 dark:hover:bg-indigo-950/40"
                      >
                        +{overflow} more
                      </button>
                    )}
                  </div>
                </div>
              )
            })}
          </div>
        ))}
      </div>

      {/* ------------------------------------------------ agenda (mobile) -- */}
      <ol
        aria-label={`${monthLabel} agenda`}
        className="max-h-[70vh] divide-y divide-slate-200 overflow-y-auto rounded-xl ring-1 ring-slate-200 sm:hidden dark:divide-slate-800 dark:ring-slate-800"
      >
        {monthDays.map(iso => {
          const tasks = tasksByDate.get(iso) ?? []
          const milestones = milestonesByDate.get(iso) ?? []
          return (
            <li
              key={iso}
              onDragOver={e => handleDragOver(e, iso)}
              onDragLeave={() => setDragOver(prev => (prev === iso ? null : prev))}
              onDrop={e => handleDrop(e, iso)}
              className={cx(
                'flex gap-3 px-3 py-2',
                iso === today && 'bg-indigo-50/70 dark:bg-indigo-950/30',
                dragOver === iso && 'ring-2 ring-inset ring-indigo-400',
              )}
            >
              <button
                type="button"
                onClick={() => setDetailDay(iso)}
                aria-label={`Open ${dayLabel(iso)}`}
                className="flex h-11 w-11 shrink-0 flex-col items-center justify-center rounded-lg text-center ring-1 ring-slate-200 dark:ring-slate-800"
              >
                <span className="text-[10px] text-slate-500 uppercase dark:text-slate-400">
                  {formatISODate(iso, { weekday: 'short' })}
                </span>
                <span className={cx(
                  'text-sm font-semibold',
                  iso === today ? 'text-indigo-600 dark:text-indigo-400' : 'text-slate-800 dark:text-slate-100',
                )}>
                  {isoParts(iso).day}
                </span>
              </button>

              <div className="flex min-w-0 flex-1 flex-col gap-1 py-0.5">
                {milestones.map(m => <MilestoneBanner key={m.id} milestone={m} />)}
                {tasks.map(t => (
                  <TaskChip
                    key={t.id}
                    task={t}
                    project={projectById.get(t.project_id)}
                    today={today}
                    dragging={draggingId === t.id}
                    onOpen={onOpenTask}
                    onDragStart={handleDragStart}
                    onDragEnd={handleDragEnd}
                  />
                ))}
                {tasks.length === 0 && milestones.length === 0 && (
                  <span className="text-[11px] text-slate-400 dark:text-slate-600">Nothing scheduled</span>
                )}
              </div>
            </li>
          )
        })}
      </ol>

      {/* ------------------------------------------------- day detail --- */}
      {detailDay && (
        <Modal
          title={formatISODate(detailDay, { weekday: 'long', month: 'long', day: 'numeric', year: 'numeric' })}
          onClose={() => setDetailDay(null)}
          footer={<Button variant="outline" size="sm" onClick={() => setDetailDay(null)}>Close</Button>}
        >
          {detailMilestones.length > 0 && (
            <ul className="space-y-1.5">
              {detailMilestones.map(m => (
                <li key={m.id} className="rounded-lg bg-indigo-50 px-3 py-2 text-sm text-indigo-800 dark:bg-indigo-950/50 dark:text-indigo-200">
                  <span aria-hidden="true">{milestoneEmoji(m)}</span> <span className="font-semibold">{m.name}</span>
                  {m.description && <p className="mt-0.5 text-xs opacity-80">{m.description}</p>}
                </li>
              ))}
            </ul>
          )}

          {detailTasks.length === 0 ? (
            <p className="text-sm text-slate-500 dark:text-slate-400">No tasks are due on this day.</p>
          ) : (
            <ul className="space-y-2">
              {detailTasks.map(t => {
                const project = projectById.get(t.project_id)
                const assignee = personName(people, t.assignee_id)
                const priority = PRIORITIES.find(p => p.id === t.priority)
                return (
                  <li
                    key={t.id}
                    className={cx(
                      'rounded-lg p-2.5 ring-1',
                      isOverdue(t, today)
                        ? 'bg-rose-50 ring-rose-200 dark:bg-rose-950/40 dark:ring-rose-900'
                        : 'bg-slate-50 ring-slate-200 dark:bg-slate-900 dark:ring-slate-800',
                    )}
                  >
                    <div className="flex items-start gap-2">
                      <span
                        aria-hidden="true"
                        className="mt-1 h-2.5 w-2.5 shrink-0 rounded-full"
                        style={{ backgroundColor: project?.color ?? '#94a3b8' }}
                      />
                      <div className="min-w-0 flex-1">
                        <button
                          type="button"
                          onClick={() => { setDetailDay(null); onOpenTask(t) }}
                          className="text-left text-sm font-medium text-slate-900 hover:underline dark:text-slate-100"
                        >
                          {t.title}
                        </button>
                        <p className="mt-0.5 text-xs text-slate-500 dark:text-slate-400">
                          {[project?.name, priority?.label, assignee].filter(Boolean).join(' · ')}
                        </p>
                      </div>
                    </div>

                    <div className="mt-2 flex flex-wrap items-center gap-1.5">
                      <label className="flex items-center gap-1.5 text-xs text-slate-500 dark:text-slate-400">
                        <span>Reschedule</span>
                        <Input
                          type="date"
                          className="w-40 px-2 py-1 text-xs"
                          value={t.due_date?.slice(0, 10) ?? detailDay}
                          onChange={e => { if (e.target.value) void moveTaskToDate(t.id, e.target.value) }}
                          aria-label={`Reschedule ${t.title}`}
                        />
                      </label>
                      <Button
                        variant="outline" size="sm"
                        onClick={() => void moveTaskToDate(t.id, addDaysISO(t.due_date?.slice(0, 10) ?? detailDay, 1))}
                      >
                        +1 day
                      </Button>
                      <Button
                        variant="outline" size="sm"
                        onClick={() => void moveTaskToDate(t.id, addDaysISO(t.due_date?.slice(0, 10) ?? detailDay, 7))}
                      >
                        +1 week
                      </Button>
                    </div>
                  </li>
                )
              })}
            </ul>
          )}
        </Modal>
      )}
    </div>
  )
}
