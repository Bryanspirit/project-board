import { useMemo } from 'react'
import type { Profile, Project, Task, Team, TeamMember, Workspace, WorkspaceMember, WorkspaceRole } from '../../lib/types'
import { Button, cx } from '../ui'
import { Mark } from '../Mark'

function initials(p?: Profile | null) {
  const source = p?.full_name?.trim() || p?.email || '?'
  return source.slice(0, 1).toUpperCase()
}

function Avatars({ members }: { members: TeamMember[] }) {
  const shown = members.slice(0, 4)
  const rest = members.length - shown.length
  return (
    <div className="flex -space-x-1.5">
      {shown.map(m => (
        <span
          key={m.id}
          title={m.profile?.full_name ?? m.profile?.email ?? 'Member'}
          className="flex h-6 w-6 items-center justify-center rounded-full bg-indigo-600 text-[10px] font-semibold text-white ring-2 ring-white dark:ring-slate-900"
        >
          {initials(m.profile)}
        </span>
      ))}
      {rest > 0 && (
        <span className="flex h-6 w-6 items-center justify-center rounded-full bg-slate-200 text-[10px] font-semibold text-slate-600 ring-2 ring-white dark:bg-slate-700 dark:text-slate-300 dark:ring-slate-900">
          +{rest}
        </span>
      )}
      {members.length === 0 && (
        <span className="text-[11px] text-slate-400">No members yet</span>
      )}
    </div>
  )
}

/**
 * What you land on after opening a workspace: its teams, who is in them, and
 * the way into each team's board. Projects that belong to no team are gathered
 * into their own card so nothing is unreachable.
 */
