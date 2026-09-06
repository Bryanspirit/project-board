import { useCallback, useEffect, useMemo, useState } from 'react'
import { supabase } from '../lib/supabase'
import { todayISO } from '../lib/dates'
import { isAtRisk } from '../lib/types'
import type { Milestone, ProjectHealth, TaskActivity, Team } from '../lib/types'

/* ------------------------------------------------------------------ dates --
 * Every date in this file is a plain 'YYYY-MM-DD' calendar day, exactly like
 * `lib/dates.ts`. Date.UTC is used only as a fixed frame to count days in — a
 * date-only string fed to `new Date()` is parsed as UTC midnight, so reading
 * local getters off it lands on the previous day for anyone west of UTC. The
 * one place a real instant becomes a calendar day is `milestoneDay` below,
 * which is documented there.
 */

const DAY_MS = 86_400_000
/** A burndown longer than this is a data mistake, not a window worth walking. */
const MAX_WINDOW_DAYS = 400

function pad(n: number): string {
  return String(n).padStart(2, '0')
}

function dayMs(iso: string): number {
  const [y, m, d] = iso.split('-').map(Number)
  return Date.UTC(y, m - 1, d)
}

function fromMs(ms: number): string {
  const d = new Date(ms)
  return `${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}-${pad(d.getUTCDate())}`
}

/** `iso` shifted by whole days, still as 'YYYY-MM-DD'. */
export function addDays(iso: string, days: number): string {
  return fromMs(dayMs(iso) + days * DAY_MS)
}

/** Whole days from `a` to `b`; negative when `b` is earlier. */
export function diffDays(a: string, b: string): number {
  return Math.round((dayMs(b) - dayMs(a)) / DAY_MS)
}

/** Every calendar day from `from` to `to`, both ends included. */
export function eachDay(from: string, to: string): string[] {
  const span = diffDays(from, to)
  if (span < 0) return []
  const out: string[] = []
  for (let i = 0; i <= Math.min(span, MAX_WINDOW_DAYS); i++) out.push(addDays(from, i))
  return out
}

/** The Monday of the ISO week containing `iso`. */
export function isoWeekStart(iso: string): string {
  const ms = dayMs(iso)
  // getUTCDay: 0 = Sunday. ISO weeks start Monday, so Sunday sits 6 days in.
  const back = (new Date(ms).getUTCDay() + 6) % 7
  return fromMs(ms - back * DAY_MS)
}

export function minDay(a: string, b: string): string { return a < b ? a : b }
export function maxDay(a: string, b: string): string { return a > b ? a : b }

/**
 * A milestone's `due_at` is a `timestamptz` — a real instant, not a calendar
 * day, so it is the one value here that legitimately reads local getters. A
 * deadline of 2026-09-10T23:00Z is "the 10th" in London and "the 11th" in
 * Tokyo; the reader burns down to the day *they* see on their own calendar, so
 * we resolve the instant in the viewer's zone once, here, and everything
 * downstream treats the result as an ordinary 'YYYY-MM-DD'.
 */
