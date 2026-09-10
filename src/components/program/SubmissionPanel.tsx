import { useState } from 'react'
import { Button, Field, Input, Spinner, cx } from '../ui'
import type { SubmissionPatch } from '../../hooks/useMilestones'
import type { Project } from '../../lib/types'

type LinkKey = 'repo_url' | 'demo_url' | 'video_url' | 'doc_url'

const LINKS: { key: LinkKey; label: string; emoji: string; placeholder: string; hint: string }[] = [
  { key: 'repo_url',  label: 'Repository', emoji: '', placeholder: 'https://github.com/team/project', hint: 'Where the judges read your code.' },
  { key: 'demo_url',  label: 'Live demo',  emoji: '', placeholder: 'https://project.vercel.app',      hint: 'A deployed build they can click through.' },
  { key: 'video_url', label: 'Video',      emoji: '', placeholder: 'https://youtu.be/…',              hint: 'Three minutes or less works best.' },
  { key: 'doc_url',   label: 'Docs',       emoji: '', placeholder: 'https://docs.google.com/…',       hint: 'Write-up, deck or README.' },
]

/** Blank passes; anything else must parse as an absolute http(s) URL. */
function urlProblem(value: string): string | null {
  const v = value.trim()
  if (!v) return null
  let parsed: URL
  try {
    parsed = new URL(v)
  } catch {
    return 'Enter a full URL, starting with https://'
  }
  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
    return 'Only http:// and https:// links are allowed.'
  }
  if (!parsed.hostname.includes('.')) return 'That does not look like a real address.'
  return null
}

export interface SubmissionPanelProps {
  project: Project
  canEdit: boolean
  onSave: (patch: SubmissionPatch) => Promise<unknown>
}

