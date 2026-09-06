import { useSortable } from '@dnd-kit/sortable'
import { CSS } from '@dnd-kit/utilities'
import type { Profile, Task } from '../lib/types'
import { PRIORITIES } from '../lib/types'
import { dueTone, formatDue } from '../lib/dates'
import { cx } from './ui'

const DUE_TONE = {
  overdue: 'bg-rose-50 text-rose-700 ring-rose-200 dark:bg-rose-950/60 dark:text-rose-300 dark:ring-rose-900',
  today:   'bg-amber-50 text-amber-700 ring-amber-200 dark:bg-amber-950/60 dark:text-amber-300 dark:ring-amber-900',
  soon:    'bg-slate-100 text-slate-600 ring-slate-200 dark:bg-slate-800 dark:text-slate-300 dark:ring-slate-700',
  later:   'bg-slate-100 text-slate-500 ring-slate-200 dark:bg-slate-800 dark:text-slate-400 dark:ring-slate-700',
}

/** What to call someone on a card: their name, or the local part of their email
 *  when the profile has not been filled in yet. */
export function personLabel(p: Profile): string {
  const name = p.full_name?.trim()
  if (name) return name
  return p.email.split('@')[0] || p.email
}

/** Resolves `assignee_id` against the roster. Returns null when unassigned, and
 *  also when the roster simply has not loaded — an avatar for "someone" is worse
 *  than no avatar at all. */
export function findAssignee(task: Task, people?: Profile[]): Profile | null {
  if (!task.assignee_id || !people?.length) return null
  return people.find(p => p.id === task.assignee_id) ?? null
}

function Avatar({ person }: { person: Profile }) {
  const name = personLabel(person)
  return (
    <span
      title={name}
      aria-hidden
      className={cx(
        'ml-auto flex h-6 w-6 shrink-0 select-none items-center justify-center rounded-full',
        'bg-indigo-600 text-[10px] font-semibold text-white ring-2 ring-white dark:ring-slate-900',
      )}
    >
      {name.slice(0, 1).toUpperCase()}
    </span>
  )
}

export function TaskBody({ task, dragging, people }: {
  task: Task
  dragging?: boolean
  people?: Profile[]
}) {
  const priority = PRIORITIES.find(p => p.id === task.priority)!
  const tone = task.due_date && task.status !== 'done' ? dueTone(task.due_date) : 'later'
  const assignee = findAssignee(task, people)

  return (
    <div className={cx(
      'group rounded-xl bg-white p-3 shadow-sm ring-1 ring-slate-200 transition',
      'hover:shadow-md hover:ring-slate-300 dark:bg-slate-900 dark:ring-slate-800 dark:hover:ring-slate-700',
      dragging && 'rotate-2 shadow-xl ring-indigo-400',
      task.status === 'done' && 'opacity-70',
    )}>
      <p className={cx(
        'text-sm leading-snug font-medium break-words',
        task.status === 'done' && 'text-slate-500 line-through dark:text-slate-500',
      )}>
        {task.title}
      </p>

      {task.description && (
        <p className="mt-1.5 line-clamp-2 text-xs leading-relaxed text-slate-500 dark:text-slate-400">
          {task.description}
        </p>
      )}

      {task.status === 'blocked' && task.blocked_reason && (
        <p className="mt-2 rounded-md bg-rose-50 px-2 py-1 text-xs text-rose-700 dark:bg-rose-950/60 dark:text-rose-300">
          <span className="font-medium">Blocked:</span> {task.blocked_reason}
        </p>
      )}

      <div className="mt-2.5 flex flex-wrap items-center gap-1.5">
        <span className={cx('rounded-md px-1.5 py-0.5 text-[10px] font-medium ring-1 ring-inset', priority.chip)}>
          {priority.label}
        </span>
        {task.due_date && (
          <span className={cx(
            'inline-flex items-center gap-1 rounded-md px-1.5 py-0.5 text-[10px] font-medium ring-1 ring-inset',
            task.status === 'done' ? DUE_TONE.later : DUE_TONE[tone],
          )}>
            <svg viewBox="0 0 16 16" className="h-3 w-3" fill="none" stroke="currentColor" strokeWidth="1.5">
              <rect x="2" y="3" width="12" height="11" rx="2" />
              <path d="M2 6.5h12M5.5 1.5v3M10.5 1.5v3" strokeLinecap="round" />
            </svg>
            {formatDue(task.due_date)}
          </span>
        )}
        {assignee && <Avatar person={assignee} />}
      </div>
    </div>
  )
}

export default function TaskCard({ task, onOpen, people }: {
  task: Task
  onOpen: (t: Task) => void
  people?: Profile[]
}) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } =
    useSortable({ id: task.id, data: { status: task.status } })

  const assignee = findAssignee(task, people)

  return (
    <li
      ref={setNodeRef}
      style={{ transform: CSS.Translate.toString(transform), transition }}
      className={cx('touch-none', isDragging && 'opacity-40')}
      {...attributes}
      {...listeners}
      onClick={() => onOpen(task)}
      onKeyDown={e => { if (e.key === 'Enter') { e.preventDefault(); onOpen(task) } }}
      role="button"
      tabIndex={0}
      aria-label={assignee
        ? `Open task ${task.title}, assigned to ${personLabel(assignee)}`
        : `Open task ${task.title}`}
    >
      <TaskBody task={task} people={people} />
    </li>
  )
}
