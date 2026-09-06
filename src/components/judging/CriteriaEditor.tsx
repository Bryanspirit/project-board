import { useEffect, useState } from 'react'
import type { JudgingCriterion } from '../../lib/types'
import { Button, Input, Modal, Textarea, cx } from '../ui'

/** Matches the database check constraints so the UI never proposes a value the
 *  row would be rejected for. */
const MAX_SCORE_LIMIT = 100

function clampMax(raw: string): number {
  const n = Math.round(Number(raw))
  if (!Number.isFinite(n)) return 10
  return Math.min(MAX_SCORE_LIMIT, Math.max(1, n))
}

function clampWeight(raw: string): number {
  const n = Number(raw)
  if (!Number.isFinite(n) || n <= 0) return 1
  return Math.round(n * 100) / 100
}

export default function CriteriaEditor({ criteria, onCreate, onUpdate, onDelete, onClose }: {
  criteria: JudgingCriterion[]
  onCreate: (input: Partial<JudgingCriterion>) => Promise<unknown>
  onUpdate: (id: string, patch: Partial<JudgingCriterion>) => Promise<unknown>
  onDelete: (id: string) => Promise<unknown>
  onClose: () => void
}) {
  const [newName, setNewName] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const totalWeight = criteria.reduce((acc, c) => acc + (Number(c.weight) || 0), 0)

  async function guard(run: () => Promise<unknown>) {
    setBusy(true)
    setError(null)
    try { await run() } catch (err) {
      setError(err instanceof Error ? err.message : 'Something went wrong')
    } finally { setBusy(false) }
  }

  async function add() {
    const name = newName.trim()
    if (!name) return
    await guard(() => onCreate({ name, max_score: 10, weight: 1 }))
    setNewName('')
  }

  /** Up/down rewrites `sort_order` for the whole list, so criteria created
   *  before any ordering existed (all sitting on the same default) still land
   *  in a stable, distinct order. */
  async function move(index: number, direction: -1 | 1) {
    const target = index + direction
    if (target < 0 || target >= criteria.length) return
    const next = [...criteria]
    const [row] = next.splice(index, 1)
    next.splice(target, 0, row)
    await guard(async () => {
      for (let i = 0; i < next.length; i++) {
        const desired = (i + 1) * 1000
        if (next[i].sort_order !== desired) await onUpdate(next[i].id, { sort_order: desired })
      }
    })
  }

  return (
    <Modal
      title="Judging criteria"
      onClose={onClose}
      footer={<Button onClick={onClose}>Done</Button>}
    >
      <p className="text-xs text-slate-500 dark:text-slate-400">
        Every score is normalised against its criterion&rsquo;s maximum, then weighted.
        The share column shows how much each criterion moves the final 0&ndash;100 result.
      </p>

      {error && (
        <p className="rounded-lg bg-rose-50 px-3 py-2 text-xs text-rose-700 ring-1 ring-rose-200 dark:bg-rose-950/50 dark:text-rose-300 dark:ring-rose-900">
          {error}
        </p>
      )}

      {criteria.length === 0 ? (
        <p className="rounded-lg border border-dashed border-slate-300 px-3 py-6 text-center text-xs text-slate-500 dark:border-slate-700 dark:text-slate-400">
          No criteria yet. Add the first one below.
        </p>
      ) : (
        <ul className="space-y-3">
          {criteria.map((c, i) => (
            <CriterionRow
              key={c.id}
              criterion={c}
              share={totalWeight > 0 ? ((Number(c.weight) || 0) / totalWeight) * 100 : 0}
              isFirst={i === 0}
              isLast={i === criteria.length - 1}
              busy={busy}
              onMove={dir => void move(i, dir)}
              onPatch={patch => void guard(() => onUpdate(c.id, patch))}
              onDelete={() => void guard(() => onDelete(c.id))}
            />
          ))}
        </ul>
      )}

      <div className="flex items-end gap-2 border-t border-slate-200 pt-4 dark:border-slate-800">
        <label className="flex-1">
          <span className="mb-1.5 block text-xs font-medium text-slate-600 dark:text-slate-400">
            Add a criterion
          </span>
          <Input
            value={newName}
            placeholder="Technical execution"
            onChange={e => setNewName(e.target.value)}
            onKeyDown={e => { if (e.key === 'Enter') { e.preventDefault(); void add() } }}
          />
        </label>
        <Button disabled={!newName.trim() || busy} onClick={() => void add()}>Add</Button>
      </div>
    </Modal>
  )
}

