import { useMemo, useRef, useState } from 'react'
import {
  DndContext, DragOverlay, KeyboardSensor, PointerSensor,
  closestCorners, useSensor, useSensors,
} from '@dnd-kit/core'
import type { DragEndEvent, DragStartEvent } from '@dnd-kit/core'
import { sortableKeyboardCoordinates } from '@dnd-kit/sortable'
import type { Profile, Project, Task, TaskStatus, Team } from '../../lib/types'
import { COLUMNS } from '../../lib/types'
import Column from '../Column'
import { TaskBody } from '../TaskCard'
import ProjectSwitcher, { SWITCHER_THRESHOLD, projectProgress } from '../board/ProjectSwitcher'
import { ShortcutHelp, useShortcuts } from '../../hooks/useShortcuts'
import { Button, Input, Spinner, cx } from '../ui'

/**
 * The board and the navigation above it.
 *
 * A handful of projects still reads best as an inline strip; past
 * `SWITCHER_THRESHOLD` that strip overflows a laptop header and squeezes the
 * search box, so the same choice moves into a searchable popover instead.
 *
 * Drag and drop lives here rather than in `Board` because the columns need the
 * roster (for assignee avatars) and the inline create handler, neither of which
 * `Board`'s props carry.
 */
export default function BoardView({
  projects, byProject, activeProjectId, onSelectProject, onNewProject, onEditProject,
  tasks, query, onQuery, loading, onOpenTask, onAddTask, onMoveTask,
  people, teams, onCreateTask,
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
  /** Roster used to resolve `assignee_id` into a name on each card. */
  people?: Profile[]
  /** Only used to label projects in the switcher. */
  teams?: Team[]
  /** Enables the inline quick-add row at the foot of every column. */
  onCreateTask?: (title: string, status: TaskStatus) => Promise<unknown>
}) {
  const [dragging, setDragging] = useState<Task | null>(null)
  const [switcherOpen, setSwitcherOpen] = useState(false)
  const [helpOpen, setHelpOpen] = useState(false)

  const searchRef = useRef<HTMLDivElement>(null)

  const sensors = useSensors(
    // A small distance threshold keeps a click-to-open from registering as a drag.
    useSensor(PointerSensor, { activationConstraint: { distance: 5 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }),
  )

  const columns = useMemo(() => {
    const map = new Map<TaskStatus, Task[]>(COLUMNS.map(c => [c.id, []]))
    for (const t of [...tasks].sort((a, b) => a.sort_order - b.sort_order)) {
      map.get(t.status)?.push(t)
    }
    return map
  }, [tasks])

  const active = projects.find(p => p.id === activeProjectId) ?? null
  const useSwitcher = projects.length >= SWITCHER_THRESHOLD

  useShortcuts({
    newTask: active ? () => onAddTask('todo') : undefined,
    focusSearch: active
      ? () => {
        const el = searchRef.current?.querySelector('input')
        el?.focus()
        el?.select()
      }
      : undefined,
    openProjects: useSwitcher ? () => setSwitcherOpen(true) : undefined,
    showHelp: () => setHelpOpen(true),
    closeOverlays: () => { setHelpOpen(false); setSwitcherOpen(false) },
  })

  function handleStart(e: DragStartEvent) {
    setDragging(tasks.find(t => t.id === e.active.id) ?? null)
  }

  function handleEnd(e: DragEndEvent) {
    setDragging(null)
    const { active: dragged, over } = e
    if (!over) return

    const moving = tasks.find(t => t.id === dragged.id)
    if (!moving) return

    const overId = String(over.id)

    // Dropped on the column body — an empty column, a collapsed rail, or below
    // the last card.
    if (overId.startsWith('col:')) {
      const status = overId.slice(4) as TaskStatus
      const column = columns.get(status) ?? []
      const index = column.filter(t => t.id !== moving.id).length
      if (status === moving.status && index === column.indexOf(moving)) return
      onMoveTask(moving.id, status, index)
      return
    }

    // Dropped on another card — take that card's slot.
    const target = tasks.find(t => t.id === overId)
    if (!target || target.id === moving.id) return

    const column = (columns.get(target.status) ?? []).filter(t => t.id !== moving.id)
    const index = column.findIndex(t => t.id === target.id)
    onMoveTask(moving.id, target.status, index < 0 ? column.length : index)
  }

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
        {useSwitcher ? (
          <div className="flex min-w-0 flex-1 items-center gap-2">
            <ProjectSwitcher
              projects={projects}
              byProject={byProject}
              activeProjectId={activeProjectId}
              onSelect={onSelectProject}
              onNewProject={onNewProject}
              teams={teams}
              open={switcherOpen}
              onOpenChange={setSwitcherOpen}
            />
            <span className="hidden text-xs text-slate-400 lg:inline">
              {projects.length} projects
            </span>
          </div>
        ) : (
          <div className="flex min-w-0 flex-1 gap-1.5 overflow-x-auto pb-0.5">
            {projects.map(p => {
              const projectTasks = byProject.get(p.id) ?? []
              const selected = p.id === activeProjectId
              const blocked = projectTasks.filter(t => t.status === 'blocked').length
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
                  <span className="text-[10px] tabular-nums text-slate-400">{projectProgress(projectTasks)}%</span>
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
        )}

        {active && (
          <>
            <div ref={searchRef} className="relative hidden w-44 shrink-0 sm:block">
              <svg viewBox="0 0 16 16" className="pointer-events-none absolute top-2.5 left-2.5 h-4 w-4 text-slate-400"
                fill="none" stroke="currentColor" strokeWidth="1.5">
                <circle cx="7" cy="7" r="4.5" /><path d="M10.5 10.5 14 14" strokeLinecap="round" />
              </svg>
              <Input value={query} onChange={e => onQuery(e.target.value)}
                placeholder="Search tasks" aria-label="Search tasks" className="pl-8" />
            </div>

            <button
              onClick={() => setHelpOpen(true)}
              aria-label="Keyboard shortcuts"
              title="Keyboard shortcuts"
              className="hidden shrink-0 rounded-lg p-2 text-slate-400 transition hover:bg-slate-100 hover:text-slate-700 sm:block dark:hover:bg-slate-800 dark:hover:text-slate-200"
            >
              <svg viewBox="0 0 16 16" className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth="1.5">
                <rect x="1" y="4" width="14" height="9" rx="2" />
                <path d="M4.5 7h.01M7.5 7h.01M10.5 7h.01M5 10h6" strokeLinecap="round" />
              </svg>
            </button>

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
          <DndContext
            sensors={sensors}
            collisionDetection={closestCorners}
            onDragStart={handleStart}
            onDragEnd={handleEnd}
            onDragCancel={() => setDragging(null)}
          >
            <div className="flex h-full gap-4 overflow-x-auto px-4 pb-4 sm:px-6" aria-label={`${active.name} board`}>
              {COLUMNS.map(col => (
                <Column
                  key={col.id}
                  status={col.id}
                  tasks={columns.get(col.id) ?? []}
                  onOpenTask={onOpenTask}
                  onAdd={onAddTask}
                  people={people}
                  onCreateTask={onCreateTask}
                />
              ))}
            </div>

            <DragOverlay dropAnimation={{ duration: 180, easing: 'cubic-bezier(0.18, 0.67, 0.6, 1.22)' }}>
              {dragging && (
                <div className="w-64 sm:w-72">
                  <TaskBody task={dragging} dragging people={people} />
                </div>
              )}
            </DragOverlay>
          </DndContext>
        )}
      </div>

      {helpOpen && <ShortcutHelp onClose={() => setHelpOpen(false)} />}
    </div>
  )
}
