import { useCallback, useEffect, useState } from 'react'
import { supabase } from '../lib/supabase'
import type { InviteLink, WorkspaceRole } from '../lib/types'

/** What the create form hands over. Everything but the role is optional —
 *  an invite with no expiry and no cap is a plain "anyone with the link". */
export interface NewInvite {
  label?: string | null
  role: WorkspaceRole
  teamId?: string | null
  /** ISO 8601, already converted out of the local-time picker. */
  expiresAt?: string | null
  maxUses?: number | null
}

// No 0/O and no 1/I/l: a token is read aloud and retyped often enough that the
// ambiguous glyphs cost more than the four characters of entropy they add.
const ALPHABET = '23456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnpqrstuvwxyz'
const TOKEN_LENGTH = 22

/** ~127 bits over a 56-character alphabet. Rejection sampling rather than a
 *  plain modulo, so every character stays equally likely. */
function newToken(): string {
  const limit = 256 - (256 % ALPHABET.length)
  let out = ''
  const buf = new Uint8Array(TOKEN_LENGTH * 2)
  while (out.length < TOKEN_LENGTH) {
    crypto.getRandomValues(buf)
    for (const byte of buf) {
      if (byte >= limit) continue
      out += ALPHABET[byte % ALPHABET.length]
      if (out.length === TOKEN_LENGTH) break
    }
  }
  return out
}

/**
 * Build the shareable link for a token.
 *
 * The app is served from a GitHub Pages sub-path (`/project-board/`), so the
 * origin alone would point at somebody else's site. `pathname` carries the base
 * back, and the token rides in the hash: Pages serves a static tree with no
 * rewrite rules, and a hash never reaches the server at all, so it survives the
 * 404-to-index bounce that would swallow a query string.
 */
export function inviteUrl(token: string): string {
  const { origin, pathname } = window.location
  return `${origin}${pathname}#invite=${token}`
}

/** Invite links for one workspace, newest first. Admin-only by RLS — for
 *  everyone else the select simply comes back empty. */
export function useInvites(workspaceId: string | undefined) {
  const [invites, setInvites] = useState<InviteLink[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  const refresh = useCallback(async () => {
    if (!workspaceId) { setInvites([]); setLoading(false); return }
    setLoading(true)
    const { data, error: err } = await supabase
      .from('invite_links')
      .select('*')
      .eq('workspace_id', workspaceId)
      .order('created_at', { ascending: false })
    if (err) setError(err.message)
    else { setError(null); setInvites((data ?? []) as InviteLink[]) }
    setLoading(false)
  }, [workspaceId])

  useEffect(() => { void refresh() }, [refresh])

  const createInvite = useCallback(async (input: NewInvite): Promise<InviteLink | undefined> => {
    if (!workspaceId) return
    const { data: auth } = await supabase.auth.getUser()
    const { data, error: err } = await supabase
      .from('invite_links')
      .insert({
        workspace_id: workspaceId,
        token: newToken(),
        role: input.role,
        team_id: input.teamId || null,
        label: input.label?.trim() || null,
        expires_at: input.expiresAt || null,
        max_uses: input.maxUses ?? null,
        created_by: auth.user?.id ?? null,
      })
      .select()
      .single()
    if (err) { setError(err.message); throw new Error(err.message) }
    const row = data as InviteLink
    setInvites(prev => [row, ...prev])
    return row
  }, [workspaceId])

  /** Revoked rather than deleted: the audit trail still points at the row that
   *  let each existing member in. */
  const revokeInvite = useCallback(async (id: string) => {
    const { data, error: err } = await supabase
      .from('invite_links').update({ revoked: true }).eq('id', id).select().single()
    if (err) { setError(err.message); void refresh(); return }
    const row = data as InviteLink
    setInvites(prev => prev.map(i => (i.id === id ? row : i)))
  }, [refresh])

  return {
    invites, loading, error, refresh, createInvite, revokeInvite, inviteUrl,
    clearError: () => setError(null),
  }
}
