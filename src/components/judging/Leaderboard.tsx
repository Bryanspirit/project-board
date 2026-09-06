import { useMemo, useState } from 'react'
import type { ProjectHealth } from '../../lib/types'
import { cx } from '../ui'

type SortKey = 'rank' | 'project' | 'team' | 'judges' | 'mean' | 'spread'

interface Row {
  project: ProjectHealth
  judges: string[]
  totals: number[]
  mean: number | null
  min: number | null
  max: number | null
  spread: number | null
  rank: number | null
}

/** A gap this wide between two judges on the same project is worth a second
 *  look before the prize is handed out. */
const CONTENTIOUS = 20

export default function Leaderboard({ projects, judgeIdsFor, weightedTotal, judgeNames }: {
  projects: ProjectHealth[]
  judgeIdsFor: (projectId: string) => string[]
  weightedTotal: (projectId: string, judgeId?: string) => number | null
  judgeNames: Record<string, string>
}) {
  const [sort, setSort] = useState<{ key: SortKey; dir: 'asc' | 'desc' }>({ key: 'rank', dir: 'asc' })

  const rows = useMemo<Row[]>(() => {
    const base: Row[] = projects.map(project => {
      const judges = judgeIdsFor(project.id)
      const totals = judges
        .map(j => weightedTotal(project.id, j))
        .filter((n): n is number => n !== null)
      if (totals.length === 0) {
        return { project, judges: [], totals: [], mean: null, min: null, max: null, spread: null, rank: null }
      }
      const mean = totals.reduce((a, b) => a + b, 0) / totals.length
      const min = Math.min(...totals)
      const max = Math.max(...totals)
      return { project, judges, totals, mean, min, max, spread: max - min, rank: null }
    })

    // Rank on the mean, descending. Ties — judged on the one decimal place the
    // table actually shows — share a rank, and the next rank skips past them.
    const scored = base.filter(r => r.mean !== null).sort((a, b) => (b.mean ?? 0) - (a.mean ?? 0))
    let lastLabel: string | null = null
    let lastRank = 0
    scored.forEach((row, i) => {
      const label = (row.mean ?? 0).toFixed(1)
      if (label !== lastLabel) { lastRank = i + 1; lastLabel = label }
      row.rank = lastRank
    })
    return base
  }, [projects, judgeIdsFor, weightedTotal])

  const anyScores = rows.some(r => r.mean !== null)

  const sorted = useMemo(() => {
    const dir = sort.dir === 'asc' ? 1 : -1
    const value = (r: Row): number | string => {
      switch (sort.key) {
        case 'project': return r.project.name.toLowerCase()
        case 'team': return (r.project.team_name ?? '').toLowerCase()
        case 'judges': return r.judges.length
        case 'mean': return r.mean ?? -1
        case 'spread': return r.spread ?? -1
        case 'rank': return r.rank ?? Number.MAX_SAFE_INTEGER
      }
    }
    return [...rows].sort((a, b) => {
      const av = value(a)
      const bv = value(b)
      if (typeof av === 'string' || typeof bv === 'string') {
        return String(av).localeCompare(String(bv)) * dir
      }
      return (av - bv) * dir
    })
  }, [rows, sort])

  function toggle(key: SortKey) {
    setSort(s => s.key === key
      ? { key, dir: s.dir === 'asc' ? 'desc' : 'asc' }
      // Names read best A→Z; every number reads best biggest-first.
      : { key, dir: key === 'project' || key === 'team' || key === 'rank' ? 'asc' : 'desc' })
  }

  if (projects.length === 0) {
    return <Empty title="No projects yet" body="Projects appear here as soon as teams create them." />
  }
  if (!anyScores) {
    return (
      <Empty
        title="No scores yet"
        body="The leaderboard fills in as judges submit scores. Nothing is ranked until at least one judge has scored a project."
      />
    )
  }

  return (
    <div className="overflow-x-auto rounded-2xl ring-1 ring-slate-200 dark:ring-slate-800">
      <table className="w-full min-w-[46rem] border-collapse text-sm">
        <thead>
          <tr className="bg-slate-50 text-left text-xs uppercase tracking-wide text-slate-500 dark:bg-slate-900 dark:text-slate-400">
            <Th label="#" sortKey="rank" sort={sort} onSort={toggle} className="w-14" />
            <Th label="Project" sortKey="project" sort={sort} onSort={toggle} />
            <Th label="Team" sortKey="team" sort={sort} onSort={toggle} />
            <Th label="Judges" sortKey="judges" sort={sort} onSort={toggle} className="w-24" />
            <Th label="Mean score" sortKey="mean" sort={sort} onSort={toggle} className="w-32" />
            <Th label="Spread" sortKey="spread" sort={sort} onSort={toggle} className="w-56" />
          </tr>
        </thead>
        <tbody className="divide-y divide-slate-100 dark:divide-slate-800">
          {sorted.map(r => (
            <tr key={r.project.id} className="bg-white transition hover:bg-slate-50 dark:bg-slate-950 dark:hover:bg-slate-900">
              <td className="px-3 py-3 text-sm font-semibold tabular-nums text-slate-500 dark:text-slate-400">
                {r.rank ?? '—'}
              </td>
              <td className="px-3 py-3">
                <div className="flex items-center gap-2">
                  <span className="h-2.5 w-2.5 shrink-0 rounded-full" style={{ background: r.project.color }} />
                  <span className="font-medium text-slate-900 dark:text-slate-100">{r.project.name}</span>
                </div>
              </td>
              <td className="px-3 py-3 text-slate-600 dark:text-slate-300">
                {r.project.team_name ?? <span className="text-slate-400">No team</span>}
              </td>
              <td className="px-3 py-3 tabular-nums text-slate-600 dark:text-slate-300"
                title={r.judges.map(j => judgeNames[j] ?? 'Judge').join(', ') || undefined}>
                {r.judges.length || <span className="text-slate-400">0</span>}
              </td>
              <td className="px-3 py-3 text-base font-semibold tabular-nums text-slate-900 dark:text-slate-100">
                {r.mean === null ? <span className="text-sm font-normal text-slate-400">Not scored</span> : r.mean.toFixed(1)}
              </td>
              <td className="px-3 py-3">
                {r.spread === null ? <span className="text-slate-400">—</span> : (
                  <SpreadBar min={r.min ?? 0} max={r.max ?? 0} mean={r.mean ?? 0} spread={r.spread} judges={r.totals.length} />
                )}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}

function SpreadBar({ min, max, mean, spread, judges }: {
  min: number
  max: number
  mean: number
  spread: number
  judges: number
}) {
  const contentious = spread >= CONTENTIOUS
  return (
    <div className="flex items-center gap-2">
      <div className="relative h-2 w-full min-w-24 flex-1 rounded-full bg-slate-200 dark:bg-slate-800">
        <div
          className={cx('absolute h-2 rounded-full', contentious ? 'bg-amber-400' : 'bg-indigo-300 dark:bg-indigo-800')}
          style={{ left: `${min}%`, width: `${Math.max(spread, 1)}%` }}
        />
        <div
          className="absolute top-1/2 h-3 w-[3px] -translate-y-1/2 rounded-full bg-indigo-600 dark:bg-indigo-400"
          style={{ left: `calc(${mean}% - 1.5px)` }}
        />
      </div>
      <span className={cx(
        'w-28 shrink-0 text-right text-xs tabular-nums',
        contentious ? 'font-medium text-amber-600 dark:text-amber-400' : 'text-slate-500 dark:text-slate-400',
      )}
        title={judges > 1
          ? `${judges} judges, ${min.toFixed(1)} to ${max.toFixed(1)}`
          : 'Only one judge has scored this project'}>
        {judges > 1 ? `${min.toFixed(1)}–${max.toFixed(1)}` : 'single judge'}
      </span>
    </div>
  )
}

function Th({ label, sortKey, sort, onSort, className }: {
  label: string
  sortKey: SortKey
  sort: { key: SortKey; dir: 'asc' | 'desc' }
  onSort: (key: SortKey) => void
  className?: string
}) {
  const active = sort.key === sortKey
  return (
    <th scope="col" className={cx('px-3 py-2 font-medium', className)}
      aria-sort={active ? (sort.dir === 'asc' ? 'ascending' : 'descending') : 'none'}>
      <button type="button" onClick={() => onSort(sortKey)}
        className={cx(
          'inline-flex items-center gap-1 rounded transition hover:text-slate-800 dark:hover:text-slate-200',
          'focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-indigo-600',
          active && 'text-slate-800 dark:text-slate-200',
        )}>
        {label}
        <span aria-hidden className={cx('text-[10px]', active ? 'opacity-100' : 'opacity-0')}>
          {sort.dir === 'asc' ? '▲' : '▼'}
        </span>
      </button>
    </th>
  )
}

function Empty({ title, body }: { title: string; body: string }) {
  return (
    <div className="rounded-2xl border border-dashed border-slate-300 px-6 py-14 text-center dark:border-slate-700">
      <p className="text-sm font-medium text-slate-700 dark:text-slate-200">{title}</p>
      <p className="mx-auto mt-1 max-w-md text-xs text-slate-500 dark:text-slate-400">{body}</p>
    </div>
  )
}