export function SubmissionPanel({ project, canEdit, onSave }: SubmissionPanelProps) {
  const [values, setValues] = useState<Record<LinkKey, string>>(() => ({
    repo_url: project.repo_url ?? '',
    demo_url: project.demo_url ?? '',
    video_url: project.video_url ?? '',
    doc_url: project.doc_url ?? '',
  }))
  const [problems, setProblems] = useState<Partial<Record<LinkKey, string>>>({})
  const [submittedAt, setSubmittedAt] = useState<string | null>(project.submitted_at)
  const [busy, setBusy] = useState<'save' | 'submit' | 'unsubmit' | null>(null)
  const [failure, setFailure] = useState<string | null>(null)
  const [saved, setSaved] = useState(false)

  const submitted = Boolean(submittedAt)

  function set(key: LinkKey, value: string) {
    setValues(prev => ({ ...prev, [key]: value }))
    setProblems(prev => (prev[key] ? { ...prev, [key]: undefined } : prev))
    setSaved(false)
  }

  /** Validate every field up front; nothing reaches the database until they all
   *  pass, so a bad link can never be half-saved. */
  function validated(): SubmissionPatch | null {
    const found: Partial<Record<LinkKey, string>> = {}
    for (const link of LINKS) {
      const problem = urlProblem(values[link.key])
      if (problem) found[link.key] = problem
    }
    setProblems(found)
    if (Object.keys(found).length > 0) return null
    return {
      repo_url: values.repo_url.trim() || null,
      demo_url: values.demo_url.trim() || null,
      video_url: values.video_url.trim() || null,
      doc_url: values.doc_url.trim() || null,
    }
  }

  async function run(mode: 'save' | 'submit' | 'unsubmit') {
    setFailure(null)
    setSaved(false)

    let patch: SubmissionPatch
    if (mode === 'unsubmit') {
      patch = { submitted_at: null }
    } else {
      const links = validated()
      if (!links) {
        setFailure('Fix the highlighted links before saving.')
        return
      }
      patch = mode === 'submit' ? { ...links, submitted_at: new Date().toISOString() } : links
    }

    setBusy(mode)
    try {
      await onSave(patch)
      if (mode === 'submit') setSubmittedAt(patch.submitted_at ?? null)
      if (mode === 'unsubmit') setSubmittedAt(null)
      setSaved(true)
    } catch (e) {
      setFailure(e instanceof Error ? e.message : 'Could not save your submission.')
    } finally {
      setBusy(null)
    }
  }

  return (
    <section className="rounded-2xl bg-white ring-1 ring-slate-200 dark:bg-slate-900 dark:ring-slate-800">
      <header className="flex flex-wrap items-center gap-3 border-b border-slate-200 px-4 py-3 dark:border-slate-800">
        <div className="min-w-0">
          <h2 className="text-sm font-semibold text-slate-900 dark:text-slate-100">Submission</h2>
          <p className="truncate text-xs text-slate-500 dark:text-slate-400">{project.name}</p>
        </div>
        <span className={cx(
          'ml-auto inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-xs font-medium ring-1',
          submitted
            ? 'bg-emerald-50 text-emerald-700 ring-emerald-200 dark:bg-emerald-950 dark:text-emerald-300 dark:ring-emerald-900'
            : 'bg-slate-50 text-slate-600 ring-slate-200 dark:bg-slate-800 dark:text-slate-300 dark:ring-slate-700',
        )}>
          <span aria-hidden>{submitted ? '' : '○'}</span>
          {submitted ? 'Submitted' : 'Not submitted'}
        </span>
      </header>

      <div className="space-y-4 px-4 py-4">
        {submitted && submittedAt && (
          <p className="rounded-lg bg-emerald-50 px-3 py-2 text-xs text-emerald-800 ring-1 ring-emerald-200 dark:bg-emerald-950/60 dark:text-emerald-300 dark:ring-emerald-900">
            Submitted <time dateTime={submittedAt}>{formatStamp(submittedAt)}</time>. You can keep editing
            the links until judging opens.
          </p>
        )}

        {LINKS.map(link => (
          <div key={link.key}>
            <Field
              label={`${link.emoji}  ${link.label}`}
              hint={problems[link.key] ? undefined : link.hint}
            >
              <Input
                type="url"
                inputMode="url"
                value={values[link.key]}
                placeholder={link.placeholder}
                disabled={!canEdit}
                aria-invalid={problems[link.key] ? true : undefined}
                onChange={e => set(link.key, e.target.value)}
                className={cx(problems[link.key] && 'ring-rose-400 focus:ring-rose-500 dark:ring-rose-800')}
              />
            </Field>
            {problems[link.key] && (
              <p role="alert" className="mt-1 text-xs text-rose-600 dark:text-rose-400">{problems[link.key]}</p>
            )}
          </div>
        ))}

        {failure && (
          <p role="alert" className="rounded-lg bg-rose-50 px-3 py-2 text-sm text-rose-700 ring-1 ring-rose-200 dark:bg-rose-950/60 dark:text-rose-300 dark:ring-rose-900">
            {failure}
          </p>
        )}
      </div>

      {canEdit ? (
        <footer className="flex flex-wrap items-center gap-2 border-t border-slate-200 px-4 py-3 dark:border-slate-800">
          {saved && !failure && (
            <span className="text-xs text-emerald-600 dark:text-emerald-400">Saved</span>
          )}
          <div className="ml-auto flex items-center gap-2">
            <Button variant="outline" size="sm" disabled={busy !== null} onClick={() => void run('save')}>
              {busy === 'save' && <Spinner className="h-3.5 w-3.5" />}
              Save links
            </Button>
            {submitted ? (
              <Button variant="ghost" size="sm" disabled={busy !== null} onClick={() => void run('unsubmit')}>
                {busy === 'unsubmit' && <Spinner className="h-3.5 w-3.5" />}
                Unsubmit
              </Button>
            ) : (
              <Button size="sm" disabled={busy !== null} onClick={() => void run('submit')}>
                {busy === 'submit' && <Spinner className="h-3.5 w-3.5" />}
                Mark as submitted
              </Button>
            )}
          </div>
        </footer>
      ) : (
        <footer className="border-t border-slate-200 px-4 py-3 text-xs text-slate-500 dark:border-slate-800 dark:text-slate-400">
          Only this project's team can change the submission.
        </footer>
      )}
    </section>
  )
}

function formatStamp(iso: string): string {
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return 'earlier'
  return d.toLocaleString(undefined, {
    month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit',
  })
}
