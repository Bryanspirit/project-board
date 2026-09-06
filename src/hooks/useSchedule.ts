import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { supabase } from '../lib/supabase'
import type { Milestone, Project, Task } from '../lib/types'

/**
 * Calendar / timeline data for one workspace.
 *
 * Every date this hook hands out is a plain 'YYYY-MM-DD' calendar day, because
 * that is what `tasks.due_date` and `projects.due_date` actually are. The
 * helpers below do their arithmetic in UTC on those strings and never read a
 * local getter off a date-only value — doing that shifts the day backwards for
 * anyone west of UTC (a task due 2026-09-06 would render on the 5th).
 *
 * Visibility is not filtered here: row level security already returns only the
 * rows the caller may see. The workspace / team filters are for focus.
 */

// ------------------------------------------------------------ date maths --

function pad2(n: number): string {
  return String(n).padStart(2, '0')
}

export interface IsoParts { year: number; month: number; day: number }

export function isoParts(iso: string): IsoParts {
  const [year, month, day] = iso.split('-').map(Number)
  return { year, month, day }
}

/** Midnight UTC for a date-only string — the anchor all the maths below uses. */
function utcOf(iso: string): number {
  const { year, month, day } = isoParts(iso)
  return Date.UTC(year, month - 1, day)
}

function isoOf(utcMs: number): string {
  const d = new Date(utcMs)
  return `${d.getUTCFullYear()}-${pad2(d.getUTCMonth() + 1)}-${pad2(d.getUTCDate())}`
}

export function addDaysISO(iso: string, days: number): string {
  return isoOf(utcOf(iso) + days * 86_400_000)
}

/** Whole days from `from` to `to`; negative when `to` is earlier. */
export function diffDaysISO(from: string, to: string): number {
  return Math.round((utcOf(to) - utcOf(from)) / 86_400_000)
}

/** 0 = Monday … 6 = Sunday. Every grid in this feature is Monday-first. */
export function weekdayISO(iso: string): number {
  return (new Date(utcOf(iso)).getUTCDay() + 6) % 7
}

export function daysInMonth(year: number, month: number): number {
  // Day 0 of the following month is the last day of this one.
  return new Date(Date.UTC(year, month, 0)).getUTCDate()
}

export function monthStartISO(iso: string): string {
  const { year, month } = isoParts(iso)
  return `${year}-${pad2(month)}-01`
}

export function addMonthsISO(iso: string, months: number): string {
  const { year, month, day } = isoParts(iso)
  const total = year * 12 + (month - 1) + months
  const y = Math.floor(total / 12)
  const m = ((total % 12) + 12) % 12 + 1
  return `${y}-${pad2(m)}-${pad2(Math.min(day, daysInMonth(y, m)))}`
}

/** Format a calendar day for display. Pinned to UTC so the day that goes in is
 *  the day that comes out, wherever the reader sits. */
export function formatISODate(iso: string, opts: Intl.DateTimeFormatOptions): string {
  const { year, month, day } = isoParts(iso)
  return new Date(Date.UTC(year, month - 1, day)).toLocaleDateString(undefined, { ...opts, timeZone: 'UTC' })
}

/**
 * Collapse a `timestamptz` to the calendar day it falls on **for this viewer**.
 *
 * Unlike a due date, `milestones.due_at` (and `created_at`) is a real instant,
 * so there is no timezone-free answer: a deadline at 2026-09-07T01:00Z is the
 * 6th in New York and the 7th in Accra. Local getters are the correct reading
 * for an instant, and this is the only place in the feature they are used.
 */
export function instantToLocalISO(instant: string): string {
  const d = new Date(instant)
  return `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}`
}

// ------------------------------------------------------------------ hook --

export interface UseScheduleArgs {
  workspaceId: string | null | undefined
  teamId?: string | null
}

export interface UseScheduleResult {
  tasks: Task[]
  tasksByDate: Map<string, Task[]>
  projects: Project[]
  projectById: Map<string, Project>
  milestones: Milestone[]
  milestonesByDate: Map<string, Milestone[]>
  loading: boolean
  error: string | null
  refresh: () => Promise<void>
  moveTaskToDate: (taskId: string, isoDate: string) => Promise<void>
}

