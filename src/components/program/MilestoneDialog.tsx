import { useState } from 'react'
import { Button, Field, Input, Modal, Select, Spinner, Textarea } from '../ui'
import { MILESTONE_KINDS } from '../../lib/types'
import type { Milestone, MilestoneKind } from '../../lib/types'

/** `due_at` is a `timestamptz`; a `datetime-local` input speaks wall-clock time
 *  in the viewer's zone. These two functions are the only place we cross that
 *  border — building the Date from its local parts (never string-slicing the
 *  ISO value) is what stops a milestone drifting a day when the offset is
 *  negative or the date sits either side of a DST change. */
export function isoToLocalInput(iso: string | null | undefined): string {
  if (!iso) return ''
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return ''
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`
}

export function localInputToISO(value: string): string | null {
  const m = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})/.exec(value.trim())
  if (!m) return null
  const d = new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]), Number(m[4]), Number(m[5]), 0, 0)
  return Number.isNaN(d.getTime()) ? null : d.toISOString()
}

function pad(n: number) { return String(n).padStart(2, '0') }

export interface MilestoneDialogProps {
  /** `null` opens the dialog in create mode. */
  milestone: Milestone | null
  onClose: () => void
  onSave: (patch: Partial<Milestone>) => Promise<unknown>
  onDelete?: (id: string) => Promise<unknown>
}

export function MilestoneDialog({ milestone, onClose, onSave, onDelete }: MilestoneDialogProps) {
  const editing = Boolean(milestone)
  const [name, setName] = useState(milestone?.name ?? '')
  const [description, setDescription] = useState(milestone?.description ?? '')
  const [kind, setKind] = useState<MilestoneKind>(milestone?.kind ?? 'custom')
  const [due, setDue] = useState(() => isoToLocalInput(milestone?.due_at) || defaultDue())
  const [problem, setProblem] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const [confirmingDelete, setConfirmingDelete] = useState(false)

  async function save() {
    const trimmed = name.trim()
    if (!trimmed) return setProblem('Give the milestone a name.')
    const due_at = localInputToISO(due)
    if (!due_at) return setProblem('Pick a valid date and time.')

    setProblem(null)
    setBusy(true)
    try {
      await onSave({
        name: trimmed,
        description: description.trim() || null,
        kind,
        due_at,
      })
      onClose()
    } catch (e) {
      setProblem(e instanceof Error ? e.message : 'Could not save that milestone.')
    } finally {
      setBusy(false)
    }
  }

  async function remove() {
    if (!milestone || !onDelete) return
    setBusy(true)
    try {
      await onDelete(milestone.id)
      onClose()
    } catch (e) {
      setProblem(e instanceof Error ? e.message : 'Could not delete that milestone.')
      setBusy(false)
    }
  }

  const zone = Intl.DateTimeFormat().resolvedOptions().timeZone

  return (
    <Modal
      title={editing ? 'Edit milestone' : 'New milestone'}
      onClose={onClose}
      footer={
        <>
          {editing && onDelete && (
            confirmingDelete ? (
              <div className="mr-auto flex items-center gap-2">
                <span className="text-xs text-slate-500 dark:text-slate-400">Delete this milestone?</span>
                <Button size="sm" variant="ghost" onClick={() => setConfirmingDelete(false)} disabled={busy}>
                  Keep
                </Button>
                <Button size="sm" variant="danger" onClick={() => void remove()} disabled={busy}>
                  Delete
                </Button>
              </div>
            ) : (
              <Button className="mr-auto" size="sm" variant="ghost" onClick={() => setConfirmingDelete(true)} disabled={busy}>
                Delete
              </Button>
            )
          )}
          <Button variant="ghost" onClick={onClose} disabled={busy}>Cancel</Button>
          <Button onClick={() => void save()} disabled={busy}>
            {busy && <Spinner className="h-3.5 w-3.5" />}
            {editing ? 'Save changes' : 'Add milestone'}
          </Button>
        </>
      }
    >
      <Field label="Name">
        <Input
          value={name}
          autoFocus
          placeholder="Submissions close"
          onChange={e => setName(e.target.value)}
        />
      </Field>

      <div className="grid gap-4 sm:grid-cols-2">
        <Field label="Kind">
          <Select value={kind} onChange={e => setKind(e.target.value as MilestoneKind)}>
            {MILESTONE_KINDS.map(k => (
              <option key={k.id} value={k.id}>{k.emoji}  {k.label}</option>
            ))}
          </Select>
        </Field>
        <Field label="Due" hint={`Local time — ${zone}`}>
          <Input type="datetime-local" value={due} onChange={e => setDue(e.target.value)} />
        </Field>
      </div>

      <Field label="Description" hint="Optional. What teams need to have done by then.">
        <Textarea
          rows={3}
          value={description}
          placeholder="Push your final commit and fill in the submission form."
          onChange={e => setDescription(e.target.value)}
        />
      </Field>

      {problem && (
        <p role="alert" className="rounded-lg bg-rose-50 px-3 py-2 text-sm text-rose-700 ring-1 ring-rose-200 dark:bg-rose-950/60 dark:text-rose-300 dark:ring-rose-900">
          {problem}
        </p>
      )}
    </Modal>
  )
}

/** Tomorrow at 17:00 local — a sane starting point for a new milestone. */
function defaultDue(): string {
  const d = new Date()
  d.setDate(d.getDate() + 1)
  d.setHours(17, 0, 0, 0)
  return isoToLocalInput(d.toISOString())
}
