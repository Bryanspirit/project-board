import { useState } from 'react'
import type { Workspace, WorkspaceKind, WorkspaceRole, Team } from '../../lib/types'
import { PROJECT_COLORS } from '../../lib/types'
import { Button, Field, Input, Modal, Select, Textarea, cx } from '../ui'
import { generateJoinCode } from '../../hooks/useWorkspaces'
import InviteCodePanel from './InviteCodePanel'
import InviteLinkPanel from './InviteLinkPanel'

export interface WorkspaceDraft {
  id?: string
  name: string
  description: string
  kind: WorkspaceKind
  emoji: string
  color: string
  starts_at: string
  ends_at: string
  join_code: string
  join_code_enabled: boolean
  join_role: WorkspaceRole
}

const KINDS: { id: WorkspaceKind; label: string; blurb: string }[] = [
  { id: 'personal',  label: 'Personal',  blurb: 'Private to you' },
  { id: 'team',      label: 'Team',      blurb: 'A standing group of people' },
  { id: 'hackathon', label: 'Hackathon', blurb: 'A time-boxed event with teams and a demo day' },
  { id: 'program',   label: 'Programme', blurb: 'A cohort running over weeks or months' },
]

/** Kinds where strangers are expected to onboard themselves with a code. */
const CODE_KINDS: WorkspaceKind[] = ['hackathon', 'program']

