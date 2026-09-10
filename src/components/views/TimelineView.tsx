import { useEffect, useMemo, useRef, useState } from 'react'
import type { Milestone, Project, Task } from '../../lib/types'
import { MILESTONE_KINDS } from '../../lib/types'
import { todayISO } from '../../lib/dates'
import { Select, Spinner, cx } from '../ui'
import {
  addDaysISO, addMonthsISO, diffDaysISO, formatISODate, instantToLocalISO,
  isoParts, monthStartISO, useSchedule, weekdayISO,
} from '../../hooks/useSchedule'

type Zoom = 'week' | 'month' | 'quarter'

/** Pixels per calendar day at each scale — the only thing zoom really changes. */
const DAY_PX: Record<Zoom, number> = { week: 26, month: 9, quarter: 3.4 }
/** Breathing room either side of the real data, in days. */
const PAD_DAYS: Record<Zoom, number> = { week: 7, month: 14, quarter: 45 }

const TICKS_H = 48   // two header tick rows
const MARKER_H = 22  // strip holding the milestone / today labels
const HEADER_H = TICKS_H + MARKER_H
const ROW_H = 44
const BAR_H = 24

interface Tick { key: string; label: string; days: number; muted?: boolean }

interface Row {
  project: Project
  start: string
  end: string
  done: number
  total: number
  percent: number
}

/** Project colours are stored as `#rrggbb`; append an alpha byte for the track. */
function tint(color: string, alpha: string): string {
  return /^#[0-9a-f]{6}$/i.test(color) ? color + alpha : color
}

function quarterLabel(iso: string): string {
  const { year, month } = isoParts(iso)
  return `Q${Math.floor((month - 1) / 3) + 1} ${year}`
}

/** Clip [from,to] month/quarter spans to the visible range so the two header
 *  rows always add up to exactly the same total width as the chart. */
function spanTicks(start: string, end: string, stepMonths: number, label: (iso: string) => string): Tick[] {
  const ticks: Tick[] = []
  let cursor = monthStartISO(start)
  while (diffDaysISO(cursor, end) >= 0) {
    const next = addMonthsISO(cursor, stepMonths)
    const from = diffDaysISO(start, cursor) < 0 ? start : cursor
    const to = diffDaysISO(next, end) >= 0 ? addDaysISO(next, -1) : end
    ticks.push({ key: from, label: label(cursor), days: diffDaysISO(from, to) + 1 })
    cursor = next
  }
  return ticks
}

function buildTicks(zoom: Zoom, start: string, end: string): { major: Tick[]; minor: Tick[] } {
  const total = diffDaysISO(start, end) + 1

  if (zoom === 'week') {
    const minor: Tick[] = []
    for (let i = 0; i < total; i++) {
      const iso = addDaysISO(start, i)
      minor.push({ key: iso, label: String(isoParts(iso).day), days: 1, muted: weekdayISO(iso) >= 5 })
    }
    const major: Tick[] = []
    for (let i = 0; i < total; i += 7) {
      const iso = addDaysISO(start, i)
      major.push({
        key: iso,
        label: formatISODate(iso, { month: 'short', day: 'numeric' }),
        days: Math.min(7, total - i),
      })
    }
    return { major, minor }
  }

  if (zoom === 'month') {
    const minor: Tick[] = []
    for (let i = 0; i < total; i += 7) {
      const iso = addDaysISO(start, i)
      minor.push({ key: iso, label: String(isoParts(iso).day), days: Math.min(7, total - i) })
    }
    return {
      major: spanTicks(start, end, 1, iso => formatISODate(iso, { month: 'short', year: 'numeric' })),
      minor,
    }
  }

  return {
    major: spanTicks(start, end, 3, quarterLabel),
    minor: spanTicks(start, end, 1, iso => formatISODate(iso, { month: 'narrow' })),
  }
}

function milestoneEmoji(m: Milestone): string {
  return MILESTONE_KINDS.find(k => k.id === m.kind)?.label ?? ''
}

