import { useEffect, useState } from 'react'
import { supabase } from '../../lib/supabase'
import type { Workspace, WorkspaceRole } from '../../lib/types'
import { Button, Spinner, cx } from '../ui'
import JoinCodeCard from '../access/JoinCodeCard'
import { Mark } from '../Mark'

interface Counts {
  teams: number
  projects: number
  members: number
  done: number
  total: number
}

const KIND_LABEL: Record<string, string> = {
  personal: 'Personal', hackathon: 'Hackathon', program: 'Programme', team: 'Team',
}

const ROLE_CHIP: Record<WorkspaceRole, string> = {
  owner: 'bg-indigo-50 text-indigo-700 ring-indigo-200 dark:bg-indigo-950 dark:text-indigo-300 dark:ring-indigo-900',
  admin: 'bg-sky-50 text-sky-700 ring-sky-200 dark:bg-sky-950 dark:text-sky-300 dark:ring-sky-900',
  manager: 'bg-emerald-50 text-emerald-700 ring-emerald-200 dark:bg-emerald-950 dark:text-emerald-300 dark:ring-emerald-900',
  judge: 'bg-amber-50 text-amber-700 ring-amber-200 dark:bg-amber-950 dark:text-amber-300 dark:ring-amber-900',
  member: 'bg-slate-100 text-slate-600 ring-slate-200 dark:bg-slate-800 dark:text-slate-300 dark:ring-slate-700',
}

/**
 * The front door. Every workspace you belong to, as cards — you pick one before
 * anything else is on screen, so the app never opens onto somebody else's work.
 */
