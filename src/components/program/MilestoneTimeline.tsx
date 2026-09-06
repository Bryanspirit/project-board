import { useState } from 'react'
import { Button, Spinner, cx } from '../ui'
import { Countdown } from './Countdown'
import { MilestoneDialog } from './MilestoneDialog'
import { useMilestones } from '../../hooks/useMilestones'
import { MILESTONE_KINDS } from '../../lib/types'
import type { Milestone } from '../../lib/types'

const KIND = new Map(MILESTONE_KINDS.map(k => [k.id, k]))
const FALLBACK_KIND = MILESTONE_KINDS[MILESTONE_KINDS.length - 1]

type NodeState = 'past' | 'current' | 'upcoming'

export interface MilestoneTimelineProps {
  workspaceId: string
  /** Workspace owners and admins get the add / edit affordances. */
  canManage: boolean
  className?: string
}

export function MilestoneTimeline({ workspaceId, canManage, className }: MilestoneTimelineProps) {
  const {
    milestones, loading, error, nextMilestone, currentPhase,
    createMilestone, updateMilestone, deleteMilestone,
  } = useMilestones(workspaceId)

  // `undefined` = closed, `null` = create, a row = edit.
  const [editing, setEditing] = useState<Milestone | null | undefined>(undefined)

  return (
    <section className={cx('rounded-2xl bg-white ring-1 ring-slate-200 dark:bg-slate-900 dark:ring-slate-800', className)}>
      <header className="flex flex-wrap items-center gap-3 border-b border-slate-200 px-4 py-3 dark:border-slate-800">
        <h2 className="text-sm font-semibold text-slate-900 dark:text-slate-100">Programme timeline</h2>
        {currentPhase && (
          <span className="rounded-full bg-indigo-50 px-2 py-0.5 text-xs font-medium text-indigo-700 ring-1 ring-indigo-200 dark:bg-indigo-950 dark:text-indigo-300 dark:ring-indigo-900">
            Now: {currentPhase.name}
          </span>
        )}
        <div className="ml-auto flex items-center gap-2">
          {nextMilestone && (
            <Countdown compact target={nextMilestone.due_at} label={nextMilestone.name} />
          )}
          {canManage && (
            <Button size="sm" variant="outline" onClick={() => setEditing(null)}>
              <span aria-hidden>+</span> Milestone
            </Button>
          )}
        </div>
      </header>

      {error && (
        <p role="alert" className="border-b border-rose-200 bg-rose-50 px-4 py-2 text-xs text-rose-700 dark:border-rose-900 dark:bg-rose-950/50 dark:text-rose-300">
          {error}
        </p>
      )}

      {loading ? (
        <div className="flex items-center gap-2 px-4 py-8 text-sm text-slate-500 dark:text-slate-400">
          <Spinner className="h-4 w-4" /> Loading milestones…
        </div>
      ) : milestones.length === 0 ? (
        <div className="px-4 py-8 text-center">
          <p className="text-sm text-slate-500 dark:text-slate-400">No milestones yet.</p>
          {canManage && (
            <Button size="sm" className="mt-3" onClick={() => setEditing(null)}>Add the first one</Button>
          )}
        </div>
      ) : (
        // The rail scrolls inside itself — the page body never moves sideways.
        <div className="overflow-x-auto overscroll-x-contain px-4 py-5">
          <ol className="flex min-w-0 flex-col gap-4 sm:min-w-max sm:flex-row sm:items-stretch sm:gap-0">
            {milestones.map((m, i) => (
              <TimelineNode
                key={m.id}
                milestone={m}
                state={nodeState(m, currentPhase)}
                isNext={nextMilestone?.id === m.id}
                first={i === 0}
                last={i === milestones.length - 1}
                canManage={canManage}
                onEdit={() => setEditing(m)}
              />
            ))}
          </ol>
        </div>
      )}

      {editing !== undefined && (
        <MilestoneDialog
          milestone={editing}
          onClose={() => setEditing(undefined)}
          onSave={patch => (editing ? updateMilestone(editing.id, patch) : createMilestone(patch))}
          onDelete={editing ? deleteMilestone : undefined}
        />
      )}
    </section>
  )
}

function nodeState(m: Milestone, currentPhase: Milestone | null): NodeState {
  if (currentPhase && m.id === currentPhase.id) return 'current'
  return new Date(m.due_at).getTime() <= Date.now() ? 'past' : 'upcoming'
}