/** `datetime-local` speaks wall-clock time; the column stores an instant. */
function toLocalInput(iso: string | null): string {
  if (!iso) return ''
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return ''
  const pad = (n: number) => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`
}

export function toISO(local: string): string | null {
  if (!local) return null
  const d = new Date(local)
  return Number.isNaN(d.getTime()) ? null : d.toISOString()
}

export function workspaceDraft(w?: Workspace): WorkspaceDraft {
  return {
    id: w?.id,
    name: w?.name ?? '',
    description: w?.description ?? '',
    kind: w?.kind ?? 'program',
    emoji: w?.emoji ?? '🗂️',
    color: w?.color ?? PROJECT_COLORS[0],
    starts_at: toLocalInput(w?.starts_at ?? null),
    ends_at: toLocalInput(w?.ends_at ?? null),
    join_code: w?.join_code ?? '',
    join_code_enabled: w?.join_code_enabled ?? false,
    join_role: w?.join_role ?? 'member',
  }
}

/** Turns a draft back into the columns `workspaces` actually has. */
export function draftToPatch(d: WorkspaceDraft): Partial<Workspace> {
  return {
    name: d.name.trim(),
    description: d.description.trim() || null,
    kind: d.kind,
    emoji: d.emoji.trim() || '🗂️',
    color: d.color,
    starts_at: toISO(d.starts_at),
    ends_at: toISO(d.ends_at),
    join_code: d.join_code.trim() || null,
    join_code_enabled: d.join_code_enabled,
    join_role: d.join_role,
  }
}

export default function WorkspaceDialog({
  draft, teams = [], canManage = false, onSave, onArchive, onRegenerateCode, onClose,
}: {
  draft: WorkspaceDraft
  /** Teams in this workspace, so an invite can target one directly. */
  teams?: Team[]
  canManage?: boolean
  onSave: (d: WorkspaceDraft) => Promise<void> | void
  onArchive?: (id: string) => Promise<void> | void
  /** Writes a fresh code straight to the row; falls back to a local one. */
  onRegenerateCode?: (id: string) => Promise<string | null>
  onClose: () => void
}) {
  const [form, setForm] = useState(draft)
  const [confirmArchive, setConfirmArchive] = useState(false)
  const [busy, setBusy] = useState(false)

  const set = <K extends keyof WorkspaceDraft>(k: K, v: WorkspaceDraft[K]) =>
    setForm(f => ({ ...f, [k]: v }))

  const showCode = CODE_KINDS.includes(form.kind)
  const invalidRange = Boolean(form.starts_at && form.ends_at && form.ends_at < form.starts_at)

  async function regenerate() {
    setBusy(true)
    try {
      const next = form.id && onRegenerateCode ? await onRegenerateCode(form.id) : null
      set('join_code', next ?? generateJoinCode())
    } finally {
      setBusy(false)
    }
  }

  return (
    <Modal
      title={form.id ? 'Edit workspace' : 'New workspace'}
      onClose={onClose}
      footer={
        <>
          {form.id && onArchive && (
            confirmArchive ? (
              <div className="mr-auto flex flex-wrap items-center gap-2">
                <span className="text-xs text-slate-500 dark:text-slate-400">
                  Archive it? Its teams, projects and boards stay put but drop out of everyone’s switcher.
                </span>
                <Button size="sm" variant="danger"
                  onClick={async () => { await onArchive(form.id as string); onClose() }}>
                  Yes, archive
                </Button>
                <Button size="sm" variant="ghost" onClick={() => setConfirmArchive(false)}>Cancel</Button>
              </div>
            ) : (
              <Button variant="ghost" className="mr-auto text-rose-600 hover:bg-rose-50 dark:hover:bg-rose-950/50"
                onClick={() => setConfirmArchive(true)}>
                Archive
              </Button>
            )
          )}
          <Button variant="ghost" onClick={onClose}>Cancel</Button>
          <Button
            disabled={!form.name.trim() || invalidRange || busy}
            onClick={async () => { await onSave(form); onClose() }}
          >
            {form.id ? 'Save changes' : 'Create workspace'}
          </Button>
        </>
      }
    >
      <Field label="Workspace name">
        <Input autoFocus value={form.name} onChange={e => set('name', e.target.value)}
          placeholder="Orion EdX" />
      </Field>

      <Field label="Description">
        <Textarea rows={2} value={form.description} onChange={e => set('description', e.target.value)}
          placeholder="What is this workspace for?" />
      </Field>

      <div className="grid grid-cols-2 gap-3">
        <Field label="Kind" hint={KINDS.find(k => k.id === form.kind)?.blurb}>
          <Select value={form.kind} onChange={e => set('kind', e.target.value as WorkspaceKind)}>
            {KINDS.map(k => <option key={k.id} value={k.id}>{k.label}</option>)}
          </Select>
        </Field>
        <Field label="Emoji" hint="Shown in the switcher">
          <Input value={form.emoji} maxLength={4} onChange={e => set('emoji', e.target.value)}
            placeholder="🚀" className="text-center text-lg" />
        </Field>
      </div>

      <div className="grid grid-cols-2 gap-3">
        <Field label="Starts">
          <Input type="datetime-local" value={form.starts_at}
            onChange={e => set('starts_at', e.target.value)} />
        </Field>
        <Field label="Ends">
          <Input type="datetime-local" value={form.ends_at}
            onChange={e => set('ends_at', e.target.value)} />
        </Field>
      </div>

      {invalidRange && (
        <p role="alert" className="-mt-2 text-xs text-rose-600 dark:text-rose-400">
          The end has to come after the start.
        </p>
      )}

      <Field label="Colour">
        <div className="flex flex-wrap gap-2">
          {PROJECT_COLORS.map(c => (
            <button key={c} type="button" onClick={() => set('color', c)}
              aria-label={'Colour ' + c} aria-pressed={form.color === c}
              style={{ backgroundColor: c }}
              className={cx(
                'h-7 w-7 rounded-full transition',
                form.color === c
                  ? 'ring-2 ring-slate-900 ring-offset-2 dark:ring-white dark:ring-offset-slate-900'
                  : 'hover:scale-110',
              )}
            />
          ))}
        </div>
      </Field>

      {showCode && (
        <InviteCodePanel
          code={form.join_code || null}
          enabled={form.join_code_enabled}
          role={form.join_role}
          busy={busy}
          onToggle={enabled => {
            set('join_code_enabled', enabled)
            // Turning it on with no code would publish a door with no key.
            if (enabled && !form.join_code) set('join_code', generateJoinCode())
          }}
          onRoleChange={role => set('join_role', role)}
          onRegenerate={regenerate}
        />
      )}

      {showCode && draft.id && (
        <InviteLinkPanel workspaceId={draft.id} teams={teams} canManage={canManage} />
      )}
    </Modal>
  )
}
