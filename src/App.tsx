import { useEffect, useMemo, useState } from 'react'
import { useAuth } from './lib/auth'
import { isConfigured } from './lib/supabase'
import { useBoard } from './hooks/useBoard'
import type { Project, Task, TaskStatus } from './lib/types'
import LoginPage from './components/LoginPage'
import Sidebar from './components/Sidebar'
import Board from './components/Board'
import SettingsDialog from './components/SettingsDialog'
import TaskDialog, { emptyDraft, toDraft } from './components/TaskDialog'
import type { TaskDraft } from './components/TaskDialog'
import ProjectDialog, { projectDraft } from './components/ProjectDialog'
import type { ProjectDraft } from './components/ProjectDialog'
import { Button, Input, Spinner, cx } from './components/ui'

const LAST_PROJECT_KEY = 'board:last-project'

/** Shown when the site was built without Supabase credentials — far more useful
 *  than a login form that can never succeed. */
function SetupNotice() {
  return (
    <div className="flex min-h-full items-center justify-center p-6">
      <div className="max-w-md rounded-2xl bg-white p-6 shadow-xl ring-1 ring-slate-200 dark:bg-slate-900 dark:ring-slate-800">
        <h1 className="text-lg font-semibold">Almost there</h1>
        <p className="mt-2 text-sm leading-relaxed text-slate-600 dark:text-slate-400">
          This build has no Supabase credentials, so sign-in is disabled. Set{' '}
          <code className="rounded bg-slate-100 px-1 py-0.5 text-xs dark:bg-slate-800">VITE_SUPABASE_URL</code> and{' '}
          <code className="rounded bg-slate-100 px-1 py-0.5 text-xs dark:bg-slate-800">VITE_SUPABASE_ANON_KEY</code>{' '}
          in <code className="rounded bg-slate-100 px-1 py-0.5 text-xs dark:bg-slate-800">.env.local</code> for local
          development, or as repository secrets for the GitHub Pages deploy.
        </p>
        <p className="mt-3 text-xs text-slate-500 dark:text-slate-500">
          The full walkthrough is in <span className="font-medium">README.md</span>.
        </p>
      </div>
    </div>
  )
}

function ThemeToggle() {
  const [dark, setDark] = useState(() => document.documentElement.classList.contains('dark'))

  useEffect(() => {
    document.documentElement.classList.toggle('dark', dark)
    localStorage.setItem('theme', dark ? 'dark' : 'light')
  }, [dark])

  return (
    <button
      onClick={() => setDark(d => !d)}
      aria-label={dark ? 'Switch to light theme' : 'Switch to dark theme'}
      className="rounded-lg p-2 text-slate-500 transition hover:bg-slate-200 hover:text-slate-800 dark:text-slate-400 dark:hover:bg-slate-800 dark:hover:text-slate-100"
    >
      {dark ? (
        <svg viewBox="0 0 20 20" className="h-4 w-4" fill="currentColor">
          <path d="M10 4a1 1 0 0 1-1-1V2a1 1 0 1 1 2 0v1a1 1 0 0 1-1 1Zm0 12a1 1 0 0 1 1 1v1a1 1 0 1 1-2 0v-1a1 1 0 0 1 1-1Zm8-6a1 1 0 0 1-1 1h-1a1 1 0 1 1 0-2h1a1 1 0 0 1 1 1ZM4 10a1 1 0 0 1-1 1H2a1 1 0 1 1 0-2h1a1 1 0 0 1 1 1Zm11.7-5.7a1 1 0 0 1 0 1.4l-.7.7a1 1 0 0 1-1.4-1.4l.7-.7a1 1 0 0 1 1.4 0ZM6.4 13.6a1 1 0 0 1 0 1.4l-.7.7a1 1 0 0 1-1.4-1.4l.7-.7a1 1 0 0 1 1.4 0Zm9.3 2.1a1 1 0 0 1-1.4 0l-.7-.7a1 1 0 0 1 1.4-1.4l.7.7a1 1 0 0 1 0 1.4ZM6.4 6.4a1 1 0 0 1-1.4 0l-.7-.7a1 1 0 0 1 1.4-1.4l.7.7a1 1 0 0 1 0 1.4ZM10 6a4 4 0 1 0 0 8 4 4 0 0 0 0-8Z" />
        </svg>
      ) : (
        <svg viewBox="0 0 20 20" className="h-4 w-4" fill="currentColor">
          <path d="M17.3 12.8A7.5 7.5 0 0 1 7.2 2.7a7.5 7.5 0 1 0 10.1 10.1Z" />
        </svg>
      )}
    </button>
  )
}

