import { useCallback, useEffect, useMemo, useState } from 'react'
import { supabase } from '../lib/supabase'
import type {
  AccessRequest, AuditEntry, MemberStatus, Profile, ProjectHealth,
  Team, Workspace, WorkspaceMember, WorkspaceRole,
} from '../lib/types'

/** Kept as a distinct name so the admin screens have somewhere to hang
 *  review-only fields later without touching the shared row type. */
export type AdminAccessRequest = AccessRequest

export interface ApproveOptions {
  workspaceId?: string | null
  role?: WorkspaceRole
  teamId?: string | null
  note?: string | null
}

/** Human "3 hours ago" for a timestamptz. Used across the admin surfaces so a
 *  reviewer can see how long somebody has been waiting without doing maths. */
export function relativeTime(iso: string | null | undefined): string {
  if (!iso) return 'never'
  const then = new Date(iso).getTime()
  if (Number.isNaN(then)) return 'unknown'
  const ms = Date.now() - then
  const abs = Math.abs(ms)
  const MIN = 60_000, HOUR = 3_600_000, DAY = 86_400_000
  if (abs < 45_000) return 'just now'
  const suffix = ms >= 0 ? 'ago' : 'from now'
  const unit = (n: number, u: string) => `${n} ${u}${n === 1 ? '' : 's'} ${suffix}`
  if (abs < HOUR) return unit(Math.round(abs / MIN), 'minute')
  if (abs < DAY) return unit(Math.round(abs / HOUR), 'hour')
  if (abs < 30 * DAY) return unit(Math.round(abs / DAY), 'day')
  if (abs < 365 * DAY) return unit(Math.round(abs / (30 * DAY)), 'month')
  return unit(Math.round(abs / (365 * DAY)), 'year')
}

/** Whole days since a timestamp, or null when it never happened. */
export function daysSince(iso: string | null | undefined): number | null {
  if (!iso) return null
  const then = new Date(iso).getTime()
  if (Number.isNaN(then)) return null
  return Math.max(0, Math.floor((Date.now() - then) / 86_400_000))
}

/**
 * Everything the super-admin control centre reads and writes. One hook so the
 * dashboard has a single source of truth and a single `refresh()` after any
 * mutation the database — not the client — is authoritative about.
 */
export function useAdmin() {
  const [requests, setRequests] = useState<AdminAccessRequest[]>([])
  const [workspaces, setWorkspaces] = useState<Workspace[]>([])
  const [members, setMembers] = useState<WorkspaceMember[]>([])
  const [teams, setTeams] = useState<Team[]>([])
  const [health, setHealth] = useState<ProjectHealth[]>([])
  const [audit, setAudit] = useState<AuditEntry[]>([])
  const [profiles, setProfiles] = useState<Profile[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  const load = useCallback(async () => {
    setLoading(true)
    const [req, ws, tm, hl, au, pr] = await Promise.all([
      supabase.from('access_requests').select('*').order('created_at', { ascending: false }),
      supabase.from('workspaces').select('*').order('name', { ascending: true }),
      supabase.from('teams').select('*').order('name', { ascending: true }),
      supabase.from('project_health').select('*'),
      supabase.from('audit_log').select('*').order('created_at', { ascending: false }).limit(100),
      supabase.from('profiles').select('*'),
    ])

    // Members are embedded against profiles. If a deployment has no declared
    // relationship for that embed, fall back to stitching the rows together
    // client-side rather than showing a members list with no names on it.
    let memberRows: WorkspaceMember[] = []
    let memberError: string | null = null
    const embedded = await supabase
      .from('workspace_members')
      .select('*, profile:profiles(*)')
      .order('created_at', { ascending: true })
    if (embedded.error) {
      const plain = await supabase.from('workspace_members').select('*').order('created_at', { ascending: true })
      if (plain.error) memberError = plain.error.message
      else memberRows = plain.data as WorkspaceMember[]
    } else {
      memberRows = embedded.data as unknown as WorkspaceMember[]
    }

    const profileRows = pr.error ? [] : (pr.data as Profile[])
    const byId = new Map(profileRows.map(p => [p.id, p]))
    memberRows = memberRows.map(m => (m.profile ? m : { ...m, profile: byId.get(m.user_id) }))

    const firstError =
      req.error?.message ?? ws.error?.message ?? tm.error?.message ??
      hl.error?.message ?? au.error?.message ?? pr.error?.message ?? memberError ?? null

    setError(firstError)
    if (!req.error) setRequests(req.data as AdminAccessRequest[])
    if (!ws.error) setWorkspaces(ws.data as Workspace[])
    if (!tm.error) setTeams(tm.data as Team[])
    if (!hl.error) setHealth(hl.data as ProjectHealth[])
    if (!au.error) setAudit(au.data as AuditEntry[])
    setProfiles(profileRows)
    setMembers(memberRows)
    setLoading(false)
  }, [])

  useEffect(() => { void load() }, [load])

  const profileById = useMemo(() => {
    const map: Record<string, Profile> = {}
    for (const p of profiles) map[p.id] = p
    for (const m of members) if (m.profile) map[m.profile.id] = m.profile
    return map
  }, [profiles, members])

  /** The RPC answers `{ ok: false, error }` for a refused review instead of
   *  raising, so both failure paths have to be checked. */
  const review = useCallback(async (
    requestId: string,
    decision: 'approved' | 'rejected',
    opts: ApproveOptions,
  ) => {
    const { data, error: rpcError } = await supabase.rpc('review_access_request', {
      request_id: requestId,
      decision,
      ws: opts.workspaceId || null,
      assign_role: opts.role ?? 'member',
      team: opts.teamId || null,
      note: opts.note && opts.note.trim() ? opts.note.trim() : null,
    })
    const refused = data && typeof data === 'object' && (data as { ok?: boolean }).ok === false
      ? String((data as { error?: unknown }).error ?? 'Review was refused')
      : null
    const message = rpcError?.message ?? refused
    if (message) { setError(message); return false }
    setError(null)
    await load()
    return true
  }, [load])

  const approve = useCallback(
    (requestId: string, opts: ApproveOptions) => review(requestId, 'approved', opts),
    [review],
  )

  const reject = useCallback(
    (requestId: string, note?: string | null) => review(requestId, 'rejected', { note }),
    [review],
  )

  const setMemberRole = useCallback(async (memberId: string, role: WorkspaceRole) => {
    setMembers(prev => prev.map(m => (m.id === memberId ? { ...m, role } : m)))
    const { error: e } = await supabase.from('workspace_members').update({ role }).eq('id', memberId)
    if (e) { setError(e.message); await load() }
  }, [load])

  const removeMember = useCallback(async (memberId: string) => {
    setMembers(prev => prev.filter(m => m.id !== memberId))
    const { error: e } = await supabase.from('workspace_members').delete().eq('id', memberId)
    if (e) { setError(e.message); await load() }
  }, [load])

  const setStatus = useCallback(async (userId: string, status: MemberStatus) => {
    setMembers(prev => prev.map(m => (
      m.user_id === userId && m.profile ? { ...m, profile: { ...m.profile, status } } : m
    )))
    setProfiles(prev => prev.map(p => (p.id === userId ? { ...p, status } : p)))
    const { error: e } = await supabase.from('profiles').update({ status }).eq('id', userId)
    if (e) { setError(e.message); await load() }
  }, [load])

  return {
    requests, workspaces, members, teams, health, audit, profileById,
    loading, error,
    refresh: load,
    approve, reject, setMemberRole, removeMember, setStatus,
  }
}