function buildRows(projects: Project[], tasks: Task[]): Row[] {
  const byProject = new Map<string, Task[]>()
  for (const t of tasks) {
    const list = byProject.get(t.project_id)
    if (list) list.push(t)
    else byProject.set(t.project_id, [t])
  }

  return projects.map(project => {
    const list = byProject.get(project.id) ?? []
    const dues = list
      .map(t => t.due_date?.slice(0, 10))
      .filter((d): d is string => Boolean(d))
      .sort()

    // created_at is an instant, so it needs the explicit local-day conversion;
    // every other date here is already a plain calendar day.
    const start = dues[0] ?? instantToLocalISO(project.created_at)
    const latest = dues[dues.length - 1]
    const candidate = project.due_date?.slice(0, 10) ?? latest ?? start
    const end = candidate < start ? start : candidate

    const total = list.length
    const done = list.filter(t => t.status === 'done').length
    return { project, start, end, total, done, percent: total ? Math.round((done / total) * 100) : 0 }
  })
}

export interface TimelineViewProps {
  workspaceId: string | null
  teamId?: string | null
  onOpenProject: (project: Project) => void
  className?: string
}

export default function TimelineView({ workspaceId, teamId = null, onOpenProject, className }: TimelineViewProps) {
  const { projects, tasks, milestones, loading, error } = useSchedule({ workspaceId, teamId })
  const [zoom, setZoom] = useState<Zoom>('month')
  const scrollRef = useRef<HTMLDivElement>(null)

  const today = todayISO()
  const dayPx = DAY_PX[zoom]

  const rows = useMemo(() => buildRows(projects, tasks), [projects, tasks])

  const markers = useMemo(
    () => milestones.map(m => ({ milestone: m, day: instantToLocalISO(m.due_at) })),
    [milestones],
  )

  const range = useMemo(() => {
    const dates = [today]
    for (const r of rows) dates.push(r.start, r.end)
    for (const m of markers) dates.push(m.day)

    let min = dates[0]
    let max = dates[0]
    for (const d of dates) {
      if (d < min) min = d
      if (d > max) max = d
    }

    let start = addDaysISO(min, -PAD_DAYS[zoom])
    let end = addDaysISO(max, PAD_DAYS[zoom])
    if (zoom === 'quarter') {
      start = monthStartISO(start)
      end = addDaysISO(addMonthsISO(monthStartISO(end), 1), -1)
    } else {
      start = addDaysISO(start, -weekdayISO(start))
      end = addDaysISO(end, 6 - weekdayISO(end))
    }
    return { start, end, days: diffDaysISO(start, end) + 1 }
  }, [markers, rows, today, zoom])

  const { major, minor } = useMemo(
    () => buildTicks(zoom, range.start, range.end),
    [range.end, range.start, zoom],
  )

  const contentWidth = range.days * dayPx
  const bodyHeight = Math.max(rows.length, 1) * ROW_H

  // Centre the viewport on today whenever the scale changes; honour the user's
  // motion preference rather than always animating the jump.
  useEffect(() => {
    const el = scrollRef.current
    if (!el) return
    const x = diffDaysISO(range.start, today) * dayPx
    const reduce = window.matchMedia('(prefers-reduced-motion: reduce)').matches
    el.scrollTo({ left: Math.max(0, x - el.clientWidth / 3), behavior: reduce ? 'auto' : 'smooth' })
  }, [dayPx, range.start, today, zoom])

  const xOf = (iso: string) => diffDaysISO(range.start, iso) * dayPx

  if (loading) {
    return (
      <div className={cx('flex min-h-64 items-center justify-center', className)}>
        <Spinner className="h-6 w-6 text-indigo-500" />
        <span className="sr-only">Loading timeline</span>
      </div>
    )
  }

  return (
    <div className={cx('flex min-w-0 flex-col gap-3', className)}>
      {/* ------------------------------------------------------- toolbar -- */}
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h2 className="text-base font-semibold text-slate-900 dark:text-slate-100">Timeline</h2>
        <label className="flex items-center gap-2 text-xs text-slate-500 dark:text-slate-400">
          <span>Scale</span>
          <Select
            className="w-32 py-1.5 text-xs"
            value={zoom}
            onChange={e => setZoom(e.target.value as Zoom)}
          >
            <option value="week">Week</option>
            <option value="month">Month</option>
            <option value="quarter">Quarter</option>
          </Select>
        </label>
      </div>

      {error && (
        <p role="alert" className="rounded-lg bg-rose-50 px-3 py-2 text-xs text-rose-700 dark:bg-rose-950/60 dark:text-rose-300">
          {error}
        </p>
      )}

      {rows.length === 0 ? (
        <div className="rounded-xl border border-dashed border-slate-300 px-6 py-12 text-center dark:border-slate-700">
          <p className="text-sm font-medium text-slate-700 dark:text-slate-200">Nothing to plot yet</p>
          <p className="mt-1 text-xs text-slate-500 dark:text-slate-400">
            Create a project and give its tasks due dates — bars appear here as soon as there is a date to span.
          </p>
        </div>
      ) : (
        <div className="flex min-w-0 overflow-hidden rounded-xl bg-white ring-1 ring-slate-200 dark:bg-slate-900 dark:ring-slate-800">
          {/* ------------------------------------------- pinned row labels -- */}
          <div className="w-40 shrink-0 border-r border-slate-200 sm:w-52 dark:border-slate-800">
            <div
              style={{ height: HEADER_H }}
              className="flex items-end border-b border-slate-200 px-3 pb-1.5 text-[11px] font-semibold tracking-wide text-slate-500 uppercase dark:border-slate-800 dark:text-slate-400"
            >
              Project
            </div>
            {rows.map((row, i) => (
              <div
                key={row.project.id}
                style={{ height: ROW_H }}
                className={cx(
                  'flex items-center gap-2 px-3',
                  i % 2 === 1 && 'bg-slate-50 dark:bg-slate-950/40',
                )}
              >
                <span
                  aria-hidden="true"
                  className="h-2.5 w-2.5 shrink-0 rounded-full"
                  style={{ backgroundColor: row.project.color }}
                />
                <span className="truncate text-xs font-medium text-slate-800 dark:text-slate-100" title={row.project.name}>
                  {row.project.name}
                </span>
              </div>
            ))}
          </div>

          {/* ------------------------------------------------ scrolling chart -- */}
          <div ref={scrollRef} className="min-w-0 flex-1 overflow-x-auto">
            <div className="relative" style={{ width: contentWidth }}>
              {/* header ticks */}
              <div className="border-b border-slate-200 dark:border-slate-800">
                <div className="flex" style={{ height: TICKS_H / 2 }}>
                  {major.map(t => (
                    <div
                      key={`major-${t.key}`}
                      style={{ width: t.days * dayPx }}
                      className="flex items-center overflow-hidden border-r border-slate-200 px-1.5 text-[11px] font-semibold whitespace-nowrap text-slate-600 dark:border-slate-800 dark:text-slate-300"
                    >
                      {t.label}
                    </div>
                  ))}
                </div>
                <div className="flex" style={{ height: TICKS_H / 2 }}>
                  {minor.map(t => (
                    <div
                      key={`minor-${t.key}`}
                      style={{ width: t.days * dayPx }}
                      className={cx(
                        'flex items-center justify-center overflow-hidden border-r border-slate-100 text-[10px] dark:border-slate-800/60',
                        t.muted ? 'bg-slate-50 text-slate-400 dark:bg-slate-950/50 dark:text-slate-600' : 'text-slate-500 dark:text-slate-400',
                      )}
                    >
                      {t.label}
                    </div>
                  ))}
                </div>
              </div>

              {/* milestone + today labels */}
              <div className="relative" style={{ height: MARKER_H }}>
                {markers.map(({ milestone, day }) => (
                  <span
                    key={`label-${milestone.id}`}
                    style={{ left: xOf(day) + dayPx / 2 }}
                    className="absolute top-0.5 -translate-x-1/2 rounded bg-indigo-600 px-1.5 py-0.5 text-[10px] font-semibold whitespace-nowrap text-white dark:bg-indigo-500"
                  >
                    <span aria-hidden="true">{milestoneEmoji(milestone)}</span> {milestone.name}
                  </span>
                ))}
                <span
                  style={{ left: xOf(today) + dayPx / 2 }}
                  className="absolute top-0.5 -translate-x-1/2 rounded bg-emerald-600 px-1.5 py-0.5 text-[10px] font-semibold whitespace-nowrap text-white dark:bg-emerald-500"
                >
                  Today
                </span>
              </div>

              {/* vertical lines run from the marker strip to the bottom row */}
              <div className="pointer-events-none absolute inset-x-0 z-10" style={{ top: TICKS_H, height: MARKER_H + bodyHeight }}>
                {markers.map(({ milestone, day }) => (
                  <span
                    key={`line-${milestone.id}`}
                    style={{ left: xOf(day) + dayPx / 2 }}
                    className="absolute inset-y-0 w-px bg-indigo-500/70"
                  />
                ))}
                <span
                  style={{ left: xOf(today) + dayPx / 2 }}
                  className="absolute inset-y-0 w-0.5 bg-emerald-500"
                />
              </div>

              {/* bars */}
              <div className="relative" style={{ height: bodyHeight }}>
                {rows.map((row, i) => (
                  <div
                    key={`band-${row.project.id}`}
                    style={{ top: i * ROW_H, height: ROW_H }}
                    className={cx('absolute inset-x-0', i % 2 === 1 && 'bg-slate-50 dark:bg-slate-950/40')}
                  />
                ))}

                {rows.map((row, i) => {
                  const left = xOf(row.start)
                  const width = Math.max((diffDaysISO(row.start, row.end) + 1) * dayPx, 6)
                  const label = `${row.project.name}, ${formatISODate(row.start, { month: 'short', day: 'numeric', year: 'numeric' })} to ${formatISODate(row.end, { month: 'short', day: 'numeric', year: 'numeric' })}, ${row.percent}% complete, ${row.done} of ${row.total} tasks done`

                  return (
                    <button
                      key={row.project.id}
                      type="button"
                      onClick={() => onOpenProject(row.project)}
                      aria-label={label}
                      title={label}
                      style={{
                        left,
                        width,
                        top: i * ROW_H + (ROW_H - BAR_H) / 2,
                        height: BAR_H,
                        backgroundColor: tint(row.project.color, '33'),
                      }}
                      className="absolute overflow-hidden rounded-md ring-1 ring-inset ring-black/10 transition hover:ring-2 hover:ring-indigo-400 focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-indigo-500 motion-reduce:transition-none dark:ring-white/10"
                    >
                      <span
                        aria-hidden="true"
                        className="absolute inset-y-0 left-0 rounded-l-md"
                        style={{ width: `${row.percent}%`, backgroundColor: row.project.color }}
                      />
                      {/* The chip background keeps the label readable over both
                          the pale track and the solid progress fill. */}
                      <span className="relative z-10 m-0.5 block truncate rounded-sm bg-white/80 px-1.5 text-left text-[11px] leading-5 font-medium text-slate-900 dark:bg-slate-900/75 dark:text-slate-50">
                        {row.project.name} · {row.percent}%
                      </span>
                    </button>
                  )
                })}
              </div>
            </div>
          </div>
        </div>
      )}

      {/* -------------------------------------------------------- legend -- */}
      <ul className="flex flex-wrap items-center gap-x-4 gap-y-1.5 text-[11px] text-slate-500 dark:text-slate-400">
        <li className="flex items-center gap-1.5">
          <span aria-hidden="true" className="h-2.5 w-8 overflow-hidden rounded-sm bg-slate-300 dark:bg-slate-700">
            <span className="block h-full w-1/2 bg-slate-500 dark:bg-slate-400" />
          </span>
          Filled portion = tasks completed
        </li>
        <li className="flex items-center gap-1.5">
          <span aria-hidden="true" className="h-3 w-0.5 bg-emerald-500" />
          Today
        </li>
        <li className="flex items-center gap-1.5">
          <span aria-hidden="true" className="h-3 w-px bg-indigo-500" />
          Milestone
        </li>
        <li>Bar colour = project</li>
      </ul>
    </div>
  )
}