export function milestoneDay(dueAt: string): string {
  const d = new Date(dueAt)
  if (Number.isNaN(d.getTime())) return todayISO()
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`
}

/* ------------------------------------------------------------------ shapes -- */

export interface BurndownPoint {
  /** 'YYYY-MM-DD' */
  date: string
  /** Tasks still open at the end of this day. */
  remaining: number
  /** The straight line from the window's starting scope down to zero. */
  ideal: number
}

export interface VelocityWeek {
  /** Monday of the ISO week, 'YYYY-MM-DD'. */
  weekStart: string
  completed: number
  created: number
}

export interface TeamStat {
  teamId: string | null
  teamName: string
  total: number
  done: number
  open: number
  overdue: number
  percent: number
  /** Tasks completed in the last seven days, today included. */
  completedLast7: number
}

export interface AnalyticsSummary {
  open: number
  completedThisWeek: number
  overdue: number
  atRiskTeams: number
}

export interface UseAnalyticsOptions {
  workspaceId: string | undefined
  teamId?: string | null
}

/** Teams are optional on a project, so unassigned work needs a stable bucket. */
const NO_TEAM = '~none'

/**
 * Everything the analytics overlay reads. Nothing is stored per-day anywhere —
 * `task_activity` is one row per live task with the two dates that matter, so
 * a burndown is derived by walking days and counting, and velocity by bucketing
 * the same rows into ISO weeks.
 */
export function useAnalytics({ workspaceId, teamId }: UseAnalyticsOptions) {
  const [activity, setActivity] = useState<TaskActivity[]>([])
  const [milestones, setMilestones] = useState<Milestone[]>([])
  const [health, setHealth] = useState<ProjectHealth[]>([])
  const [teams, setTeams] = useState<Team[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  const refresh = useCallback(async () => {
    if (!workspaceId) {
      setActivity([]); setMilestones([]); setHealth([]); setTeams([])
      setLoading(false)
      return
    }
    setLoading(true)
    // project_health carries the overdue counts task_activity has no due dates
    // for, and teams carries the names; both are small and workspace-scoped.
    const [act, ms, hl, tm] = await Promise.all([
      supabase.from('task_activity').select('*').eq('workspace_id', workspaceId),
      supabase.from('milestones').select('*').eq('workspace_id', workspaceId)
        .order('due_at', { ascending: true }),
      supabase.from('project_health').select('*').eq('workspace_id', workspaceId),
      supabase.from('teams').select('*').eq('workspace_id', workspaceId)
        .order('name', { ascending: true }),
    ])

    const failed = act.error ?? ms.error ?? hl.error ?? tm.error
    setError(failed ? failed.message : null)

    setActivity((act.data ?? []) as TaskActivity[])
    setMilestones((ms.data ?? []) as Milestone[])
    setHealth((hl.data ?? []) as ProjectHealth[])
    setTeams((tm.data ?? []) as Team[])
    setLoading(false)
  }, [workspaceId])

  useEffect(() => { void refresh() }, [refresh])

  /** Rows narrowed to the caller's team, if they asked for one. */
  const rows = useMemo(
    () => (teamId ? activity.filter(a => a.team_id === teamId) : activity),
    [activity, teamId],
  )

  const scopedHealth = useMemo(
    () => (teamId ? health.filter(h => h.team_id === teamId) : health),
    [health, teamId],
  )

  /** The earliest day anything was created — the natural left edge of history. */
  const firstActivityDay = useMemo(() => {
    let first: string | null = null
    for (const r of rows) {
      if (!r.created_on) continue
      if (first === null || r.created_on < first) first = r.created_on
    }
    return first
  }, [rows])

  /**
   * Open tasks at the end of every day in [from, to], against the straight
   * ideal line. Tasks created mid-window are added on the day they appear, so
   * new scope pushes `remaining` *up* — that visible spike is the whole point
   * of a burndown and must never be smoothed away. `ideal` is deliberately
   * pinned to the scope at the window's first day, so the gap between the two
   * lines reads as "what we planned for that is still unpaid, plus everything
   * that has been added since".
   */
  const burndown = useCallback((from: string, to: string): BurndownPoint[] => {
    const days = eachDay(from, to)
    if (days.length === 0) return []
    const last = days[days.length - 1]

    const createdOn = new Map<string, number>()
    const completedOn = new Map<string, number>()
    // Everything already open when the window opened is the carried-in scope.
    let running = 0

    for (const r of rows) {
      const created = r.created_on
      if (!created) continue
      const done = r.completed_on
      if (created < from && (!done || done >= from)) running += 1
      if (created >= from && created <= last) {
        createdOn.set(created, (createdOn.get(created) ?? 0) + 1)
      }
      if (done && done >= from && done <= last) {
        completedOn.set(done, (completedOn.get(done) ?? 0) + 1)
      }
    }

    const points: BurndownPoint[] = days.map(date => {
      running += createdOn.get(date) ?? 0
      running -= completedOn.get(date) ?? 0
      // A row completed before it was created is bad data, not negative work.
      return { date, remaining: Math.max(0, running), ideal: 0 }
    })

    const scope = points[0].remaining
    const span = points.length - 1
    for (let i = 0; i < points.length; i++) {
      points[i].ideal = span === 0 ? scope : scope * (1 - i / span)
    }
    return points
  }, [rows])

  /** Created and completed counts for the last `weeks` ISO weeks, oldest first. */
  const velocity = useCallback((weeks: number): VelocityWeek[] => {
    const count = Math.max(1, Math.floor(weeks))
    const current = isoWeekStart(todayISO())
    const out: VelocityWeek[] = []
    const index = new Map<string, number>()
    for (let i = count - 1; i >= 0; i--) {
      const weekStart = addDays(current, -7 * i)
      index.set(weekStart, out.length)
      out.push({ weekStart, created: 0, completed: 0 })
    }

    for (const r of rows) {
      if (r.created_on) {
        const at = index.get(isoWeekStart(r.created_on))
        if (at !== undefined) out[at].created += 1
      }
      if (r.completed_on) {
        const at = index.get(isoWeekStart(r.completed_on))
        if (at !== undefined) out[at].completed += 1
      }
    }
    return out
  }, [rows])

  /**
   * Per-team totals. The counts come from `project_health` because it is the
   * only source that knows a task is overdue (task_activity carries no due
   * dates); the seven-day completion count comes from `task_activity`, the
   * only source that knows *when* something was finished.
   */
  const teamBreakdown = useCallback((): TeamStat[] => {
    const since = addDays(todayISO(), -6)
    const names = new Map(teams.map(t => [t.id, t.name]))
    const acc = new Map<string, TeamStat>()

    const bucket = (id: string | null): TeamStat => {
      const key = id ?? NO_TEAM
      let row = acc.get(key)
      if (!row) {
        row = {
          teamId: id,
          teamName: id ? names.get(id) ?? 'Unknown team' : 'No team',
          total: 0, done: 0, open: 0, overdue: 0, percent: 0, completedLast7: 0,
        }
        acc.set(key, row)
      }
      return row
    }

    for (const h of scopedHealth) {
      const row = bucket(h.team_id)
      row.total += h.total_tasks
      row.done += h.done_tasks
      row.overdue += h.overdue_tasks
    }
    for (const r of rows) {
      if (r.completed_on && r.completed_on >= since) bucket(r.team_id).completedLast7 += 1
    }

    return [...acc.values()].map(row => ({
      ...row,
      open: Math.max(0, row.total - row.done),
      percent: row.total === 0 ? 0 : Math.round((100 * row.done) / row.total),
    })).sort((a, b) => a.teamName.localeCompare(b.teamName))
  }, [scopedHealth, rows, teams])

  /** The four numbers the panel leads with. */
  const summary = useMemo<AnalyticsSummary>(() => {
    const weekStart = isoWeekStart(todayISO())
    let completedThisWeek = 0
    for (const r of rows) if (r.completed_on && r.completed_on >= weekStart) completedThisWeek += 1

    let open = 0
    let overdue = 0
    const atRisk = new Set<string>()
    for (const h of scopedHealth) {
      open += Math.max(0, h.total_tasks - h.done_tasks)
      overdue += h.overdue_tasks
      if (isAtRisk(h)) atRisk.add(h.team_id ?? NO_TEAM)
    }
    return { open, completedThisWeek, overdue, atRiskTeams: atRisk.size }
  }, [rows, scopedHealth])

  return {
    activity: rows,
    milestones,
    health: scopedHealth,
    teams,
    firstActivityDay,
    summary,
    loading,
    error,
    refresh,
    burndown,
    velocity,
    teamBreakdown,
  }
}
