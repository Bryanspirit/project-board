import { useCallback, useEffect, useMemo, useState } from 'react'
import { supabase } from '../lib/supabase'
import { useAuth } from '../lib/auth'
import type { JudgingCriterion, Score } from '../lib/types'

/** Key for the (project, criterion, judge) unique constraint. */
function key(projectId: string, criterionId: string, judgeId: string) {
  return `${projectId}|${criterionId}|${judgeId}`
}

/** Postgres `numeric` can arrive as a string; every arithmetic path goes
 *  through here so a stringly-typed weight never turns a total into NaN. */
function num(v: unknown, fallback = 0): number {
  const n = typeof v === 'number' ? v : Number(v)
  return Number.isFinite(n) ? n : fallback
}

/**
 * Judging for one workspace: the criteria, the scores the caller is allowed to
 * see, and the writes that keep them in sync.
 *
 * RLS is the reason `isAdmin` exists. A judge can only ever select their OWN
 * rows from `scores`, so for a judge `scores` and `myScores` are the same set —
 * the hook never pretends otherwise, and `weightedTotal` for another judge
 * simply returns null when that judge's rows are invisible.
 */
export function useJudging(workspaceId: string | undefined, isAdmin = false) {
  const { user } = useAuth()
  const userId = user?.id ?? null

  const [criteria, setCriteria] = useState<JudgingCriterion[]>([])
  const [scores, setScores] = useState<Score[]>([])
  const [judgeNames, setJudgeNames] = useState<Record<string, string>>({})
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  const refresh = useCallback(async () => {
    if (!workspaceId || !userId) {
      setCriteria([]); setScores([]); setJudgeNames({}); setLoading(false)
      return
    }
    setLoading(true)

    const [critRes, projRes] = await Promise.all([
      supabase.from('judging_criteria').select('*')
        .eq('workspace_id', workspaceId)
        .order('sort_order', { ascending: true }),
      supabase.from('projects').select('id').eq('workspace_id', workspaceId),
    ])

    if (critRes.error) {
      setError(critRes.error.message); setLoading(false); return
    }
    setCriteria((critRes.data ?? []) as JudgingCriterion[])

    const projectIds: string[] = ((projRes.data ?? []) as { id: string }[]).map(r => r.id)
    if (projectIds.length === 0) {
      setScores([]); setJudgeNames({}); setError(null); setLoading(false); return
    }

    // Admins ask for every judge's row; a judge asks only for their own, which
    // is also all that RLS would hand back.
    let q = supabase.from('scores').select('*').in('project_id', projectIds)
    if (!isAdmin) q = q.eq('judge_id', userId)
    const { data, error: err } = await q

    if (err) { setError(err.message); setLoading(false); return }
    const rows = (data ?? []) as Score[]
    setScores(rows)
    setError(null)

    // Names make the leaderboard's "judges" column readable. Best effort only:
    // a failure here must not break scoring.
    if (isAdmin) {
      const ids = [...new Set(rows.map(r => r.judge_id))]
      if (ids.length > 0) {
        const { data: people } = await supabase
          .from('profiles').select('id, full_name, email').in('id', ids)
        const map: Record<string, string> = {}
        for (const p of (people ?? []) as { id: string; full_name: string | null; email: string }[]) {
          map[p.id] = p.full_name?.trim() || p.email
        }
        setJudgeNames(map)
      } else {
        setJudgeNames({})
      }
    }
    setLoading(false)
  }, [workspaceId, userId, isAdmin])

  useEffect(() => { void refresh() }, [refresh])

  // ------------------------------------------------------------- criteria --

  const createCriterion = useCallback(async (input: Partial<JudgingCriterion>) => {
    if (!workspaceId) return
    const sort_order = (criteria.at(-1)?.sort_order ?? 0) + 1000
    const { data, error: err } = await supabase
      .from('judging_criteria')
      .insert({ max_score: 10, weight: 1, sort_order, ...input, workspace_id: workspaceId })
      .select().single()
    if (err) { setError(err.message); throw new Error(err.message) }
    const row = data as JudgingCriterion
    setCriteria(prev => [...prev, row].sort(bySortOrder))
    return row
  }, [workspaceId, criteria])

  const updateCriterion = useCallback(async (id: string, patch: Partial<JudgingCriterion>) => {
    const { data, error: err } = await supabase
      .from('judging_criteria').update(patch).eq('id', id).select().single()
    if (err) { setError(err.message); throw new Error(err.message) }
    const row = data as JudgingCriterion
    setCriteria(prev => prev.map(c => (c.id === id ? row : c)).sort(bySortOrder))
    return row
  }, [])

  /** Deleting a criterion cascades to every score filed against it. */
  const deleteCriterion = useCallback(async (id: string) => {
    const previous = criteria
    setCriteria(prev => prev.filter(c => c.id !== id))
    setScores(prev => prev.filter(s => s.criterion_id !== id))
    const { error: err } = await supabase.from('judging_criteria').delete().eq('id', id)
    if (err) {
      setError(err.message); setCriteria(previous); void refresh()
      throw new Error(err.message)
    }
  }, [criteria, refresh])

  // --------------------------------------------------------------- scores --

  const saveScore = useCallback(async (
    projectId: string, criterionId: string, score: number, notes: string | null,
  ) => {
    if (!userId) throw new Error('You must be signed in to score.')
    const criterion = criteria.find(c => c.id === criterionId)
    const max = criterion ? num(criterion.max_score, 100) : 100
    // Clamp here as well as in the input: the database check constraint is
    // unforgiving, and a rejected write would lose the judge's work.
    const safe = Math.min(max, Math.max(0, Number.isFinite(score) ? score : 0))

    const { data, error: err } = await supabase
      .from('scores')
      .upsert({
        project_id: projectId,
        criterion_id: criterionId,
        judge_id: userId,
        score: safe,
        notes: notes && notes.trim() ? notes : null,
        updated_at: new Date().toISOString(),
      }, { onConflict: 'project_id,criterion_id,judge_id' })
      .select().single()

    if (err) { setError(err.message); throw new Error(err.message) }
    const row = data as Score
    setScores(prev => {
      const k = key(row.project_id, row.criterion_id, row.judge_id)
      const next = prev.filter(s => key(s.project_id, s.criterion_id, s.judge_id) !== k)
      next.push(row)
      return next
    })
    return row
  }, [userId, criteria])

  // -------------------------------------------------------------- derived --

  const byKey = useMemo(() => {
    const m = new Map<string, Score>()
    for (const s of scores) m.set(key(s.project_id, s.criterion_id, s.judge_id), s)
    return m
  }, [scores])

  const myScores = useMemo(
    () => (userId ? scores.filter(s => s.judge_id === userId) : []),
    [scores, userId],
  )

  const myScoreFor = useCallback(
    (projectId: string, criterionId: string) =>
      (userId ? byKey.get(key(projectId, criterionId, userId)) : undefined),
    [byKey, userId],
  )

  /** Judges with at least one score on this project, in a stable order. */
  const judgeIdsFor = useCallback((projectId: string) => {
    const seen: string[] = []
    for (const s of scores) {
      if (s.project_id === projectId && !seen.includes(s.judge_id)) seen.push(s.judge_id)
    }
    return seen.sort()
  }, [scores])

  /**
   * One judge's verdict on one project, normalised to 0-100:
   * sum((score / max_score) * weight) / sum(weight) * 100.
   *
   * Only criteria the judge actually scored contribute to either sum, so a
   * half-finished scorecard reads as "what they have given so far" rather than
   * being dragged toward zero by criteria they have not reached yet. A project
   * with no scores at all returns null — never a misleading 0.
   */
  const weightedTotal = useCallback((projectId: string, judgeId?: string): number | null => {
    const judge = judgeId ?? userId
    if (!judge) return null
    let sum = 0
    let weight = 0
    for (const c of criteria) {
      const row = byKey.get(key(projectId, c.id, judge))
      if (!row) continue
      const w = num(c.weight)
      const max = num(c.max_score, 1) || 1
      if (w <= 0) continue
      sum += (num(row.score) / max) * w
      weight += w
    }
    if (weight <= 0) return null
    return (sum / weight) * 100
  }, [criteria, byKey, userId])

  const totalWeight = useMemo(
    () => criteria.reduce((acc, c) => acc + num(c.weight), 0),
    [criteria],
  )

  return {
    criteria, scores, myScores, judgeNames, totalWeight,
    loading, error,
    refresh, createCriterion, updateCriterion, deleteCriterion, saveScore,
    myScoreFor, judgeIdsFor, weightedTotal,
    clearError: () => setError(null),
  }
}

function bySortOrder(a: JudgingCriterion, b: JudgingCriterion) {
  return a.sort_order - b.sort_order
}
