import type { Project, Task, TaskStatus } from '../../lib/types'
import Board from '../Board'
import { Button, Input, Spinner, cx } from '../ui'

function progress(tasks: Task[]) {
  if (tasks.length === 0) return 0
  return Math.round((tasks.filter(t => t.status === 'done').length / tasks.length) * 100)
}

/**
 * The board, with its projects as a horizontal strip rather than a sidebar —
 * navigation here is a drill-down (workspace, then team, then project), so the
 * strip only ever holds the handful of projects the chosen team owns.
 */
export default function BoardView({
  projects, byProject, activeProjectId, onSelectProject, onNewProject, onEditProject,
  tasks, query, onQuery, loading, onOpenTask, onAddTask, onMoveTask,
}: {
  projects: Project[]
  byProject: Map<string, Task[]>
  activeProjectId: string | null
  onSelectProject: (id: string) => void
  onNewProject: () => void
  onEditProject: (p: Project) => void
  tasks: Task[]
  query: string
  onQuery: (q: string) => void
  loading: boolean
  onOpenTask: (t: Task) => void
  onAddTask: (status: TaskStatus) => void
  onMoveTask: (id: string, status: TaskStatus, index: number) => void
}) {
  const active = projects.find(p => p.id === activeProjectId) ?? null

  if (loading && projects.length === 0) {
    return (
      <div className="flex h-64 items-center justify-center text-slate-400">
        <Spinner className="h-6 w-6" />
      </div>
    )
  }

  if (projects.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center gap-3 px-6 py-20 text-center">
        <span className="text-4xl" aria-hidden>🗂️</span>
        <h2 className="text-base font-semibold">No projects here yet</h2>
        <p className="max-w-xs text-sm text-slate-500 dark:text-slate-400">
          Create the first project and start dropping tasks onto the board.
        </p>
        <Button onClick={onNewProject}>Create a project</Button>
      </div>
    )
  }

  return (
    <div className="flex h-full min-h-0 flex-col">
      <div className="flex items-center gap-3 border-b border-slate-200 px-4 py-2.5 sm:px-6 dark:border-slate-800">
        <div className="flex min-w-0 flex-1 gap-1.5 overflow-x-auto pb-0.5">
          {projects.map(p => {
            const tasks = byProject.get(p.id) ?? []
            const selected = p.id === activeProjectId
            const blocked = tasks.filter(t => t.status === 'blocked').length
            return (
              <button
                key={p.id}
                onClick={() => onSelectProject(p.id)}
                aria-current={selected ? 'page' : undefined}
                className={cx(
                  'group flex shrink-0 items-center gap-2 rounded-lg px-3 py-1.5 text-sm transition',
                  selected
                    ? 'bg-slate-100 font-medium text-slate-900 dark:bg-slate-800 dark:text-slate-100'
                    : 'text-slate-500 hover:bg-slate-100/70 hover:text-slate-800 dark:hover:bg-slate-800/60 dark:hover:text-slate-200',
                )}
              >
                <span className="h-2 w-2 shrink-0 rounded-full" style={{ backgroundColor: p.color }} aria-hidden />
                <span className="max-w-44 truncate">{p.name}</span>
                <span className="text-[10px] tabular-nums text-slate-400">{progress(tasks)}%</span>
                {blocked > 0 && (
                  <span title={`${blocked} blocked`}
                    className="rounded-full bg-rose-100 px-1.5 text-[10px] font-semibold text-rose-700 dark:bg-rose-950 dark:text-rose-300">
                    {blocked}
                  </span>
                )}
              </button>
            )
          })}

          <button
            onClick={onNewProject}
            aria-label="New project"
            className="flex shrink-0 items-center gap-1 rounded-lg px-2.5 py-1.5 text-sm text-slate-400 transition hover:bg-slate-100 hover:text-indigo-600 dark:hover:bg-slate-800"
          >
            <svg viewBox="0 0 16 16" className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth="2">
              <path d="M8 3v10M3 8h10" strokeLinecap="round" />
            </svg>
          </button>
        </div>

        {active && (
          <>
            <div className="relative hidden w-44 shrink-0 sm:block">
              <svg viewBox="0 0 16 16" className="pointer-events-none absolute top-2.5 left-2.5 h-4 w-4 text-slate-400"
                fill="none" stroke="currentColor" strokeWidth="1.5">
                <circle cx="7" cy="7" r="4.5" /><path d="M10.5 10.5 14 14" strokeLinecap="round" />
              </svg>
              <Input value={query} onChange={e => onQuery(e.target.value)}
                placeholder="Search tasks" aria-label="Search tasks" className="pl-8" />
            </div>

            <button
              onClick={() => onEditProject(active)}
              aria-label={`Project settings for ${active.name}`}
              className="shrink-0 rounded-lg p-2 text-slate-400 transition hover:bg-slate-100 hover:text-slate-700 dark:hover:bg-slate-800 dark:hover:text-slate-200"
            >
              <svg viewBox="0 0 16 16" className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth="1.5">
                <path d="M11.5 2.5a1.7 1.7 0 0 1 2.4 2.4L5.6 13.2l-3.1.7.7-3.1 8.3-8.3Z" strokeLinejoin="round" />
              </svg>
            </button>

            <Button className="shrink-0" onClick={() => onAddTask('todo')}>
              <svg viewBox="0 0 16 16" className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth="2">
                <path d="M8 3v10M3 8h10" strokeLinecap="round" />
              </svg>
              <span className="hidden sm:inline">New task</span>
            </Button>
          </>
        )}
      </div>

      <div className="min-h-0 flex-1 pt-4">
        {active && (
          <Board
            project={active}
            tasks={tasks}
            onOpenTask={onOpenTask}
            onAdd={onAddTask}
            onMove={onMoveTask}
          />
        )}
      </div>
    </div>
  )
}
