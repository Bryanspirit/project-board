import { useEffect, useMemo, useState } from 'react'
import { supabase } from '../../lib/supabase'
import { useAuth } from '../../lib/auth'
import type { Task, TaskPriority } from '../../lib/types'
import { PRIORITIES } from '../../lib/types'
import { daysUntil, dueTone, formatDue } from '../../lib/dates'
import { Button, Spinner, cx } from '../ui'

/** Just enough of the project (and the workspace above it) to say where a task
 *  lives. Embedded on the task row by PostgREST. */
interface TaskHome {
  id: string
  name: string
  color: string
  workspace_id: string
  team_id: string | null
  workspace?: { id: string; name: string; emoji: string } | null
}

type Row = Task & { project: TaskHome | null }

const SELECT_EMBEDDED =
  '*, project:projects(id,name,color,workspace_id,team_id,workspace:workspaces(id,name,emoji))'

const DUE_TONE = {
  overdue: 'bg-rose-50 text-rose-700 ring-rose-200 dark:bg-rose-950/60 dark:text-rose-300 dark:ring-rose-900',
  today:   'bg-amber-50 text-amber-700 ring-amber-200 dark:bg-amber-950/60 dark:text-amber-300 dark:ring-amber-900',
  soon:    'bg-slate-100 text-slate-600 ring-slate-200 dark:bg-slate-800 dark:text-slate-300 dark:ring-slate-700',
  later:   'bg-slate-100 text-slate-500 ring-slate-200 dark:bg-slate-800 dark:text-slate-400 dark:ring-slate-700',
}

const PRIORITY_RANK: Record<TaskPriority, number> = { urgent: 0, high: 1, medium: 2, low: 3 }

type BucketId = 'overdue' | 'today' | 'week' | 'later' | 'none'

const BUCKETS: { id: BucketId; label: string; accent: string }[] = [
  { id: 'overdue', label: 'Overdue',     accent: 'bg-rose-500' },
  { id: 'today',   label: 'Today',       accent: 'bg-amber-500' },
  { id: 'week',    label: 'This week',   accent: 'bg-sky-500' },
  { id: 'later',   label: 'Later',       accent: 'bg-indigo-500' },
  { id: 'none',    label: 'No due date', accent: 'bg-slate-400' },
]

/** Buckets on the plain 'YYYY-MM-DD' string — `new Date(iso)` would parse it as
 *  UTC midnight and slide a due date into the wrong day west of Greenwich. */
function bucketOf(due: string | null): BucketId {
  if (!due) return 'none'
  const d = daysUntil(due)
  if (d < 0) return 'overdue'
  if (d === 0) return 'today'
  if (d <= 7) return 'week'
  return 'later'
}

/** Soonest first, then the loudest priority. Undated rows fall back to priority. */
function compareRows(a: Row, b: Row): number {
  if (a.due_date && b.due_date && a.due_date !== b.due_date) return a.due_date < b.due_date ? -1 : 1
  if (a.due_date && !b.due_date) return -1
  if (!a.due_date && b.due_date) return 1
  return PRIORITY_RANK[a.priority] - PRIORITY_RANK[b.priority]
}

/** The embed is one round trip; this is the two-query version for when the
 *  relationship cannot be resolved (a missing FK, a stale schema cache). */
async function loadStitched(userId: string): Promise<Row[]> {
  const { data: t, error } = await supabase.from('tasks').select('*')
    .eq('assignee_id', userId).neq('status', 'done').is('deleted_at', null)
  if (error) throw new Error(error.message)

  const tasks = (t ?? []) as Task[]
  const projectIds = [...new Set(tasks.map(x => x.project_id))]
  if (projectIds.length === 0) return tasks.map(x => ({ ...x, project: null }))

  const { data: p } = await supabase.from('projects')
    .select('id,name,color,workspace_id,team_id').in('id', projectIds)
  const projects = (p ?? []) as TaskHome[]

  const workspaceIds = [...new Set(projects.map(x => x.workspace_id))]
  const { data: w } = workspaceIds.length > 0
    ? await supabase.from('workspaces').select('id,name,emoji').in('id', workspaceIds)
    : { data: [] }
  const spaces = new Map(((w ?? []) as { id: string; name: string; emoji: string }[]).map(x => [x.id, x]))

  const byId = new Map(projects.map(x => [x.id, { ...x, workspace: spaces.get(x.workspace_id) ?? null }]))
  return tasks.map(x => ({ ...x, project: byId.get(x.project_id) ?? null }))
}

