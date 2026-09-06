import { useEffect, useMemo, useState } from 'react'
import type { MeetingAttendee, Profile, RsvpStatus, Team } from '../../lib/types'
import { useAuth } from '../../lib/auth'
import { useCollab, relativeTime } from '../../hooks/useCollab'
import type { MeetingRow } from '../../hooks/useCollab'
import { MeetingDialog, providerLabel } from './MeetingDialog'
import { displayName } from './MentionInput'
import { Button, Spinner, cx } from '../ui'

const DATE_OPTS: Intl.DateTimeFormatOptions = { weekday: 'short', month: 'short', day: 'numeric' }
const TIME_OPTS: Intl.DateTimeFormatOptions = { hour: 'numeric', minute: '2-digit' }

/** Rendered with the browser's own locale and zone, so a meeting created in
 *  Accra reads correctly for someone opening the board in Berlin. */
function formatRange(startIso: string, endIso: string): string {
  const s = new Date(startIso)
  const e = new Date(endIso)
  if (Number.isNaN(s.getTime()) || Number.isNaN(e.getTime())) return ''
  const sameDay = s.toDateString() === e.toDateString()
  if (sameDay) {
    return `${s.toLocaleDateString(undefined, DATE_OPTS)}, ` +
      `${s.toLocaleTimeString(undefined, TIME_OPTS)} – ${e.toLocaleTimeString(undefined, TIME_OPTS)}`
  }
  const both = { ...DATE_OPTS, ...TIME_OPTS }
  return `${s.toLocaleString(undefined, both)} – ${e.toLocaleString(undefined, both)}`
}

function AttendeeAvatars({ attendees, people }: { attendees: MeetingAttendee[]; people: Profile[] }) {
  const nameOf = (a: MeetingAttendee) =>
    (a.profile ? displayName(a.profile) : people.find(p => p.id === a.user_id)?.full_name) ?? '?'
  const shown = attendees.slice(0, 5)
  const extra = attendees.length - shown.length
  if (attendees.length === 0) return null
  return (
    <div className="flex items-center -space-x-1.5">
      {shown.map(a => {
        const name = nameOf(a)
        return (
          <span
            key={a.id}
            title={`${name} — ${a.response}`}
            className={cx(
              'flex h-6 w-6 items-center justify-center rounded-full text-[10px] font-semibold ring-2 ring-white dark:ring-slate-900',
              a.response === 'accepted' && 'bg-emerald-100 text-emerald-800 dark:bg-emerald-900 dark:text-emerald-200',
              a.response === 'declined' && 'bg-rose-100 text-rose-700 line-through dark:bg-rose-950 dark:text-rose-300',
              a.response === 'pending' && 'bg-slate-200 text-slate-600 dark:bg-slate-700 dark:text-slate-200',
            )}
          >
            {name.charAt(0).toUpperCase()}
          </span>
        )
      })}
      {extra > 0 && (
        <span className="flex h-6 w-6 items-center justify-center rounded-full bg-slate-100 text-[10px] font-semibold text-slate-500 ring-2 ring-white dark:bg-slate-800 dark:text-slate-400 dark:ring-slate-900">
          +{extra}
        </span>
      )}
    </div>
  )
}

interface RowProps {
  meeting: MeetingRow
  people: Profile[]
  past: boolean
  canManage: boolean
  myId: string | undefined
  onRsvp: (id: string, response: RsvpStatus) => void
  onEdit: (m: MeetingRow) => void
  onCancel: (id: string) => void
}

