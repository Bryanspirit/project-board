import { useEffect, useMemo, useRef, useState } from 'react'
import type { JudgingCriterion, ProjectHealth, Score } from '../../lib/types'
import { Input, Textarea, cx } from '../ui'

type SaveState = 'idle' | 'saving' | 'saved' | 'error'

interface Draft {
  /** null means "not scored yet" — distinct from a deliberate 0. */
  score: number | null
  notes: string
}

const DEBOUNCE_MS = 600

/** Clamp a typed number into the criterion's range, or null when unusable. */
function clamp(raw: string, max: number): number | null {
  if (raw.trim() === '') return null
  const n = Number(raw)
  if (!Number.isFinite(n)) return null
  return Math.min(max, Math.max(0, Math.round(n)))
}

export default function ScoreCard({ project, criteria, savedScore, onSave }: {
  project: ProjectHealth
  criteria: JudgingCriterion[]
  savedScore: (projectId: string, criterionId: string) => Score | undefined
  onSave: (projectId: string, criterionId: string, score: number, notes: string | null) => Promise<unknown>
}) {
  // Seeded once. Later refreshes must never overwrite what the judge is typing.
  const [draft, setDraft] = useState<Record<string, Draft>>(() => {
    const initial: Record<string, Draft> = {}
    for (const c of criteria) {
      const row = savedScore(project.id, c.id)
      initial[c.id] = {
        score: row ? Number(row.score) : null,
        notes: row?.notes ?? '',
      }
    }
    return initial
  })
  const [state, setState] = useState<Record<string, SaveState>>({})
  const [errors, setErrors] = useState<Record<string, string>>({})

  const timers = useRef<Record<string, ReturnType<typeof setTimeout>>>({})
  const flashes = useRef<Record<string, ReturnType<typeof setTimeout>>>({})
  const pending = useRef<Record<string, { score: number; notes: string | null }>>({})
  const saveRef = useRef(onSave)
  useEffect(() => { saveRef.current = onSave }, [onSave])

  // A judge who closes the panel mid-edit still gets their last keystroke
  // written, rather than silently losing the debounce window.
  useEffect(() => {
    const running = timers.current
    const flashing = flashes.current
    const queued = pending.current
    const projectId = project.id
    return () => {
      for (const t of Object.values(flashing)) clearTimeout(t)
      for (const [criterionId, t] of Object.entries(running)) {
        clearTimeout(t)
        const p = queued[criterionId]
        if (p) void saveRef.current(projectId, criterionId, p.score, p.notes).catch(() => {})
      }
    }
  }, [project.id])

  function flush(criterionId: string, next: Draft) {
    if (next.score === null) return // score is NOT NULL in the database
    pending.current[criterionId] = { score: next.score, notes: next.notes.trim() ? next.notes : null }
    clearTimeout(timers.current[criterionId])
    timers.current[criterionId] = setTimeout(async () => {
      const payload = pending.current[criterionId]
      if (!payload) return
      setState(s => ({ ...s, [criterionId]: 'saving' }))
      try {
        await saveRef.current(project.id, criterionId, payload.score, payload.notes)
        delete pending.current[criterionId]
        delete timers.current[criterionId]
        setErrors(e => {
          if (!(criterionId in e)) return e
          const next2 = { ...e }; delete next2[criterionId]; return next2
        })
        setState(s => ({ ...s, [criterionId]: 'saved' }))
        clearTimeout(flashes.current[criterionId])
        flashes.current[criterionId] = setTimeout(
          () => setState(s => ({ ...s, [criterionId]: 'idle' })), 2000,
        )
      } catch (err) {
        // Keep both the pending payload and the judge's input: the next edit
        // retries, and nothing they typed is thrown away.
        setState(s => ({ ...s, [criterionId]: 'error' }))
        setErrors(e => ({ ...e, [criterionId]: err instanceof Error ? err.message : 'Could not save' }))
      }
    }, DEBOUNCE_MS)
  }

  // The ref mirrors `draft` synchronously so a burst of keystrokes never
  // computes its next value from a stale render, and so the debounce is
  // scheduled outside the state updater (which React may run twice).
  const draftRef = useRef(draft)

  function set(criterionId: string, patch: Partial<Draft>) {
    const current = draftRef.current[criterionId] ?? { score: null, notes: '' }
    const next: Draft = { ...current, ...patch }
    draftRef.current = { ...draftRef.current, [criterionId]: next }
    setDraft(draftRef.current)
    flush(criterionId, next)
  }

  const { total, scored } = useMemo(() => {
    let sum = 0
    let weight = 0
    let count = 0
    for (const c of criteria) {
      const value = draft[c.id]?.score
      if (value === null || value === undefined) continue
      const w = Number(c.weight)
      const max = Number(c.max_score) || 1
      if (!Number.isFinite(w) || w <= 0) continue
      sum += (value / max) * w
      weight += w
      count += 1
    }
    return { total: weight > 0 ? (sum / weight) * 100 : null, scored: count }
  }, [criteria, draft])

  const links = [
    { label: 'Repo', href: project.repo_url },
    { label: 'Demo', href: project.demo_url },
    { label: 'Video', href: project.video_url },
  ].filter((l): l is { label: string; href: string } => Boolean(l.href))

  return (
    <section className="rounded-2xl bg-white ring-1 ring-slate-200 dark:bg-slate-900 dark:ring-slate-800">
      <header className="flex flex-wrap items-start justify-between gap-3 border-b border-slate-200 px-5 py-4 dark:border-slate-800">
        <div className="min-w-0">
          <div className="flex items-center gap-2">
            <span className="h-2.5 w-2.5 shrink-0 rounded-full" style={{ background: project.color }} />
            <h3 className="truncate text-sm font-semibold text-slate-900 dark:text-slate-100">{project.name}</h3>
          </div>
          <p className="mt-1 text-xs text-slate-500 dark:text-slate-400">
            {project.team_name ?? 'No team'}
            {project.submitted_at && ' · submitted'}
          </p>
          {links.length > 0 && (
            <div className="mt-2 flex flex-wrap gap-1.5">
              {links.map(l => (
                <a key={l.label} href={l.href} target="_blank" rel="noreferrer noopener"
                  className="rounded-md px-2 py-1 text-xs font-medium text-indigo-600 ring-1 ring-indigo-200 transition hover:bg-indigo-50 dark:text-indigo-300 dark:ring-indigo-900 dark:hover:bg-indigo-950/50">
                  {l.label}
                </a>
              ))}
            </div>
          )}
        </div>

        <div className="text-right">
          <div className="text-2xl font-semibold tabular-nums text-slate-900 dark:text-slate-100">
            {total === null ? '—' : total.toFixed(1)}
          </div>
          <div className="text-[11px] uppercase tracking-wide text-slate-400">
            your weighted score
          </div>
          <div className="mt-1 text-[11px] text-slate-500 dark:text-slate-400">
            {scored} of {criteria.length} scored
          </div>
        </div>
      </header>

      <div className="divide-y divide-slate-100 dark:divide-slate-800">
        {criteria.map(c => {
          const max = Number(c.max_score) || 10
          const value = draft[c.id]?.score ?? null
          const notes = draft[c.id]?.notes ?? ''
          const status = state[c.id] ?? 'idle'
          const sliderId = `score-${project.id}-${c.id}`
          return (
            <div key={c.id} className="px-5 py-4">
              <div className="flex flex-wrap items-baseline justify-between gap-2">
                <div className="min-w-0">
                  <span className="text-sm font-medium text-slate-800 dark:text-slate-200">{c.name}</span>
                  <span className="ml-2 text-[11px] text-slate-400">weight {Number(c.weight)}</span>
                </div>
                <SaveBadge status={status} />
              </div>
              {c.description && (
                <p className="mt-0.5 text-xs text-slate-500 dark:text-slate-400">{c.description}</p>
              )}

              <div className="mt-3 flex items-center gap-3">
                <input
                  id={sliderId}
                  type="range"
                  min={0}
                  max={max}
                  step={1}
                  value={value ?? 0}
                  aria-label={`${c.name} score for ${project.name}`}
                  aria-valuetext={value === null ? `Not scored, 0 to ${max}` : `${value} out of ${max}`}
                  onChange={e => set(c.id, { score: clamp(e.target.value, max) ?? 0 })}
                  className={cx(
                    'h-2 w-full flex-1 cursor-pointer appearance-none rounded-full bg-slate-200 accent-indigo-600',
                    'focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-indigo-600',
                    'dark:bg-slate-800',
                    value === null && 'opacity-60',
                  )}
                />
                <Input
                  type="number"
                  inputMode="numeric"
                  min={0}
                  max={max}
                  step={1}
                  value={value === null ? '' : String(value)}
                  aria-label={`${c.name} score out of ${max} for ${project.name}`}
                  placeholder="—"
                  onChange={e => {
                    const raw = e.target.value
                    const next = clamp(raw, max)
                    // Reject NaN outright; an emptied box just goes back to unscored.
                    if (next === null && raw.trim() !== '') return
                    set(c.id, { score: next })
                  }}
                  className="w-20 shrink-0 text-center tabular-nums"
                />
                <span className="shrink-0 text-xs text-slate-400">/ {max}</span>
              </div>

              <Textarea
                rows={1}
                value={notes}
                placeholder="Notes (optional)"
                aria-label={`Notes on ${c.name} for ${project.name}`}
                onChange={e => set(c.id, { notes: e.target.value })}
                className="mt-2 text-xs"
              />

              {value === null && notes.trim() !== '' && (
                <p className="mt-1 text-xs text-amber-600 dark:text-amber-400">
                  Set a score before these notes can be saved.
                </p>
              )}
              {errors[c.id] && (
                <p className="mt-1 text-xs text-rose-600 dark:text-rose-400">
                  {errors[c.id]} — your input is kept; edit again to retry.
                </p>
              )}
            </div>
          )
        })}
      </div>
    </section>
  )
}

function SaveBadge({ status }: { status: SaveState }) {
  if (status === 'idle') return null
  const map: Record<Exclude<SaveState, 'idle'>, { text: string; className: string }> = {
    saving: { text: 'Saving…', className: 'text-slate-400' },
    saved: { text: 'Saved', className: 'text-emerald-600 dark:text-emerald-400' },
    error: { text: 'Not saved', className: 'text-rose-600 dark:text-rose-400' },
  }
  const it = map[status]
  return <span className={cx('text-[11px] font-medium', it.className)} role="status">{it.text}</span>
}
