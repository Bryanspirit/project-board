// The shared contract between every screen. Mirrors supabase/migrations/*.sql —
// if you change a column there, change it here in the same commit.

export type TaskStatus = 'backlog' | 'todo' | 'in_progress' | 'blocked' | 'done'
export type TaskPriority = 'low' | 'medium' | 'high' | 'urgent'
export type ProjectStatus = 'active' | 'on_hold' | 'completed' | 'archived'

export type WorkspaceKind = 'personal' | 'hackathon' | 'program' | 'team'
export type WorkspaceRole = 'owner' | 'admin' | 'manager' | 'judge' | 'member'
export type TeamRole = 'lead' | 'member'
export type MemberStatus = 'pending' | 'active' | 'suspended' | 'rejected'
export type RequestStatus = 'pending' | 'approved' | 'rejected'
export type MilestoneKind = 'registration' | 'build' | 'submission' | 'judging' | 'demo' | 'custom'
export type MeetingStatus = 'scheduled' | 'completed' | 'cancelled'
export type RsvpStatus = 'pending' | 'accepted' | 'declined'
export type AttachmentKind = 'doc' | 'design' | 'repo' | 'video' | 'sheet' | 'other'

export interface Profile {
  id: string
  email: string
  full_name: string | null
  gender: string | null
  phone: string | null
  organization: string | null
  role_title: string | null
  github_url: string | null
  linkedin_url: string | null
  country: string | null
  bio: string | null
  timezone: string
  status: MemberStatus
  is_super_admin: boolean
  daily_digest: boolean
  weekly_summary: boolean
  blocker_alerts: boolean
  mention_alerts: boolean
  meeting_alerts: boolean
  created_at: string
}

export interface Workspace {
  id: string
  name: string
  slug: string
  kind: WorkspaceKind
  description: string | null
  color: string
  emoji: string
  owner_id: string
  join_code: string | null
  join_code_enabled: boolean
  join_role: WorkspaceRole
  starts_at: string | null
  ends_at: string | null
  is_archived: boolean
  created_at: string
  updated_at: string
}

export interface WorkspaceMember {
  id: string
  workspace_id: string
  user_id: string
  role: WorkspaceRole
  invited_by: string | null
  created_at: string
  profile?: Profile
}

export interface Team {
  id: string
  workspace_id: string
  name: string
  description: string | null
  color: string
  emoji: string
  created_by: string | null
  created_at: string
  updated_at: string
}

export interface TeamMember {
  id: string
  team_id: string
  user_id: string
  role: TeamRole
  created_at: string
  profile?: Profile
}

export interface Project {
  id: string
  user_id: string
  workspace_id: string
  team_id: string | null
  name: string
  description: string | null
  color: string
  status: ProjectStatus
  due_date: string | null
  sort_order: number
  created_by: string | null
  repo_url: string | null
  demo_url: string | null
  video_url: string | null
  doc_url: string | null
  submitted_at: string | null
  deleted_at: string | null
  created_at: string
  updated_at: string
}

export interface Task {
  id: string
  user_id: string
  project_id: string
  title: string
  description: string | null
  status: TaskStatus
  priority: TaskPriority
  due_date: string | null
  sort_order: number
  assignee_id: string | null
  created_by: string | null
  blocked_reason: string | null
  blocked_at: string | null
  blocked_notified_at: string | null
  completed_at: string | null
  deleted_at: string | null
  created_at: string
  updated_at: string
}

export interface AccessRequest {
  id: string
  user_id: string | null
  email: string
  full_name: string
  gender: string | null
  phone: string | null
  organization: string | null
  role_title: string | null
  github_url: string | null
  linkedin_url: string | null
  country: string | null
  motivation: string | null
  requested_workspace_id: string | null
  status: RequestStatus
  reviewed_by: string | null
  reviewed_at: string | null
  decision_note: string | null
  created_at: string
}

export interface Milestone {
  id: string
  workspace_id: string
  name: string
  description: string | null
  kind: MilestoneKind
  due_at: string
  sort_order: number
  created_at: string
}

export interface Attachment {
  id: string
  project_id: string | null
  task_id: string | null
  label: string
  url: string
  kind: AttachmentKind
  created_by: string | null
  created_at: string
}

export interface Comment {
  id: string
  task_id: string | null
  project_id: string | null
  author_id: string
  body: string
  created_at: string
  updated_at: string
  author?: Profile
}

export interface Mention {
  id: string
  comment_id: string
  mentioned_user_id: string
  notified_at: string | null
  read_at: string | null
  created_at: string
}

export interface Meeting {
  id: string
  workspace_id: string
  team_id: string | null
  title: string
  agenda: string | null
  starts_at: string
  ends_at: string
  location: string | null
  meeting_url: string | null
  provider: string
  status: MeetingStatus
  created_by: string | null
  created_at: string
}

export interface MeetingAttendee {
  id: string
  meeting_id: string
  user_id: string
  response: RsvpStatus
  notified_at: string | null
  profile?: Profile
}

