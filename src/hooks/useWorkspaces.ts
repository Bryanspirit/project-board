import { useCallback, useEffect, useMemo, useState } from 'react'
import { supabase } from '../lib/supabase'
import type {
  Profile, Team, TeamMember, TeamRole, Workspace, WorkspaceMember, WorkspaceRole,
} from '../lib/types'

/** Where the last-used workspace is remembered between visits. */
const STORAGE_KEY = 'board:workspace'

/** No O/0/I/1 — a join code has to survive being read aloud down a phone line. */
const CODE_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'
const CODE_LENGTH = 8

/** Uppercase, unambiguous, ~8 characters. */
export function generateJoinCode(length = CODE_LENGTH): string {
  const picks = new Uint32Array(length)
  crypto.getRandomValues(picks)
  let out = ''
  for (let i = 0; i < length; i++) out += CODE_ALPHABET[picks[i] % CODE_ALPHABET.length]
  return out
}

/** Slugs are unique in the DB, so a short random tail keeps two "Personal"
 *  workspaces from colliding on insert. */
export function workspaceSlug(name: string): string {
  const base = name.toLowerCase().trim().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '')
  return `${base || 'workspace'}-${Math.random().toString(36).slice(2, 8)}`
}

function readStored(): string | null {
  try { return window.localStorage.getItem(STORAGE_KEY) } catch { return null }
}

function writeStored(id: string | null) {
  try {
    if (id) window.localStorage.setItem(STORAGE_KEY, id)
    else window.localStorage.removeItem(STORAGE_KEY)
  } catch { /* private mode — the fallback picks a workspace on next load */ }
}

const ADMIN_ROLES: WorkspaceRole[] = ['owner', 'admin']

/**
 * Everything above the board: which workspaces you can see, what you are in
 * each of them, and the teams inside the one you are looking at.
 *
 * RLS already limits `workspaces` to rows you belong to, so a plain select is
 * the whole authorisation story on the client.
 */
