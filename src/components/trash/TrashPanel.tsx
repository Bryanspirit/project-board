import { useEffect, useMemo, useState } from 'react'
import type { ReactNode } from 'react'
import { Button, Modal, Spinner, cx } from '../ui'
import { RETENTION_DAYS, useTrash } from '../../hooks/useTrash'
import type { TrashedProject, TrashedTask } from '../../hooks/useTrash'

/** "3 days ago" for a timestamp, kept local so the panel reads the same
 *  whether or not the admin surfaces are loaded. */
function deletedAgo(iso: string | null): string {
  if (!iso) return 'recently'
  const ms = Date.now() - new Date(iso).getTime()
  if (Number.isNaN(ms)) return 'recently'
  const MIN = 60_000, HOUR = 3_600_000, DAY = 86_400_000
  if (ms < 45_000) return 'just now'
  const plural = (n: number, u: string) => `${n} ${u}${n === 1 ? '' : 's'} ago`
  if (ms < HOUR) return plural(Math.round(ms / MIN), 'minute')
  if (ms < DAY) return plural(Math.round(ms / HOUR), 'hour')
  if (ms < 30 * DAY) return plural(Math.round(ms / DAY), 'day')
  return plural(Math.round(ms / (30 * DAY)), 'month')
}

function Countdown({ days }: { days: number }) {
  if (days <= 0) {
    return (
      <span className="rounded-full bg-rose-100 px-2 py-0.5 text-[11px] font-medium text-rose-700 ring-1 ring-rose-200 dark:bg-rose-950 dark:text-rose-300 dark:ring-rose-900">
        Past the {RETENTION_DAYS}-day window — the next purge removes this
      </span>
    )
  }
  const soon = days <= 3
  return (
    <span className={cx(
      'shrink-0 rounded-full px-2 py-0.5 text-[11px] font-medium ring-1',
      soon
        ? 'bg-amber-100 text-amber-700 ring-amber-200 dark:bg-amber-950 dark:text-amber-300 dark:ring-amber-900'
        : 'bg-slate-100 text-slate-600 ring-slate-200 dark:bg-slate-800 dark:text-slate-300 dark:ring-slate-700',
    )}>
      {days === 1 ? '1 day left' : `${days} days left`}
    </span>
  )
}

function Row({ expired, children }: { expired: boolean; children: ReactNode }) {
  return (
    <li className={cx(
      'flex flex-wrap items-center gap-3 rounded-xl px-4 py-3 ring-1',
      expired
        ? 'bg-rose-50/60 ring-rose-200 dark:bg-rose-950/30 dark:ring-rose-900/70'
        : 'bg-white ring-slate-200 dark:bg-slate-900 dark:ring-slate-800',
    )}>
      {children}
    </li>
  )
}

function Empty({ children }: { children: ReactNode }) {
  return (
    <p className="rounded-xl border border-dashed border-slate-300 px-4 py-6 text-center text-sm text-slate-500 dark:border-slate-700 dark:text-slate-400">
      {children}
    </p>
  )
}

/**
 * Everything this workspace has thrown away, with a way back for each row.
 *
 * Nothing on this screen destroys data except "Empty trash", a super-admin
 * action behind a confirm that names exactly what it is about to remove.
 */
