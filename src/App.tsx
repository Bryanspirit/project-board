import { useEffect, useMemo, useState } from 'react'
import { useAuth } from './lib/auth'
import { isConfigured } from './lib/supabase'
import { useBoard } from './hooks/useBoard'
import { useWorkspaces } from './hooks/useWorkspaces'
import { useFilters } from './hooks/useFilters'
import type { Profile, Project, Task, TaskStatus, TeamRole } from './lib/types'

import AuthGate, { useProfile } from './components/access/AuthGate'
import ResetPassword from './components/access/ResetPassword'
import AcceptInvite, { captureInviteFromUrl, pendingInviteToken } from './components/access/AcceptInvite'
import { ToastProvider, useToast } from './lib/toast'

import SettingsDialog from './components/SettingsDialog'
import TaskDialog, { emptyDraft, toDraft } from './components/TaskDialog'
import type { TaskDraft } from './components/TaskDialog'
import ProjectDialog, { projectDraft } from './components/ProjectDialog'
import type { ProjectDraft } from './components/ProjectDialog'

import WorkspacePicker from './components/shell/WorkspacePicker'
import WorkspaceHome from './components/shell/WorkspaceHome'
import BoardView from './components/shell/BoardView'

import WorkspaceDialog, { workspaceDraft, draftToPatch } from './components/workspace/WorkspaceDialog'
import type { WorkspaceDraft } from './components/workspace/WorkspaceDialog'
import TeamDialog, { teamDraft, draftToTeamPatch } from './components/workspace/TeamDialog'
import type { TeamDraft } from './components/workspace/TeamDialog'

import AdminDashboard from './components/admin/AdminDashboard'
import { MilestoneTimeline } from './components/program/MilestoneTimeline'
import { ShowcasePage } from './components/program/ShowcasePage'
import { MeetingList } from './components/collab/MeetingList'
import { NotificationBell } from './components/collab/NotificationBell'

import FilterBar from './components/filters/FilterBar'
import MyTasks from './components/filters/MyTasks'
import TrashPanel from './components/trash/TrashPanel'
import CalendarView from './components/views/CalendarView'
import TimelineView from './components/views/TimelineView'
import AnalyticsPanel from './components/analytics/AnalyticsPanel'

import InstallPrompt, { UpdateToast } from './pwa/InstallPrompt'
import OfflineBanner from './pwa/OfflineBanner'

import { useIsMobile } from './hooks/useIsMobile'
import MobileShell from './components/mobile/MobileShell'
import type { MobileTab } from './components/mobile/MobileShell'
import MobileBoard from './components/mobile/MobileBoard'

import { BrandMark, Mark } from './components/Mark'
import { cx } from './components/ui'

/** Where you are in the drill-down: workspaces → one workspace → a board. */
type Level = 'workspaces' | 'workspace' | 'board'
type Tab = 'board' | 'calendar' | 'timeline' | 'meetings'

const TABS: { id: Tab; label: string }[] = [
  { id: 'board', label: 'Board' },
  { id: 'calendar', label: 'Calendar' },
  { id: 'timeline', label: 'Timeline' },
  { id: 'meetings', label: 'Meetings' },
]

// Read the invite out of the URL once, at module scope, so it is consumed
// before any component effect can act on the hash.
const INITIAL_INVITE = captureInviteFromUrl()