function CriterionRow({ criterion, share, isFirst, isLast, busy, onMove, onPatch, onDelete }: {
  criterion: JudgingCriterion
  share: number
  isFirst: boolean
  isLast: boolean
  busy: boolean
  onMove: (direction: -1 | 1) => void
  onPatch: (patch: Partial<JudgingCriterion>) => void
  onDelete: () => void
}) {
  const [name, setName] = useState(criterion.name)
  const [description, setDescription] = useState(criterion.description ?? '')
  const [maxScore, setMaxScore] = useState(String(criterion.max_score))
  const [weight, setWeight] = useState(String(criterion.weight))
  const [confirm, setConfirm] = useState(false)

  // Re-seed when the row is replaced by a server round trip (a reorder, say).
  useEffect(() => {
    setName(criterion.name)
    setDescription(criterion.description ?? '')
    setMaxScore(String(criterion.max_score))
    setWeight(String(criterion.weight))
  }, [criterion.id, criterion.name, criterion.description, criterion.max_score, criterion.weight])

  return (
    <li className="rounded-xl bg-slate-50 p-3 ring-1 ring-slate-200 dark:bg-slate-900/60 dark:ring-slate-800">
      <div className="flex items-start gap-2">
        <div className="flex flex-col gap-1 pt-1">
          <IconButton label={`Move ${criterion.name} up`} disabled={isFirst || busy} onClick={() => onMove(-1)} d="M10 15V5M5 10l5-5 5 5" />
          <IconButton label={`Move ${criterion.name} down`} disabled={isLast || busy} onClick={() => onMove(1)} d="M10 5v10M5 10l5 5 5-5" />
        </div>

        <div className="min-w-0 flex-1 space-y-2">
          <Input
            value={name}
            aria-label="Criterion name"
            onChange={e => setName(e.target.value)}
            onBlur={() => {
              const trimmed = name.trim()
              if (!trimmed) { setName(criterion.name); return }
              if (trimmed !== criterion.name) onPatch({ name: trimmed })
            }}
          />
          <Textarea
            rows={2}
            value={description}
            aria-label="Criterion description"
            placeholder="What are judges looking for?"
            onChange={e => setDescription(e.target.value)}
            onBlur={() => {
              const next = description.trim() || null
              if (next !== (criterion.description ?? null)) onPatch({ description: next })
            }}
            className="text-xs"
          />

          <div className="flex flex-wrap items-end gap-3">
            <label className="w-24">
              <span className="mb-1 block text-[11px] font-medium text-slate-500 dark:text-slate-400">Max score</span>
              <Input
                type="number" min={1} max={MAX_SCORE_LIMIT} step={1} value={maxScore}
                aria-label="Maximum score"
                onChange={e => setMaxScore(e.target.value)}
                onBlur={() => {
                  const next = clampMax(maxScore)
                  setMaxScore(String(next))
                  if (next !== criterion.max_score) onPatch({ max_score: next })
                }}
                className="tabular-nums"
              />
            </label>
            <label className="w-24">
              <span className="mb-1 block text-[11px] font-medium text-slate-500 dark:text-slate-400">Weight</span>
              <Input
                type="number" min={0.1} step={0.1} value={weight}
                aria-label="Weight"
                onChange={e => setWeight(e.target.value)}
                onBlur={() => {
                  const next = clampWeight(weight)
                  setWeight(String(next))
                  if (next !== Number(criterion.weight)) onPatch({ weight: next })
                }}
                className="tabular-nums"
              />
            </label>
            <div className="flex-1">
              <span className="mb-1 block text-[11px] font-medium text-slate-500 dark:text-slate-400">
                Share of total
              </span>
              <div className="flex items-center gap-2">
                <div className="h-2 flex-1 overflow-hidden rounded-full bg-slate-200 dark:bg-slate-800">
                  <div className="h-full rounded-full bg-indigo-500" style={{ width: `${Math.min(100, share)}%` }} />
                </div>
                <span className="w-12 text-right text-xs tabular-nums text-slate-600 dark:text-slate-300">
                  {share.toFixed(1)}%
                </span>
              </div>
            </div>
          </div>
        </div>
      </div>

      <div className="mt-2 flex justify-end">
        {confirm ? (
          <div className="flex flex-wrap items-center justify-end gap-2">
            <span className="text-xs text-rose-600 dark:text-rose-400">
              Delete &ldquo;{criterion.name}&rdquo;? Every score judges have already given
              against it is deleted too.
            </span>
            <Button size="sm" variant="danger" disabled={busy} onClick={() => { setConfirm(false); onDelete() }}>
              Yes, delete
            </Button>
            <Button size="sm" variant="ghost" onClick={() => setConfirm(false)}>Cancel</Button>
          </div>
        ) : (
          <Button size="sm" variant="ghost" disabled={busy}
            className="text-rose-600 hover:bg-rose-50 dark:text-rose-400 dark:hover:bg-rose-950/50"
            onClick={() => setConfirm(true)}>
            Delete
          </Button>
        )}
      </div>
    </li>
  )
}

function IconButton({ label, d, disabled, onClick }: {
  label: string
  d: string
  disabled?: boolean
  onClick: () => void
}) {
  return (
    <button
      type="button"
      aria-label={label}
      disabled={disabled}
      onClick={onClick}
      className={cx(
        'rounded-md p-1 text-slate-400 transition',
        'hover:bg-slate-200 hover:text-slate-700 dark:hover:bg-slate-800 dark:hover:text-slate-200',
        'disabled:cursor-not-allowed disabled:opacity-30',
        'focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-indigo-600',
      )}
    >
      <svg viewBox="0 0 20 20" className="h-3.5 w-3.5" fill="none" stroke="currentColor" strokeWidth="2">
        <path d={d} strokeLinecap="round" strokeLinejoin="round" />
      </svg>
    </button>
  )
}