export interface InviteLink {
  id: string
  workspace_id: string
  team_id: string | null
  token: string
  role: WorkspaceRole
  label: string | null
  expires_at: string | null
  max_uses: number | null
  uses: number
  revoked: boolean
  created_by: string | null
  created_at: string
}

/** One row per live task, flattened to the two dates burndown needs. */
export interface TaskActivity {
  id: string
  project_id: string
  workspace_id: string
  team_id: string | null
  created_on: string
  completed_on: string | null
}

export interface AuditEntry {
  id: string
  actor_id: string | null
  action: string
  entity_type: string
  entity_id: string | null
  workspace_id: string | null
  detail: Record<string, unknown>
  created_at: string
}

/** Read-only view: one row per project with its progress rolled up. */
export interface ProjectHealth {
  id: string
  workspace_id: string
  team_id: string | null
  name: string
  color: string
  status: ProjectStatus
  due_date: string | null
  team_name: string | null
  total_tasks: number
  done_tasks: number
  blocked_tasks: number
  overdue_tasks: number
  percent_done: number
  last_activity: string | null
  repo_url: string | null
  demo_url: string | null
  video_url: string | null
  submitted_at: string | null
}

// ----------------------------------------------------------- board config --

export const COLUMNS: { id: TaskStatus; label: string; accent: string }[] = [
  { id: 'backlog',     label: 'Backlog',     accent: 'bg-slate-400' },
  { id: 'todo',        label: 'To Do',       accent: 'bg-sky-500' },
  { id: 'in_progress', label: 'In Progress', accent: 'bg-amber-500' },
  { id: 'blocked',     label: 'Blocked',     accent: 'bg-rose-500' },
  { id: 'done',        label: 'Done',        accent: 'bg-emerald-500' },
]

export const PRIORITIES: { id: TaskPriority; label: string; chip: string }[] = [
  { id: 'low',    label: 'Low',    chip: 'bg-slate-100 text-slate-600 ring-slate-200 dark:bg-slate-800 dark:text-slate-300 dark:ring-slate-700' },
  { id: 'medium', label: 'Medium', chip: 'bg-sky-50 text-sky-700 ring-sky-200 dark:bg-sky-950 dark:text-sky-300 dark:ring-sky-900' },
  { id: 'high',   label: 'High',   chip: 'bg-amber-50 text-amber-700 ring-amber-200 dark:bg-amber-950 dark:text-amber-300 dark:ring-amber-900' },
  { id: 'urgent', label: 'Urgent', chip: 'bg-rose-50 text-rose-700 ring-rose-200 dark:bg-rose-950 dark:text-rose-300 dark:ring-rose-900' },
]

export const PROJECT_COLORS = [
  '#6366f1', '#0ea5e9', '#10b981', '#f59e0b',
  '#ef4444', '#ec4899', '#8b5cf6', '#14b8a6',
]

/** Selectable roles. 'judge' is deliberately absent — judging was removed, and
 *  the enum member only survives in Postgres because dropping it would mean
 *  rebuilding every policy that depends on the type. */
export const WORKSPACE_ROLES: { id: WorkspaceRole; label: string; blurb: string }[] = [
  { id: 'owner',   label: 'Owner',   blurb: 'Full control of the workspace' },
  { id: 'admin',   label: 'Admin',   blurb: 'Manage teams, members and every project' },
  { id: 'manager', label: 'Manager', blurb: 'Run projects across teams they belong to' },
  { id: 'member',  label: 'Member',  blurb: 'Work on their own team’s boards' },
]

export const MILESTONE_KINDS: { id: MilestoneKind; label: string }[] = [
  { id: 'registration', label: 'Registration' },
  { id: 'build',        label: 'Build' },
  { id: 'submission',   label: 'Submission' },
  { id: 'judging',      label: 'Judging' },
  { id: 'demo',         label: 'Demo day' },
  { id: 'custom',       label: 'Custom' },
]

export const ATTACHMENT_KINDS: { id: AttachmentKind; label: string }[] = [
  { id: 'doc',    label: 'Document' },
  { id: 'design', label: 'Design' },
  { id: 'repo',   label: 'Repo' },
  { id: 'video',  label: 'Video' },
  { id: 'sheet',  label: 'Sheet' },
  { id: 'other',  label: 'Link' },
]

export const GENDERS = ['Female', 'Male', 'Non-binary', 'Prefer not to say']

export const ROLE_TITLES = [
  'Developer', 'Designer', 'Product manager', 'Data / analytics',
  'Marketing', 'Founder', 'Student', 'Mentor', 'Judge', 'Other',
]

/** A project is at risk when it is behind and nobody has touched it lately. */
export function isAtRisk(h: ProjectHealth, staleDays = 5): boolean {
  if (h.status === 'completed' || h.status === 'archived') return false
  const stale = h.last_activity
    ? (Date.now() - new Date(h.last_activity).getTime()) / 86_400_000 > staleDays
    : true
  return (h.overdue_tasks > 0 && h.blocked_tasks > 0) || (h.overdue_tasks > 0 && stale)
}
