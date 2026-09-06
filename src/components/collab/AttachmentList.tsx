import { useEffect, useState } from 'react'
import type { Attachment, AttachmentKind } from '../../lib/types'
import { ATTACHMENT_KINDS } from '../../lib/types'
import { useCollab } from '../../hooks/useCollab'
import { Button, Field, Input, Select, Spinner } from '../ui'

const KIND_EMOJI = new Map(ATTACHMENT_KINDS.map(k => [k.id, k.emoji]))

/** Only real web links are stored. A `javascript:` or `data:` URL in an anchor
 *  is an attack surface, and a bare "docs.google.com" would resolve relative to
 *  the app when clicked. */
function validateUrl(raw: string): { url: string } | { message: string } {
  const value = raw.trim()
  if (!value) return { message: 'Paste the link to the document.' }
  let parsed: URL
  try {
    parsed = new URL(value)
  } catch {
    return { message: 'That is not a valid link. Include the https:// prefix.' }
  }
  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
    return { message: 'Links must start with http:// or https://' }
  }
  return { url: parsed.toString() }
}

/** The hostname, or the whole string when it somehow got past validation. */
function hostOf(url: string): string {
  try {
    return new URL(url).hostname.replace(/^www\./, '')
  } catch {
    return url
  }
}

export interface AttachmentListProps {
  taskId?: string
  projectId?: string
  canEdit: boolean
}

export function AttachmentList({ taskId, projectId, canEdit }: AttachmentListProps) {
  const { loadAttachments, addAttachment, deleteAttachment } = useCollab()
  const [rows, setRows] = useState<Attachment[]>([])
  const [ready, setReady] = useState(false)
  const [label, setLabel] = useState('')
  const [url, setUrl] = useState('')
  const [kind, setKind] = useState<AttachmentKind>('doc')
  const [problem, setProblem] = useState<string | null>(null)
  const [saving, setSaving] = useState(false)
  const [confirmId, setConfirmId] = useState<string | null>(null)

  useEffect(() => {
    let alive = true
    setReady(false)
    void loadAttachments({ taskId, projectId }).then(list => {
      if (!alive) return
      setRows(list)
      setReady(true)
    })
    return () => { alive = false }
  }, [taskId, projectId, loadAttachments])

  const add = async () => {
    if (saving) return
    const name = label.trim()
    if (!name) { setProblem('Give the link a short name.'); return }
    const checked = validateUrl(url)
    if ('message' in checked) { setProblem(checked.message); return }
    setProblem(null)
    setSaving(true)
    const row = await addAttachment({
      task_id: taskId ?? null,
      project_id: taskId ? null : (projectId ?? null),
      label: name,
      url: checked.url,
      kind,
    })
    setSaving(false)
    if (!row) { setProblem('That link could not be saved. Try again.'); return }
    setRows(prev => [...prev, row])
    setLabel('')
    setUrl('')
    setKind('doc')
  }

  const remove = async (id: string) => {
    setConfirmId(null)
    const ok = await deleteAttachment(id)
    if (ok) setRows(prev => prev.filter(r => r.id !== id))
  }

  return (
    <section className="space-y-3" aria-label="Links">
      <h3 className="text-xs font-semibold uppercase tracking-wide text-slate-500 dark:text-slate-400">
        Links{rows.length > 0 && <span className="ml-1 font-normal text-slate-400">{rows.length}</span>}
      </h3>

      {!ready ? (
        <div className="flex items-center gap-2 py-3 text-sm text-slate-500">
          <Spinner className="h-4 w-4" /> Loading links…
        </div>
      ) : rows.length === 0 ? (
        <p className="rounded-lg border border-dashed border-slate-300 px-3 py-3 text-center text-sm text-slate-500 dark:border-slate-700 dark:text-slate-400">
          No links yet. Attach the design, the repo, or the spec.
        </p>
      ) : (
        <ul className="space-y-1.5">
          {rows.map(row => (
            <li
              key={row.id}
              className="flex items-center gap-2 rounded-lg bg-slate-50 px-2.5 py-2 ring-1 ring-slate-200 dark:bg-slate-800/60 dark:ring-slate-700"
            >
              <span aria-hidden="true" className="text-base leading-none">
                {KIND_EMOJI.get(row.kind) ?? '🔗'}
              </span>
              <a
                href={row.url}
                target="_blank"
                rel="noreferrer noopener"
                className="min-w-0 flex-1 truncate text-sm font-medium text-slate-800 hover:text-indigo-600 hover:underline dark:text-slate-100 dark:hover:text-indigo-400"
              >
                {row.label}
              </a>
              <span className="hidden shrink-0 truncate text-xs text-slate-400 sm:block">{hostOf(row.url)}</span>
              {canEdit && (
                confirmId === row.id ? (
                  <span className="flex shrink-0 items-center gap-1.5 text-xs text-slate-500">
                    Remove?
                    <button
                      type="button"
                      onClick={() => void remove(row.id)}
                      className="font-medium text-rose-600 hover:underline dark:text-rose-400"
                    >
                      Yes
                    </button>
                    <button type="button" onClick={() => setConfirmId(null)} className="hover:underline">No</button>
                  </span>
                ) : (
                  <button
                    type="button"
                    aria-label={`Remove ${row.label}`}
                    onClick={() => setConfirmId(row.id)}
                    className="shrink-0 rounded p-1 text-slate-400 transition hover:text-rose-600 dark:hover:text-rose-400"
                  >
                    <svg viewBox="0 0 20 20" className="h-3.5 w-3.5" fill="none" stroke="currentColor" strokeWidth="2">
                      <path d="M5 5l10 10M15 5L5 15" strokeLinecap="round" />
                    </svg>
                  </button>
                )
              )}
            </li>
          ))}
        </ul>
      )}

      {canEdit && (
        <div className="space-y-2 rounded-lg border border-slate-200 p-3 dark:border-slate-800">
          <div className="grid gap-2 sm:grid-cols-[1fr_1fr_auto]">
            <Field label="Name">
              <Input
                value={label}
                onChange={e => setLabel(e.target.value)}
                placeholder="Design file"
              />
            </Field>
            <Field label="Link">
              <Input
                type="url"
                inputMode="url"
                value={url}
                onChange={e => { setUrl(e.target.value); setProblem(null) }}
                onKeyDown={e => { if (e.key === 'Enter') { e.preventDefault(); void add() } }}
                placeholder="https://…"
                aria-invalid={problem !== null}
              />
            </Field>
            <Field label="Kind">
              <Select value={kind} onChange={e => setKind(e.target.value as AttachmentKind)}>
                {ATTACHMENT_KINDS.map(k => (
                  <option key={k.id} value={k.id}>{k.emoji} {k.label}</option>
                ))}
              </Select>
            </Field>
          </div>
          {problem && <p role="alert" className="text-xs text-rose-600 dark:text-rose-400">{problem}</p>}
          <Button size="sm" variant="outline" onClick={() => void add()} disabled={saving}>
            {saving && <Spinner className="h-3.5 w-3.5" />}
            Add link
          </Button>
        </div>
      )}
    </section>
  )
}

export default AttachmentList
