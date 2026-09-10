import { useMemo, useState } from 'react'
import type { Profile, Team } from '../../lib/types'
import { useCollab, isoToLocalInput, localInputToIso } from '../../hooks/useCollab'
import type { MeetingRow } from '../../hooks/useCollab'
import { displayName } from './MentionInput'
import { Button, Field, Input, Modal, Select, Spinner, Textarea, cx } from '../ui'

export const MEETING_PROVIDERS: { id: string; label: string }[] = [
  { id: 'teams', label: 'Microsoft Teams' },
  { id: 'meet', label: 'Google Meet' },
  { id: 'zoom', label: 'Zoom' },
  { id: 'in_person', label: 'In person' },
  { id: 'other', label: 'Other' },
]

export function providerLabel(id: string): string {
  return MEETING_PROVIDERS.find(p => p.id === id)?.label ?? id
}

/** A sensible first slot: the next whole hour, running an hour. */
function defaultSlot(): { start: string; end: string } {
  const start = new Date()
  start.setMinutes(0, 0, 0)
  start.setHours(start.getHours() + 1)
  const end = new Date(start.getTime() + 60 * 60 * 1000)
  return { start: isoToLocalInput(start.toISOString()), end: isoToLocalInput(end.toISOString()) }
}

export interface MeetingDialogProps {
  workspaceId: string
  /** Omitted for a new meeting. */
  meeting?: MeetingRow | null
  /** Workspace members who can be invited. */
  people: Profile[]
  teams?: Team[]
  onClose: () => void
  onSaved?: (meeting: MeetingRow) => void
}

