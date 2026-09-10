import { useMemo, useState } from 'react'
import { Button, Input, Modal, Select, cx } from '../ui'
import { WORKSPACE_ROLES } from '../../lib/types'
import type { MemberStatus, Workspace, WorkspaceMember, WorkspaceRole } from '../../lib/types'

interface Props {
  members: WorkspaceMember[]
  workspaces: Workspace[]
  onSetRole: (memberId: string, role: WorkspaceRole) => void | Promise<void>
  onRemove: (memberId: string) => void | Promise<void>
  onSetStatus: (userId: string, status: MemberStatus) => void | Promise<void>
}

const STATUS_CHIP: Record<MemberStatus, string> = {
  active: 'bg-emerald-50 text-emerald-700 ring-emerald-200 dark:bg-emerald-950 dark:text-emerald-300 dark:ring-emerald-900',
  pending: 'bg-amber-50 text-amber-700 ring-amber-200 dark:bg-amber-950 dark:text-amber-300 dark:ring-amber-900',
  suspended: 'bg-slate-100 text-slate-600 ring-slate-300 dark:bg-slate-800 dark:text-slate-300 dark:ring-slate-700',
  rejected: 'bg-rose-50 text-rose-700 ring-rose-200 dark:bg-rose-950 dark:text-rose-300 dark:ring-rose-900',
}

type Pending =
  | { kind: 'suspend'; member: WorkspaceMember }
  | { kind: 'reactivate'; member: WorkspaceMember }
  | { kind: 'remove'; member: WorkspaceMember; workspaceName: string }

function displayName(m: WorkspaceMember) {
  return m.profile?.full_name?.trim() || m.profile?.email || 'Unknown member'
}

function MemberRow({ member, workspaceName, onSetRole, onAsk }: {
  member: WorkspaceMember
  workspaceName: string
  onSetRole: Props['onSetRole']
  onAsk: (p: Pending) => void
}) {
  const [menu, setMenu] = useState(false)
  const name = displayName(member)
  const status = member.profile?.status ?? 'pending'

  return (
    <li className="flex flex-wrap items-center gap-3 px-4 py-3">
      <span aria-hidden="true"
        className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-indigo-100 text-sm font-semibold text-indigo-700 dark:bg-indigo-950 dark:text-indigo-300">
        {name.charAt(0).toUpperCase()}
      </span>

      <div className="min-w-0 flex-1 basis-56">
        <p className="truncate text-sm font-medium text-slate-900 dark:text-slate-50">{name}</p>
        <p className="truncate text-xs text-slate-500 dark:text-slate-400">
          {member.profile?.email ?? '—'}
          {member.profile?.organization && <span> · {member.profile.organization}</span>}
        </p>
      </div>

      <Select
        aria-label={`Workspace role for ${name}`}
        value={member.role}
        onChange={e => void onSetRole(member.id, e.target.value as WorkspaceRole)}
        className="w-36 shrink-0 py-1.5 text-xs"
      >
        {WORKSPACE_ROLES.map(r => <option key={r.id} value={r.id}>{r.label}</option>)}
      </Select>

      <span className={cx('shrink-0 rounded-full px-2 py-0.5 text-xs font-medium ring-1', STATUS_CHIP[status])}>
        {status}
      </span>

      <div className="relative shrink-0">
        <button
          onClick={() => setMenu(m => !m)}
          aria-haspopup="menu"
          aria-expanded={menu}
          aria-label={`Actions for ${name}`}
          className="rounded-lg p-1.5 text-slate-400 transition hover:bg-slate-100 hover:text-slate-700 dark:hover:bg-slate-800 dark:hover:text-slate-200"
        >
          <svg viewBox="0 0 20 20" className="h-4 w-4" fill="currentColor" aria-hidden="true">
            <circle cx="10" cy="4" r="1.6" /><circle cx="10" cy="10" r="1.6" /><circle cx="10" cy="16" r="1.6" />
          </svg>
        </button>
        {menu && (
          <>
            <button className="fixed inset-0 z-10 cursor-default" aria-hidden="true" tabIndex={-1}
              onClick={() => setMenu(false)} />
            <div role="menu" aria-label={`Actions for ${name}`}
              className="absolute right-0 z-20 mt-1 w-52 overflow-hidden rounded-lg bg-white py-1 shadow-lg ring-1 ring-slate-200 dark:bg-slate-900 dark:ring-slate-700">
              {status === 'suspended' ? (
                <button role="menuitem" onClick={() => { setMenu(false); onAsk({ kind: 'reactivate', member }) }}
                  className="block w-full px-3 py-2 text-left text-sm text-slate-700 hover:bg-slate-100 dark:text-slate-200 dark:hover:bg-slate-800">
                  Reactivate account
                </button>
              ) : (
                <button role="menuitem" onClick={() => { setMenu(false); onAsk({ kind: 'suspend', member }) }}
                  className="block w-full px-3 py-2 text-left text-sm text-slate-700 hover:bg-slate-100 dark:text-slate-200 dark:hover:bg-slate-800">
                  Suspend account
                </button>
              )}
              <button role="menuitem" onClick={() => { setMenu(false); onAsk({ kind: 'remove', member, workspaceName }) }}
                className="block w-full px-3 py-2 text-left text-sm text-rose-600 hover:bg-rose-50 dark:text-rose-400 dark:hover:bg-rose-950/50">
                Remove from workspace
              </button>
            </div>
          </>
        )}
      </div>
    </li>
  )
}

