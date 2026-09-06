import { useCallback, useEffect, useMemo, useState } from 'react'
import { useAuth } from './lib/auth'
import { isConfigured, supabase } from './lib/supabase'
import { useBoard } from './hooks/useBoard'
import { useWorkspaces } from './hooks/useWorkspaces'
import type { Profile, Project, ProjectHealth, Task, TaskStatus, TeamRole } from './lib/types'

import AuthGate, { useProfile } from './components/access/AuthGate'
import Sidebar from './components/Sidebar'
import Board from './components/Board'
import SettingsDialog from './components/SettingsDialog'
import TaskDialog, { emptyDraft, toDraft } from './components/TaskDialog'
import type { TaskDraft } from './components/TaskDialog'
import ProjectDialog, { projectDraft } from './components/ProjectDialog'
import type { ProjectDraft } from './components/ProjectDialog'

import WorkspaceSwitcher from './components/workspace/WorkspaceSwitcher'
import TeamList from './components/workspace/TeamList'
import WorkspaceDialog, { workspaceDraft, draftToPatch } from './components/workspace/WorkspaceDialog'
import type { WorkspaceDraft } from './components/workspace/WorkspaceDialog'
import TeamDialog, { teamDraft, draftToTeamPatch } from './components/workspace/TeamDialog'
import type { TeamDraft } from './components/workspace/TeamDialog'

import AdminDashboard from './components/admin/AdminDashboard'
import { MilestoneTimeline } from './components/program/MilestoneTimeline'
import { ShowcasePage } from './components/program/ShowcasePage'
import JudgingPanel from './components/judging/JudgingPanel'
import { MeetingList } from './components/collab/MeetingList'
import { NotificationBell } from './components/collab/NotificationBell'

import { Button, Input, Spinner, cx } from './components/ui'

const LAST_PROJECT_KEY = 'board:last-project'

type View = 'board' | 'meetings'

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

function IconButton({ label, onClick, children, badge }: {
  label: string
  onClick: () => void
  children: React.ReactNode
  badge?: number
}) {
  return (
    <button
      onClick={onClick}
      aria-label={label}
      title={label}
      className="relative rounded-lg p-2 text-slate-500 transition hover:bg-slate-200 hover:text-slate-800 dark:text-slate-400 dark:hover:bg-slate-800 dark:hover:text-slate-100"
    >
      {children}
      {badge !== undefined && badge > 0 && (
        <span className="absolute -top-0.5 -right-0.5 flex h-4 min-w-4 items-center justify-center rounded-full bg-rose-600 px-1 text-[10px] font-semibold text-white">
          {badge > 9 ? '9+' : badge}
        </span>
      )}
    </button>
  )
}