export default function App() {
  const { user, loading: authLoading, signOut } = useAuth()
  const board = useBoard(user?.id)

  const [activeId, setActiveId] = useState<string | null>(null)
  const [query, setQuery] = useState('')
  const [sidebarOpen, setSidebarOpen] = useState(false)
  const [taskDraft, setTaskDraft] = useState<TaskDraft | null>(null)
  const [projDraft, setProjDraft] = useState<ProjectDraft | null>(null)
  const [showSettings, setShowSettings] = useState(false)

  // Land on the last project you had open; fall back to the first one.
  useEffect(() => {
    if (board.projects.length === 0) { setActiveId(null); return }
    setActiveId(current => {
      if (current && board.projects.some(p => p.id === current)) return current
      const remembered = localStorage.getItem(LAST_PROJECT_KEY)
      if (remembered && board.projects.some(p => p.id === remembered)) return remembered
      return board.projects[0].id
    })
  }, [board.projects])

  useEffect(() => {
    if (activeId) localStorage.setItem(LAST_PROJECT_KEY, activeId)
  }, [activeId])

  const active = board.projects.find(p => p.id === activeId) ?? null

  const visibleTasks = useMemo(() => {
    if (!active) return []
    const all = board.byProject.get(active.id) ?? []
    const q = query.trim().toLowerCase()
    if (!q) return all
    return all.filter(t =>
      t.title.toLowerCase().includes(q) || (t.description ?? '').toLowerCase().includes(q))
  }, [active, board.byProject, query])

  const stats = useMemo(() => {
    const all = active ? board.byProject.get(active.id) ?? [] : []
    return {
      total: all.length,
      done: all.filter(t => t.status === 'done').length,
      blocked: all.filter(t => t.status === 'blocked').length,
    }
  }, [active, board.byProject])

  if (!isConfigured) return <SetupNotice />

  if (authLoading) {
    return (
      <div className="flex min-h-full items-center justify-center text-slate-400">
        <Spinner className="h-6 w-6" />
      </div>
    )
  }

  if (!user) return <LoginPage />

  async function saveTask(d: TaskDraft) {
    if (!active) return
    const payload: Partial<Task> = {
      title: d.title.trim(),
      description: d.description.trim() || null,
      status: d.status,
      priority: d.priority,
      due_date: d.due_date || null,
      blocked_reason: d.status === 'blocked' ? (d.blocked_reason.trim() || null) : null,
    }
    if (d.id) await board.updateTask(d.id, payload)
    else await board.createTask({ ...payload, project_id: active.id })
  }

  async function saveProject(d: ProjectDraft) {
    const payload: Partial<Project> = {
      name: d.name.trim(),
      description: d.description.trim() || null,
      color: d.color,
      status: d.status,
      due_date: d.due_date || null,
    }
    if (d.id) await board.updateProject(d.id, payload)
    else {
      const created = await board.createProject(payload)
      if (created) setActiveId(created.id)
    }
  }

  return (
    <div className="flex h-full overflow-hidden">
      <Sidebar
        projects={board.projects}
        byProject={board.byProject}
        activeId={activeId}
        onSelect={setActiveId}
        onNew={() => setProjDraft(projectDraft())}
        onEdit={p => setProjDraft(projectDraft(p))}
        open={sidebarOpen}
        onClose={() => setSidebarOpen(false)}
      />

      <main className="flex min-w-0 flex-1 flex-col">
        <header className="flex flex-wrap items-center gap-3 border-b border-slate-200 px-4 py-3 sm:px-6 dark:border-slate-800">
          <button
            onClick={() => setSidebarOpen(true)}
            aria-label="Open project list"
            className="rounded-lg p-2 text-slate-500 hover:bg-slate-200 lg:hidden dark:hover:bg-slate-800"
          >
            <svg viewBox="0 0 20 20" className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth="2">
              <path d="M3 5h14M3 10h14M3 15h14" strokeLinecap="round" />
            </svg>
          </button>

          <div className="min-w-0 flex-1">
            <h1 className="truncate text-base font-semibold tracking-tight">
              {active?.name ?? 'No project selected'}
            </h1>
            {active && (
              <p className="mt-0.5 text-xs text-slate-500 dark:text-slate-400">
                {stats.done} of {stats.total} done
                {stats.blocked > 0 && (
                  <span className="text-rose-600 dark:text-rose-400"> · {stats.blocked} blocked</span>
                )}
              </p>
            )}
          </div>

          {active && (
            <div className="relative order-last w-full sm:order-none sm:w-52">
              <svg viewBox="0 0 16 16" className="pointer-events-none absolute top-2.5 left-2.5 h-4 w-4 text-slate-400"
                fill="none" stroke="currentColor" strokeWidth="1.5">
                <circle cx="7" cy="7" r="4.5" /><path d="M10.5 10.5 14 14" strokeLinecap="round" />
              </svg>
              <Input value={query} onChange={e => setQuery(e.target.value)}
                placeholder="Search tasks" aria-label="Search tasks" className="pl-8" />
            </div>
          )}

          <ThemeToggle />

          <button
            onClick={() => setShowSettings(true)}
            aria-label="Email alert settings"
            className="rounded-lg p-2 text-slate-500 transition hover:bg-slate-200 hover:text-slate-800 dark:text-slate-400 dark:hover:bg-slate-800 dark:hover:text-slate-100"
          >
            <svg viewBox="0 0 20 20" className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth="1.5">
              <rect x="2" y="4" width="16" height="12" rx="2" />
              <path d="m2.5 6 7.5 5 7.5-5" strokeLinecap="round" />
            </svg>
          </button>

          <button
            onClick={() => void signOut()}
            title={user.email ?? undefined}
            className="flex h-8 w-8 items-center justify-center rounded-full bg-indigo-600 text-xs font-semibold text-white transition hover:bg-indigo-500"
            aria-label={`Sign out ${user.email ?? ''}`}
          >
            {(user.email ?? '?').slice(0, 1).toUpperCase()}
          </button>

          {active && (
            <Button onClick={() => setTaskDraft(emptyDraft('todo'))}>
              <svg viewBox="0 0 16 16" className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth="2">
                <path d="M8 3v10M3 8h10" strokeLinecap="round" />
              </svg>
              New task
            </Button>
          )}
        </header>

        {board.error && (
          <div role="alert" className="flex items-center gap-3 bg-rose-50 px-4 py-2 text-xs text-rose-700 sm:px-6 dark:bg-rose-950/50 dark:text-rose-300">
            <span className="flex-1">{board.error}</span>
            <button onClick={board.clearError} className="font-medium underline">Dismiss</button>
          </div>
        )}

        <div className={cx('flex-1 overflow-hidden pt-4', board.loading && 'opacity-50')}>
          {board.loading && board.projects.length === 0 ? (
            <div className="flex h-full items-center justify-center text-slate-400">
              <Spinner className="h-6 w-6" />
            </div>
          ) : active ? (
            <Board
              project={active}
              tasks={visibleTasks}
              onOpenTask={t => setTaskDraft(toDraft(t))}
              onAdd={(status: TaskStatus) => setTaskDraft(emptyDraft(status))}
              onMove={board.moveTask}
            />
          ) : (
            <div className="flex h-full flex-col items-center justify-center gap-3 px-6 text-center">
              <span className="text-4xl" aria-hidden>🗂️</span>
              <h2 className="text-base font-semibold">No projects yet</h2>
              <p className="max-w-xs text-sm text-slate-500 dark:text-slate-400">
                Create your first project and start dropping tasks into the board.
              </p>
              <Button onClick={() => setProjDraft(projectDraft())}>Create a project</Button>
            </div>
          )}
        </div>
      </main>

      {taskDraft && (
        <TaskDialog
          draft={taskDraft}
          onSave={saveTask}
          onDelete={board.deleteTask}
          onClose={() => setTaskDraft(null)}
        />
      )}

      {projDraft && (
        <ProjectDialog
          draft={projDraft}
          onSave={saveProject}
          onDelete={board.deleteProject}
          onClose={() => setProjDraft(null)}
        />
      )}

      {showSettings && (
        <SettingsDialog userId={user.id} email={user.email ?? ''} onClose={() => setShowSettings(false)} />
      )}
    </div>
  )
}