export default function MembersPanel({ members, workspaces, onSetRole, onRemove, onSetStatus }: Props) {
  const [query, setQuery] = useState('')
  const [pending, setPending] = useState<Pending | null>(null)

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase()
    if (!q) return members
    return members.filter(m => {
      const p = m.profile
      return (p?.full_name ?? '').toLowerCase().includes(q) || (p?.email ?? '').toLowerCase().includes(q)
    })
  }, [members, query])

  const groups = useMemo(() => {
    const known = workspaces.map(w => ({
      workspace: w,
      rows: filtered.filter(m => m.workspace_id === w.id),
    })).filter(g => g.rows.length > 0)
    const knownIds = new Set(workspaces.map(w => w.id))
    const orphans = filtered.filter(m => !knownIds.has(m.workspace_id))
    return { known, orphans }
  }, [filtered, workspaces])

  const confirm = async () => {
    if (!pending) return
    if (pending.kind === 'remove') await onRemove(pending.member.id)
    else await onSetStatus(pending.member.user_id, pending.kind === 'suspend' ? 'suspended' : 'active')
    setPending(null)
  }

  const total = filtered.length

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-center gap-3">
        <label className="min-w-56 flex-1">
          <span className="sr-only">Search members by name or email</span>
          <Input type="search" value={query} onChange={e => setQuery(e.target.value)}
            placeholder="Search by name or email…" />
        </label>
        <p className="text-xs text-slate-500 dark:text-slate-400">
          {total} membership{total === 1 ? '' : 's'}
        </p>
      </div>

      {total === 0 && (
        <div className="rounded-xl border border-dashed border-slate-300 px-6 py-12 text-center dark:border-slate-700">
          <p className="text-sm font-medium text-slate-700 dark:text-slate-200">No members match</p>
          <p className="mt-1 text-sm text-slate-500 dark:text-slate-400">
            {query ? 'Try a different name or email.' : 'Approve an access request to add the first member.'}
          </p>
        </div>
      )}

      {groups.known.map(({ workspace, rows }) => (
        <section key={workspace.id} aria-labelledby={`ws-${workspace.id}`}>
          <h3 id={`ws-${workspace.id}`} className="mb-2 flex items-center gap-2 text-sm font-semibold text-slate-700 dark:text-slate-200">
            {workspace.name}
            <span className="font-normal text-slate-400">({rows.length})</span>
          </h3>
          <ul className="divide-y divide-slate-200 overflow-hidden rounded-xl bg-white ring-1 ring-slate-200 dark:divide-slate-800 dark:bg-slate-900 dark:ring-slate-800">
            {rows.map(m => (
              <MemberRow key={m.id} member={m} workspaceName={workspace.name}
                onSetRole={onSetRole} onAsk={setPending} />
            ))}
          </ul>
        </section>
      ))}

      {groups.orphans.length > 0 && (
        <section aria-labelledby="ws-unknown">
          <h3 id="ws-unknown" className="mb-2 text-sm font-semibold text-slate-700 dark:text-slate-200">
            Other workspaces <span className="font-normal text-slate-400">({groups.orphans.length})</span>
          </h3>
          <ul className="divide-y divide-slate-200 overflow-hidden rounded-xl bg-white ring-1 ring-slate-200 dark:divide-slate-800 dark:bg-slate-900 dark:ring-slate-800">
            {groups.orphans.map(m => (
              <MemberRow key={m.id} member={m} workspaceName="this workspace"
                onSetRole={onSetRole} onAsk={setPending} />
            ))}
          </ul>
        </section>
      )}

      {pending && (
        <Modal
          title={
            pending.kind === 'remove' ? 'Remove from workspace'
              : pending.kind === 'suspend' ? 'Suspend account' : 'Reactivate account'
          }
          onClose={() => setPending(null)}
          footer={
            <>
              <Button variant="ghost" onClick={() => setPending(null)}>Cancel</Button>
              <Button variant={pending.kind === 'reactivate' ? 'primary' : 'danger'} onClick={() => void confirm()}>
                {pending.kind === 'remove' ? 'Remove member'
                  : pending.kind === 'suspend' ? 'Suspend account' : 'Reactivate'}
              </Button>
            </>
          }
        >
          <p className="text-sm text-slate-600 dark:text-slate-300">
            {pending.kind === 'remove' && (
              <>
                <strong>{displayName(pending.member)}</strong> will lose their membership of
                {' '}<strong>{pending.workspaceName}</strong> and every board, team and project inside it.
                Their account and any other workspace memberships stay untouched. This cannot be undone —
                you would have to add them back.
              </>
            )}
            {pending.kind === 'suspend' && (
              <>
                <strong>{displayName(pending.member)}</strong> will be signed out of every workspace and
                blocked from reading or changing anything until you reactivate them. Their memberships and
                data are kept.
              </>
            )}
            {pending.kind === 'reactivate' && (
              <>
                <strong>{displayName(pending.member)}</strong> regains access to every workspace they belong
                to, with the roles they already had.
              </>
            )}
          </p>
        </Modal>
      )}
    </div>
  )
}
