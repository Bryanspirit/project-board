import { useEffect, useMemo, useState } from 'react'
import { Button, Select, Spinner, cx } from '../ui'
import { todayISO } from '../../lib/dates'
import { addDays, maxDay, milestoneDay, minDay, useAnalytics } from '../../hooks/useAnalytics'
import BurndownChart from './BurndownChart'
import VelocityChart from './VelocityChart'
import type { ReactNode } from 'react'
import type { TeamStat } from '../../hooks/useAnalytics'

export interface AnalyticsPanelProps {
  workspaceId: string
  /** Narrow every number to one team. Omit for the whole workspace. */
  teamId?: string | null
  /** Managers see every team's breakdown and can force a refetch. */
  canManage: boolean
  onClose: () => void
}

const WINDOWS = [14, 30, 60, 90]
const WEEK_COUNTS = [6, 8, 12, 26]

type SortKey = 'team' | 'total' | 'done' | 'open' | 'overdue' | 'percent' | 'recent'
type Dir = 'asc' | 'desc'

const COLUMNS: { key: SortKey; label: string; align?: 'right'; hint?: string }[] = [
  { key: 'team', label: 'Team' },
  { key: 'percent', label: 'Progress' },
  { key: 'total', label: 'Tasks', align: 'right' },
  { key: 'done', label: 'Done', align: 'right' },
  { key: 'open', label: 'Open', align: 'right' },
  { key: 'overdue', label: 'Overdue', align: 'right' },
  { key: 'recent', label: 'Last 7d', align: 'right', hint: 'Tasks completed in the last seven days' },
]

function sortValue(row: TeamStat, key: SortKey): string | number {
  switch (key) {
    case 'team': return row.teamName.toLowerCase()
    case 'total': return row.total
    case 'done': return row.done
    case 'open': return row.open
    case 'overdue': return row.overdue
    case 'percent': return row.percent
    case 'recent': return row.completedLast7
  }
}

/** Label · value · optional note. The value carries proportional figures — a
 *  standalone number reads loose in tabular digits. */
function Tile({ label, value, note, tone }: {
  label: string
  value: number
  note?: ReactNode
  tone?: 'critical' | 'warning'
}) {
  return (
    <div className="rounded-xl bg-white p-4 ring-1 ring-slate-200 dark:bg-slate-900 dark:ring-slate-800">
      <p className="text-xs font-medium text-slate-500 dark:text-slate-400">{label}</p>
      <p className={cx(
        'mt-1 text-3xl font-semibold',
        tone === 'critical' ? 'text-rose-600 dark:text-rose-400'
          : tone === 'warning' ? 'text-amber-600 dark:text-amber-400'
            : 'text-slate-900 dark:text-slate-50',
      )}>
        {value}
      </p>
      {note && <p className="mt-1 text-xs text-slate-500 dark:text-slate-400">{note}</p>}
    </div>
  )
}

function Card({ title, subtitle, children }: { title: string; subtitle?: string; children: ReactNode }) {
  return (
    <section className="rounded-xl bg-white p-4 ring-1 ring-slate-200 sm:p-5 dark:bg-slate-900 dark:ring-slate-800">
      <header className="mb-3">
        <h2 className="text-sm font-semibold text-slate-900 dark:text-slate-50">{title}</h2>
        {subtitle && <p className="mt-0.5 text-xs text-slate-500 dark:text-slate-400">{subtitle}</p>}
      </header>
      {children}
    </section>
  )
}