function TaskRow({ row, onOpen }: { row: Row; onOpen: () => void }) {
  const priority = PRIORITIES.find(p => p.id === row.priority)!
  const tone = row.due_date ? dueTone(row.due_date) : 'later'

  return (
    <li>
      <button
        type="button"
        onClick={onOpen}
        className={cx(
          'flex w-full items-start gap-3 rounded-xl bg-white px-3 py-2.5 text-left ring-1 ring-slate-200 transition',
          'hover:bg-slate-50 hover:ring-slate-300 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-indigo-600',
          'dark:bg-slate-900 dark:ring-slate-800 dark:hover:bg-slate-800/60 dark:hover:ring-slate-700',
        )}
      >
        <span className="min-w-0 flex-1">
          <span className="block truncate text-sm font-medium">{row.title}</span>
          <span className="mt-1 flex flex-wrap items-center gap-x-2 gap-y-1 text-[11px] text-slate-500 dark:text-slate-400">
            <span className="inline-flex min-w-0 items-center gap-1.5">
              <span
                aria-hidden
                className="h-2 w-2 shrink-0 rounded-full"
                style={{ backgroundColor: row.project?.color ?? '#94a3b8' }}
              />
              <span className="truncate">{row.project?.name ?? 'Unknown project'}</span>
            </span>
            {row.project?.workspace && (
              <span className="truncate text-slate-400 dark:text-slate-500">
                {row.project.workspace.name}
              </span>
            )}
            {row.status === 'blocked' && (
              <span className="font-medium text-rose-600 dark:text-rose-400">Blocked</span>
            )}
          </span>
        </span>

        <span className="flex shrink-0 flex-col items-end gap-1 sm:flex-row sm:items-center sm:gap-1.5">
          <span className={cx('rounded-md px-1.5 py-0.5 text-[10px] font-medium ring-1 ring-inset', priority.chip)}>
            {priority.label}
          </span>
          {row.due_date && (
            <span className={cx(
              'inline-flex items-center gap-1 rounded-md px-1.5 py-0.5 text-[10px] font-medium ring-1 ring-inset',
              DUE_TONE[tone],
            )}>
              <svg viewBox="0 0 16 16" className="h-3 w-3" fill="none" stroke="currentColor" strokeWidth="1.5" aria-hidden>
                <rect x="2" y="3" width="12" height="11" rx="2" />
                <path d="M2 6.5h12M5.5 1.5v3M10.5 1.5v3" strokeLinecap="round" />
              </svg>
              {formatDue(row.due_date)}
            </span>
          )}
        </span>
      </button>
    </li>
  )
}

/**
 * "What do I owe anyone" — every open task assigned to the signed-in user,
 * across every workspace they can see rather than only the active one. RLS is
 * what limits the rows; this deliberately adds no workspace filter.
 */