function SetupNotice() {
  return (
    <div className="flex min-h-full items-center justify-center p-6">
      <div className="max-w-md rounded-2xl bg-white p-6 shadow-xl ring-1 ring-slate-200 dark:bg-slate-900 dark:ring-slate-800">
        <h1 className="text-lg font-semibold">Almost there</h1>
        <p className="mt-2 text-sm leading-relaxed text-slate-600 dark:text-slate-400">
          This build has no Supabase credentials, so sign-in is disabled. Set{' '}
          <code className="rounded bg-slate-100 px-1 py-0.5 text-xs dark:bg-slate-800">VITE_SUPABASE_URL</code> and{' '}
          <code className="rounded bg-slate-100 px-1 py-0.5 text-xs dark:bg-slate-800">VITE_SUPABASE_ANON_KEY</code>{' '}
          in <code className="rounded bg-slate-100 px-1 py-0.5 text-xs dark:bg-slate-800">.env.local</code>, or as
          repository secrets for the GitHub Pages deploy.
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

function IconButton({ label, onClick, children }: {
  label: string
  onClick: () => void
  children: React.ReactNode
}) {
  return (
    <button
      onClick={onClick}
      aria-label={label}
      title={label}
      className="rounded-lg p-2 text-slate-500 transition hover:bg-slate-200 hover:text-slate-800 dark:text-slate-400 dark:hover:bg-slate-800 dark:hover:text-slate-100"
    >
      {children}
    </button>
  )
}

function BoardApp() {
  const { user, signOut } = useAuth()
  const { profile } = useProfile()
  const ws = useWorkspaces(user?.id)
  const toast = useToast()

  const [level, setLevel] = useState<Level>('workspaces')
  const [activeTeamId, setActiveTeamId] = useState<string | null>(null)
  const [tab, setTab] = useState<Tab>('board')

  // At workspace level the team filter is deliberately dropped, so the overview
  // can count every project in the workspace, not just one team's.
  const board = useBoard(user?.id, ws.activeWorkspaceId, level === 'board' ? activeTeamId : null)

  const [activeProjectId, setActiveProjectId] = useState<string | null>(null)

  const [taskDraft, setTaskDraft] = useState<TaskDraft | null>(null)
  const [projDraft, setProjDraft] = useState<ProjectDraft | null>(null)
  const [wsDraft, setWsDraft] = useState<WorkspaceDraft | null>(null)
  const [teamDraftState, setTeamDraftState] = useState<TeamDraft | null>(null)
  const [showSettings, setShowSettings] = useState(false)
  const [showAdmin, setShowAdmin] = useState(false)
  const [showShowcase, setShowShowcase] = useState(false)
  const [showTrash, setShowTrash] = useState(false)
  const [showMyTasks, setShowMyTasks] = useState(false)
  const [showAnalytics, setShowAnalytics] = useState(false)

  const isMobile = useIsMobile()
  const [mobileTab, setMobileTab] = useState<MobileTab>('boards')

  const workspace = ws.activeWorkspace
  const workspaceId = ws.activeWorkspaceId
  const isAdmin = workspaceId ? ws.isAdmin(workspaceId) : false
  const isProgramme = workspace?.kind === 'hackathon' || workspace?.kind === 'program'

  // Filters are remembered per board, so switching teams does not carry a
  // narrowing you set somewhere else.
  const filters = useFilters(workspaceId ? `${workspaceId}:${activeTeamId ?? 'all'}` : null)

  // The "new request" email links straight to the approval queue.
  useEffect(() => {
    if (window.location.hash === '#admin' && profile?.is_super_admin) setShowAdmin(true)
  }, [profile?.is_super_admin])

  useEffect(() => {
    if (board.projects.length === 0) { setActiveProjectId(null); return }
    setActiveProjectId(current =>
      current && board.projects.some(p => p.id === current) ? current : board.projects[0].id)
  }, [board.projects])

  const active = board.projects.find(p => p.id === activeProjectId) ?? null

  const people: Profile[] = useMemo(
    () => ws.workspaceMembers.map(m => m.profile).filter((p): p is Profile => Boolean(p)),
    [ws.workspaceMembers],
  )

  const visibleTasks = useMemo(
    () => (active ? filters.apply(board.byProject.get(active.id) ?? []) : []),
    [active, board.byProject, filters],
  )

  function openWorkspace(id: string) {
    ws.setActiveWorkspace(id)
    setActiveTeamId(null)
    setTab('board')
    setLevel('workspace')
  }

  function openTeam(teamId: string | null) {
    setActiveTeamId(teamId)
    setTab('board')
    setLevel('board')
  }

  /** Jump to a task from anywhere — a mention, or the My tasks list. */
  function revealTask(taskId: string, projectId: string) {
    const t = board.tasks.find(x => x.id === taskId)
    setLevel('board')
    setTab('board')
    setActiveProjectId(projectId)
    if (t) setTaskDraft(toDraft(t))
  }

  // Deletes are recoverable now, so every one of them offers the way back.
  async function removeTask(id: string) {
    const trashed = await board.deleteTask(id)
    if (!trashed) return
    toast.show({
      message: `Deleted “${trashed.label}”`,
      actionLabel: 'Undo',
      onAction: () => void trashed.undo(),
    })
  }

  async function removeProject(id: string) {
    const trashed = await board.deleteProject(id)
    if (!trashed) return
    toast.show({
      message: `Deleted “${trashed.label}” and its tasks`,
      actionLabel: 'Undo',
      onAction: () => void trashed.undo(),
    })
  }

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
      const created = await board.createProject({ ...payload, team_id: payload.team_id ?? activeTeamId })
      if (created) setActiveProjectId(created.id)
    }
  }

  const teamName = activeTeamId ? ws.teams.find(t => t.id === activeTeamId)?.name : null

  // Rendered by both shells, so a dialog opened on a phone is the same
  // component — and the same state — as on a desktop.
  const dialogs = (
    <>
    {taskDraft && (
      <TaskDialog
        draft={taskDraft}
        people={people}
        onSave={saveTask}
        onDelete={id => void removeTask(id)}
        onClose={() => setTaskDraft(null)}
      />
    )}

    {projDraft && (
      <ProjectDialog
        draft={projDraft}
        teams={ws.teams}
        project={projDraft.id ? board.projects.find(p => p.id === projDraft.id) ?? null : null}
        onSave={saveProject}
        onDelete={id => void removeProject(id)}
        onSaveSubmission={patch => board.updateProject(projDraft.id!, patch)}
        onClose={() => setProjDraft(null)}
      />
    )}

    {wsDraft && (
      <WorkspaceDialog
        draft={wsDraft}
        teams={ws.teams}
        canManage={isAdmin || ws.isSuperAdmin}
        onSave={async d => {
          const patch = draftToPatch(d)
          if (d.id) await ws.updateWorkspace(d.id, patch)
          else {
            const created = await ws.createWorkspace(patch)
            if (created) openWorkspace(created.id)
          }
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

    {showAnalytics && workspaceId && (
      <AnalyticsPanel
        workspaceId={workspaceId}
        teamId={activeTeamId}
        canManage={isAdmin}
        onClose={() => setShowAnalytics(false)}
      />
    )}

    {showTrash && workspaceId && (
      <TrashPanel
        workspaceId={workspaceId}
        canPurge={profile?.is_super_admin === true}
        onClose={() => setShowTrash(false)}
        onRestored={() => void board.reload()}
      />
    )}

    {showMyTasks && (
      <MyTasks
        onClose={() => setShowMyTasks(false)}
        onOpenTask={(taskId, projectId) => revealTask(taskId, projectId)}
      />
    )}

    </>
  )

  if (isMobile) {
    const backTo =
      level === 'board' ? () => setLevel('workspace')
        : level === 'workspace' ? () => { setLevel('workspaces'); setActiveTeamId(null) }
          : undefined

    const moreRows = [
      ...(workspaceId ? [
        { label: 'Meetings', hint: 'Schedule and RSVP', onSelect: () => { setLevel('board'); setTab('meetings'); setMobileTab('boards') } },
        { label: 'Timeline', hint: 'Projects against milestones', onSelect: () => { setLevel('board'); setTab('timeline'); setMobileTab('boards') } },
        { label: 'Progress', hint: 'Burndown and velocity', onSelect: () => setShowAnalytics(true) },
        { label: 'Trash', hint: 'Restore anything deleted', onSelect: () => setShowTrash(true) },
      ] : []),
      ...(isProgramme && workspaceId
        ? [{ label: 'Showcase', hint: 'Demo day submissions', onSelect: () => setShowShowcase(true) }] : []),
      ...(profile?.is_super_admin
        ? [{ label: 'Admin', hint: 'Approvals and members', onSelect: () => setShowAdmin(true) }] : []),
      { label: 'Email alerts', hint: 'Choose what reaches your inbox', onSelect: () => setShowSettings(true) },
      {
        label: 'Switch theme',
        onSelect: () => {
          const dark = document.documentElement.classList.toggle('dark')
          localStorage.setItem('theme', dark ? 'dark' : 'light')
        },
      },
      { label: 'Sign out', hint: user?.email ?? undefined, danger: true, onSelect: () => void signOut() },
    ]

    const title = level === 'board'
      ? (teamName ?? 'All boards')
      : level === 'workspace' ? (workspace?.name ?? 'Workspace') : 'Workspaces'

    const subtitle = level === 'board'
      ? workspace?.name
      : level === 'workspace' ? ws.teams.length + ' teams' : 'Pick one to start'

    return (
      <>
        <OfflineBanner />
        <MobileShell
          title={title}
          subtitle={subtitle}
          onBack={backTo}
          tab={mobileTab}
          onTabChange={t => {
            // My tasks is an overlay rather than a destination, so selecting it
            // must not leave the bar highlighting a tab with nothing behind it.
            if (t === 'mine') { setShowMyTasks(true); return }
            setMobileTab(t)
          }}
          bell={
            <NotificationBell onOpenTask={id => {
              const t = board.tasks.find(x => x.id === id)
              if (t) { setMobileTab('boards'); revealTask(t.id, t.project_id) }
            }} />
          }
          more={moreRows}
        >
          {mobileTab === 'calendar' ? (
            workspaceId ? (
              <div className="h-full overflow-y-auto p-3">
                <CalendarView
                  workspaceId={workspaceId}
                  teamId={activeTeamId}
                  people={people}
                  onOpenTask={t => setTaskDraft(toDraft(t))}
                />
              </div>
            ) : (
              <p className="p-6 text-center text-sm text-slate-500 dark:text-slate-400">
                Open a workspace to see its calendar.
              </p>
            )
          ) : level === 'workspaces' ? (
            <div className="h-full overflow-y-auto">
              <WorkspacePicker
                workspaces={ws.workspaces}
                myRole={ws.myRole}
                canCreate={ws.isSuperAdmin}
                loading={ws.loading}
                onOpen={openWorkspace}
                onNew={() => setWsDraft(workspaceDraft())}
                onJoined={() => void ws.refresh()}
              />
            </div>
          ) : level === 'workspace' && workspace ? (
            <div className="h-full overflow-y-auto">
              {isProgramme && workspaceId && (
                <div className="px-4 pt-4">
                  <MilestoneTimeline workspaceId={workspaceId} canManage={isAdmin} />
                </div>
              )}
              <WorkspaceHome
                workspace={workspace}
                role={ws.myRole(workspace.id)}
                isAdmin={isAdmin}
                isTeamLead={ws.isTeamLead}
                teams={ws.teams}
                membersByTeam={ws.membersByTeam}
                workspaceMembers={ws.workspaceMembers}
                projects={board.projects}
                tasksByProject={board.byProject}
                onOpenTeam={openTeam}
                onNewTeam={() => setTeamDraftState(teamDraft())}
                onEditTeam={t => setTeamDraftState(teamDraft(t))}
                onManageMembers={() => setShowAdmin(true)}
                onEditWorkspace={() => setWsDraft(workspaceDraft(workspace))}
              />
            </div>
          ) : tab === 'meetings' && workspaceId ? (
            <div className="h-full overflow-y-auto p-3">
              <MeetingList
                workspaceId={workspaceId}
                people={people}
                teams={ws.teams}
                canManage={isAdmin || (activeTeamId ? ws.isTeamLead(activeTeamId) : false)}
              />
            </div>
          ) : tab === 'timeline' && workspaceId ? (
            <div className="h-full overflow-y-auto p-3">
              <TimelineView
                workspaceId={workspaceId}
                teamId={activeTeamId}
                onOpenProject={p => setProjDraft(projectDraft(p))}
              />
            </div>
          ) : (
            <MobileBoard
              projects={board.projects}
              activeProjectId={activeProjectId}
              onSelectProject={setActiveProjectId}
              tasks={visibleTasks}
              loading={board.loading}
              people={people}
              onOpenTask={t => setTaskDraft(toDraft(t))}
              onAddTask={(status: TaskStatus) => setTaskDraft(emptyDraft(status))}
              onMoveTask={board.moveTask}
              onNewProject={() => setProjDraft(projectDraft())}
            />
          )}
        </MobileShell>

        {dialogs}
      </>
    )
  }


  return (
    <div className="flex h-full flex-col overflow-hidden">
      <OfflineBanner />

      <header className="safe-x flex shrink-0 flex-wrap items-center gap-2 border-b border-slate-200 px-4 py-2.5 sm:px-6 dark:border-slate-800">
        <nav aria-label="Breadcrumb" className="flex min-w-0 flex-1 items-center gap-1 text-sm">
          <button
            onClick={() => { setLevel('workspaces'); setActiveTeamId(null) }}
            className={cx('flex items-center gap-1.5 rounded-md px-2 py-1 transition hover:bg-slate-100 dark:hover:bg-slate-800',
              level === 'workspaces' ? 'font-semibold' : 'text-slate-500 dark:text-slate-400')}
          >
            <BrandMark className="h-4 w-4 text-indigo-600 dark:text-indigo-400" />
            <span className="hidden sm:inline">Workspaces</span>
          </button>

          {level !== 'workspaces' && workspace && (
            <>
              <span className="text-slate-300 dark:text-slate-600" aria-hidden>/</span>
              <button
                onClick={() => { setLevel('workspace'); setActiveTeamId(null) }}
                className={cx('flex min-w-0 items-center gap-1.5 rounded-md px-2 py-1 transition hover:bg-slate-100 dark:hover:bg-slate-800',
                  level === 'workspace' ? 'font-semibold' : 'text-slate-500 dark:text-slate-400')}
              >
                <Mark name={workspace.name} color={workspace.color} size="sm" />
                <span className="truncate">{workspace.name}</span>
              </button>
            </>
          )}

          {level === 'board' && (
            <>
              <span className="text-slate-300 dark:text-slate-600" aria-hidden>/</span>
              <span className="truncate rounded-md px-2 py-1 font-semibold">
                {teamName ?? 'All boards'}
              </span>
            </>
          )}
        </nav>

        {level === 'board' && workspaceId && (
          <div className="flex items-center gap-0.5 overflow-x-auto rounded-lg bg-slate-100 p-0.5 dark:bg-slate-800">
            {TABS.map(t => (
              <button key={t.id} onClick={() => setTab(t.id)}
                aria-current={tab === t.id ? 'page' : undefined}
                className={cx('shrink-0 rounded-md px-2.5 py-1.5 text-xs font-medium transition',
                  tab === t.id ? 'bg-white shadow-sm dark:bg-slate-700' : 'text-slate-500 hover:text-slate-800 dark:hover:text-slate-200')}>
                {t.label}
              </button>
            ))}
          </div>
        )}

        <NotificationBell onOpenTask={id => {
          const t = board.tasks.find(x => x.id === id)
          if (t) revealTask(t.id, t.project_id)
        }} />

        <IconButton label="My tasks" onClick={() => setShowMyTasks(true)}>
          <svg viewBox="0 0 20 20" className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth="1.5">
            <path d="M4 6h12M4 10h12M4 14h7" strokeLinecap="round" />
          </svg>
        </IconButton>

        {level !== 'workspaces' && (
          <>
            {isProgramme && (
              <IconButton label="Demo day showcase" onClick={() => setShowShowcase(true)}>
                <svg viewBox="0 0 20 20" className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth="1.5">
                  <path d="M4 4h12v9H4zM8 17h4M10 13v4" strokeLinecap="round" />
                </svg>
              </IconButton>
            )}
            <IconButton label="Progress and burndown" onClick={() => setShowAnalytics(true)}>
              <svg viewBox="0 0 20 20" className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth="1.5">
                <path d="M3 16V9M8 16V4M13 16v-5M17 16V7" strokeLinecap="round" />
              </svg>
            </IconButton>
            <IconButton label="Trash" onClick={() => setShowTrash(true)}>
              <svg viewBox="0 0 20 20" className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth="1.5">
                <path d="M4 6h12M8 6V4h4v2M6 6l.7 10h6.6L14 6" strokeLinecap="round" strokeLinejoin="round" />
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
      </header>

      {(board.error || ws.error) && (
        <div role="alert" className="flex shrink-0 items-center gap-3 bg-rose-50 px-4 py-2 text-xs text-rose-700 sm:px-6 dark:bg-rose-950/50 dark:text-rose-300">
          <span className="flex-1">{board.error ?? ws.error}</span>
          <button onClick={() => { board.clearError(); ws.clearError() }} className="font-medium underline">Dismiss</button>
        </div>
      )}

      {level === 'board' && tab === 'board' && board.projects.length > 0 && (
        <div className="shrink-0 border-b border-slate-200 px-4 py-2 sm:px-6 dark:border-slate-800">
          <FilterBar {...filters} people={people} />
        </div>
      )}

      <div className={cx('min-h-0 flex-1', level === 'board' && tab === 'board' ? 'overflow-hidden' : 'overflow-y-auto')}>
        {level === 'workspaces' && (
          <WorkspacePicker
            workspaces={ws.workspaces}
            myRole={ws.myRole}
            canCreate={ws.isSuperAdmin}
            loading={ws.loading}
            onOpen={openWorkspace}
            onNew={() => setWsDraft(workspaceDraft())}
            onJoined={() => void ws.refresh()}
          />
        )}

        {level === 'workspace' && workspace && (
          <>
            {isProgramme && workspaceId && (
              <div className="mx-auto w-full max-w-6xl px-5 pt-6 sm:px-8">
                <MilestoneTimeline workspaceId={workspaceId} canManage={isAdmin} />
              </div>
            )}
            <WorkspaceHome
              workspace={workspace}
              role={ws.myRole(workspace.id)}
              isAdmin={isAdmin}
              isTeamLead={ws.isTeamLead}
              teams={ws.teams}
              membersByTeam={ws.membersByTeam}
              workspaceMembers={ws.workspaceMembers}
              projects={board.projects}
              tasksByProject={board.byProject}
              onOpenTeam={openTeam}
              onNewTeam={() => setTeamDraftState(teamDraft())}
              onEditTeam={t => setTeamDraftState(teamDraft(t))}
              onManageMembers={() => setShowAdmin(true)}
              onEditWorkspace={() => setWsDraft(workspaceDraft(workspace))}
            />
          </>
        )}

        {level === 'board' && tab === 'board' && (
          <BoardView
            projects={board.projects}
            byProject={board.byProject}
            activeProjectId={activeProjectId}
            onSelectProject={setActiveProjectId}
            onNewProject={() => setProjDraft(projectDraft())}
            onEditProject={p => setProjDraft(projectDraft(p))}
            tasks={visibleTasks}
            query={filters.filters.text}
            onQuery={q => filters.setFilter('text', q)}
            loading={board.loading}
            onOpenTask={t => setTaskDraft(toDraft(t))}
            onAddTask={(status: TaskStatus) => setTaskDraft(emptyDraft(status))}
            onMoveTask={board.moveTask}
            people={people}
            teams={ws.teams}
            onCreateTask={async (title, status) => {
              if (active) await board.createTask({ title, status, project_id: active.id })
            }}
          />
        )}

        {level === 'board' && tab === 'calendar' && (
          <CalendarView
            workspaceId={workspaceId}
            teamId={activeTeamId}
            people={people}
            onOpenTask={t => setTaskDraft(toDraft(t))}
            className="p-4 sm:p-6"
          />
        )}

        {level === 'board' && tab === 'timeline' && (
          <TimelineView
            workspaceId={workspaceId}
            teamId={activeTeamId}
            onOpenProject={p => setProjDraft(projectDraft(p))}
            className="p-4 sm:p-6"
          />
        )}

        {level === 'board' && tab === 'meetings' && workspaceId && (
          <div className="mx-auto w-full max-w-5xl p-4 sm:p-6">
            <MeetingList
              workspaceId={workspaceId}
              people={people}
              teams={ws.teams}
              canManage={isAdmin || (activeTeamId ? ws.isTeamLead(activeTeamId) : false)}
            />
          </div>
        )}
      </div>

      {dialogs}
    </div>
  )
}

export default function App() {
  // Held outside the gate: someone arriving on an invite link may not be signed
  // in yet, and AuthGate would otherwise swap in the login screen and swallow
  // the invite entirely.
  const [inviteToken, setInviteToken] = useState<string | null>(
    () => INITIAL_INVITE ?? pendingInviteToken())
  const [joinedAt, setJoinedAt] = useState(0)
  const { recovering, endRecovery } = useAuth()

  if (!isConfigured) return <SetupNotice />

  // A reset link signs the visitor in, so the gate would happily show them the
  // board with the password they had forgotten still in force. Divert first.
  if (recovering) return <ResetPassword onDone={endRecovery} />

  return (
    <ToastProvider>
      {/* Remounting after a join reloads the profile and workspace list with
          the membership the invite just granted. */}
      <AuthGate key={joinedAt}>
        <BoardApp />
      </AuthGate>

      {inviteToken && (
        <AcceptInvite
          token={inviteToken}
          onAccepted={() => { setInviteToken(null); setJoinedAt(Date.now()) }}
          onDismiss={() => setInviteToken(null)}
        />
      )}

      {/* Outside AuthGate on purpose: mounting these registers the service
          worker, and registration is what checks for a new build. Gated behind
          sign-in, a stale install could never discover an update until after
          someone had already logged in. */}
      <InstallPrompt />
      <UpdateToast />
    </ToastProvider>
  )
}
