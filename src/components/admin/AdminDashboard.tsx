import { useEffect, useMemo, useState } from 'react'
import { Button, Spinner, cx } from '../ui'
import { isAtRisk } from '../../lib/types'
import { useAdmin } from '../../hooks/useAdmin'
import StatCard from './StatCard'
import RequestsQueue from './RequestsQueue'
import MembersPanel from './MembersPanel'
import HealthTable from './HealthTable'
import AuditPanel from './AuditPanel'

type Tab = 'requests' | 'people' | 'progress' | 'activity'

const TABS: { id: Tab; label: string }[] = [
  { id: 'requests', label: 'Requests' },
  { id: 'people', label: 'People' },
  { id: 'progress', label: 'Progress' },
  { id: 'activity', label: 'Activity' },
]

export default function AdminDashboard({ onClose }: { onClose: () => void }) {
  const [tab, setTab] = useState<Tab>('requests')
  const {
    requests, workspaces, members, teams, health, audit, profileById,
    loading, error, refresh, approve, reject, setMemberRole, removeMember, setStatus,
  } = useAdmin()

  useEffect(() => {
    const esc = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose() }
    window.addEventListener('keydown', esc)
    document.body.style.overflow = 'hidden'
    return () => {
      window.removeEventListener('keydown', esc)
      document.body.style.overflow = ''
    }
  }, [onClose])

  const stats = useMemo(() => {
    const pending = requests.filter(r => r.status === 'pending').length
    const activeMembers = new Set(
      members.filter(m => (m.profile?.status ?? 'pending') === 'active').map(m => m.user_id),
    ).size
    return {
      pending,
      activeMembers,
      projects: health.length,
      atRisk: health.filter(h => isAtRisk(h)).length,
    }
  }, [requests, members, health])

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label="Admin control centre"
      className="fixed inset-0 z-50 flex flex-col bg-slate-50 dark:bg-slate-950"
    >
      <header className="shrink-0 border-b border-slate-200 bg-white px-4 pt-4 sm:px-6 dark:border-slate-800 dark:bg-slate-900">
        <div className="flex items-start justify-between gap-4">
          <div>
            <h1 className="text-lg font-semibold text-slate-900 dark:text-slate-50">Admin control centre</h1>
            <p className="mt-0.5 text-sm text-slate-500 dark:text-slate-400">
              Approve access, manage people, and track every team&rsquo;s progress.
            </p>
          </div>
          <div className="flex shrink-0 items-center gap-2">
            <Button size="sm" variant="outline" onClick={() => void refresh()} disabled={loading}>
              {loading ? <Spinner className="h-3.5 w-3.5" /> : null}
              Refresh
            </Button>
            <button
              onClick={onClose}
              aria-label="Close admin control centre"
              className="rounded-lg p-1.5 text-slate-400 transition hover:bg-slate-100 hover:text-slate-700 dark:hover:bg-slate-800 dark:hover:text-slate-200"
            >
              <svg viewBox="0 0 20 20" className="h-5 w-5" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true">
                <path d="M5 5l10 10M15 5L5 15" strokeLinecap="round" />
              </svg>
            </button>
          </div>
        </div>

        <div className="mt-4 flex flex-wrap gap-3">
          <StatCard label="Pending requests" value={stats.pending}
            tone={stats.pending > 0 ? 'warn' : 'neutral'}
            sublabel={stats.pending > 0 ? 'Waiting on you' : 'Queue is clear'} />
          <StatCard label="Active members" value={stats.activeMembers} tone="good"
            sublabel={`${members.length} membership${members.length === 1 ? '' : 's'} across ${workspaces.length} workspace${workspaces.length === 1 ? '' : 's'}`} />
          <StatCard label="Projects" value={stats.projects} sublabel={`${teams.length} team${teams.length === 1 ? '' : 's'}`} />
          <StatCard label="At risk" value={stats.atRisk}
            tone={stats.atRisk > 0 ? 'danger' : 'good'}
            sublabel={stats.atRisk > 0 ? 'Overdue and stalled' : 'Everything on track'} />
        </div>

        <nav role="tablist" aria-label="Admin sections" className="-mb-px mt-4 flex gap-1 overflow-x-auto">
          {TABS.map(t => {
            const active = tab === t.id
            return (
              <button
                key={t.id}
                role="tab"
                id={`admin-tab-${t.id}`}
                aria-selected={active}
                aria-controls={`admin-panel-${t.id}`}
                onClick={() => setTab(t.id)}
                className={cx(
                  'shrink-0 border-b-2 px-3 py-2 text-sm font-medium transition',
                  active
                    ? 'border-indigo-600 text-indigo-700 dark:border-indigo-400 dark:text-indigo-300'
                    : 'border-transparent text-slate-500 hover:text-slate-800 dark:text-slate-400 dark:hover:text-slate-100',
                )}
              >
                {t.label}
                {t.id === 'requests' && stats.pending > 0 && (
                  <span className="ml-1.5 rounded-full bg-amber-100 px-1.5 py-0.5 text-xs font-semibold text-amber-700 dark:bg-amber-950 dark:text-amber-300">
                    {stats.pending}
                  </span>
                )}
              </button>
            )
          })}
        </nav>
      </header>

      <main className="min-h-0 flex-1 overflow-y-auto px-4 py-5 sm:px-6">
        {error && (
          <p role="alert" className="mb-4 rounded-lg bg-rose-50 px-3 py-2 text-sm text-rose-700 ring-1 ring-rose-200 dark:bg-rose-950/60 dark:text-rose-300 dark:ring-rose-900">
            {error}
          </p>
        )}

        {loading && requests.length === 0 && health.length === 0 ? (
          <div className="flex items-center justify-center gap-2 py-20 text-sm text-slate-500 dark:text-slate-400">
            <Spinner className="h-4 w-4" /> Loading the control centre…
          </div>
        ) : (
          <>
            <div role="tabpanel" id="admin-panel-requests" aria-labelledby="admin-tab-requests" hidden={tab !== 'requests'}>
              {tab === 'requests' && (
                <RequestsQueue requests={requests} workspaces={workspaces} teams={teams}
                  onApprove={approve} onReject={reject} />
              )}
            </div>
            <div role="tabpanel" id="admin-panel-people" aria-labelledby="admin-tab-people" hidden={tab !== 'people'}>
              {tab === 'people' && (
                <MembersPanel members={members} workspaces={workspaces}
                  onSetRole={setMemberRole} onRemove={removeMember} onSetStatus={setStatus} />
              )}
            </div>
            <div role="tabpanel" id="admin-panel-progress" aria-labelledby="admin-tab-progress" hidden={tab !== 'progress'}>
              {tab === 'progress' && <HealthTable health={health} workspaces={workspaces} />}
            </div>
            <div role="tabpanel" id="admin-panel-activity" aria-labelledby="admin-tab-activity" hidden={tab !== 'activity'}>
              {tab === 'activity' && <AuditPanel entries={audit} profileById={profileById} />}
            </div>
          </>
        )}
      </main>
    </div>
  )
}
