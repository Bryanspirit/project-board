import { useState } from 'react'
import type { Profile, Task, TaskPriority, TaskStatus } from '../lib/types'
import { COLUMNS, PRIORITIES } from '../lib/types'
import { Button, Field, Input, Modal, Select, Textarea, cx } from './ui'
import { CommentThread } from './collab/CommentThread'
import { AttachmentList } from './collab/AttachmentList'

export interface TaskDraft {
  id?: string
  title: string
  description: string
  status: TaskStatus
  priority: TaskPriority
  due_date: string
  assignee_id: string
  blocked_reason: string
}

export function toDraft(task: Task): TaskDraft {
  return {
    id: task.id,
    title: task.title,
    description: task.description ?? '',
    status: task.status,
    priority: task.priority,
    due_date: task.due_date ?? '',
    assignee_id: task.assignee_id ?? '',
    blocked_reason: task.blocked_reason ?? '',
  }
}

export function emptyDraft(status: TaskStatus = 'todo'): TaskDraft {
  return {
    title: '', description: '', status, priority: 'medium',
    due_date: '', assignee_id: '', blocked_reason: '',
  }
}

type Tab = 'details' | 'discussion' | 'links'

export default function TaskDialog({ draft, people = [], onSave, onDelete, onClose }: {
  draft: TaskDraft
  people?: Profile[]
  onSave: (d: TaskDraft) => Promise<void> | void
  onDelete?: (id: string) => void
  onClose: () => void
}) {
  const [form, setForm] = useState(draft)
  const [tab, setTab] = useState<Tab>('details')
  const [busy, setBusy] = useState(false)
  const [confirmDelete, setConfirmDelete] = useState(false)
  const set = <K extends keyof TaskDraft>(k: K, v: TaskDraft[K]) => setForm(f => ({ ...f, [k]: v }))

  async function save() {
    if (!form.title.trim()) return
    setBusy(true)
    await onSave(form)
    setBusy(false)
    onClose()
  }

  // Discussion and links hang off a saved row, so they only exist once there
  // is an id to attach them to.
  const saved = Boolean(form.id)
  const TABS: { id: Tab; label: string }[] = saved
    ? [{ id: 'details', label: 'Details' }, { id: 'discussion', label: 'Discussion' }, { id: 'links', label: 'Links' }]
    : [{ id: 'details', label: 'Details' }]

  return (
    <Modal
      title={saved ? 'Edit task' : 'New task'}
      onClose={onClose}
      footer={
        <>
          {saved && onDelete && (
            confirmDelete ? (
              <div className="mr-auto flex items-center gap-2">
                <span className="text-xs text-slate-500">Delete this task?</span>
                <Button size="sm" variant="danger" onClick={() => { onDelete(form.id!); onClose() }}>Yes, delete</Button>
                <Button size="sm" variant="ghost" onClick={() => setConfirmDelete(false)}>Cancel</Button>
              </div>
            ) : (
              <Button variant="ghost" className="mr-auto text-rose-600 hover:bg-rose-50 dark:hover:bg-rose-950/50"
                onClick={() => setConfirmDelete(true)}>
                Delete
              </Button>
            )
          )}
          <Button variant="ghost" onClick={onClose}>Close</Button>
          <Button onClick={save} disabled={busy || !form.title.trim()}>
            {saved ? 'Save changes' : 'Add task'}
          </Button>
        </>
      }
    >
      {TABS.length > 1 && (
        <div className="flex gap-0.5 rounded-lg bg-slate-100 p-0.5 dark:bg-slate-800" role="tablist">
          {TABS.map(t => (
            <button
              key={t.id}
              role="tab"
              aria-selected={tab === t.id}
              onClick={() => setTab(t.id)}
              className={cx(
                'flex-1 rounded-md px-3 py-1.5 text-xs font-medium transition',
                tab === t.id
                  ? 'bg-white shadow-sm dark:bg-slate-700'
                  : 'text-slate-500 hover:text-slate-800 dark:hover:text-slate-200',
              )}
            >
              {t.label}
            </button>
          ))}
        </div>
      )}

      {tab === 'details' && (
        <>
          <Field label="Title">
            <Input autoFocus value={form.title} onChange={e => set('title', e.target.value)}
              placeholder="What needs doing?"
              onKeyDown={e => { if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) void save() }} />
          </Field>

          <Field label="Notes">
            <Textarea rows={3} value={form.description} onChange={e => set('description', e.target.value)}
              placeholder="Context, links, next steps…" />
          </Field>

          <div className="grid grid-cols-2 gap-3">
            <Field label="Column">
              <Select value={form.status} onChange={e => set('status', e.target.value as TaskStatus)}>
                {COLUMNS.map(c => <option key={c.id} value={c.id}>{c.label}</option>)}
              </Select>
            </Field>
            <Field label="Priority">
              <Select value={form.priority} onChange={e => set('priority', e.target.value as TaskPriority)}>
                {PRIORITIES.map(p => <option key={p.id} value={p.id}>{p.label}</option>)}
              </Select>
            </Field>
          </div>

          <div className="grid grid-cols-2 gap-3">
            <Field label="Due date" hint="Drives the daily digest.">
              <Input type="date" value={form.due_date} onChange={e => set('due_date', e.target.value)} />
            </Field>
            <Field label="Assignee" hint="Their digest, not yours.">
              <Select value={form.assignee_id} onChange={e => set('assignee_id', e.target.value)}>
                <option value="">Unassigned</option>
                {people.map(p => (
                  <option key={p.id} value={p.id}>{p.full_name?.trim() || p.email}</option>
                ))}
              </Select>
            </Field>
          </div>

          {form.status === 'blocked' && (
            <Field label="What is blocking it?" hint="Included in the blocker alert email.">
              <Input value={form.blocked_reason} onChange={e => set('blocked_reason', e.target.value)}
                placeholder="Waiting on vendor quote…" />
            </Field>
          )}
        </>
      )}

      {tab === 'discussion' && form.id && <CommentThread taskId={form.id} people={people} />}

      {tab === 'links' && form.id && <AttachmentList taskId={form.id} canEdit />}
    </Modal>
  )
}
