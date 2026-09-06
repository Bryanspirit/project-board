import { useCallback, useEffect, useState } from 'react'
import { supabase } from '../lib/supabase'
import type { Project, Task } from '../lib/types'

/** How long a trashed row survives before `purge_trash` may remove it. Matches
 *  the default of the RPC in supabase/migrations/20260906180000_*.sql. */
export const RETENTION_DAYS = 30

/** A trashed task carries the project it belonged to, so the panel can say
 *  where the row lived without a second round trip. */
export interface TrashedTask extends Task {
  project: { id: string; name: string; color: string } | null
}

export type TrashedProject = Project

/** Whatever `purge_trash` returned: a count of what went, or a refusal. */
export interface PurgeResult {
  ok: boolean
  projects?: number
  tasks?: number
  error?: string
}

/** Whole days left before a row is old enough to be purged. Zero means the
 *  retention window has already closed and the next purge will take it. */
export function daysLeft(deletedAt: string | null | undefined, retentionDays = RETENTION_DAYS): number {
  if (!deletedAt) return retentionDays
  const then = new Date(deletedAt).getTime()
  if (Number.isNaN(then)) return retentionDays
  const elapsedDays = (Date.now() - then) / 86_400_000
  return Math.max(0, Math.ceil(retentionDays - elapsedDays))
}

/**
 * Everything one workspace has in the trash, newest first.
 *
 * Nothing here removes a row: restoring clears `deleted_at`, and the only
 * permanent path is `purge`, which the database itself restricts to super
 * admins. Row level security still decides what is visible.
 */
export function useTrash(workspaceId: string | null | undefined) {
  const [projects, setProjects] = useState<TrashedProject[]>([])
  const [tasks, setTasks] = useState<TrashedTask[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  const refresh = useCallback(async () => {
    if (!workspaceId) { setProjects([]); setTasks([]); setLoading(false); return }
    setLoading(true)

    const [p, t] = await Promise.all([
      supabase.from('projects').select('*')
        .eq('workspace_id', workspaceId)
        .not('deleted_at', 'is', null)
        .order('deleted_at', { ascending: false }),
      // `!inner` makes the workspace filter on the embedded project a join
      // condition, so only this workspace's trashed tasks come back.
      supabase.from('tasks').select('*, project:projects!inner(id, name, color, workspace_id)')
        .eq('project.workspace_id', workspaceId)
        .not('deleted_at', 'is', null)
        .order('deleted_at', { ascending: false }),
    ])

    if (p.error || t.error) {
      setError(p.error?.message ?? t.error?.message ?? 'Could not load the trash.')
      setLoading(false)
      return
    }

    setError(null)
    setProjects((p.data ?? []) as TrashedProject[])
    setTasks((t.data ?? []) as unknown as TrashedTask[])
    setLoading(false)
  }, [workspaceId])

  useEffect(() => { void refresh() }, [refresh])

  /** Clearing a project's `deleted_at` brings back exactly the tasks the
   *  database trashed alongside it — the cascade trigger handles that. */
  const restoreProject = useCallback(async (id: string) => {
    setProjects(prev => prev.filter(p => p.id !== id))
    const { error: err } = await supabase.from('projects').update({ deleted_at: null }).eq('id', id)
    if (err) setError(err.message)
    await refresh()
    return !err
  }, [refresh])

  const restoreTask = useCallback(async (id: string) => {
    setTasks(prev => prev.filter(t => t.id !== id))
    const { error: err } = await supabase.from('tasks').update({ deleted_at: null }).eq('id', id)
    if (err) setError(err.message)
    await refresh()
    return !err
  }, [refresh])

  /** The only permanent delete in the app. The RPC refuses anyone who is not a
   *  super admin, so a non-admin caller gets `{ ok: false }`, not a throw. */
  const purge = useCallback(async (days = RETENTION_DAYS): Promise<PurgeResult> => {
    const { data, error: err } = await supabase.rpc('purge_trash', { older_than_days: days })
    if (err) { setError(err.message); return { ok: false, error: err.message } }
    const result = (data ?? { ok: false }) as PurgeResult
    if (!result.ok && result.error) setError(result.error)
    await refresh()
    return result
  }, [refresh])

  // Stable identity so callers can safely use it in a dependency array.
  const daysLeftFor = useCallback(
    (deletedAt: string | null | undefined) => daysLeft(deletedAt),
    [],
  )

  return {
    projects,
    tasks,
    loading,
    error,
    refresh,
    restoreProject,
    restoreTask,
    purge,
    daysLeft: daysLeftFor,
    clearError: () => setError(null),
  }
}