export default function WorkspaceHome({
  workspace, role, isAdmin, isTeamLead, teams, membersByTeam, workspaceMembers,
  projects, tasksByProject, onOpenTeam, onNewTeam, onEditTeam, onManageMembers, onEditWorkspace,
}: {
  workspace: Workspace
  role: WorkspaceRole | null
  isAdmin: boolean
  isTeamLead: (teamId: string) => boolean
  teams: Team[]
  membersByTeam: Map<string, TeamMember[]>
  workspaceMembers: WorkspaceMember[]
  projects: Project[]
  tasksByProject: Map<string, Task[]>
  onOpenTeam: (teamId: string | null) => void
  onNewTeam: () => void
  onEditTeam: (team: Team) => void
  onManageMembers: () => void
  onEditWorkspace: () => void
}) {
  const stats = useMemo(() => {
    const per = new Map<string | null, { projects: number; done: number; total: number }>()
    for (const p of projects) {
      const key = p.team_id
      const bucket = per.get(key) ?? { projects: 0, done: 0, total: 0 }
      bucket.projects++
      const tasks = tasksByProject.get(p.id) ?? []
      bucket.total += tasks.length
      bucket.done += tasks.filter(t => t.status === 'done').length
      per.set(key, bucket)
    }
    return per
  }, [projects, tasksByProject])

  const unassigned = stats.get(null)

  function card(key: string, opts: {
    name: string
    subtitle: string
    color: string
    members?: TeamMember[]
    onOpen: () => void
    onEdit?: () => void
  }) {
    const s = stats.get(key === '__none__' ? null : key)
    const pct = s && s.total > 0 ? Math.round((s.done / s.total) * 100) : 0

    return (
      <div
        key={key}
        className="group relative flex flex-col rounded-2xl bg-white p-5 shadow-sm ring-1 ring-slate-200 transition hover:-translate-y-0.5 hover:shadow-lg dark:bg-slate-900 dark:ring-slate-800"
      >
        <button
          onClick={opts.onOpen}
          aria-label={`Open ${opts.name}`}
          className="flex flex-1 flex-col text-left focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-indigo-600"
        >
          <div className="flex items-center gap-3">
            <Mark name={opts.name} color={opts.color} />
            <div className="min-w-0">
              <h3 className="truncate text-sm font-semibold">{opts.name}</h3>
              <p className="truncate text-xs text-slate-500 dark:text-slate-400">{opts.subtitle}</p>
            </div>
          </div>

          <div className="mt-4 flex items-center justify-between gap-3">
            {opts.members ? <Avatars members={opts.members} /> : <span />}
            <span className="text-xs text-slate-500 dark:text-slate-400">
              {s?.projects ?? 0} project{(s?.projects ?? 0) === 1 ? '' : 's'}
            </span>
          </div>

          <div className="mt-3 flex items-center gap-2">
            <div className="h-1.5 flex-1 overflow-hidden rounded-full bg-slate-200 dark:bg-slate-700">
              <div className="h-full rounded-full transition-all"
                style={{ width: `${pct}%`, backgroundColor: opts.color }} />
            </div>
            <span className="w-9 shrink-0 text-right text-[10px] tabular-nums text-slate-400">{pct}%</span>
          </div>
        </button>

        {opts.onEdit && (
          <button
            onClick={opts.onEdit}
            aria-label={`Edit ${opts.name}`}
            className="absolute top-4 right-4 rounded-md p-1 text-slate-400 opacity-0 transition group-hover:opacity-100 hover:bg-slate-100 hover:text-slate-700 focus:opacity-100 dark:hover:bg-slate-800 dark:hover:text-slate-200"
          >
            <svg viewBox="0 0 16 16" className="h-3.5 w-3.5" fill="none" stroke="currentColor" strokeWidth="1.5">
              <path d="M11.5 2.5a1.7 1.7 0 0 1 2.4 2.4L5.6 13.2l-3.1.7.7-3.1 8.3-8.3Z" strokeLinejoin="round" />
            </svg>
          </button>
        )}
      </div>
    )
  }

  return (
    <div className="mx-auto w-full max-w-6xl px-5 py-8 sm:px-8">
      <section className="mb-8 flex flex-wrap items-start gap-4">
        <Mark name={workspace.name} color={workspace.color} size="lg" />
        <div className="min-w-0 flex-1">
          <h1 className="text-xl font-semibold tracking-tight sm:text-2xl">{workspace.name}</h1>
          <p className="mt-1 max-w-2xl text-sm text-slate-500 dark:text-slate-400">
            {workspace.description || 'No description yet.'}
          </p>
          <div className="mt-2 flex flex-wrap items-center gap-2 text-xs text-slate-500 dark:text-slate-400">
            <span className="rounded-md bg-slate-100 px-1.5 py-0.5 font-medium capitalize dark:bg-slate-800">
              {workspace.kind}
            </span>
            {role && <span>You are {role === 'owner' || role === 'admin' ? 'an' : 'a'} {role}</span>}
            <span>· {workspaceMembers.length} member{workspaceMembers.length === 1 ? '' : 's'}</span>
          </div>
        </div>

        <div className="flex flex-wrap gap-2">
          <Button variant="outline" onClick={onManageMembers}>People</Button>
          {isAdmin && <Button variant="outline" onClick={onEditWorkspace}>Settings</Button>}
        </div>
      </section>

      <section>
        <div className="mb-3 flex items-center justify-between">
          <h2 className="text-sm font-semibold">Teams</h2>
          {isAdmin && (
            <Button size="sm" onClick={onNewTeam}>
              <svg viewBox="0 0 16 16" className="h-3.5 w-3.5" fill="none" stroke="currentColor" strokeWidth="2">
                <path d="M8 3v10M3 8h10" strokeLinecap="round" />
              </svg>
              New team
            </Button>
          )}
        </div>

        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {teams.map(t => card(t.id, {
            name: t.name,
            subtitle: t.description || 'No description',
            color: t.color,
            members: membersByTeam.get(t.id) ?? [],
            onOpen: () => onOpenTeam(t.id),
            onEdit: isAdmin || isTeamLead(t.id) ? () => onEditTeam(t) : undefined,
          }))}

          {unassigned && unassigned.projects > 0 && card('__none__', {
                        name: 'Shared with everyone',
            subtitle: 'Projects not owned by a team',
            color: workspace.color,
            onOpen: () => onOpenTeam(null),
          })}

          {isAdmin && (
            <button
              onClick={onNewTeam}
              className={cx(
                'flex min-h-44 flex-col items-center justify-center gap-2 rounded-2xl border-2 border-dashed p-5 transition',
                'border-slate-300 text-slate-500 hover:border-indigo-400 hover:text-indigo-600',
                'focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-indigo-600',
                'dark:border-slate-700 dark:hover:border-indigo-600',
              )}
            >
              <svg viewBox="0 0 24 24" className="h-6 w-6" fill="none" stroke="currentColor" strokeWidth="1.5">
                <path d="M12 6v12M6 12h12" strokeLinecap="round" />
              </svg>
              <span className="text-sm font-medium">Add a team</span>
              <span className="max-w-[13rem] text-center text-xs text-slate-400">
                Then add its members and start a board
              </span>
            </button>
          )}
        </div>

        {teams.length === 0 && !isAdmin && (
          <p className="rounded-xl border border-dashed border-slate-300 py-10 text-center text-sm text-slate-500 dark:border-slate-700 dark:text-slate-400">
            No teams here yet. An administrator needs to create one.
          </p>
        )}
      </section>

      <section className="mt-8">
        <button
          onClick={() => onOpenTeam(null)}
          className="w-full rounded-xl bg-slate-100 px-5 py-3.5 text-left text-sm font-medium text-slate-700 transition hover:bg-slate-200 dark:bg-slate-800/60 dark:text-slate-200 dark:hover:bg-slate-800"
        >
          Open every board in this workspace
        </button>
      </section>
    </div>
  )
}
