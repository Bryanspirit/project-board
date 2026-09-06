import { useCallback, useEffect, useMemo, useState } from 'react'
import { supabase } from '../lib/supabase'
import type { Project, Task, TaskStatus } from '../lib/types'

/** Gap between adjacent sort_order values. Moves write the midpoint between
 *  neighbours, so a reorder touches exactly one row instead of the whole column. */
const ORDER_STEP = 1000

/**
 * Loads the boards for one workspace, optionally narrowed to a single team.
 *
 * Visibility is not filtered here — row level security already returns only the
 * projects the caller may see, so a plain select is both correct and the only
 * thing that can be trusted. The workspace filter is for focus, not security.
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

    let q = supabase.from('projects').select('*').eq('workspace_id', workspaceId)
    if (teamId) q = q.eq('team_id', teamId)
    const { data: p, error: pe } = await q.order('sort_order', { ascending: true })

    if (pe) { setError(pe.message); setLoading(false); return }

    const ids = (p as Project[]).map(x => x.id)
    let t: Task[] = []
    if (ids.length > 0) {
      const { data, error: te } = await supabase.from('tasks').select('*')
        .in('project_id', ids).order('sort_order', { ascending: true })
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

  const deleteProject = useCallback(async (id: string) => {
    setProjects(prev => prev.filter(p => p.id !== id))
    setTasks(prev => prev.filter(t => t.project_id !== id))
    const { error } = await supabase.from('projects').delete().eq('id', id)
    if (error) { setError(error.message); void load() }
  }, [load])

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

  const deleteTask = useCallback(async (id: string) => {
    setTasks(prev => prev.filter(t => t.id !== id))
    const { error } = await supabase.from('tasks').delete().eq('id', id)
    if (error) { setError(error.message); void load() }
  }, [load])

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
    createProject, updateProject, deleteProject,
    createTask, updateTask, deleteTask, moveTask,
  }
}
