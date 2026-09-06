import { useCallback, useRef, useState } from 'react'
import { supabase } from '../lib/supabase'
import { useAuth } from '../lib/auth'
import type {
  Attachment, AttachmentKind, Comment, Meeting, MeetingAttendee, Mention,
  Profile, RsvpStatus,
} from '../lib/types'

/** A comment with its author profile embedded (`author:profiles(*)`). */
export type CommentRow = Omit<Comment, 'author'> & { author: Profile | null }

/** A meeting with its attendee rows, each carrying the member profile. */
export type MeetingRow = Meeting & { attendees: MeetingAttendee[] }

/** An unread mention joined to the comment that raised it. */
export type MentionRow = Mention & { comment: CommentRow | null }

export interface MeetingInput {
  workspace_id: string
  team_id?: string | null
  title: string
  agenda?: string | null
  starts_at: string
  ends_at: string
  location?: string | null
  meeting_url?: string | null
  provider?: string
}

export interface AttachmentInput {
  task_id?: string | null
  project_id?: string | null
  label: string
  url: string
  kind: AttachmentKind
}

const COMMENT_SELECT = '*, author:profiles(*)'
const MEETING_SELECT = '*, attendees:meeting_attendees(*, profile:profiles(*))'
const MENTION_SELECT = '*, comment:comments(*, author:profiles(*))'

/** Compact relative label that reads the same in both directions:
 *  "3h ago" for the past, "in 2h" for the future. */
export function relativeTime(iso: string): string {
  const ms = new Date(iso).getTime() - Date.now()
  if (Number.isNaN(ms)) return ''
  const mins = Math.round(Math.abs(ms) / 60_000)
  if (mins < 1) return 'just now'
  let unit: string
  if (mins < 60) unit = mins + 'm'
  else if (mins < 1440) unit = Math.floor(mins / 60) + 'h'
  else if (mins < 10_080) unit = Math.floor(mins / 1440) + 'd'
  else unit = Math.floor(mins / 10_080) + 'w'
  return ms >= 0 ? 'in ' + unit : unit + ' ago'
}

/** `timestamptz` to the value a `datetime-local` input expects, in the viewer's
 *  own zone. Built from the local getters so the wall clock never shifts. */