export function MeetingDialog({
  workspaceId, meeting, people, teams = [], onClose, onSaved,
}: MeetingDialogProps) {
  const { createMeeting, updateMeeting } = useCollab()
  const slot = useMemo(defaultSlot, [])

  const [title, setTitle] = useState(meeting?.title ?? '')
  const [agenda, setAgenda] = useState(meeting?.agenda ?? '')
  // Both inputs hold local wall time; the ISO conversion happens only on save.
  const [startsAt, setStartsAt] = useState(
    meeting ? isoToLocalInput(meeting.starts_at) : slot.start,
  )
  const [endsAt, setEndsAt] = useState(
    meeting ? isoToLocalInput(meeting.ends_at) : slot.end,
  )
  const [provider, setProvider] = useState(meeting?.provider ?? 'teams')
  const [meetingUrl, setMeetingUrl] = useState(meeting?.meeting_url ?? '')
  const [location, setLocation] = useState(meeting?.location ?? '')
  const [teamId, setTeamId] = useState(meeting?.team_id ?? '')
  const [attendees, setAttendees] = useState<string[]>(
    () => (meeting?.attendees ?? []).map(a => a.user_id),
  )
  const [problem, setProblem] = useState<string | null>(null)
  const [saving, setSaving] = useState(false)

  const zone = useMemo(() => Intl.DateTimeFormat().resolvedOptions().timeZone, [])

  const toggle = (id: string) =>
    setAttendees(prev => (prev.includes(id) ? prev.filter(x => x !== id) : [...prev, id]))

  const save = async () => {
    if (saving) return
    const name = title.trim()
    if (!name) { setProblem('Give the meeting a title.'); return }
    const startIso = localInputToIso(startsAt)
    const endIso = localInputToIso(endsAt)
    if (!startIso) { setProblem('Pick a start time.'); return }
    if (!endIso) { setProblem('Pick an end time.'); return }
    if (new Date(endIso).getTime() <= new Date(startIso).getTime()) {
      setProblem('The meeting has to end after it starts.')
      return
    }
    if (meetingUrl.trim()) {
      try {
        const parsed = new URL(meetingUrl.trim())
        if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') throw new Error('scheme')
      } catch {
        setProblem('The meeting link must start with http:// or https://')
        return
      }
    }

    setProblem(null)
    setSaving(true)
    const patch = {
      workspace_id: workspaceId,
      team_id: teamId || null,
      title: name,
      agenda: agenda.trim() || null,
      starts_at: startIso,
      ends_at: endIso,
      location: location.trim() || null,
      meeting_url: meetingUrl.trim() || null,
      provider,
    }
    const row = meeting
      ? await updateMeeting(meeting.id, patch, attendees)
      : await createMeeting(patch, attendees)
    setSaving(false)
    if (!row) { setProblem('The meeting could not be saved. Try again.'); return }
    onSaved?.(row)
    onClose()
  }

  return (
    <Modal
      title={meeting ? 'Edit meeting' : 'New meeting'}
      onClose={onClose}
      footer={
        <>
          <Button variant="ghost" onClick={onClose}>Cancel</Button>
          <Button onClick={() => void save()} disabled={saving}>
            {saving && <Spinner className="h-4 w-4" />}
            {meeting ? 'Save meeting' : 'Create meeting'}
          </Button>
        </>
      }
    >
      <Field label="Title">
        <Input value={title} onChange={e => setTitle(e.target.value)} placeholder="Sprint review" autoFocus />
      </Field>

      <Field label="Agenda" hint="What everyone should turn up prepared for.">
        <Textarea rows={3} value={agenda} onChange={e => setAgenda(e.target.value)} />
      </Field>

      <div className="grid gap-3 sm:grid-cols-2">
        <Field label="Starts" hint={zone}>
          <Input
            type="datetime-local"
            value={startsAt}
            onChange={e => {
              const next = e.target.value
              setStartsAt(next)
              setProblem(null)
              // Drag the end along so the duration survives a start change.
              const s = localInputToIso(next)
              const e0 = localInputToIso(startsAt)
              const eEnd = localInputToIso(endsAt)
              if (s && e0 && eEnd) {
                const shifted = new Date(new Date(eEnd).getTime() + (new Date(s).getTime() - new Date(e0).getTime()))
                setEndsAt(isoToLocalInput(shifted.toISOString()))
              }
            }}
          />
        </Field>
        <Field label="Ends">
          <Input
            type="datetime-local"
            value={endsAt}
            min={startsAt}
            onChange={e => { setEndsAt(e.target.value); setProblem(null) }}
          />
        </Field>
      </div>

      <div className="grid gap-3 sm:grid-cols-2">
        <Field label="Where">
          <Select value={provider} onChange={e => setProvider(e.target.value)}>
            {MEETING_PROVIDERS.map(p => <option key={p.id} value={p.id}>{p.label}</option>)}
          </Select>
        </Field>
        <Field label="Team" hint="Optional — narrows who this is for.">
          <Select value={teamId} onChange={e => setTeamId(e.target.value)}>
            <option value="">Whole workspace</option>
            {teams.map(t => <option key={t.id} value={t.id}>{t.name}</option>)}
          </Select>
        </Field>
      </div>

      <Field label="Meeting link">
        <Input
          type="url"
          inputMode="url"
          value={meetingUrl}
          onChange={e => { setMeetingUrl(e.target.value); setProblem(null) }}
          placeholder="https://teams.microsoft.com/…"
        />
      </Field>

      <Field label="Location" hint="Room or address, for anyone joining in person.">
        <Input value={location} onChange={e => setLocation(e.target.value)} placeholder="Room 2A" />
      </Field>

      <fieldset className="space-y-1.5">
        <legend className="mb-1.5 text-xs font-medium text-slate-600 dark:text-slate-400">
          Attendees{attendees.length > 0 && <span className="ml-1 text-slate-400">{attendees.length} selected</span>}
        </legend>
        <div className="max-h-44 space-y-0.5 overflow-y-auto rounded-lg p-1 ring-1 ring-slate-300 dark:ring-slate-700">
          {people.length === 0 ? (
            <p className="px-2 py-3 text-sm text-slate-400">Nobody else is in this workspace yet.</p>
          ) : people.map(p => {
            const on = attendees.includes(p.id)
            return (
              <label
                key={p.id}
                className={cx(
                  'flex cursor-pointer items-center gap-2 rounded px-2 py-1.5 text-sm',
                  on ? 'bg-indigo-50 dark:bg-indigo-950/60' : 'hover:bg-slate-100 dark:hover:bg-slate-800',
                )}
              >
                <input
                  type="checkbox"
                  checked={on}
                  onChange={() => toggle(p.id)}
                  className="h-4 w-4 rounded border-slate-300 text-indigo-600 focus:ring-indigo-500 dark:border-slate-600 dark:bg-slate-800"
                />
                <span className="truncate text-slate-700 dark:text-slate-200">{displayName(p)}</span>
                <span className="ml-auto truncate text-xs text-slate-400">{p.email}</span>
              </label>
            )
          })}
        </div>
        <p className="text-xs text-slate-500 dark:text-slate-400">
          Everyone ticked gets an email invite with a calendar file they can add to their own diary.
        </p>
      </fieldset>

      {problem && <p role="alert" className="text-sm text-rose-600 dark:text-rose-400">{problem}</p>}
    </Modal>
  )
}

export default MeetingDialog
