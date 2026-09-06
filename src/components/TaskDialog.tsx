import { useState } from 'react'
import type { Task, TaskPriority, TaskStatus } from '../lib/types'
import { COLUMNS, PRIORITIES } from '../lib/types'
import { Button, Field, Input, Modal, Select, Textarea } from './ui'

export interface TaskDraft {
  id?: string
  title: string
  description: string
  status: TaskStatus
  priority: TaskPriority
  due_date: string
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
    blocked_reason: task.blocked_reason ?? '',
  }
}

export function emptyDraft(status: TaskStatus = 'todo'): TaskDraft {
  return { title: '', description: '', status, priority: 'medium', due_date: '', blocked_reason: '' }
}

export default function TaskDialog({ draft, onSave, onDelete, onClose }: {
  draft: TaskDraft
  onSave: (d: TaskDraft) => Promise<void> | void
  onDelete?: (id: string) => void
  onClose: () => void
}) {
  const [form, setForm] = useState(draft)
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

  return (
    <Modal
      title={form.id ? 'Edit task' : 'New task'}
      onClose={onClose}
      footer={
        <>
          {form.id && onDelete && (
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
          <Button variant="ghost" onClick={onClose}>Cancel</Button>
          <Button onClick={save} disabled={busy || !form.title.trim()}>
            {form.id ? 'Save changes' : 'Add task'}
          </Button>
        </>
      }
    >
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

      <Field label="Due date" hint="Drives the daily digest and overdue alerts.">
        <Input type="date" value={form.due_date} onChange={e => set('due_date', e.target.value)} />
      </Field>

      {form.status === 'blocked' && (
        <Field label="What is blocking it?" hint="Included in the blocker alert email.">
          <Input value={form.blocked_reason} onChange={e => set('blocked_reason', e.target.value)}
            placeholder="Waiting on vendor quote…" />
        </Field>
      )}
    </Modal>
  )
}