export function useSchedule({ workspaceId, teamId = null }: UseScheduleArgs): UseScheduleResult {
  const [projects, setProjects] = useState<Project[]>([])
  const [tasks, setTasks] = useState<Task[]>([])
  const [milestones, setMilestones] = useState<Milestone[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  // Guards a slow load from overwriting a faster later one after the workspace
  // or team changed underneath it.
  const runRef = useRef(0)
  const tasksRef = useRef<Task[]>([])
  useEffect(() => { tasksRef.current = tasks }, [tasks])

  const refresh = useCallback(async () => {
    const run = ++runRef.current
    if (!workspaceId) {
      setProjects([]); setTasks([]); setMilestones([]); setError(null); setLoading(false)
      return
    }
    setLoading(true)

    let projectQuery = supabase.from('projects').select('*')
      .eq('workspace_id', workspaceId).is('deleted_at', null)
    if (teamId) projectQuery = projectQuery.eq('team_id', teamId)
    const { data: projectRows, error: projectErr } =
      await projectQuery.order('sort_order', { ascending: true })
    if (run !== runRef.current) return
    if (projectErr) { setError(projectErr.message); setLoading(false); return }

    const live = (projectRows ?? []) as Project[]
    const ids = live.map(p => p.id)

    let taskRows: Task[] = []
    if (ids.length > 0) {
      const { data, error: taskErr } = await supabase.from('tasks').select('*')
        .in('project_id', ids).is('deleted_at', null)
        .order('due_date', { ascending: true })
        .order('sort_order', { ascending: true })
      if (run !== runRef.current) return
      if (taskErr) { setError(taskErr.message); setLoading(false); return }
      taskRows = (data ?? []) as Task[]
    }

    const { data: milestoneRows, error: milestoneErr } = await supabase.from('milestones')
      .select('*').eq('workspace_id', workspaceId).order('due_at', { ascending: true })
    if (run !== runRef.current) return
    if (milestoneErr) { setError(milestoneErr.message); setLoading(false); return }

    setError(null)
    setProjects(live)
    setTasks(taskRows)
    setMilestones((milestoneRows ?? []) as Milestone[])
    setLoading(false)
  }, [workspaceId, teamId])

  useEffect(() => { void refresh() }, [refresh])

  /** Reschedule a task onto a calendar day. Optimistic, rolled back on failure. */
  const moveTaskToDate = useCallback(async (taskId: string, isoDate: string) => {
    const before = tasksRef.current.find(t => t.id === taskId)
    if (!before || before.due_date === isoDate) return

    setTasks(prev => prev.map(t => (t.id === taskId ? { ...t, due_date: isoDate } : t)))
    const { error: err } = await supabase.from('tasks').update({ due_date: isoDate }).eq('id', taskId)
    if (err) {
      setError(err.message)
      setTasks(prev => prev.map(t => (t.id === taskId ? { ...t, due_date: before.due_date } : t)))
    }
  }, [])

  const tasksByDate = useMemo(() => {
    const map = new Map<string, Task[]>()
    for (const t of tasks) {
      if (!t.due_date) continue
      // Postgres hands back `date` as 'YYYY-MM-DD'; slice is belt and braces in
      // case a caller ever writes a full timestamp into the column.
      const key = t.due_date.slice(0, 10)
      const list = map.get(key)
      if (list) list.push(t)
      else map.set(key, [t])
    }
    return map
  }, [tasks])

  const projectById = useMemo(() => new Map(projects.map(p => [p.id, p])), [projects])

  const milestonesByDate = useMemo(() => {
    const map = new Map<string, Milestone[]>()
    for (const m of milestones) {
      const key = instantToLocalISO(m.due_at)
      const list = map.get(key)
      if (list) list.push(m)
      else map.set(key, [m])
    }
    return map
  }, [milestones])

  return {
    tasks, tasksByDate, projects, projectById, milestones, milestonesByDate,
    loading, error, refresh, moveTaskToDate,
  }
}
