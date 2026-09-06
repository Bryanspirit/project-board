export type TaskStatus = 'backlog' | 'todo' | 'in_progress' | 'blocked' | 'done'
export type TaskPriority = 'low' | 'medium' | 'high' | 'urgent'
export type ProjectStatus = 'active' | 'on_hold' | 'completed' | 'archived'

export interface Project {
  id: string
  user_id: string
  name: string
  description: string | null
  color: string
  status: ProjectStatus
  due_date: string | null
  sort_order: number
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
  blocked_reason: string | null
  blocked_at: string | null
  blocked_notified_at: string | null
  completed_at: string | null
  created_at: string
  updated_at: string
}

export interface Profile {
  id: string
  email: string
  full_name: string | null
  timezone: string
  daily_digest: boolean
  weekly_summary: boolean
  blocker_alerts: boolean
}

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
