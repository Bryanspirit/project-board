import { useState } from 'react'
import type { Project, ProjectStatus } from '../lib/types'
import { PROJECT_COLORS } from '../lib/types'
import { Button, Field, Input, Modal, Select, Textarea, cx } from './ui'

export interface ProjectDraft {
  id?: string
  name: string
  description: string
  color: string
  status: ProjectStatus
  due_date: string
}

export function projectDraft(p?: Project): ProjectDraft {
  return {
    id: p?.id,
    name: p?.name ?? '',
    description: p?.description ?? '',
    color: p?.color ?? PROJECT_COLORS[0],
    status: p?.status ?? 'active',
    due_date: p?.due_date ?? '',
  }
}

const STATUSES: { id: ProjectStatus; label: string }[] = [
  { id: 'active', label: 'Active' },
  { id: 'on_hold', label: 'On hold' },
  { id: 'completed', label: 'Completed' },
  { id: 'archived', label: 'Archived' },
]

export default function ProjectDialog({ draft, onSave, onDelete, onClose }: {
  draft: ProjectDraft
  onSave: (d: ProjectDraft) => Promise<void> | void
  onDelete?: (id: string) => void
  onClose: () => void
}) {
  const [form, setForm] = useState(draft)
  const [confirmDelete, setConfirmDelete] = useState(false)
  const set = <K extends keyof ProjectDraft>(k: K, v: ProjectDraft[K]) => setForm(f => ({ ...f, [k]: v }))

  return (
    <Modal
      title={form.id ? 'Edit project' : 'New project'}
      onClose={onClose}
      footer={
        <>
          {form.id && onDelete && (
            confirmDelete ? (
              <div className="mr-auto flex items-center gap-2">
                <span className="text-xs text-slate-500">Delete project and all its tasks?</span>
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
          <Button disabled={!form.name.trim()} onClick={async () => { await onSave(form); onClose() }}>
            {form.id ? 'Save changes' : 'Create project'}
          </Button>
        </>
      }
    >
      <Field label="Project name">
        <Input autoFocus value={form.name} onChange={e => set('name', e.target.value)}
          placeholder="Q3 Portfolio Refresh" />
      </Field>

      <Field label="Description">
        <Textarea rows={2} value={form.description} onChange={e => set('description', e.target.value)}
          placeholder="What is this project for?" />
      </Field>

      <div className="grid grid-cols-2 gap-3">
        <Field label="Status">
          <Select value={form.status} onChange={e => set('status', e.target.value as ProjectStatus)}>
            {STATUSES.map(s => <option key={s.id} value={s.id}>{s.label}</option>)}
          </Select>
        </Field>
        <Field label="Target date">
          <Input type="date" value={form.due_date} onChange={e => set('due_date', e.target.value)} />
        </Field>
      </div>

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
    </Modal>
  )
}