export function isoToLocalInput(iso: string | null | undefined): string {
  if (!iso) return ''
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return ''
  const p = (n: number) => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}T${p(d.getHours())}:${p(d.getMinutes())}`
}

/** The inverse: 'YYYY-MM-DDTHH:mm' is read as local wall time, then serialised
 *  to UTC. Constructing the Date field by field avoids the parser treating a
 *  bare date-time string as UTC, which would shift every meeting by the offset. */
export function localInputToIso(local: string): string | null {
  const m = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})/.exec(local)
  if (!m) return null
  const d = new Date(
    Number(m[1]), Number(m[2]) - 1, Number(m[3]), Number(m[4]), Number(m[5]), 0, 0,
  )
  return Number.isNaN(d.getTime()) ? null : d.toISOString()
}

/**
 * Comments, @mentions, link attachments and meetings: every write the
 * collaboration surfaces need, in one place.
 *
 * Mentions are only recorded here. The scheduled mail job picks up the rows
 * with `notified_at is null` and sends the email, so posting a comment never
 * waits on a mail server.
 */
export function useCollab() {
  const { user } = useAuth()
  const userId = user?.id
  const [busy, setBusy] = useState(0)
  const [error, setError] = useState<string | null>(null)
  // The most recent loader, replayed by `refresh()` with its original arguments.
  const lastLoad = useRef<(() => Promise<unknown>) | null>(null)

  const start = useCallback(() => setBusy(n => n + 1), [])
  const stop = useCallback(() => setBusy(n => Math.max(0, n - 1)), [])

  // ------------------------------------------------------------- comments --

  const loadComments = useCallback(async (taskId: string): Promise<CommentRow[]> => {
    lastLoad.current = () => loadComments(taskId)
    start()
    try {
      const { data, error: err } = await supabase
        .from('comments')
        .select(COMMENT_SELECT)
        .eq('task_id', taskId)
        .order('created_at', { ascending: true })
      if (err) { setError(err.message); return [] }
      setError(null)
      return (data ?? []) as CommentRow[]
    } finally { stop() }
  }, [start, stop])

  /** Insert the comment, then one `mentions` row per person named in it. */
  const addComment = useCallback(async (
    taskId: string, body: string, mentionedUserIds: string[],
  ): Promise<CommentRow | null> => {
    const text = body.trim()
    if (!text) return null
    if (!userId) { setError('Sign in to post a comment.'); return null }
    start()
    try {
      const { data, error: err } = await supabase
        .from('comments')
        .insert({ task_id: taskId, author_id: userId, body: text })
        .select(COMMENT_SELECT)
        .single()
      if (err || !data) { setError(err?.message ?? 'Could not post that comment.'); return null }
      const row = data as CommentRow

      // Mentioning yourself is not a notification worth sending.
      const targets = [...new Set(mentionedUserIds)].filter(id => id && id !== userId)
      if (targets.length > 0) {
        const { error: mErr } = await supabase.from('mentions').insert(
          targets.map(id => ({ comment_id: row.id, mentioned_user_id: id })),
        )
        if (mErr) {
          setError('Comment posted, but the mentions were not recorded: ' + mErr.message)
          return row
        }
      }
      setError(null)
      return row
    } finally { stop() }
  }, [userId, start, stop])

  const deleteComment = useCallback(async (id: string): Promise<boolean> => {
    start()
    try {
      const { error: err } = await supabase.from('comments').delete().eq('id', id)
      if (err) { setError(err.message); return false }
      setError(null)
      return true
    } finally { stop() }
  }, [start, stop])

  // ---------------------------------------------------------- attachments --

  const loadAttachments = useCallback(async (
    scope: { taskId?: string; projectId?: string },
  ): Promise<Attachment[]> => {
    const { taskId, projectId } = scope
    if (!taskId && !projectId) return []
    lastLoad.current = () => loadAttachments(scope)
    start()
    try {
      const base = supabase.from('attachments').select('*')
      const scoped = taskId ? base.eq('task_id', taskId) : base.eq('project_id', projectId as string)
      const { data, error: err } = await scoped.order('created_at', { ascending: true })
      if (err) { setError(err.message); return [] }
      setError(null)
      return (data ?? []) as Attachment[]
    } finally { stop() }
  }, [start, stop])

  const addAttachment = useCallback(async (input: AttachmentInput): Promise<Attachment | null> => {
    start()
    try {
      const { data, error: err } = await supabase
        .from('attachments')
        .insert({ ...input, created_by: userId ?? null })
        .select('*')
        .single()
      if (err || !data) { setError(err?.message ?? 'Could not save that link.'); return null }
      setError(null)
      return data as Attachment
    } finally { stop() }
  }, [userId, start, stop])

  const deleteAttachment = useCallback(async (id: string): Promise<boolean> => {
    start()
    try {
      const { error: err } = await supabase.from('attachments').delete().eq('id', id)
      if (err) { setError(err.message); return false }
      setError(null)
      return true
    } finally { stop() }
  }, [start, stop])

  // ------------------------------------------------------------- meetings --

  const loadMeetings = useCallback(async (workspaceId: string): Promise<MeetingRow[]> => {
    if (!workspaceId) return []
    lastLoad.current = () => loadMeetings(workspaceId)
    start()
    try {
      const { data, error: err } = await supabase
        .from('meetings')
        .select(MEETING_SELECT)
        .eq('workspace_id', workspaceId)
        .order('starts_at', { ascending: true })
      if (err) { setError(err.message); return [] }
      setError(null)
      return (data ?? []) as MeetingRow[]
    } finally { stop() }
  }, [start, stop])

  /** Create the meeting, then the attendee rows the mail job turns into invites. */
  const createMeeting = useCallback(async (
    meeting: MeetingInput, attendeeIds: string[],
  ): Promise<MeetingRow | null> => {
    start()
    try {
      const { data, error: err } = await supabase
        .from('meetings')
        .insert({ ...meeting, created_by: userId ?? null })
        .select('*')
        .single()
      if (err || !data) { setError(err?.message ?? 'Could not create that meeting.'); return null }
      const row = data as Meeting

      // The organiser is always an attendee, and has already accepted.
      const ids = [...new Set([...attendeeIds, ...(userId ? [userId] : [])])].filter(Boolean)
      if (ids.length > 0) {
        const { error: aErr } = await supabase.from('meeting_attendees').insert(
          ids.map(id => ({
            meeting_id: row.id,
            user_id: id,
            response: id === userId ? 'accepted' : 'pending',
          })),
        )
        if (aErr) {
          setError('Meeting created, but the invites were not saved: ' + aErr.message)
          return { ...row, attendees: [] }
        }
      }
      setError(null)
      return (await reloadMeeting(row.id)) ?? { ...row, attendees: [] }
    } finally { stop() }
  }, [userId, start, stop])

  /** Patch the meeting and, when `attendeeIds` is given, reconcile the invite
   *  list: rows that disappeared are removed, new ones are added as pending. */
  const updateMeeting = useCallback(async (
    id: string, patch: Partial<MeetingInput>, attendeeIds?: string[],
  ): Promise<MeetingRow | null> => {
    start()
    try {
      const { error: err } = await supabase.from('meetings').update(patch).eq('id', id)
      if (err) { setError(err.message); return null }

      if (attendeeIds) {
        const wanted = [...new Set([...attendeeIds, ...(userId ? [userId] : [])])].filter(Boolean)
        const { data: current, error: cErr } = await supabase
          .from('meeting_attendees').select('id, user_id').eq('meeting_id', id)
        if (cErr) { setError(cErr.message); return null }
        const existing = (current ?? []) as { id: string; user_id: string }[]
        const gone = existing.filter(a => !wanted.includes(a.user_id)).map(a => a.id)
        const added = wanted.filter(uid => !existing.some(a => a.user_id === uid))
        if (gone.length > 0) await supabase.from('meeting_attendees').delete().in('id', gone)
        if (added.length > 0) {
          await supabase.from('meeting_attendees').insert(added.map(uid => ({
            meeting_id: id, user_id: uid, response: uid === userId ? 'accepted' : 'pending',
          })))
        }
      }
      setError(null)
      return await reloadMeeting(id)
    } finally { stop() }
  }, [userId, start, stop])

  /** Meetings are never deleted. A cancelled row keeps the history and lets the
   *  mail job send the withdrawal notice. */
  const cancelMeeting = useCallback(async (id: string): Promise<MeetingRow | null> => {
    start()
    try {
      const { error: err } = await supabase
        .from('meetings').update({ status: 'cancelled' }).eq('id', id)
      if (err) { setError(err.message); return null }
      setError(null)
      return await reloadMeeting(id)
    } finally { stop() }
  }, [start, stop])

  const rsvp = useCallback(async (meetingId: string, response: RsvpStatus): Promise<boolean> => {
    if (!userId) { setError('Sign in to RSVP.'); return false }
    start()
    try {
      const { error: err } = await supabase
        .from('meeting_attendees')
        .update({ response })
        .eq('meeting_id', meetingId)
        .eq('user_id', userId)
      if (err) { setError(err.message); return false }
      setError(null)
      return true
    } finally { stop() }
  }, [userId, start, stop])

  // ------------------------------------------------------- mentions inbox --

  const myMentions = useCallback(async (limit = 25): Promise<MentionRow[]> => {
    if (!userId) return []
    lastLoad.current = () => myMentions(limit)
    start()
    try {
      const { data, error: err } = await supabase
        .from('mentions')
        .select(MENTION_SELECT)
        .eq('mentioned_user_id', userId)
        .is('read_at', null)
        .order('created_at', { ascending: false })
        .limit(limit)
      if (err) { setError(err.message); return [] }
      setError(null)
      return (data ?? []) as MentionRow[]
    } finally { stop() }
  }, [userId, start, stop])

  const markMentionRead = useCallback(async (id: string): Promise<boolean> => {
    const { error: err } = await supabase
      .from('mentions').update({ read_at: new Date().toISOString() }).eq('id', id)
    if (err) { setError(err.message); return false }
    return true
  }, [])

  const refresh = useCallback(async () => { await lastLoad.current?.() }, [])

  return {
    loading: busy > 0,
    error,
    clearError: () => setError(null),
    refresh,
    loadComments, addComment, deleteComment,
    loadAttachments, addAttachment, deleteAttachment,
    loadMeetings, createMeeting, updateMeeting, cancelMeeting, rsvp,
    myMentions, markMentionRead,
  }
}

/** Re-read one meeting with its attendees, so a caller always gets back the row
 *  the database actually holds rather than an optimistic guess. */
async function reloadMeeting(id: string): Promise<MeetingRow | null> {
  const { data } = await supabase
    .from('meetings').select(MEETING_SELECT).eq('id', id).single()
  return (data as MeetingRow | null) ?? null
}