export default function AnalyticsPanel({ workspaceId, teamId, canManage, onClose }: AnalyticsPanelProps) {
  const {
    milestones, summary, firstActivityDay, loading, error, refresh,
    burndown, velocity, teamBreakdown,
  } = useAnalytics({ workspaceId, teamId })

  const [milestoneId, setMilestoneId] = useState('')
  const [windowDays, setWindowDays] = useState(30)
  const [weekCount, setWeekCount] = useState(8)
  const [sort, setSort] = useState<{ key: SortKey; dir: Dir }>({ key: 'overdue', dir: 'desc' })

  useEffect(() => {
    const esc = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose() }
    window.addEventListener('keydown', esc)
    document.body.style.overflow = 'hidden'
    return () => {
      window.removeEventListener('keydown', esc)
      document.body.style.overflow = ''
    }
  }, [onClose])

  const today = todayISO()

  /** '' means "whatever deadline is next"; 'none' burns down to today. */
  const milestone = useMemo(() => {
    if (milestoneId === 'none') return null
    const picked = milestones.find(m => m.id === milestoneId)
    if (picked) return picked
    return milestones.find(m => milestoneDay(m.due_at) >= today)
      ?? milestones[milestones.length - 1]
      ?? null
  }, [milestoneId, milestones, today])

  const points = useMemo(() => {
    const to = milestone ? milestoneDay(milestone.due_at) : today
    // The window is measured back from whichever comes first — a deadline in
    // three weeks must not push the window's start into the future.
    let from = addDays(minDay(today, to), -windowDays)
    if (firstActivityDay && firstActivityDay > from) from = firstActivityDay
    if (from > to) from = addDays(to, -windowDays)
    return burndown(minDay(from, to), maxDay(from, to))
  }, [burndown, milestone, firstActivityDay, windowDays, today])

  const weeks = useMemo(() => velocity(weekCount), [velocity, weekCount])

  const rows = useMemo(() => {
    // A member without manage rights sees their own team's row, not everyone's.
    const all = teamBreakdown()
    const scoped = canManage ? all : all.filter(r => r.teamId === (teamId ?? null))
    const factor = sort.dir === 'asc' ? 1 : -1
    return [...scoped].sort((a, b) => {
      const av = sortValue(a, sort.key)
      const bv = sortValue(b, sort.key)
      const cmp = typeof av === 'string' && typeof bv === 'string'
        ? av.localeCompare(bv)
        : Number(av) - Number(bv)
      return cmp * factor || a.teamName.localeCompare(b.teamName)
    })
  }, [teamBreakdown, canManage, teamId, sort])

  const hasData = points.length > 0 || weeks.some(w => w.created > 0 || w.completed > 0)
  // Refetch keeps the frame: hold the previous render at reduced opacity rather
  // than flashing a skeleton and jumping the layout.
  const refetching = loading && hasData

  const toggleSort = (key: SortKey) => {
    setSort(s => (s.key === key
      ? { key, dir: s.dir === 'asc' ? 'desc' : 'asc' }
      : { key, dir: key === 'team' ? 'asc' : 'desc' }))
  }

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label="Delivery analytics"
      className="fixed inset-0 z-50 flex flex-col bg-slate-50 dark:bg-slate-950"
    >
      <header className="shrink-0 border-b border-slate-200 bg-white px-4 py-3 sm:px-6 dark:border-slate-800 dark:bg-slate-900">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <h1 className="text-lg font-semibold text-slate-900 dark:text-slate-50">Delivery analytics</h1>
            <p className="mt-0.5 text-sm text-slate-500 dark:text-slate-400">
              {teamId ? 'One team’s' : 'The whole workspace’s'} burndown, velocity and team split.
            </p>
          </div>
          <div className="flex shrink-0 items-center gap-2">
            {canManage && (
              <Button size="sm" variant="outline" onClick={() => void refresh()} disabled={loading}>
                {loading ? <Spinner className="h-3.5 w-3.5" /> : null}
                Refresh
              </Button>
            )}
            <button
              onClick={onClose}
              aria-label="Close analytics"
              className="rounded-lg p-1.5 text-slate-400 transition hover:bg-slate-100 hover:text-slate-700 dark:hover:bg-slate-800 dark:hover:text-slate-200"
            >
              <svg viewBox="0 0 20 20" className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth="2">
                <path d="M5 5l10 10M15 5L5 15" strokeLinecap="round" />
              </svg>
            </button>
          </div>
        </div>

        {/* One filter row, above everything it scopes. */}
        <div className="mt-3 flex flex-wrap items-end gap-3">
          <label className="block">
            <span className="mb-1 block text-xs font-medium text-slate-600 dark:text-slate-400">Burn down to</span>
            <Select
              className="w-56"
              value={milestoneId}
              onChange={e => setMilestoneId(e.target.value)}
              aria-label="Milestone the burndown targets"
            >
              <option value="">Next deadline (auto)</option>
              <option value="none">No deadline — to today</option>
              {milestones.map(m => (
                <option key={m.id} value={m.id}>{m.name} · {milestoneDay(m.due_at)}</option>
              ))}
            </Select>
          </label>
          <label className="block">
            <span className="mb-1 block text-xs font-medium text-slate-600 dark:text-slate-400">History</span>
            <Select
              className="w-32"
              value={String(windowDays)}
              onChange={e => setWindowDays(Number(e.target.value))}
              aria-label="Days of history in the burndown"
            >
              {WINDOWS.map(d => <option key={d} value={d}>Last {d} days</option>)}
            </Select>
          </label>
          <label className="block">
            <span className="mb-1 block text-xs font-medium text-slate-600 dark:text-slate-400">Velocity</span>
            <Select
              className="w-32"
              value={String(weekCount)}
              onChange={e => setWeekCount(Number(e.target.value))}
              aria-label="Number of weeks in the velocity chart"
            >
              {WEEK_COUNTS.map(w => <option key={w} value={w}>{w} weeks</option>)}
            </Select>
          </label>
        </div>
      </header>

      {error && (
        <div role="alert" className="shrink-0 bg-rose-50 px-4 py-2 text-xs text-rose-700 sm:px-6 dark:bg-rose-950/50 dark:text-rose-300">
          {error}
        </div>
      )}

      {/* The overlay owns the only vertical scroll; the page body is locked. */}
      <div className="min-h-0 flex-1 overflow-y-auto px-4 py-5 sm:px-6">
        <div className={cx('mx-auto max-w-5xl space-y-5 transition-opacity', refetching && 'opacity-60')}>

          <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
            <Tile label="Open tasks" value={summary.open} note="Not done right now" />
            <Tile label="Completed this week" value={summary.completedThisWeek} note="Since Monday" />
            <Tile label="Overdue" value={summary.overdue} tone={summary.overdue > 0 ? 'critical' : undefined}
              note={summary.overdue > 0 ? 'Past due and still open' : 'Nothing past due'} />
            <Tile label="At-risk teams" value={summary.atRiskTeams} tone={summary.atRiskTeams > 0 ? 'warning' : undefined}
              note="Overdue work that is blocked or stale" />
          </div>

          <Card
            title="Burndown"
            subtitle={milestone
              ? `Open tasks against the ideal line to ${milestone.name} (${milestoneDay(milestone.due_at)}).`
              : 'Open tasks against the ideal line. Scope added mid-window pushes the line up.'}
          >
            <BurndownChart
              points={points}
              milestone={milestone}
              today={today}
              loading={loading && !hasData}
            />
          </Card>

          <Card title="Velocity" subtitle={`Created against completed for the last ${weekCount} ISO weeks.`}>
            <VelocityChart weeks={weeks} loading={loading && !hasData} />
          </Card>

          <Card
            title="Team breakdown"
            subtitle={canManage
              ? 'Every team in the workspace. Click a column to sort.'
              : 'Your team. Workspace-wide numbers need manage rights.'}
          >
            {rows.length === 0 ? (
              <p className="py-6 text-center text-sm text-slate-500 dark:text-slate-400">
                No teams with tasks yet.
              </p>
            ) : (
              /* Wide content scrolls in its own box, never the page. */
              <div className="-mx-1 overflow-x-auto px-1">
                <table className="w-full min-w-[36rem] text-sm">
                  <thead>
                    <tr className="border-b border-slate-200 text-left dark:border-slate-800">
                      {COLUMNS.map(col => {
                        const isSorted = sort.key === col.key
                        return (
                          <th
                            key={col.key}
                            scope="col"
                            title={col.hint}
                            aria-sort={isSorted ? (sort.dir === 'asc' ? 'ascending' : 'descending') : 'none'}
                            className={cx('py-2 font-medium', col.align === 'right' && 'text-right')}
                          >
                            <button
                              type="button"
                              onClick={() => toggleSort(col.key)}
                              className={cx(
                                'inline-flex items-center gap-1 rounded px-1 py-0.5 text-xs transition',
                                'hover:bg-slate-100 dark:hover:bg-slate-800',
                                isSorted ? 'text-slate-900 dark:text-slate-100' : 'text-slate-500 dark:text-slate-400',
                              )}
                            >
                              {col.label}
                              <span aria-hidden className={cx('text-[10px]', !isSorted && 'opacity-0')}>
                                {sort.dir === 'asc' ? '▲' : '▼'}
                              </span>
                            </button>
                          </th>
                        )
                      })}
                    </tr>
                  </thead>
                  <tbody>
                    {rows.map(row => (
                      <tr key={row.teamId ?? 'none'} className="border-b border-slate-100 last:border-0 dark:border-slate-800/60">
                        <th scope="row" className="max-w-56 truncate py-2 pr-3 text-left font-medium text-slate-800 dark:text-slate-100">
                          {row.teamName}
                        </th>
                        <td className="py-2 pr-3">
                          <div className="flex items-center gap-2">
                            <div
                              className="h-1.5 w-24 shrink-0 overflow-hidden rounded-full bg-slate-200 dark:bg-slate-700"
                              role="progressbar"
                              aria-valuenow={row.percent}
                              aria-valuemin={0}
                              aria-valuemax={100}
                              aria-label={`${row.teamName}: ${row.percent}% done`}
                            >
                              <div className="h-full rounded-full bg-sky-600 dark:bg-sky-500" style={{ width: `${row.percent}%` }} />
                            </div>
                            <span className="w-9 shrink-0 text-right text-xs tabular-nums text-slate-600 dark:text-slate-300">
                              {row.percent}%
                            </span>
                          </div>
                        </td>
                        <td className="py-2 text-right tabular-nums text-slate-600 dark:text-slate-300">{row.total}</td>
                        <td className="py-2 text-right tabular-nums text-slate-600 dark:text-slate-300">{row.done}</td>
                        <td className="py-2 text-right tabular-nums text-slate-600 dark:text-slate-300">{row.open}</td>
                        <td className="py-2 text-right tabular-nums">
                          {row.overdue > 0 ? (
                            <span className="inline-flex items-center gap-1 rounded-md bg-rose-100 px-1.5 py-0.5 text-xs font-semibold text-rose-700 dark:bg-rose-950 dark:text-rose-300">
                              <svg viewBox="0 0 12 12" className="h-3 w-3" fill="none" stroke="currentColor" strokeWidth="1.5" aria-hidden>
                                <path d="M6 1.5 11 10.5H1z" strokeLinejoin="round" />
                                <path d="M6 5v2.5M6 9h.01" strokeLinecap="round" />
                              </svg>
                              {row.overdue}
                            </span>
                          ) : (
                            <span className="text-slate-400">0</span>
                          )}
                        </td>
                        <td className="py-2 text-right tabular-nums text-slate-600 dark:text-slate-300">{row.completedLast7}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </Card>
        </div>
      </div>
    </div>
  )
}