export function useWorkspaces(userId: string | undefined) {
  const [workspaces, setWorkspaces] = useState<Workspace[]>([])
  const [memberships, setMemberships] = useState<WorkspaceMember[]>([])
  const [teams, setTeams] = useState<Team[]>([])
  const [teamMembers, setTeamMembers] = useState<TeamMember[]>([])
  const [profile, setProfile] = useState<Profile | null>(null)
  const [activeId, setActiveId] = useState<string | null>(() => readStored())
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  // ------------------------------------------------------------- loading --
  const loadWorkspaces = useCallback(async () => {
    if (!userId) {
      setWorkspaces([]); setMemberships([]); setProfile(null); setLoading(false)
      return
    }
    const [w, m, p] = await Promise.all([
      supabase.from('workspaces').select('*').order('name', { ascending: true }),
      supabase.from('workspace_members').select('*, profile:profiles(*)'),
      supabase.from('profiles').select('*').eq('id', userId).maybeSingle(),
    ])
    const failure = w.error ?? m.error ?? p.error
    if (failure) {
      setError(failure.message)
    } else {
      setError(null)
      setWorkspaces((w.data ?? []) as Workspace[])
      setMemberships((m.data ?? []) as unknown as WorkspaceMember[])
      setProfile((p.data ?? null) as Profile | null)
    }
    setLoading(false)
  }, [userId])

  const loadTeams = useCallback(async () => {
    if (!userId || !activeId) { setTeams([]); setTeamMembers([]); return }

    const t = await supabase.from('teams').select('*')
      .eq('workspace_id', activeId).order('name', { ascending: true })
    if (t.error) { setError(t.error.message); return }

    const rows = (t.data ?? []) as Team[]
    setTeams(rows)

    if (rows.length === 0) { setTeamMembers([]); return }
    const tm = await supabase.from('team_members').select('*, profile:profiles(*)')
      .in('team_id', rows.map(r => r.id))
    if (tm.error) { setError(tm.error.message); return }
    setTeamMembers((tm.data ?? []) as unknown as TeamMember[])
  }, [userId, activeId])

  useEffect(() => { void loadWorkspaces() }, [loadWorkspaces])
  useEffect(() => { void loadTeams() }, [loadTeams])

  const refresh = useCallback(async () => {
    await loadWorkspaces()
    await loadTeams()
  }, [loadWorkspaces, loadTeams])

  // The stored id can point at a workspace that was deleted, archived, or that
  // this account was removed from — in every case fall back to what it can see.
  useEffect(() => {
    if (loading) return
    if (workspaces.length === 0) {
      if (activeId !== null) { setActiveId(null); writeStored(null) }
      return
    }
    if (activeId && workspaces.some(w => w.id === activeId)) return
    const fallback = workspaces.find(w => !w.is_archived) ?? workspaces[0]
    setActiveId(fallback.id)
    writeStored(fallback.id)
  }, [loading, workspaces, activeId])

  const setActiveWorkspace = useCallback((id: string) => {
    setActiveId(id)
    writeStored(id)
  }, [])

  // -------------------------------------------------------------- derived --
  const activeWorkspace = useMemo(
    () => workspaces.find(w => w.id === activeId) ?? null,
    [workspaces, activeId],
  )

  /** The signed-in user's row per workspace — the switcher's role chips. */
  const myMemberships = useMemo(
    () => memberships.filter(row => row.user_id === userId),
    [memberships, userId],
  )

  const roleByWorkspace = useMemo(() => {
    const map = new Map<string, WorkspaceRole>()
    for (const row of myMemberships) map.set(row.workspace_id, row.role)
    return map
  }, [myMemberships])

  /** Every member of the workspace in view, for the team member pickers. */
  const workspaceMembers = useMemo(
    () => (activeId ? memberships.filter(row => row.workspace_id === activeId) : []),
    [memberships, activeId],
  )

  const membersByTeam = useMemo(() => {
    const map = new Map<string, TeamMember[]>()
    for (const row of teamMembers) {
      const list = map.get(row.team_id)
      if (list) list.push(row)
      else map.set(row.team_id, [row])
    }
    return map
  }, [teamMembers])

  const isSuperAdmin = profile?.is_super_admin === true

  const myRole = useCallback(
    (workspaceId: string): WorkspaceRole | null => roleByWorkspace.get(workspaceId) ?? null,
    [roleByWorkspace],
  )

  const isAdmin = useCallback((workspaceId: string): boolean => {
    if (isSuperAdmin) return true
    const role = roleByWorkspace.get(workspaceId)
    return role !== undefined && ADMIN_ROLES.includes(role)
  }, [roleByWorkspace, isSuperAdmin])

  const isTeamLead = useCallback((teamId: string): boolean => {
    const team = teams.find(t => t.id === teamId)
    if (team && isAdmin(team.workspace_id)) return true
    return (membersByTeam.get(teamId) ?? [])
      .some(row => row.user_id === userId && row.role === 'lead')
  }, [teams, membersByTeam, userId, isAdmin])

  // ----------------------------------------------------------- workspaces --
  const createWorkspace = useCallback(async (input: Partial<Workspace>) => {
    if (!userId) return null
    const name = (input.name ?? '').trim()
    if (!name) { setError('A workspace needs a name.'); return null }

    const { data, error: insertError } = await supabase.from('workspaces').insert({
      ...input,
      name,
      slug: input.slug ?? workspaceSlug(name),
      owner_id: userId,
    }).select().single()
    if (insertError) { setError(insertError.message); return null }

    const created = data as Workspace
    // No trigger seats the creator, so claim ownership before anything reads it
    // back — without this row RLS would hide the workspace we just made.
    const seat = await supabase.from('workspace_members')
      .insert({ workspace_id: created.id, user_id: userId, role: 'owner' })
    if (seat.error) setError(seat.error.message)

    await refresh()
    setActiveWorkspace(created.id)
    return created
  }, [userId, refresh, setActiveWorkspace])

  const updateWorkspace = useCallback(async (id: string, patch: Partial<Workspace>) => {
    setWorkspaces(prev => prev.map(w => (w.id === id ? { ...w, ...patch } : w)))
    const { error: updateError } = await supabase.from('workspaces').update(patch).eq('id', id)
    if (updateError) { setError(updateError.message); await loadWorkspaces() }
  }, [loadWorkspaces])

  const archiveWorkspace = useCallback(async (id: string) => {
    await updateWorkspace(id, { is_archived: true })
  }, [updateWorkspace])

  const regenerateJoinCode = useCallback(async (workspaceId: string) => {
    const code = generateJoinCode()
    await updateWorkspace(workspaceId, { join_code: code })
    return code
  }, [updateWorkspace])

  // ---------------------------------------------------------------- teams --
  const createTeam = useCallback(async (input: Partial<Team>) => {
    const workspaceId = input.workspace_id ?? activeId
    if (!workspaceId) { setError('Pick a workspace first.'); return null }
    const name = (input.name ?? '').trim()
    if (!name) { setError('A team needs a name.'); return null }

    const { data, error: insertError } = await supabase.from('teams').insert({
      ...input, name, workspace_id: workspaceId, created_by: userId ?? null,
    }).select().single()
    if (insertError) { setError(insertError.message); return null }

    const created = data as Team
    setTeams(prev => [...prev, created].sort((a, b) => a.name.localeCompare(b.name)))
    return created
  }, [activeId, userId])

  const updateTeam = useCallback(async (id: string, patch: Partial<Team>) => {
    setTeams(prev => prev.map(t => (t.id === id ? { ...t, ...patch } : t)))
    const { error: updateError } = await supabase.from('teams').update(patch).eq('id', id)
    if (updateError) { setError(updateError.message); await loadTeams() }
  }, [loadTeams])

  const deleteTeam = useCallback(async (id: string) => {
    setTeams(prev => prev.filter(t => t.id !== id))
    setTeamMembers(prev => prev.filter(m => m.team_id !== id))
    const { error: deleteError } = await supabase.from('teams').delete().eq('id', id)
    if (deleteError) { setError(deleteError.message); await loadTeams() }
  }, [loadTeams])

  const addTeamMember = useCallback(async (teamId: string, memberId: string, role: TeamRole = 'member') => {
    const { data, error: insertError } = await supabase.from('team_members')
      .insert({ team_id: teamId, user_id: memberId, role })
      .select('*, profile:profiles(*)').single()
    if (insertError) { setError(insertError.message); return null }
    const row = data as unknown as TeamMember
    setTeamMembers(prev => [...prev, row])
    return row
  }, [])

  const updateTeamMember = useCallback(async (id: string, role: TeamRole) => {
    setTeamMembers(prev => prev.map(m => (m.id === id ? { ...m, role } : m)))
    const { error: updateError } = await supabase.from('team_members').update({ role }).eq('id', id)
    if (updateError) { setError(updateError.message); await loadTeams() }
  }, [loadTeams])

  const removeTeamMember = useCallback(async (id: string) => {
    setTeamMembers(prev => prev.filter(m => m.id !== id))
    const { error: deleteError } = await supabase.from('team_members').delete().eq('id', id)
    if (deleteError) { setError(deleteError.message); await loadTeams() }
  }, [loadTeams])

  return {
    workspaces,
    memberships,
    myMemberships,
    workspaceMembers,
    teams,
    teamMembers,
    membersByTeam,
    profile,
    isSuperAdmin,
    activeWorkspace,
    activeWorkspaceId: activeId,
    setActiveWorkspace,
    myRole,
    isAdmin,
    isTeamLead,
    createWorkspace,
    updateWorkspace,
    archiveWorkspace,
    regenerateJoinCode,
    createTeam,
    updateTeam,
    deleteTeam,
    addTeamMember,
    updateTeamMember,
    removeTeamMember,
    refresh,
    loading,
    error,
    clearError: () => setError(null),
  }
}

export type UseWorkspaces = ReturnType<typeof useWorkspaces>