export default function TrashPanel({ workspaceId, canPurge, onClose, onRestored }: {
  workspaceId: string
  canPurge: boolean
  onClose: () => void
  onRestored?: () => void
}) {
  const trash = useTrash(workspaceId)
  const [confirmPurge, setConfirmPurge] = useState(false)
  const [purging, setPurging] = useState(false)
  const [busyId, setBusyId] = useState<string | null>(null)
  const [notice, setNotice] = useState<string | null>(null)

  useEffect(() => {
    const esc = (e: KeyboardEvent) => { if (e.key === 'Escape' && !confirmPurge) onClose() }
    window.addEventListener('keydown', esc)
    document.body.style.overflow = 'hidden'
    return () => {
      window.removeEventListener('keydown', esc)
      document.body.style.overflow = ''
    }
  }, [onClose, confirmPurge])

  const trashedProjectIds = useMemo(
    () => new Set(trash.projects.map(p => p.id)),
    [trash.projects],
  )

  /** How many trashed tasks would come back with each trashed project. */
  const tasksPerProject = useMemo(() => {
    const map = new Map<string, number>()
    for (const t of trash.tasks) map.set(t.project_id, (map.get(t.project_id) ?? 0) + 1)
    return map
  }, [trash.tasks])

  // What "Empty trash" would actually destroy, counted the way the RPC counts.
  const { projects: trashProjects, tasks: trashTasks, daysLeft } = trash
  const expired = useMemo(() => ({
    projects: trashProjects.filter(p => daysLeft(p.deleted_at) <= 0).length,
    tasks: trashTasks.filter(t => daysLeft(t.deleted_at) <= 0).length,
  }), [trashProjects, trashTasks, daysLeft])

  const restoreProject = async (p: TrashedProject) => {
    setBusyId(p.id)
    const ok = await trash.restoreProject(p.id)
    setBusyId(null)
    if (!ok) return
    const n = tasksPerProject.get(p.id) ?? 0
    setNotice(`“${p.name}” is back on the board${n > 0 ? `, with ${n === 1 ? 'its task' : `all ${n} of its tasks`}` : ''}.`)
    onRestored?.()
  }

  const restoreTask = async (t: TrashedTask) => {
    setBusyId(t.id)
    const ok = await trash.restoreTask(t.id)
    setBusyId(null)
    if (!ok) return
    setNotice(`“${t.title}” is back in ${t.project?.name ?? 'its project'}.`)
    onRestored?.()
  }

  const runPurge = async () => {
    setPurging(true)
    const result = await trash.purge(RETENTION_DAYS)
    setPurging(false)
    setConfirmPurge(false)
    setNotice(result.ok
      ? `Permanently deleted ${result.projects ?? 0} project(s) and ${result.tasks ?? 0} task(s).`
      : result.error ?? 'The trash could not be emptied.')
    if (result.ok) onRestored?.()
  }

  return (
    <div className="fixed inset-0 z-50 flex flex-col bg-slate-100 dark:bg-slate-950">
      <header className="flex shrink-0 items-center gap-3 border-b border-slate-200 px-5 py-4 sm:px-8 dark:border-slate-800">
        <div className="min-w-0 flex-1">
          <h1 className="text-base font-semibold text-slate-900 dark:text-slate-100">Trash</h1>
          <p className="text-xs text-slate-500 dark:text-slate-400">
            Deleted projects and tasks stay here for {RETENTION_DAYS} days. Restore one before then and it
            returns exactly where it was.
          </p>
        </div>

        {canPurge && (
          <Button variant="danger" size="sm" onClick={() => setConfirmPurge(true)}>Empty trash</Button>
        )}
        <Button variant="ghost" size="sm" onClick={onClose}>Close</Button>
      </header>

      {(trash.error || notice) && (
        <div
          role="status"
          className={cx('shrink-0 px-5 py-2 text-xs sm:px-8',
            trash.error
              ? 'bg-rose-50 text-rose-700 dark:bg-rose-950/50 dark:text-rose-300'
              : 'bg-emerald-50 text-emerald-700 dark:bg-emerald-950/50 dark:text-emerald-300')}
        >
          {trash.error ?? notice}
        </div>
      )}

      <div className="min-h-0 flex-1 overflow-y-auto px-5 py-6 sm:px-8">
        {trash.loading ? (
          <div className="flex items-center justify-center gap-2 py-16 text-sm text-slate-500 dark:text-slate-400">
            <Spinner className="h-4 w-4" /> Loading the trash…
          </div>
        ) : (
          <div className="mx-auto w-full max-w-4xl space-y-8">
            <section>
              <h2 className="mb-2 text-xs font-semibold uppercase tracking-wide text-slate-500 dark:text-slate-400">
                Projects ({trash.projects.length})
              </h2>

              {trash.projects.length === 0 ? (
                <Empty>No deleted projects.</Empty>
              ) : (
                <ul className="space-y-2">
                  {trash.projects.map(p => {
                    const left = trash.daysLeft(p.deleted_at)
                    const carried = tasksPerProject.get(p.id) ?? 0
                    return (
                      <Row key={p.id} expired={left <= 0}>
                        <span className="h-2.5 w-2.5 shrink-0 rounded-full" style={{ background: p.color }} />
                        <div className="min-w-0 flex-1">
                          <p className="truncate text-sm font-medium text-slate-900 dark:text-slate-100">{p.name}</p>
                          <p className="text-xs text-slate-500 dark:text-slate-400">
                            Project board · {p.team_id ? 'a team board' : 'workspace-wide'} · deleted {deletedAgo(p.deleted_at)}
                          </p>
                          <p className="mt-0.5 text-xs text-slate-500 dark:text-slate-400">
                            {carried > 0
                              ? `Restoring brings back ${carried === 1 ? 'the 1 task' : `all ${carried} tasks`} that were deleted with it.`
                              : 'Restoring brings back the project along with any tasks deleted with it.'}
                          </p>
                        </div>
                        <Countdown days={left} />
                        <Button size="sm" variant="outline" disabled={busyId === p.id}
                          onClick={() => void restoreProject(p)}>
                          {busyId === p.id ? 'Restoring…' : 'Restore'}
                        </Button>
                      </Row>
                    )
                  })}
                </ul>
              )}
            </section>

            <section>
              <h2 className="mb-2 text-xs font-semibold uppercase tracking-wide text-slate-500 dark:text-slate-400">
                Tasks ({trash.tasks.length})
              </h2>

              {trash.tasks.length === 0 ? (
                <Empty>No deleted tasks.</Empty>
              ) : (
                <ul className="space-y-2">
                  {trash.tasks.map(t => {
                    const left = trash.daysLeft(t.deleted_at)
                    const parentTrashed = trashedProjectIds.has(t.project_id)
                    return (
                      <Row key={t.id} expired={left <= 0}>
                        <div className="min-w-0 flex-1">
                          <p className="truncate text-sm font-medium text-slate-900 dark:text-slate-100">{t.title}</p>
                          <p className="text-xs text-slate-500 dark:text-slate-400">
                            in {t.project?.name ?? 'an unknown project'} · {t.status.replace('_', ' ')} · deleted {deletedAgo(t.deleted_at)}
                          </p>
                          {parentTrashed && (
                            <p className="mt-0.5 text-xs text-amber-600 dark:text-amber-400">
                              Its project is in the trash too — restore the project to put this card back on a board.
                            </p>
                          )}
                        </div>
                        <Countdown days={left} />
                        <Button size="sm" variant="outline" disabled={busyId === t.id}
                          onClick={() => void restoreTask(t)}>
                          {busyId === t.id ? 'Restoring…' : 'Restore'}
                        </Button>
                      </Row>
                    )
                  })}
                </ul>
              )}
            </section>
          </div>
        )}
      </div>

      {confirmPurge && (
        <Modal
          title="Empty the trash?"
          onClose={() => setConfirmPurge(false)}
          footer={
            <>
              <Button variant="ghost" size="sm" onClick={() => setConfirmPurge(false)}>Cancel</Button>
              <Button variant="danger" size="sm" disabled={purging} onClick={() => void runPurge()}>
                {purging ? 'Deleting…' : 'Delete permanently'}
              </Button>
            </>
          }
        >
          <p className="text-sm text-slate-600 dark:text-slate-300">
            This permanently deletes every project and task that has been in the trash for more than{' '}
            {RETENTION_DAYS} days — in this workspace that is{' '}
            <strong className="text-slate-900 dark:text-slate-100">
              {expired.projects} project{expired.projects === 1 ? '' : 's'}
            </strong>{' '}
            and{' '}
            <strong className="text-slate-900 dark:text-slate-100">
              {expired.tasks} task{expired.tasks === 1 ? '' : 's'}
            </strong>
            . As a super admin the purge runs across every workspace, so rows you cannot see here go too.
          </p>
          <p className="text-sm text-slate-600 dark:text-slate-300">
            Their descriptions, comments and history are destroyed with them. This cannot be undone and nothing in
            this app can bring them back.
          </p>
          <p className="text-sm text-slate-600 dark:text-slate-300">
            Anything deleted within the last {RETENTION_DAYS} days is left untouched and can still be restored.
          </p>
        </Modal>
      )}
    </div>
  )
}
