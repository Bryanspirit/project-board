import { useEffect, useState } from 'react'
import type { ProjectHealth } from '../../lib/types'
import { useJudging } from '../../hooks/useJudging'
import { Button, Spinner, cx } from '../ui'
import CriteriaEditor from './CriteriaEditor'
import Leaderboard from './Leaderboard'
import ScoreCard from './ScoreCard'

type Tab = 'score' | 'leaderboard'

export default function JudgingPanel({ workspaceId, projects, canManage, onClose }: {
  workspaceId: string
  projects: ProjectHealth[]
  canManage: boolean
  onClose: () => void
}) {
  const [tab, setTab] = useState<Tab>('score')
  const [editing, setEditing] = useState(false)
  const {
    criteria, loading, error, clearError,
    createCriterion, updateCriterion, deleteCriterion, saveScore,
    myScoreFor, judgeIdsFor, weightedTotal, judgeNames,
  } = useJudging(workspaceId, canManage)

  useEffect(() => {
    const esc = (e: KeyboardEvent) => { if (e.key === 'Escape' && !editing) onClose() }
    window.addEventListener('keydown', esc)
    document.body.style.overflow = 'hidden'
    return () => {
      window.removeEventListener('keydown', esc)
      document.body.style.overflow = ''
    }
  }, [onClose, editing])

  const tabs: { id: Tab; label: string }[] = canManage
    ? [{ id: 'score', label: 'Score' }, { id: 'leaderboard', label: 'Leaderboard' }]
    : [{ id: 'score', label: 'Score' }]

  const active: Tab = tab === 'leaderboard' && !canManage ? 'score' : tab

  return (
    <div className="fixed inset-0 z-40 flex justify-center overflow-y-auto bg-slate-900/50 backdrop-blur-sm sm:p-6">
      <div className="flex w-full max-w-5xl flex-col bg-slate-50 shadow-2xl ring-1 ring-slate-200 sm:my-auto sm:rounded-2xl dark:bg-slate-950 dark:ring-slate-800">
        <header className="sticky top-0 z-10 rounded-t-2xl border-b border-slate-200 bg-white/95 px-5 py-4 backdrop-blur dark:border-slate-800 dark:bg-slate-900/95">
          <div className="flex items-start justify-between gap-3">
            <div>
              <h2 className="text-base font-semibold text-slate-900 dark:text-slate-100">Judging</h2>
              <p className="mt-0.5 text-xs text-slate-500 dark:text-slate-400">
                {canManage
                  ? 'Score projects and review the aggregated standings.'
                  : 'Your scores are private to you — no other judge sees them.'}
              </p>
            </div>
            <div className="flex items-center gap-2">
              {canManage && (
                <Button size="sm" variant="outline" onClick={() => setEditing(true)}>Criteria</Button>
              )}
              <button onClick={onClose} aria-label="Close judging"
                className="rounded-lg p-1.5 text-slate-400 transition hover:bg-slate-100 hover:text-slate-700 dark:hover:bg-slate-800 dark:hover:text-slate-200">
                <svg viewBox="0 0 20 20" className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth="2">
                  <path d="M5 5l10 10M15 5L5 15" strokeLinecap="round" />
                </svg>
              </button>
            </div>
          </div>

          {tabs.length > 1 && (
            <div role="tablist" aria-label="Judging views" className="mt-3 flex gap-1">
              {tabs.map(t => (
                <button
                  key={t.id}
                  role="tab"
                  aria-selected={active === t.id}
                  onClick={() => setTab(t.id)}
                  className={cx(
                    'rounded-lg px-3 py-1.5 text-sm font-medium transition',
                    'focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-indigo-600',
                    active === t.id
                      ? 'bg-indigo-600 text-white'
                      : 'text-slate-600 hover:bg-slate-100 dark:text-slate-300 dark:hover:bg-slate-800',
                  )}
                >
                  {t.label}
                </button>
              ))}
            </div>
          )}
        </header>

        <div className="flex-1 space-y-4 px-5 py-5">
          {error && (
            <div className="flex items-start justify-between gap-3 rounded-xl bg-rose-50 px-4 py-3 text-sm text-rose-700 ring-1 ring-rose-200 dark:bg-rose-950/50 dark:text-rose-300 dark:ring-rose-900">
              <span>{error}</span>
              <button onClick={clearError} className="text-xs font-medium underline">Dismiss</button>
            </div>
          )}

          {loading ? (
            <div className="flex items-center justify-center gap-2 py-20 text-sm text-slate-500 dark:text-slate-400">
              <Spinner className="h-4 w-4" /> Loading judging data…
            </div>
          ) : active === 'leaderboard' ? (
            <Leaderboard
              projects={projects}
              judgeIdsFor={judgeIdsFor}
              weightedTotal={weightedTotal}
              judgeNames={judgeNames}
            />
          ) : criteria.length === 0 ? (
            <div className="rounded-2xl border border-dashed border-slate-300 px-6 py-14 text-center dark:border-slate-700">
              <p className="text-sm font-medium text-slate-700 dark:text-slate-200">No judging criteria yet</p>
              <p className="mx-auto mt-1 max-w-md text-xs text-slate-500 dark:text-slate-400">
                {canManage
                  ? 'Define what judges are scoring — each criterion gets a maximum score and a weight — and this tab turns into a scorecard for every project.'
                  : 'A workspace admin needs to define the judging criteria before scoring can start.'}
              </p>
              {canManage && (
                <Button className="mt-4" onClick={() => setEditing(true)}>Define criteria</Button>
              )}
            </div>
          ) : projects.length === 0 ? (
            <div className="rounded-2xl border border-dashed border-slate-300 px-6 py-14 text-center dark:border-slate-700">
              <p className="text-sm font-medium text-slate-700 dark:text-slate-200">Nothing to score yet</p>
              <p className="mt-1 text-xs text-slate-500 dark:text-slate-400">
                Projects show up here as soon as teams create them.
              </p>
            </div>
          ) : (
            <div className="space-y-4">
              {projects.map(p => (
                <ScoreCard
                  key={p.id}
                  project={p}
                  criteria={criteria}
                  savedScore={myScoreFor}
                  onSave={saveScore}
                />
              ))}
            </div>
          )}
        </div>
      </div>

      {editing && canManage && (
        <CriteriaEditor
          criteria={criteria}
          onCreate={createCriterion}
          onUpdate={updateCriterion}
          onDelete={deleteCriterion}
          onClose={() => setEditing(false)}
        />
      )}
    </div>
  )
}