export default function WorkspacePicker({
  workspaces, myRole, canCreate, loading, onOpen, onNew, onJoined,
}: {
  workspaces: Workspace[]
  myRole: (workspaceId: string) => WorkspaceRole | null
  canCreate: boolean
  loading: boolean
  onOpen: (id: string) => void
  onNew: () => void
  onJoined: () => void
}) {
  const [counts, setCounts] = useState<Record<string, Counts>>({})
  const [showJoin, setShowJoin] = useState(false)

  // One pass over everything RLS lets us see, tallied per workspace — cheaper
  // and simpler than a count query per card.
  useEffect(() => {
    let alive = true
    void (async () => {
      const [teams, projects, members, health] = await Promise.all([
        supabase.from('teams').select('id,workspace_id'),
        supabase.from('projects').select('id,workspace_id'),
        supabase.from('workspace_members').select('id,workspace_id'),
        supabase.from('project_health').select('workspace_id,total_tasks,done_tasks'),
      ])
      if (!alive) return

      const blank = (): Counts => ({ teams: 0, projects: 0, members: 0, done: 0, total: 0 })
      const next: Record<string, Counts> = {}
      const bump = (id: string) => (next[id] ??= blank())

      for (const t of teams.data ?? []) bump(t.workspace_id).teams++
      for (const p of projects.data ?? []) bump(p.workspace_id).projects++
      for (const m of members.data ?? []) bump(m.workspace_id).members++
      for (const h of health.data ?? []) {
        const c = bump(h.workspace_id)
        c.total += h.total_tasks ?? 0
        c.done += h.done_tasks ?? 0
      }
      setCounts(next)
    })()
    return () => { alive = false }
  }, [workspaces])

  const active = workspaces.filter(w => !w.is_archived)

  return (
    <div className="mx-auto w-full max-w-6xl px-5 py-10 sm:px-8 sm:py-14">
      <header className="mb-8">
        <h1 className="text-2xl font-semibold tracking-tight sm:text-3xl">Your workspaces</h1>
        <p className="mt-1.5 text-sm text-slate-500 dark:text-slate-400">
          Open a workspace to see its teams and boards. You only ever see the ones you belong to.
        </p>
      </header>

      {loading && active.length === 0 ? (
        <div className="flex justify-center py-20 text-slate-400"><Spinner className="h-6 w-6" /></div>
      ) : (
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {active.map(w => {
            const c = counts[w.id]
            const role = myRole(w.id)
            const pct = c && c.total > 0 ? Math.round((c.done / c.total) * 100) : 0

            return (
              <button
                key={w.id}
                onClick={() => onOpen(w.id)}
                aria-label={`Open ${w.name}`}
                className="group flex flex-col rounded-2xl bg-white p-5 text-left shadow-sm ring-1 ring-slate-200 transition hover:-translate-y-0.5 hover:shadow-lg hover:ring-slate-300 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-indigo-600 dark:bg-slate-900 dark:ring-slate-800 dark:hover:ring-slate-700"
              >
                <div className="flex items-start gap-3">
                  <Mark name={w.name} color={w.color} className="h-11 w-11" />
                  <div className="min-w-0 flex-1">
                    <h2 className="truncate text-base font-semibold">{w.name}</h2>
                    <div className="mt-1 flex flex-wrap items-center gap-1.5">
                      <span className="rounded-md bg-slate-100 px-1.5 py-0.5 text-[10px] font-medium text-slate-600 dark:bg-slate-800 dark:text-slate-300">
                        {KIND_LABEL[w.kind] ?? w.kind}
                      </span>
                      {role && (
                        <span className={cx('rounded-md px-1.5 py-0.5 text-[10px] font-medium ring-1 ring-inset capitalize', ROLE_CHIP[role])}>
                          {role}
                        </span>
                      )}
                    </div>
                  </div>
                </div>

                <p className="mt-3 line-clamp-2 min-h-[2.5rem] text-xs leading-relaxed text-slate-500 dark:text-slate-400">
                  {w.description || 'No description yet.'}
                </p>

                <dl className="mt-4 flex items-center gap-4 text-xs text-slate-500 dark:text-slate-400">
                  <div><dt className="sr-only">Teams</dt>
                    <dd><span className="font-semibold text-slate-800 dark:text-slate-200">{c?.teams ?? 0}</span> teams</dd></div>
                  <div><dt className="sr-only">Projects</dt>
                    <dd><span className="font-semibold text-slate-800 dark:text-slate-200">{c?.projects ?? 0}</span> projects</dd></div>
                  <div><dt className="sr-only">Members</dt>
                    <dd><span className="font-semibold text-slate-800 dark:text-slate-200">{c?.members ?? 0}</span> members</dd></div>
                </dl>

                <div className="mt-3 flex items-center gap-2">
                  <div className="h-1.5 flex-1 overflow-hidden rounded-full bg-slate-200 dark:bg-slate-700">
                    <div className="h-full rounded-full transition-all"
                      style={{ width: `${pct}%`, backgroundColor: w.color }} />
                  </div>
                  <span className="w-9 shrink-0 text-right text-[10px] tabular-nums text-slate-400">{pct}%</span>
                </div>

                <span className="mt-4 inline-flex items-center gap-1 text-xs font-medium text-indigo-600 transition group-hover:gap-2 dark:text-indigo-400">
                  Open workspace
                  <svg viewBox="0 0 16 16" className="h-3.5 w-3.5" fill="none" stroke="currentColor" strokeWidth="2">
                    <path d="M6 3.5 10.5 8 6 12.5" strokeLinecap="round" strokeLinejoin="round" />
                  </svg>
                </span>
              </button>
            )
          })}

          {canCreate && (
            <button
              onClick={onNew}
              className="flex min-h-56 flex-col items-center justify-center gap-2 rounded-2xl border-2 border-dashed border-slate-300 p-5 text-slate-500 transition hover:border-indigo-400 hover:text-indigo-600 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-indigo-600 dark:border-slate-700 dark:hover:border-indigo-600"
            >
              <svg viewBox="0 0 24 24" className="h-7 w-7" fill="none" stroke="currentColor" strokeWidth="1.5">
                <path d="M12 6v12M6 12h12" strokeLinecap="round" />
              </svg>
              <span className="text-sm font-medium">New workspace</span>
              <span className="max-w-[14rem] text-center text-xs text-slate-400">
                A hackathon, a programme, or a private space of your own
              </span>
            </button>
          )}
        </div>
      )}

      {active.length === 0 && !loading && (
        <div className="rounded-2xl border border-dashed border-slate-300 py-16 text-center dark:border-slate-700">
          <h2 className="mt-3 text-base font-semibold">You are not in any workspace yet</h2>
          <p className="mx-auto mt-1 max-w-sm text-sm text-slate-500 dark:text-slate-400">
            If you were given a join code, enter it below. Otherwise an administrator
            needs to add you to one.
          </p>
        </div>
      )}

      <div className="mt-10 border-t border-slate-200 pt-6 dark:border-slate-800">
        {showJoin ? (
          <div className="max-w-sm">
            <JoinCodeCard onJoined={() => { setShowJoin(false); onJoined() }} />
            <button onClick={() => setShowJoin(false)}
              className="mt-2 text-xs text-slate-500 hover:text-slate-800 dark:hover:text-slate-200">
              Cancel
            </button>
          </div>
        ) : (
          <Button variant="outline" onClick={() => setShowJoin(true)}>
            Join with a code
          </Button>
        )}
      </div>
    </div>
  )
}