export default function MyTasks({ onClose, onOpenTask }: {
  onClose: () => void
  onOpenTask: (taskId: string, projectId: string) => void
}) {
  const { user } = useAuth()
  const [rows, setRows] = useState<Row[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    const esc = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose() }
    window.addEventListener('keydown', esc)
    document.body.style.overflow = 'hidden'
    return () => {
      window.removeEventListener('keydown', esc)
      document.body.style.overflow = ''
    }
  }, [onClose])

  useEffect(() => {
    const userId = user?.id
    if (!userId) { setRows([]); setLoading(false); return }

    let live = true
    setLoading(true)

    void (async () => {
      try {
        const { data, error: embedError } = await supabase.from('tasks').select(SELECT_EMBEDDED)
          .eq('assignee_id', userId).neq('status', 'done').is('deleted_at', null)

        const next = embedError
          ? await loadStitched(userId)
          : ((data ?? []) as unknown as Row[])

        if (!live) return
        setRows(next)
        setError(null)
      } catch (e) {
        if (!live) return
        setError(e instanceof Error ? e.message : 'Could not load your tasks.')
        setRows([])
      } finally {
        if (live) setLoading(false)
      }
    })()

    return () => { live = false }
  }, [user?.id])

  const groups = useMemo(() => {
    const map = new Map<BucketId, Row[]>()
    for (const row of rows) {
      const id = bucketOf(row.due_date)
      const list = map.get(id)
      if (list) list.push(row)
      else map.set(id, [row])
    }
    for (const list of map.values()) list.sort(compareRows)
    return BUCKETS
      .map(b => ({ ...b, rows: map.get(b.id) ?? [] }))
      .filter(b => b.rows.length > 0)
  }, [rows])

  return (
    <div className="fixed inset-0 z-50 flex flex-col bg-slate-50 dark:bg-slate-950">
      <header className="flex shrink-0 items-center gap-3 border-b border-slate-200 px-4 py-3 sm:px-6 dark:border-slate-800">
        <div className="min-w-0 flex-1">
          <h1 className="text-base font-semibold">My tasks</h1>
          <p className="truncate text-xs text-slate-500 dark:text-slate-400">
            Everything open and assigned to you, across every workspace.
          </p>
        </div>
        {!loading && rows.length > 0 && (
          <span className="shrink-0 rounded-full bg-slate-200 px-2 py-0.5 text-xs font-medium tabular-nums text-slate-600 dark:bg-slate-800 dark:text-slate-300">
            {rows.length}
          </span>
        )}
        <Button variant="ghost" size="sm" onClick={onClose} aria-label="Close my tasks">
          Close
        </Button>
      </header>

      <div className="min-h-0 flex-1 overflow-y-auto px-4 py-5 sm:px-6">
        <div className="mx-auto w-full max-w-3xl">
          {loading && (
            <div className="flex h-64 flex-col items-center justify-center gap-2 text-slate-400">
              <Spinner className="h-6 w-6" />
              <p className="text-xs">Gathering your tasks…</p>
            </div>
          )}

          {!loading && error && (
            <p className="rounded-xl bg-rose-50 px-4 py-3 text-sm text-rose-700 dark:bg-rose-950/60 dark:text-rose-300">
              {error}
            </p>
          )}

          {!loading && !error && rows.length === 0 && (
            <div className="flex flex-col items-center justify-center gap-3 px-6 py-20 text-center">
              <span className="text-4xl" aria-hidden></span>
              <h2 className="text-base font-semibold">You are all caught up</h2>
              <p className="max-w-xs text-sm text-slate-500 dark:text-slate-400">
                Nothing open is assigned to you anywhere. Enjoy it while it lasts.
              </p>
            </div>
          )}

          {!loading && !error && groups.map(group => (
            <section key={group.id} className="mb-6 last:mb-0">
              <h2 className="mb-2 flex items-center gap-2 text-xs font-semibold tracking-wide text-slate-500 uppercase dark:text-slate-400">
                <span className={cx('h-2 w-2 rounded-full', group.accent)} aria-hidden />
                {group.label}
                <span className="rounded-full bg-slate-200 px-1.5 text-[10px] tabular-nums text-slate-600 dark:bg-slate-800 dark:text-slate-300">
                  {group.rows.length}
                </span>
              </h2>
              <ul className="space-y-1.5">
                {group.rows.map(row => (
                  <TaskRow
                    key={row.id}
                    row={row}
                    onOpen={() => {
                      // Hand the task to the board underneath, then get out of
                      // its way — the dialog would otherwise open behind this.
                      onOpenTask(row.id, row.project_id)
                      onClose()
                    }}
                  />
                ))}
              </ul>
            </section>
          ))}
        </div>
      </div>
    </div>
  )
}
