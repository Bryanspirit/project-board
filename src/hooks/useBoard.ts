import { useCallback, useEffect, useMemo, useState } from 'react'
import { supabase } from '../lib/supabase'
import type { Project, Task, TaskStatus } from '../lib/types'

/** Gap between adjacent sort_order values. Moves write the midpoint between
 *  neighbours, so a reorder touches exactly one row instead of the whole column. */
const ORDER_STEP = 1000

/**
 * What a delete hands back so the caller can offer an undo. The shape is
 * deliberately loose and the whole result optional, so the existing callers
 * that ignore it keep compiling untouched.
 */
export interface TrashedRef {
  kind: 'project' | 'task'
  id: string
  /** Human name of what went to the trash, for the toast copy. */
  label: string
  /** Puts it straight back — wire this to the toast's action. */
  undo: () => Promise<void>
}

/**
 * Loads the boards for one workspace, optionally narrowed to a single team.
 *
 * Visibility is not filtered here — row level security already returns only the
 * projects the caller may see, so a plain select is both correct and the only
 * thing that can be trusted. The workspace filter is for focus, not security.
 *
 * Deletes are recoverable: they stamp `deleted_at` rather than removing rows,
 * and every read here excludes anything already in the trash.
 */
export function useBoard(userId: string | undefined, workspaceId: string | null, teamId: string | null) {
  const [projects, setProjects] = useState<Project[]>([])
  const [tasks, setTasks] = useState<Task[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  const load = useCallback(async () => {
    if (!userId || !workspaceId) {
      setProjects([]); setTasks([]); setLoading(false)
      return
    }
    setLoading(true)

    let q = supabase.from('projects').select('*')
      .eq('workspace_id', workspaceId).is('deleted_at', null)
    if (teamId) q = q.eq('team_id', teamId)
    const { data: p, error: pe } = await q.order('sort_order', { ascending: true })

    if (pe) { setError(pe.message); setLoading(false); return }

    const ids = (p as Project[]).map(x => x.id)
    let t: Task[] = []
    if (ids.length > 0) {
      const { data, error: te } = await supabase.from('tasks').select('*')
        .in('project_id', ids).is('deleted_at', null)
        .order('sort_order', { ascending: true })
      if (te) { setError(te.message); setLoading(false); return }
      t = data as Task[]
    }

    setError(null)
    setProjects(p as Project[])
    setTasks(t)
    setLoading(false)
  }, [userId, workspaceId, teamId])

  useEffect(() => { void load() }, [load])

  // Keep other open tabs and teammates in step.
  useEffect(() => {
    if (!userId || !workspaceId) return
    const channel = supabase
      .channel(`board-${workspaceId}`)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'tasks' }, () => void load())
      .on('postgres_changes', { event: '*', schema: 'public', table: 'projects' }, () => void load())
      .subscribe()
    return () => { void supabase.removeChannel(channel) }
  }, [userId, workspaceId, load])

  // ------------------------------------------------------------- projects --
  const createProject = useCallback(async (input: Partial<Project>) => {
    if (!userId || !workspaceId) return
    const sort_order = (projects.at(-1)?.sort_order ?? 0) + ORDER_STEP
    const { data, error } = await supabase.from('projects').insert({
      ...input,
      workspace_id: input.workspace_id ?? workspaceId,
      team_id: input.team_id ?? teamId,
      user_id: userId,
      created_by: userId,
      sort_order,
    }).select().single()
    if (error) return setError(error.message)
    setProjects(prev => [...prev, data as Project])
    return data as Project
  }, [userId, workspaceId, teamId, projects])

  const updateProject = useCallback(async (id: string, patch: Partial<Project>) => {
    setProjects(prev => prev.map(p => (p.id === id ? { ...p, ...patch } : p)))
    const { error } = await supabase.from('projects').update(patch).eq('id', id)
    if (error) { setError(error.message); void load() }
  }, [load])

  /** Clears `deleted_at`; the DB trigger brings back exactly the tasks that
   *  went down with the project. */
  const restoreProject = useCallback(async (id: string) => {
    const { error } = await supabase.from('projects').update({ deleted_at: null }).eq('id', id)
    if (error) { setError(error.message); return }
    await load()
  }, [load])

  /** Moves the project to the trash. Its tasks follow, by database trigger. */
  const deleteProject = useCallback(async (id: string): Promise<TrashedRef | undefined> => {
    const label = projects.find(p => p.id === id)?.name ?? 'Project'
    setProjects(prev => prev.filter(p => p.id !== id))
    setTasks(prev => prev.filter(t => t.project_id !== id))
    const { error } = await supabase.from('projects')
      .update({ deleted_at: new Date().toISOString() }).eq('id', id)
    if (error) { setError(error.message); void load(); return }
    return { kind: 'project', id, label, undo: () => restoreProject(id) }
  }, [projects, load, restoreProject])

  // ---------------------------------------------------------------- tasks --
  const createTask = useCallback(async (input: Partial<Task>) => {
    if (!userId) return
    const status = (input.status ?? 'todo') as TaskStatus
    const siblings = tasks.filter(t => t.project_id === input.project_id && t.status === status)
    const sort_order = (siblings.at(-1)?.sort_order ?? 0) + ORDER_STEP
    const { data, error } = await supabase.from('tasks')
      .insert({ ...input, user_id: userId, created_by: userId, status, sort_order })
      .select().single()
    if (error) return setError(error.message)
    setTasks(prev => [...prev, data as Task])
    return data as Task
  }, [userId, tasks])

  const updateTask = useCallback(async (id: string, patch: Partial<Task>) => {
    setTasks(prev => prev.map(t => (t.id === id ? { ...t, ...patch } : t)))
    const { data, error } = await supabase.from('tasks').update(patch).eq('id', id).select().single()
    if (error) { setError(error.message); void load(); return }
    // The DB triggers stamp blocked_at / completed_at — take the row back so the
    // card reflects what was actually persisted.
    setTasks(prev => prev.map(t => (t.id === id ? (data as Task) : t)))
  }, [load])

  const restoreTask = useCallback(async (id: string) => {
    const { error } = await supabase.from('tasks').update({ deleted_at: null }).eq('id', id)
    if (error) { setError(error.message); return }
    await load()
  }, [load])

  /** Moves the task to the trash rather than removing it. */
  const deleteTask = useCallback(async (id: string): Promise<TrashedRef | undefined> => {
    const label = tasks.find(t => t.id === id)?.title ?? 'Task'
    setTasks(prev => prev.filter(t => t.id !== id))
    const { error } = await supabase.from('tasks')
      .update({ deleted_at: new Date().toISOString() }).eq('id', id)
    if (error) { setError(error.message); void load(); return }
    return { kind: 'task', id, label, undo: () => restoreTask(id) }
  }, [tasks, load, restoreTask])

  /** Drop `id` into `status` at position `index` within the column it lands in. */
  const moveTask = useCallback(async (id: string, status: TaskStatus, index: number) => {
    const moving = tasks.find(t => t.id === id)
    if (!moving) return

    const column = tasks
      .filter(t => t.project_id === moving.project_id && t.status === status && t.id !== id)
      .sort((a, b) => a.sort_order - b.sort_order)

    const before = column[index - 1]?.sort_order
    const after = column[index]?.sort_order
    let sort_order: number
    if (before === undefined && after === undefined) sort_order = ORDER_STEP
    else if (before === undefined) sort_order = after! - ORDER_STEP
    else if (after === undefined) sort_order = before + ORDER_STEP
    else sort_order = (before + after) / 2

    await updateTask(id, { status, sort_order })
  }, [tasks, updateTask])

  const byProject = useMemo(() => {
    const map = new Map<string, Task[]>()
    for (const t of tasks) {
      const list = map.get(t.project_id)
      if (list) list.push(t)
      else map.set(t.project_id, [t])
    }
    return map
  }, [tasks])

  return {
    projects, tasks, byProject, loading, error, reload: load, clearError: () => setError(null),
    createProject, updateProject, deleteProject, restoreProject,
    createTask, updateTask, deleteTask, restoreTask, moveTask,
  }
}
