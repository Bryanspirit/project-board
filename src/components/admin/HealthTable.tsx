import { useMemo, useState } from 'react'
import { Select, cx } from '../ui'
import { isAtRisk } from '../../lib/types'
import type { ProjectHealth, Workspace } from '../../lib/types'
import { daysSince } from '../../hooks/useAdmin'

interface Props {
  health: ProjectHealth[]
  workspaces: Workspace[]
}

type SortKey = 'risk' | 'team' | 'name' | 'percent' | 'done' | 'overdue' | 'blocked' | 'idle'
type Dir = 'asc' | 'desc'

const COLUMNS: { key: SortKey; label: string; align?: 'right'; hint?: string }[] = [
  { key: 'team', label: 'Team' },
  { key: 'name', label: 'Project' },
  { key: 'percent', label: 'Progress' },
  { key: 'done', label: 'Done', align: 'right', hint: 'Completed of total tasks' },
  { key: 'overdue', label: 'Overdue', align: 'right' },
  { key: 'blocked', label: 'Blocked', align: 'right' },
  { key: 'idle', label: 'Idle', align: 'right', hint: 'Days since the last task change' },
  { key: 'risk', label: 'Risk' },
]

function sortValue(h: ProjectHealth, key: SortKey): string | number {
  switch (key) {
    case 'risk': return isAtRisk(h) ? 1 : 0
    case 'team': return (h.team_name ?? '').toLowerCase()
    case 'name': return h.name.toLowerCase()
    case 'percent': return h.percent_done
    case 'done': return h.total_tasks === 0 ? -1 : h.done_tasks / h.total_tasks
    case 'overdue': return h.overdue_tasks
    case 'blocked': return h.blocked_tasks
    case 'idle': return daysSince(h.last_activity) ?? Number.MAX_SAFE_INTEGER
  }
}

function barTone(percent: number) {
  if (percent >= 80) return 'bg-emerald-500'
  if (percent >= 50) return 'bg-sky-500'
  if (percent >= 25) return 'bg-amber-500'
  return 'bg-rose-500'
}

function ProgressBar({ percent }: { percent: number }) {
  return (
    <div className="flex items-center gap-2">
      <div className="h-2 w-24 shrink-0 overflow-hidden rounded-full bg-slate-200 dark:bg-slate-700"
        role="progressbar" aria-valuenow={percent} aria-valuemin={0} aria-valuemax={100}
        aria-label={`${percent}% of tasks done`}>
        <div className={cx('h-full rounded-full transition-all', barTone(percent))} style={{ width: `${percent}%` }} />
      </div>
      <span className="w-10 shrink-0 text-right text-xs font-medium tabular-nums text-slate-600 dark:text-slate-300">
        {percent}%
      </span>
    </div>
  )
}

function Count({ value, tone }: { value: number; tone: 'danger' | 'warn' }) {
  if (value === 0) return <span className="text-slate-400 tabular-nums">0</span>
  return (
    <span className={cx(
      'inline-block min-w-6 rounded-md px-1.5 py-0.5 text-xs font-semibold tabular-nums',
      tone === 'danger'
        ? 'bg-rose-100 text-rose-700 dark:bg-rose-950 dark:text-rose-300'
        : 'bg-amber-100 text-amber-700 dark:bg-amber-950 dark:text-amber-300',
    )}>{value}</span>
  )
}

