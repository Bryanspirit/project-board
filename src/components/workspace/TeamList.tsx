import { useMemo } from 'react'
import type { Team, TeamMember } from '../../lib/types'
import { cx } from '../ui'

/**
 * Sits under the workspace switcher in the sidebar. Selecting a team filters
 * the board to that team's projects; "All teams" clears the filter.
 */
export default function TeamList({
  teams, teamMembers = [], projects = [], activeTeamId, onSelect,
  canCreate = false, canEdit, onNew, onEdit, className,
}: {
  teams: Team[]
  teamMembers?: TeamMember[]
  /** Only `team_id` is read — pass the workspace's projects straight through. */
  projects?: { team_id: string | null }[]
  activeTeamId: string | null
  onSelect: (teamId: string | null) => void
  canCreate?: boolean
  /** True for workspace admins, and for the lead of that particular team. */
  canEdit?: (teamId: string) => boolean
  onNew?: () => void
  onEdit?: (team: Team) => void
  className?: string
}) {
  const memberCounts = useMemo(() => {
    const map = new Map<string, number>()
    for (const m of teamMembers) map.set(m.team_id, (map.get(m.team_id) ?? 0) + 1)
    return map
  }, [teamMembers])

  const projectCounts = useMemo(() => {
    const map = new Map<string, number>()
    for (const p of projects) {
      if (p.team_id) map.set(p.team_id, (map.get(p.team_id) ?? 0) + 1)
    }
    return map
  }, [projects])

  const row = (
    key: string,
    id: string | null,
    emoji: string,
    name: string,
    detail: string,
    color: string | null,
    team?: Team,
  ) => {
    const active = id === activeTeamId
    const editable = Boolean(team && onEdit && canEdit?.(team.id))
    return (
      <li key={key}>
        <div
          role="button"
          tabIndex={0}
          aria-pressed={active}
          onClick={() => onSelect(id)}
          onKeyDown={e => {
            if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); onSelect(id) }
          }}
          className={cx(
            'group flex w-full cursor-pointer items-center gap-2 rounded-lg px-2.5 py-1.5 text-left transition',
            active
              ? 'bg-white shadow-sm ring-1 ring-slate-200 dark:bg-slate-800 dark:ring-slate-700'
              : 'hover:bg-slate-200/60 dark:hover:bg-slate-800/60',
          )}
        >
          <span className="text-sm leading-none" aria-hidden>{emoji}</span>
          <span className="min-w-0 flex-1">
            <span className="flex items-center gap-1.5">
              {color && (
                <span className="h-1.5 w-1.5 shrink-0 rounded-full" style={{ backgroundColor: color }} aria-hidden />
              )}
              <span className="min-w-0 truncate text-sm font-medium">{name}</span>
            </span>
            <span className="block truncate text-[11px] text-slate-400">{detail}</span>
          </span>

          {editable && team && (
            <button
              type="button"
              aria-label={`Edit ${team.name}`}
              onClick={e => { e.stopPropagation(); onEdit?.(team) }}
              className="shrink-0 rounded p-0.5 text-slate-400 opacity-0 transition group-hover:opacity-100 hover:text-slate-700 focus:opacity-100 dark:hover:text-slate-200"
            >
              <svg viewBox="0 0 16 16" className="h-3.5 w-3.5" fill="none" stroke="currentColor" strokeWidth="1.5" aria-hidden>
                <path d="M11.5 2.5a1.7 1.7 0 0 1 2.4 2.4L5.6 13.2l-3.1.7.7-3.1 8.3-8.3Z" strokeLinejoin="round" />
              </svg>
            </button>
          )}
        </div>
      </li>
    )
  }

  const totalProjects = projects.length

  return (
    <section className={className}>
      <div className="flex items-center justify-between px-2.5 py-1.5">
        <h2 className="text-[10px] font-semibold tracking-wider text-slate-400 uppercase">Teams</h2>
        {canCreate && onNew && (
          <button
            type="button"
            onClick={onNew}
            aria-label="New team"
            title="New team"
            className="rounded p-0.5 text-slate-400 transition hover:bg-slate-200/70 hover:text-slate-700 dark:hover:bg-slate-800 dark:hover:text-slate-200"
          >
            <svg viewBox="0 0 16 16" className="h-3.5 w-3.5" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden>
              <path d="M8 3v10M3 8h10" strokeLinecap="round" />
            </svg>
          </button>
        )}
      </div>

      <ul className="space-y-0.5">
        {row(
          'all', null, '🌐', 'All teams',
          `${teams.length} ${teams.length === 1 ? 'team' : 'teams'} · ${totalProjects} ${totalProjects === 1 ? 'project' : 'projects'}`,
          null,
        )}
        {teams.map(t => {
          const people = memberCounts.get(t.id) ?? 0
          const built = projectCounts.get(t.id) ?? 0
          return row(
            t.id, t.id, t.emoji, t.name,
            `${people} ${people === 1 ? 'member' : 'members'} · ${built} ${built === 1 ? 'project' : 'projects'}`,
            t.color, t,
          )
        })}
      </ul>

      {teams.length === 0 && (
        <p className="px-2.5 py-2 text-xs leading-relaxed text-slate-400">
          {canCreate
            ? 'No teams yet. Add one to split the work up.'
            : 'No teams in this workspace yet.'}
        </p>
      )}
    </section>
  )
}