function MeetingCard({ meeting, people, past, canManage, myId, onRsvp, onEdit, onCancel }: RowProps) {
  const [confirm, setConfirm] = useState(false)
  const cancelled = meeting.status === 'cancelled'
  const mine = meeting.attendees.find(a => a.user_id === myId)
  const organiser = meeting.created_by === myId

  return (
    <li
      className={cx(
        'rounded-xl bg-white p-3 ring-1 ring-slate-200 dark:bg-slate-900 dark:ring-slate-800',
        past && 'opacity-70',
      )}
    >
      <div className="flex flex-wrap items-start gap-x-2 gap-y-1">
        <h4
          className={cx(
            'min-w-0 flex-1 truncate text-sm font-semibold text-slate-800 dark:text-slate-100',
            cancelled && 'line-through decoration-rose-500',
          )}
        >
          {meeting.title}
        </h4>
        <span className="shrink-0 rounded-full bg-slate-100 px-2 py-0.5 text-[11px] font-medium text-slate-600 dark:bg-slate-800 dark:text-slate-300">
          {providerLabel(meeting.provider)}
        </span>
        {cancelled ? (
          <span className="shrink-0 rounded-full bg-rose-50 px-2 py-0.5 text-[11px] font-medium text-rose-700 dark:bg-rose-950 dark:text-rose-300">
            Cancelled
          </span>
        ) : !past && (
          <span className="shrink-0 rounded-full bg-indigo-50 px-2 py-0.5 text-[11px] font-medium text-indigo-700 dark:bg-indigo-950 dark:text-indigo-300">
            {relativeTime(meeting.starts_at)}
          </span>
        )}
      </div>

      <p className={cx('mt-0.5 text-xs text-slate-500 dark:text-slate-400', cancelled && 'line-through')}>
        {formatRange(meeting.starts_at, meeting.ends_at)}
        {meeting.location && <span> · {meeting.location}</span>}
      </p>

      {meeting.agenda && (
        <p className="mt-1.5 whitespace-pre-wrap break-words text-xs text-slate-600 dark:text-slate-300">
          {meeting.agenda}
        </p>
      )}

      <div className="mt-2 flex flex-wrap items-center gap-2">
        <AttendeeAvatars attendees={meeting.attendees} people={people} />

        {!cancelled && meeting.meeting_url && (
          <a
            href={meeting.meeting_url}
            target="_blank"
            rel="noreferrer noopener"
            className="rounded-lg bg-indigo-600 px-2.5 py-1.5 text-xs font-medium text-white transition hover:bg-indigo-500"
          >
            Join
          </a>
        )}

        {!cancelled && !past && mine && (
          <div className="flex items-center gap-1" role="group" aria-label="Your response">
            <button
              type="button"
              onClick={() => onRsvp(meeting.id, 'accepted')}
              aria-pressed={mine.response === 'accepted'}
              className={cx(
                'rounded-lg px-2 py-1 text-xs font-medium ring-1 transition',
                mine.response === 'accepted'
                  ? 'bg-emerald-600 text-white ring-emerald-600'
                  : 'text-slate-600 ring-slate-300 hover:bg-slate-100 dark:text-slate-300 dark:ring-slate-700 dark:hover:bg-slate-800',
              )}
            >
              Accept
            </button>
            <button
              type="button"
              onClick={() => onRsvp(meeting.id, 'declined')}
              aria-pressed={mine.response === 'declined'}
              className={cx(
                'rounded-lg px-2 py-1 text-xs font-medium ring-1 transition',
                mine.response === 'declined'
                  ? 'bg-rose-600 text-white ring-rose-600'
                  : 'text-slate-600 ring-slate-300 hover:bg-slate-100 dark:text-slate-300 dark:ring-slate-700 dark:hover:bg-slate-800',
              )}
            >
              Decline
            </button>
          </div>
        )}

        {(canManage || organiser) && !cancelled && (
          <div className="ml-auto flex items-center gap-1.5 text-xs">
            <button
              type="button"
              onClick={() => onEdit(meeting)}
              className="text-slate-500 transition hover:text-indigo-600 dark:hover:text-indigo-400"
            >
              Edit
            </button>
            {confirm ? (
              <span className="flex items-center gap-1.5 text-slate-500">
                Cancel it?
                <button
                  type="button"
                  onClick={() => { setConfirm(false); onCancel(meeting.id) }}
                  className="font-medium text-rose-600 hover:underline dark:text-rose-400"
                >
                  Yes
                </button>
                <button type="button" onClick={() => setConfirm(false)} className="hover:underline">No</button>
              </span>
            ) : (
              <button
                type="button"
                onClick={() => setConfirm(true)}
                className="text-slate-500 transition hover:text-rose-600 dark:hover:text-rose-400"
              >
                Cancel
              </button>
            )}
          </div>
        )}
      </div>
    </li>
  )
}

export interface MeetingListProps {
  workspaceId: string
  people: Profile[]
  teams?: Team[]
  /** Owners and admins can edit or cancel any meeting, not just their own. */
  canManage: boolean
}

