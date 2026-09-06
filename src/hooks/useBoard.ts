import { useCallback, useEffect, useMemo, useState } from 'react'
import { supabase } from '../lib/supabase'
import type { Project, Task, TaskStatus } from '../lib/types'

/** Gap between adjacent sort_order values. Moves write the midpoint between
 *  neighbours, so a reorder touches exactly one row instead of the whole column. */
const ORDER_STEP = 1000

export function useBoard(userId: string | undefined) {
  const [projects, setProjects] = useState<Project[]>([])
  const [tasks, setTasks] = useState<Task[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  const load = useCallback(async () => {
    if (!userId) return
    setLoading(true)
    const [p, t] = await Promise.all([
      supabase.from('projects').select('*').order('sort_order', { ascending: true }),
      supabase.from('tasks').select('*').order('sort_order', { ascending: true }),
    ])
    if (p.error) setError(p.error.message)
    else if (t.error) setError(t.error.message)
    else {
      setError(null)
      setProjects(p.data as Project[])
      setTasks(t.data as Task[])
    }
    setLoading(false)
  }, [userId])

  useEffect(() => { void load() }, [load])

  // Keep other open tabs / devices in step. Realtime is a nicety here — if the
  // publication is not enabled the board still works, it just won't live-update.
  useEffect(() => {
    if (!userId) return
    const channel = supabase
      .channel('board-sync')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'tasks' }, () => void load())
      .on('postgres_changes', { event: '*', schema: 'public', table: 'projects' }, () => void load())
      .subscribe()
    return () => { void supabase.removeChannel(channel) }
  }, [userId, load])

  // ------------------------------------------------------------- projects --
  const createProject = useCallback(async (input: Partial<Project>) => {
    if (!userId) return
    const sort_order = (projects.at(-1)?.sort_order ?? 0) + ORDER_STEP
    const { data, error } = await supabase.from('projects')
      .insert({ ...input, user_id: userId, sort_order }).select().single()
    if (error) return setError(error.message)
    setProjects(prev => [...prev, data as Project])
    return data as Project
  }, [userId, projects])

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
      .insert({ ...input, user_id: userId, status, sort_order }).select().single()
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
