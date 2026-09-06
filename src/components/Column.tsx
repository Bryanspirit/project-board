import { useDroppable } from '@dnd-kit/core'
import { SortableContext, verticalListSortingStrategy } from '@dnd-kit/sortable'
import type { Task, TaskStatus } from '../lib/types'
import { COLUMNS } from '../lib/types'
import TaskCard from './TaskCard'
import { cx } from './ui'

export default function Column({ status, tasks, onOpenTask, onAdd }: {
  status: TaskStatus
  tasks: Task[]
  onOpenTask: (t: Task) => void
  onAdd: (status: TaskStatus) => void
}) {
  const meta = COLUMNS.find(c => c.id === status)!
  const { setNodeRef, isOver } = useDroppable({ id: `col:${status}`, data: { status } })

  return (
    <section className="flex w-72 shrink-0 flex-col sm:w-80">
      <header className="mb-2.5 flex items-center gap-2 px-1">
        <span className={cx('h-2 w-2 rounded-full', meta.accent)} aria-hidden />
        <h3 className="text-sm font-semibold">{meta.label}</h3>
        <span className="rounded-full bg-slate-200 px-1.5 text-[10px] font-medium text-slate-600 dark:bg-slate-800 dark:text-slate-400">
          {tasks.length}
        </span>
        <button
          onClick={() => onAdd(status)}
          aria-label={`Add task to ${meta.label}`}
          className="ml-auto rounded-md p-1 text-slate-400 transition hover:bg-slate-200 hover:text-slate-700 dark:hover:bg-slate-800 dark:hover:text-slate-200"
        >
          <svg viewBox="0 0 16 16" className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth="2">
            <path d="M8 3v10M3 8h10" strokeLinecap="round" />
          </svg>
        </button>
      </header>

      <div
        ref={setNodeRef}
        className={cx(
          'flex-1 rounded-xl p-2 transition-colors',
          'bg-slate-100/70 ring-1 ring-slate-200/80 dark:bg-slate-900/50 dark:ring-slate-800/80',
          isOver && 'bg-indigo-50 ring-2 ring-indigo-300 dark:bg-indigo-950/30 dark:ring-indigo-800',
        )}
      >
        <SortableContext items={tasks.map(t => t.id)} strategy={verticalListSortingStrategy}>
          <ul className="flex min-h-24 flex-col gap-2">
            {tasks.map(t => <TaskCard key={t.id} task={t} onOpen={onOpenTask} />)}
            {tasks.length === 0 && (
              <li className="flex h-24 items-center justify-center rounded-lg border border-dashed border-slate-300 text-xs text-slate-400 dark:border-slate-700">
                Drop tasks here
              </li>
            )}
          </ul>
        </SortableContext>
      </div>
    </section>
  )
}