function BoardApp() {
  const { user, signOut } = useAuth()
  const { profile } = useProfile()
  const ws = useWorkspaces(user?.id)

  const [activeTeamId, setActiveTeamId] = useState<string | null>(null)
  const board = useBoard(user?.id, ws.activeWorkspaceId, activeTeamId)

  const [activeProjectId, setActiveProjectId] = useState<string | null>(null)
  const [query, setQuery] = useState('')
  const [sidebarOpen, setSidebarOpen] = useState(false)
  const [view, setView] = useState<View>('board')

  const [taskDraft, setTaskDraft] = useState<TaskDraft | null>(null)
  const [projDraft, setProjDraft] = useState<ProjectDraft | null>(null)
  const [wsDraft, setWsDraft] = useState<WorkspaceDraft | null>(null)
  const [teamDraftState, setTeamDraftState] = useState<TeamDraft | null>(null)
  const [showSettings, setShowSettings] = useState(false)
  const [showAdmin, setShowAdmin] = useState(false)
  const [showShowcase, setShowShowcase] = useState(false)
  const [showJudging, setShowJudging] = useState(false)
  const [health, setHealth] = useState<ProjectHealth[]>([])

  const workspaceId = ws.activeWorkspaceId
  const isAdmin = workspaceId ? ws.isAdmin(workspaceId) : false
  const isProgramme = ws.activeWorkspace?.kind === 'hackathon' || ws.activeWorkspace?.kind === 'program'

  // A deep link of #admin (used by the "new request" email) opens the dashboard.
  useEffect(() => {
    if (window.location.hash === '#admin' && profile?.is_super_admin) setShowAdmin(true)
  }, [profile?.is_super_admin])

  // Changing workspace invalidates the team filter — a team id never spans two.
  useEffect(() => { setActiveTeamId(null) }, [workspaceId])

  useEffect(() => {
    if (board.projects.length === 0) { setActiveProjectId(null); return }
    setActiveProjectId(current => {
      if (current && board.projects.some(p => p.id === current)) return current
      const remembered = localStorage.getItem(LAST_PROJECT_KEY)
      if (remembered && board.projects.some(p => p.id === remembered)) return remembered
      return board.projects[0].id
    })
  }, [board.projects])

  useEffect(() => {
    if (activeProjectId) localStorage.setItem(LAST_PROJECT_KEY, activeProjectId)
  }, [activeProjectId])

  // project_health powers judging and the showcase; only fetched when needed.
  const loadHealth = useCallback(async () => {
    if (!workspaceId) return
    const { data } = await supabase.from('project_health').select('*').eq('workspace_id', workspaceId)
    if (data) setHealth(data as ProjectHealth[])
  }, [workspaceId])

  useEffect(() => { if (showJudging) void loadHealth() }, [showJudging, loadHealth])

  const active = board.projects.find(p => p.id === activeProjectId) ?? null

  const people: Profile[] = useMemo(
    () => ws.workspaceMembers.map(m => m.profile).filter((p): p is Profile => Boolean(p)),
    [ws.workspaceMembers],
  )

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

  async function saveTask(d: TaskDraft) {
    if (!active) return
    const payload: Partial<Task> = {
      title: d.title.trim(),
      description: d.description.trim() || null,
      status: d.status,
      priority: d.priority,
      due_date: d.due_date || null,
      assignee_id: d.assignee_id || null,
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
      team_id: d.team_id || null,
    }
    if (d.id) await board.updateProject(d.id, payload)
    else {
      const created = await board.createProject(payload)
      if (created) setActiveProjectId(created.id)
    }
  }

  if (ws.loading && ws.workspaces.length === 0) {
    return (
      <div className="flex min-h-full items-center justify-center text-slate-400">
        <Spinner className="h-6 w-6" />
      </div>
    )
  }

  return (
    <div className="flex h-full overflow-hidden">
      <Sidebar
        projects={board.projects}
        byProject={board.byProject}
        activeId={activeProjectId}
        onSelect={setActiveProjectId}
        onNew={() => setProjDraft(projectDraft())}
        onEdit={p => setProjDraft(projectDraft(p))}
        open={sidebarOpen}
        onClose={() => setSidebarOpen(false)}
        header={
          <div className="space-y-2 px-2.5 pt-3">
            <WorkspaceSwitcher
              workspaces={ws.workspaces}
              activeWorkspace={ws.activeWorkspace}
              onSelect={ws.setActiveWorkspace}
              myRole={ws.myRole}
              canCreate={ws.isSuperAdmin}
              onNew={() => setWsDraft(workspaceDraft())}
            />
            <TeamList
              teams={ws.teams}
              teamMembers={ws.teamMembers}
              projects={board.projects}
              activeTeamId={activeTeamId}
              onSelect={setActiveTeamId}
              canCreate={isAdmin}
              canEdit={id => isAdmin || ws.isTeamLead(id)}
              onNew={() => setTeamDraftState(teamDraft())}
              onEdit={t => setTeamDraftState(teamDraft(t))}
            />
          </div>
        }
      />

      <main className="flex min-w-0 flex-1 flex-col">
        <header className="flex flex-wrap items-center gap-2 border-b border-slate-200 px-4 py-3 sm:px-6 dark:border-slate-800">
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
              {view === 'meetings' ? 'Meetings' : active?.name ?? 'No project selected'}
            </h1>
            {view === 'board' && active && (
              <p className="mt-0.5 text-xs text-slate-500 dark:text-slate-400">
                {stats.done} of {stats.total} done
                {stats.blocked > 0 && (
                  <span className="text-rose-600 dark:text-rose-400"> · {stats.blocked} blocked</span>
                )}
              </p>
            )}
          </div>

          {view === 'board' && active && (
            <div className="relative order-last w-full sm:order-none sm:w-48">
              <svg viewBox="0 0 16 16" className="pointer-events-none absolute top-2.5 left-2.5 h-4 w-4 text-slate-400"
                fill="none" stroke="currentColor" strokeWidth="1.5">
                <circle cx="7" cy="7" r="4.5" /><path d="M10.5 10.5 14 14" strokeLinecap="round" />
              </svg>
              <Input value={query} onChange={e => setQuery(e.target.value)}
                placeholder="Search tasks" aria-label="Search tasks" className="pl-8" />
            </div>
          )}

          <div className="flex items-center gap-0.5 rounded-lg bg-slate-100 p-0.5 dark:bg-slate-800">
            {(['board', 'meetings'] as View[]).map(v => (
              <button key={v} onClick={() => setView(v)}
                className={cx('rounded-md px-2.5 py-1.5 text-xs font-medium capitalize transition',
                  view === v ? 'bg-white shadow-sm dark:bg-slate-700' : 'text-slate-500 hover:text-slate-800 dark:hover:text-slate-200')}>
                {v}
              </button>
            ))}
          </div>

          <NotificationBell onOpenTask={id => {
            const t = board.tasks.find(x => x.id === id)
            if (t) { setActiveProjectId(t.project_id); setView('board'); setTaskDraft(toDraft(t)) }
          }} />

          {isProgramme && (
            <>
              <IconButton label="Demo day showcase" onClick={() => setShowShowcase(true)}>
                <svg viewBox="0 0 20 20" className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth="1.5">
                  <path d="M4 4h12v9H4zM8 17h4M10 13v4" strokeLinecap="round" />
                </svg>
              </IconButton>
              <IconButton label="Judging" onClick={() => setShowJudging(true)}>
                <svg viewBox="0 0 20 20" className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth="1.5">
                  <path d="M10 3v14M5 7h10M6.5 7 4 12h5zM13.5 7 11 12h5z" strokeLinejoin="round" />
                </svg>
              </IconButton>
            </>
          )}

          {profile?.is_super_admin && (
            <IconButton label="Admin dashboard" onClick={() => setShowAdmin(true)}>
              <svg viewBox="0 0 20 20" className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth="1.5">
                <circle cx="10" cy="6" r="3" /><path d="M4 17a6 6 0 0 1 12 0" strokeLinecap="round" />
              </svg>
            </IconButton>
          )}

          <ThemeToggle />

          <IconButton label="Email alert settings" onClick={() => setShowSettings(true)}>
            <svg viewBox="0 0 20 20" className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth="1.5">
              <rect x="2" y="4" width="16" height="12" rx="2" />
              <path d="m2.5 6 7.5 5 7.5-5" strokeLinecap="round" />
            </svg>
          </IconButton>

          <button
            onClick={() => void signOut()}
            title={`Sign out — ${user?.email ?? ''}`}
            className="flex h-8 w-8 items-center justify-center rounded-full bg-indigo-600 text-xs font-semibold text-white transition hover:bg-indigo-500"
            aria-label={`Sign out ${user?.email ?? ''}`}
          >
            {(profile?.full_name ?? user?.email ?? '?').slice(0, 1).toUpperCase()}
          </button>

          {view === 'board' && active && (
            <Button onClick={() => setTaskDraft(emptyDraft('todo'))}>
              <svg viewBox="0 0 16 16" className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth="2">
                <path d="M8 3v10M3 8h10" strokeLinecap="round" />
              </svg>
              New task
            </Button>
          )}
        </header>

        {(board.error || ws.error) && (
          <div role="alert" className="flex items-center gap-3 bg-rose-50 px-4 py-2 text-xs text-rose-700 sm:px-6 dark:bg-rose-950/50 dark:text-rose-300">
            <span className="flex-1">{board.error ?? ws.error}</span>
            <button onClick={() => { board.clearError(); ws.clearError() }} className="font-medium underline">Dismiss</button>
          </div>
        )}

        <div className="flex-1 overflow-y-auto">
          {isProgramme && workspaceId && view === 'board' && (
            <div className="px-4 pt-4 sm:px-6">
              <MilestoneTimeline workspaceId={workspaceId} canManage={isAdmin} />
            </div>
          )}

          {view === 'meetings' && workspaceId ? (
            <div className="p-4 sm:p-6">
              <MeetingList
                workspaceId={workspaceId}
                people={people}
                teams={ws.teams}
                canManage={isAdmin || (activeTeamId ? ws.isTeamLead(activeTeamId) : false)}
              />
            </div>
          ) : board.loading && board.projects.length === 0 ? (
            <div className="flex h-64 items-center justify-center text-slate-400">
              <Spinner className="h-6 w-6" />
            </div>
          ) : active ? (
            <div className="h-full pt-4">
              <Board
                project={active}
                tasks={visibleTasks}
                onOpenTask={t => setTaskDraft(toDraft(t))}
                onAdd={(status: TaskStatus) => setTaskDraft(emptyDraft(status))}
                onMove={board.moveTask}
              />
            </div>
          ) : (
            <div className="flex h-64 flex-col items-center justify-center gap-3 px-6 text-center">
              <span className="text-4xl" aria-hidden>🗂️</span>
              <h2 className="text-base font-semibold">No projects here yet</h2>
              <p className="max-w-xs text-sm text-slate-500 dark:text-slate-400">
                {activeTeamId
                  ? 'This team has no projects. Create one to get them started.'
                  : 'Create your first project and start dropping tasks into the board.'}
              </p>
              <Button onClick={() => setProjDraft(projectDraft())}>Create a project</Button>
            </div>
          )}
        </div>
      </main>

      {taskDraft && (
        <TaskDialog
          draft={taskDraft}
          people={people}
          onSave={saveTask}
          onDelete={board.deleteTask}
          onClose={() => setTaskDraft(null)}
        />
      )}

      {projDraft && (
        <ProjectDialog
          draft={projDraft}
          teams={ws.teams}
          project={projDraft.id ? board.projects.find(p => p.id === projDraft.id) ?? null : null}
          onSave={saveProject}
          onDelete={board.deleteProject}
          onSaveSubmission={patch => board.updateProject(projDraft.id!, patch)}
          onClose={() => setProjDraft(null)}
        />
      )}

      {wsDraft && (
        <WorkspaceDialog
          draft={wsDraft}
          onSave={async d => {
            const patch = draftToPatch(d)
            if (d.id) await ws.updateWorkspace(d.id, patch)
            else await ws.createWorkspace(patch)
          }}
          onArchive={id => ws.archiveWorkspace(id)}
          onRegenerateCode={id => ws.regenerateJoinCode(id)}
          onClose={() => setWsDraft(null)}
        />
      )}

      {teamDraftState && workspaceId && (
        <TeamDialog
          draft={teamDraftState}
          members={teamDraftState.id ? ws.membersByTeam.get(teamDraftState.id) ?? [] : []}
          workspaceMembers={ws.workspaceMembers}
          canManageMembers={isAdmin || (teamDraftState.id ? ws.isTeamLead(teamDraftState.id) : false)}
          onSave={async d => {
            const patch = draftToTeamPatch(d)
            if (d.id) await ws.updateTeam(d.id, patch)
            else await ws.createTeam({ ...patch, workspace_id: workspaceId })
          }}
          onDelete={id => ws.deleteTeam(id)}
          onAddMember={(userId, role) =>
            teamDraftState.id ? ws.addTeamMember(teamDraftState.id, userId, role) : undefined}
          onRemoveMember={(id: string) => ws.removeTeamMember(id)}
          onChangeMemberRole={(id: string, role: TeamRole) => ws.updateTeamMember(id, role)}
          onClose={() => setTeamDraftState(null)}
        />
      )}

      {showSettings && user && (
        <SettingsDialog userId={user.id} email={user.email ?? ''} onClose={() => setShowSettings(false)} />
      )}

      {showAdmin && <AdminDashboard onClose={() => { setShowAdmin(false); void ws.refresh() }} />}

      {showShowcase && workspaceId && (
        <ShowcasePage workspaceId={workspaceId} onClose={() => setShowShowcase(false)} />
      )}

      {showJudging && workspaceId && (
        <JudgingPanel
          workspaceId={workspaceId}
          projects={health}
          canManage={isAdmin}
          onClose={() => setShowJudging(false)}
        />
      )}
    </div>
  )
}

export default function App() {
  if (!isConfigured) return <SetupNotice />
  return (
    <AuthGate>
      <BoardApp />
    </AuthGate>
  )
}