function TimelineNode({ milestone, state, isNext, first, last, canManage, onEdit }: {
  milestone: Milestone
  state: NodeState
  isNext: boolean
  first: boolean
  last: boolean
  canManage: boolean
  onEdit: () => void
}) {
  const kind = KIND.get(milestone.kind) ?? FALLBACK_KIND

  const dot =
    state === 'current' ? 'bg-indigo-600 text-white ring-4 ring-indigo-200 dark:ring-indigo-900'
    : state === 'past' ? 'bg-slate-200 text-slate-500 ring-1 ring-slate-300 dark:bg-slate-800 dark:text-slate-400 dark:ring-slate-700'
    : 'bg-white text-slate-700 ring-1 ring-slate-300 dark:bg-slate-900 dark:text-slate-200 dark:ring-slate-700'

  const done = state === 'past' || state === 'current'
  const rail = done ? 'bg-indigo-400 dark:bg-indigo-700' : 'bg-slate-200 dark:bg-slate-800'

  return (
    <li className={cx(
      'relative flex gap-3 sm:w-56 sm:shrink-0 sm:flex-col sm:gap-2 sm:px-3',
      state === 'past' && 'opacity-70',
    )}>
      {/* Rail: a vertical spine on narrow screens, a horizontal one from sm up. */}
      <div className="relative flex w-9 shrink-0 justify-center sm:w-full sm:justify-start" aria-hidden>
        <span className={cx('absolute bottom-0 left-1/2 top-9 w-px -translate-x-1/2 sm:hidden', last ? 'hidden' : rail)} />
        <span className={cx('absolute left-0 top-4 hidden h-px w-1/2 -translate-y-1/2 sm:block', first ? 'invisible' : rail)} />
        <span className={cx('absolute right-0 top-4 hidden h-px w-1/2 -translate-y-1/2 sm:block', last ? 'invisible' : rail)} />
        <span className={cx('relative z-10 flex h-8 w-8 items-center justify-center rounded-full text-sm', dot)}>
          {state === 'past' ? (
            <svg viewBox="0 0 20 20" className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth="2.5">
              <path d="M4 10.5l4 4 8-8" strokeLinecap="round" strokeLinejoin="round" />
            </svg>
          ) : (
            <span>{kind.emoji}</span>
          )}
        </span>
      </div>

      <div className="min-w-0 flex-1 pb-1 sm:pt-1">
        <div className="flex items-start gap-1.5">
          <h3
            title={milestone.name}
            className={cx(
              'min-w-0 flex-1 truncate text-sm font-semibold',
              state === 'current' ? 'text-indigo-700 dark:text-indigo-300' : 'text-slate-900 dark:text-slate-100',
            )}
          >
            {milestone.name}
          </h3>
          {canManage && (
            <button
              onClick={onEdit}
              aria-label={'Edit ' + milestone.name}
              className="shrink-0 rounded-md p-1 text-slate-400 transition hover:bg-slate-100 hover:text-slate-700 dark:hover:bg-slate-800 dark:hover:text-slate-200"
            >
              <svg viewBox="0 0 20 20" className="h-3.5 w-3.5" fill="none" stroke="currentColor" strokeWidth="1.8">
                <path d="M13.5 3.5l3 3L7 16H4v-3l9.5-9.5z" strokeLinecap="round" strokeLinejoin="round" />
              </svg>
            </button>
          )}
        </div>

        <p className="mt-0.5 text-xs text-slate-500 dark:text-slate-400">
          <span className="uppercase tracking-wide opacity-70">{kind.label}</span>
          <span className="mx-1.5 opacity-40">·</span>
          <time dateTime={milestone.due_at}>{formatWhen(milestone.due_at)}</time>
        </p>

        {milestone.description && (
          <p className="mt-1 line-clamp-2 text-xs text-slate-500 dark:text-slate-400">{milestone.description}</p>
        )}

        {isNext && (
          <div className="mt-2">
            <Countdown target={milestone.due_at} label="Time left" />
          </div>
        )}
      </div>
    </li>
  )
}

/** Milestones are instants, so they render in the viewer's own timezone. */
function formatWhen(iso: string): string {
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return '—'
  const sameYear = d.getFullYear() === new Date().getFullYear()
  return d.toLocaleString(undefined, {
    month: 'short', day: 'numeric', year: sameYear ? undefined : 'numeric',
    hour: 'numeric', minute: '2-digit',
  })
}
