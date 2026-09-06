import { useCallback, useEffect, useMemo, useState } from 'react'
import { supabase } from '../lib/supabase'
import type { Milestone, Project } from '../lib/types'

/** The subset of `projects` a team edits from the submission panel. */
export interface SubmissionPatch {
  repo_url?: string | null
  demo_url?: string | null
  video_url?: string | null
  doc_url?: string | null
  submitted_at?: string | null
}

/** Milestones for one workspace, always ordered by `due_at` ascending, plus the
 *  two things every hackathon surface asks for: what is next, and where we are. */
export function useMilestones(workspaceId: string | undefined) {
  const [milestones, setMilestones] = useState<Milestone[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  const refresh = useCallback(async () => {
    if (!workspaceId) { setMilestones([]); setLoading(false); return }
    setLoading(true)
    const { data, error: err } = await supabase
      .from('milestones')
      .select('*')
      .eq('workspace_id', workspaceId)
      .order('due_at', { ascending: true })
    if (err) setError(err.message)
    else { setError(null); setMilestones((data ?? []) as Milestone[]) }
    setLoading(false)
  }, [workspaceId])

  useEffect(() => { void refresh() }, [refresh])

  const createMilestone = useCallback(async (input: Partial<Milestone>) => {
    if (!workspaceId) return
    const sort_order = (milestones.at(-1)?.sort_order ?? 0) + 1000
    const { data, error: err } = await supabase
      .from('milestones')
      .insert({ sort_order, ...input, workspace_id: workspaceId })
      .select()
      .single()
    if (err) { setError(err.message); return }
    const row = data as Milestone
    setMilestones(prev => [...prev, row].sort(byDueAt))
    return row
  }, [workspaceId, milestones])

  const updateMilestone = useCallback(async (id: string, patch: Partial<Milestone>) => {
    const { data, error: err } = await supabase
      .from('milestones').update(patch).eq('id', id).select().single()
    if (err) { setError(err.message); void refresh(); return }
    const row = data as Milestone
    setMilestones(prev => prev.map(m => (m.id === id ? row : m)).sort(byDueAt))
    return row
  }, [refresh])

  const deleteMilestone = useCallback(async (id: string) => {
    setMilestones(prev => prev.filter(m => m.id !== id))
    const { error: err } = await supabase.from('milestones').delete().eq('id', id)
    if (err) { setError(err.message); void refresh() }
  }, [refresh])

  /** Write a project's submission links. Lives here so the timeline, the panel
   *  and the showcase all speak to `projects` through one code path. */
  const updateSubmission = useCallback(async (projectId: string, patch: SubmissionPatch) => {
    const { data, error: err } = await supabase
      .from('projects').update(patch).eq('id', projectId).select().single()
    if (err) { setError(err.message); throw new Error(err.message) }
    return data as Project
  }, [])

  // `now` is captured once per load rather than per render so the two derived
  // values below stay stable; the Countdown owns the ticking.
  const nextMilestone = useMemo(() => {
    const now = Date.now()
    return milestones.find(m => new Date(m.due_at).getTime() > now) ?? null
  }, [milestones])

  const currentPhase = useMemo(() => {
    const now = Date.now()
    let latest: Milestone | null = null
    for (const m of milestones) {
      if (new Date(m.due_at).getTime() <= now) latest = m
      else break
    }
    return latest
  }, [milestones])

  return {
    milestones, loading, error, nextMilestone, currentPhase,
    refresh, createMilestone, updateMilestone, deleteMilestone, updateSubmission,
    clearError: () => setError(null),
  }
}

function byDueAt(a: Milestone, b: Milestone) {
  return new Date(a.due_at).getTime() - new Date(b.due_at).getTime()
}