export function MeetingList({ workspaceId, people, teams = [], canManage }: MeetingListProps) {
  const { user } = useAuth()
  const { error, loadMeetings, cancelMeeting, rsvp } = useCollab()
  const [rows, setRows] = useState<MeetingRow[]>([])
  const [ready, setReady] = useState(false)
  const [showPast, setShowPast] = useState(false)
  const [editing, setEditing] = useState<MeetingRow | null>(null)
  const [creating, setCreating] = useState(false)

  useEffect(() => {
    let alive = true
    setReady(false)
    void loadMeetings(workspaceId).then(list => {
      if (!alive) return
      setRows(list)
      setReady(true)
    })
    return () => { alive = false }
  }, [workspaceId, loadMeetings])

  // Split once per load rather than per render, so a row cannot hop between the
  // two lists mid-interaction.
  const { upcoming, past } = useMemo(() => {
    const now = Date.now()
    const up: MeetingRow[] = []
    const old: MeetingRow[] = []
    for (const m of rows) {
      if (new Date(m.ends_at).getTime() >= now) up.push(m)
      else old.push(m)
    }
    old.reverse()
    return { upcoming: up, past: old }
  }, [rows])

  const replace = (row: MeetingRow) =>
    setRows(prev => {
      const next = prev.some(m => m.id === row.id)
        ? prev.map(m => (m.id === row.id ? row : m))
        : [...prev, row]
      return next.sort((a, b) => new Date(a.starts_at).getTime() - new Date(b.starts_at).getTime())
    })

  const onRsvp = async (id: string, response: RsvpStatus) => {
    if (!user) return
    // Optimistic: the RSVP buttons should feel instant.
    setRows(prev => prev.map(m => (m.id !== id ? m : {
      ...m,
      attendees: m.attendees.map(a => (a.user_id === user.id ? { ...a, response } : a)),
    })))
    const ok = await rsvp(id, response)
    if (!ok) setRows(await loadMeetings(workspaceId))
  }

  const onCancel = async (id: string) => {
    const row = await cancelMeeting(id)
    if (row) replace(row)
  }

  return (
    <section className="space-y-3" aria-label="Meetings">
      <div className="flex items-center justify-between">
        <h3 className="text-xs font-semibold uppercase tracking-wide text-slate-500 dark:text-slate-400">
          Meetings
        </h3>
        {canManage && (
          <Button size="sm" variant="outline" onClick={() => setCreating(true)}>New meeting</Button>
        )}
      </div>

      {error && <p role="alert" className="text-xs text-rose-600 dark:text-rose-400">{error}</p>}

      {!ready ? (
        <div className="flex items-center gap-2 py-4 text-sm text-slate-500">
          <Spinner className="h-4 w-4" /> Loading the calendar…
        </div>
      ) : upcoming.length === 0 ? (
        <p className="rounded-lg border border-dashed border-slate-300 px-3 py-4 text-center text-sm text-slate-500 dark:border-slate-700 dark:text-slate-400">
          Nothing on the calendar. {canManage ? 'Schedule the next stand-up or review.' : 'You will see invites here.'}
        </p>
      ) : (
        <ul className="space-y-2">
          {upcoming.map(m => (
            <MeetingCard
              key={m.id} meeting={m} people={people} past={false}
              canManage={canManage} myId={user?.id}
              onRsvp={(id, r) => void onRsvp(id, r)}
              onEdit={setEditing}
              onCancel={id => void onCancel(id)}
            />
          ))}
        </ul>
      )}

      {past.length > 0 && (
        <div>
          <button
            type="button"
            onClick={() => setShowPast(v => !v)}
            aria-expanded={showPast}
            className="flex items-center gap-1.5 text-xs font-medium text-slate-500 transition hover:text-slate-800 dark:hover:text-slate-200"
          >
            <svg
              viewBox="0 0 20 20" aria-hidden="true"
              className={cx('h-3 w-3 transition-transform', showPast && 'rotate-90')}
              fill="none" stroke="currentColor" strokeWidth="2"
            >
              <path d="M7 4l6 6-6 6" strokeLinecap="round" strokeLinejoin="round" />
            </svg>
            Past meetings ({past.length})
          </button>
          {showPast && (
            <ul className="mt-2 space-y-2">
              {past.map(m => (
                <MeetingCard
                  key={m.id} meeting={m} people={people} past
                  canManage={canManage} myId={user?.id}
                  onRsvp={(id, r) => void onRsvp(id, r)}
                  onEdit={setEditing}
                  onCancel={id => void onCancel(id)}
                />
              ))}
            </ul>
          )}
        </div>
      )}

      {(creating || editing) && (
        <MeetingDialog
          workspaceId={workspaceId}
          meeting={editing}
          people={people}
          teams={teams}
          onClose={() => { setCreating(false); setEditing(null) }}
          onSaved={replace}
        />
      )}
    </section>
  )
}

export default MeetingList