export default function HealthTable({ health, workspaces }: Props) {
  const [workspaceId, setWorkspaceId] = useState('')
  const [sort, setSort] = useState<{ key: SortKey; dir: Dir }>({ key: 'risk', dir: 'desc' })

  const rows = useMemo(() => {
    const scoped = workspaceId ? health.filter(h => h.workspace_id === workspaceId) : health
    const factor = sort.dir === 'asc' ? 1 : -1
    return [...scoped].sort((a, b) => {
      const av = sortValue(a, sort.key)
      const bv = sortValue(b, sort.key)
      let cmp = typeof av === 'string' && typeof bv === 'string'
        ? av.localeCompare(bv)
        : Number(av) - Number(bv)
      cmp *= factor
      if (cmp !== 0) return cmp
      // Stable, meaningful tiebreak: least finished first, then by name.
      return a.percent_done - b.percent_done || a.name.localeCompare(b.name)
    })
  }, [health, workspaceId, sort])

  const atRisk = rows.filter(isAtRisk).length

  const toggle = (key: SortKey) => setSort(s => (
    s.key === key
      ? { key, dir: s.dir === 'asc' ? 'desc' : 'asc' }
      : { key, dir: key === 'team' || key === 'name' ? 'asc' : 'desc' }
  ))

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-3">
        <label className="flex items-center gap-2 text-sm text-slate-600 dark:text-slate-300">
          <span className="shrink-0">Workspace</span>
          <Select value={workspaceId} onChange={e => setWorkspaceId(e.target.value)} className="w-56 py-1.5 text-xs">
            <option value="">All workspaces</option>
            {workspaces.map(w => <option key={w.id} value={w.id}>{w.emoji} {w.name}</option>)}
          </Select>
        </label>
        <p className="text-xs text-slate-500 dark:text-slate-400">
          {rows.length} project{rows.length === 1 ? '' : 's'}
          {atRisk > 0 && <span className="text-rose-600 dark:text-rose-400"> · {atRisk} at risk</span>}
        </p>
      </div>

      {rows.length === 0 ? (
        <div className="rounded-xl border border-dashed border-slate-300 px-6 py-12 text-center dark:border-slate-700">
          <p className="text-sm font-medium text-slate-700 dark:text-slate-200">Nothing to track yet</p>
          <p className="mt-1 text-sm text-slate-500 dark:text-slate-400">
            Projects appear here as soon as a team creates one.
          </p>
        </div>
      ) : (
        <div className="overflow-x-auto rounded-xl bg-white ring-1 ring-slate-200 dark:bg-slate-900 dark:ring-slate-800">
          <table className="w-full min-w-[54rem] border-collapse text-sm">
            <caption className="sr-only">
              Progress of every project, sortable by column. At-risk projects are listed first by default.
            </caption>
            <thead>
              <tr className="border-b border-slate-200 dark:border-slate-800">
                {COLUMNS.map(col => {
                  const active = sort.key === col.key
                  return (
                    <th
                      key={col.key}
                      scope="col"
                      aria-sort={active ? (sort.dir === 'asc' ? 'ascending' : 'descending') : 'none'}
                      className={cx('px-3 py-2', col.align === 'right' ? 'text-right' : 'text-left')}
                    >
                      <button
                        onClick={() => toggle(col.key)}
                        title={col.hint}
                        className={cx(
                          'inline-flex items-center gap-1 rounded text-xs font-semibold tracking-wide uppercase transition',
                          active ? 'text-slate-900 dark:text-slate-50' : 'text-slate-500 hover:text-slate-800 dark:text-slate-400 dark:hover:text-slate-100',
                        )}
                      >
                        {col.label}
                        <span aria-hidden="true" className={cx('text-[0.6rem]', !active && 'opacity-0')}>
                          {sort.dir === 'asc' ? '▲' : '▼'}
                        </span>
                      </button>
                    </th>
                  )
                })}
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100 dark:divide-slate-800">
              {rows.map(h => {
                const risky = isAtRisk(h)
                const idle = daysSince(h.last_activity)
                return (
                  <tr key={h.id} className={cx(
                    'transition hover:bg-slate-50 dark:hover:bg-slate-800/50',
                    risky && 'bg-rose-50/40 dark:bg-rose-950/20',
                  )}>
                    <td className="px-3 py-2.5 whitespace-nowrap text-slate-600 dark:text-slate-300">
                      {h.team_name ?? <span className="text-slate-400">No team</span>}
                    </td>
                    <th scope="row" className="px-3 py-2.5 text-left font-medium text-slate-900 dark:text-slate-50">
                      <span className="flex items-center gap-2">
                        <span aria-hidden="true" className="h-2.5 w-2.5 shrink-0 rounded-full"
                          style={{ backgroundColor: h.color }} />
                        <span className="max-w-56 truncate" title={h.name}>{h.name}</span>
                      </span>
                    </th>
                    <td className="px-3 py-2.5"><ProgressBar percent={h.percent_done} /></td>
                    <td className="px-3 py-2.5 text-right whitespace-nowrap tabular-nums text-slate-600 dark:text-slate-300">
                      {h.done_tasks}<span className="text-slate-400"> / {h.total_tasks}</span>
                    </td>
                    <td className="px-3 py-2.5 text-right"><Count value={h.overdue_tasks} tone="danger" /></td>
                    <td className="px-3 py-2.5 text-right"><Count value={h.blocked_tasks} tone="warn" /></td>
                    <td className="px-3 py-2.5 text-right whitespace-nowrap tabular-nums text-slate-600 dark:text-slate-300">
                      {idle === null ? <span className="text-slate-400">never</span> : `${idle}d`}
                    </td>
                    <td className="px-3 py-2.5">
                      {risky ? (
                        <span className="rounded-full bg-rose-100 px-2 py-0.5 text-xs font-semibold text-rose-700 ring-1 ring-rose-200 dark:bg-rose-950 dark:text-rose-300 dark:ring-rose-900">
                          At risk
                        </span>
                      ) : (
                        <span className="text-xs text-slate-400">On track</span>
                      )}
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
      )}
    </div>
  )
}
