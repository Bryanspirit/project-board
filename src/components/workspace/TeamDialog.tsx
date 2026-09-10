import { useMemo, useState, useRef } from 'react'
import type { Team, TeamMember, TeamRole, WorkspaceMember } from '../../lib/types'
import { PROJECT_COLORS } from '../../lib/types'
import { Button, Field, Input, Modal, Select, Textarea, cx } from '../ui'

export interface TeamDraft {
  id?: string
  name: string
  description: string
  color: string
}

const TEAM_ROLES: { id: TeamRole; label: string }[] = [
  { id: 'lead', label: 'Lead' },
  { id: 'member', label: 'Member' },
]

export function teamDraft(t?: Team): TeamDraft {
  return {
    id: t?.id,
    name: t?.name ?? '',
    description: t?.description ?? '',
    color: t?.color ?? PROJECT_COLORS[1],
  }
}

export function draftToTeamPatch(d: TeamDraft): Partial<Team> {
  return {
    name: d.name.trim(),
    description: d.description.trim() || null,
    color: d.color,
  }
}

function displayName(profile: { full_name: string | null; email: string } | undefined, fallback: string) {
  if (!profile) return fallback
  return profile.full_name?.trim() || profile.email
}

export default function TeamDialog({
  draft, members = [], workspaceMembers = [], canManageMembers = false,
  onSave, onDelete, onAddMember, onChangeMemberRole, onRemoveMember, onClose,
}: {
  draft: TeamDraft
  /** Current `team_members` rows for the team being edited. */
  members?: TeamMember[]
  /** Everyone in the workspace, for the add picker. */
  workspaceMembers?: WorkspaceMember[]
  canManageMembers?: boolean
  onSave: (d: TeamDraft) => Promise<void> | void
  onDelete?: (id: string) => Promise<void> | void
  onAddMember?: (userId: string, role: TeamRole) => Promise<unknown> | void
  onChangeMemberRole?: (memberRowId: string, role: TeamRole) => Promise<unknown> | void
  onRemoveMember?: (memberRowId: string) => Promise<unknown> | void
  onClose: () => void
}) {
  const [form, setForm] = useState(draft)

  // A create takes a round trip, and the button stayed live for all of it —
  // two quick clicks made two workspaces. State alone cannot fix that: React
  // batches the update, so the second click is handled before the re-render
  // disables anything. The ref shuts the door immediately; the state is only
  // there to grey the button out.
  const savingRef = useRef(false)
  const [saving, setSaving] = useState(false)

  async function commit() {
    if (savingRef.current) return
    savingRef.current = true
    setSaving(true)
    try {
      await onSave(form)
      onClose()
    } finally {
      savingRef.current = false
      setSaving(false)
    }
  }

  const [confirmDelete, setConfirmDelete] = useState(false)
  const [pickUser, setPickUser] = useState('')
  const [pickRole, setPickRole] = useState<TeamRole>('member')
  const [busy, setBusy] = useState(false)

  const set = <K extends keyof TeamDraft>(k: K, v: TeamDraft[K]) => setForm(f => ({ ...f, [k]: v }))

  const editing = Boolean(form.id)
  const showMembers = editing && canManageMembers

  const onTeam = useMemo(() => new Set(members.map(m => m.user_id)), [members])
  const candidates = useMemo(
    () => workspaceMembers
      .filter(m => !onTeam.has(m.user_id))
      .sort((a, b) => displayName(a.profile, a.user_id).localeCompare(displayName(b.profile, b.user_id))),
    [workspaceMembers, onTeam],
  )

  async function add() {
    if (!pickUser || !onAddMember) return
    setBusy(true)
    try {
      await onAddMember(pickUser, pickRole)
      setPickUser('')
      setPickRole('member')
    } finally {
      setBusy(false)
    }
  }

  return (
    <Modal
      title={editing ? 'Edit team' : 'New team'}
      onClose={onClose}
      footer={
        <>
          {editing && onDelete && (
            confirmDelete ? (
              <div className="mr-auto flex flex-wrap items-center gap-2">
                <span className="text-xs text-slate-500 dark:text-slate-400">
                  Delete the team? Its members lose access and its projects fall back to the workspace.
                </span>
                <Button size="sm" variant="danger"
                  onClick={async () => { await onDelete(form.id as string); onClose() }}>
                  Yes, delete
                </Button>
                <Button size="sm" variant="ghost" onClick={() => setConfirmDelete(false)}>Cancel</Button>
              </div>
            ) : (
              <Button variant="ghost" className="mr-auto text-rose-600 hover:bg-rose-50 dark:hover:bg-rose-950/50"
                onClick={() => setConfirmDelete(true)}>
                Delete
              </Button>
            )
          )}
          <Button variant="ghost" onClick={onClose}>Cancel</Button>
          <Button disabled={!form.name.trim() || busy || saving}
            onClick={() => void commit()}>
            {editing ? 'Save changes' : 'Create team'}
          </Button>
        </>
      }
    >
      <Field label="Team name">
        <Input autoFocus value={form.name} onChange={e => set('name', e.target.value)}
          placeholder="Platform" />
      </Field>

      <Field label="Description">
        <Textarea rows={2} value={form.description} onChange={e => set('description', e.target.value)}
          placeholder="What does this team own?" />
      </Field>

      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        <Field label="Colour">
          <div className="flex flex-wrap gap-2 pt-1">
            {PROJECT_COLORS.map(c => (
              <button key={c} type="button" onClick={() => set('color', c)}
                aria-label={'Colour ' + c} aria-pressed={form.color === c}
                style={{ backgroundColor: c }}
                className={cx(
                  'h-6 w-6 rounded-full transition',
                  form.color === c
                    ? 'ring-2 ring-slate-900 ring-offset-2 dark:ring-white dark:ring-offset-slate-900'
                    : 'hover:scale-110',
                )}
              />
            ))}
          </div>
        </Field>
      </div>

      {showMembers && (
        <section className="rounded-xl bg-slate-50 p-3.5 ring-1 ring-slate-200 dark:bg-slate-950/40 dark:ring-slate-800">
          <h3 className="text-sm font-semibold text-slate-800 dark:text-slate-100">
            Members <span className="font-normal text-slate-400">({members.length})</span>
          </h3>

          <ul className="mt-2 space-y-1.5">
            {members.map(m => (
              <li key={m.id} className="flex items-center gap-2 rounded-lg bg-white px-2.5 py-2 ring-1 ring-slate-200 dark:bg-slate-900 dark:ring-slate-800">
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-sm text-slate-800 dark:text-slate-100">
                    {displayName(m.profile, 'Unknown member')}
                  </span>
                  {m.profile?.role_title && (
                    <span className="block truncate text-[11px] text-slate-400">{m.profile.role_title}</span>
                  )}
                </span>
                <Select
                  aria-label={`Role for ${displayName(m.profile, 'this member')}`}
                  value={m.role}
                  disabled={!onChangeMemberRole || busy}
                  onChange={e => void onChangeMemberRole?.(m.id, e.target.value as TeamRole)}
                  className="w-28 shrink-0 py-1 text-xs"
                >
                  {TEAM_ROLES.map(r => <option key={r.id} value={r.id}>{r.label}</option>)}
                </Select>
                <button
                  type="button"
                  aria-label={`Remove ${displayName(m.profile, 'member')}`}
                  disabled={!onRemoveMember || busy}
                  onClick={() => void onRemoveMember?.(m.id)}
                  className="shrink-0 rounded-lg p-1.5 text-slate-400 transition hover:bg-rose-50 hover:text-rose-600 disabled:opacity-40 dark:hover:bg-rose-950/50 dark:hover:text-rose-400"
                >
                  <svg viewBox="0 0 16 16" className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth="1.8" aria-hidden>
                    <path d="M4 4l8 8M12 4l-8 8" strokeLinecap="round" />
                  </svg>
                </button>
              </li>
            ))}
            {members.length === 0 && (
              <li className="px-0.5 py-1 text-xs text-slate-500 dark:text-slate-400">Nobody on this team yet.</li>
            )}
          </ul>

          {onAddMember && (
            <div className="mt-3 flex items-end gap-2 border-t border-slate-200 pt-3 dark:border-slate-800">
              <div className="min-w-0 flex-1">
                <Field label="Add from the workspace">
                  <Select value={pickUser} onChange={e => setPickUser(e.target.value)}
                    disabled={candidates.length === 0}>
                    <option value="">
                      {candidates.length === 0 ? 'Everyone is already on this team' : 'Choose a person…'}
                    </option>
                    {candidates.map(c => (
                      <option key={c.id} value={c.user_id}>
                        {displayName(c.profile, c.user_id)} · {c.role}
                      </option>
                    ))}
                  </Select>
                </Field>
              </div>
              <Select aria-label="Role for the new member" value={pickRole}
                onChange={e => setPickRole(e.target.value as TeamRole)} className="w-28 shrink-0">
                {TEAM_ROLES.map(r => <option key={r.id} value={r.id}>{r.label}</option>)}
              </Select>
              <Button type="button" variant="outline" disabled={!pickUser || busy} onClick={() => void add()}>
                Add
              </Button>
            </div>
          )}
        </section>
      )}

      {editing && !canManageMembers && (
        <p className="text-xs text-slate-500 dark:text-slate-400">
          Only a workspace admin or this team’s lead can change who is on it.
        </p>
      )}
    </Modal>
  )
}
