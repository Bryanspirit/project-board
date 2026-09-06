import { useMemo, useState } from 'react'
import type { ReactNode } from 'react'
import { Button, Field, Input, Modal, Select, Textarea, cx } from '../ui'
import { WORKSPACE_ROLES } from '../../lib/types'
import type { Team, Workspace, WorkspaceRole } from '../../lib/types'
import type { AdminAccessRequest, ApproveOptions } from '../../hooks/useAdmin'
import { relativeTime } from '../../hooks/useAdmin'

interface Props {
  requests: AdminAccessRequest[]
  workspaces: Workspace[]
  teams: Team[]
  onApprove: (id: string, opts: ApproveOptions) => Promise<boolean>
  onReject: (id: string, note?: string | null) => Promise<boolean>
}

const STATUS_CHIP: Record<string, string> = {
  approved: 'bg-emerald-50 text-emerald-700 ring-emerald-200 dark:bg-emerald-950 dark:text-emerald-300 dark:ring-emerald-900',
  rejected: 'bg-rose-50 text-rose-700 ring-rose-200 dark:bg-rose-950 dark:text-rose-300 dark:ring-rose-900',
  pending: 'bg-amber-50 text-amber-700 ring-amber-200 dark:bg-amber-950 dark:text-amber-300 dark:ring-amber-900',
}

/** One term/description pair. Blank values are dropped by the caller so the
 *  layout never shows a row of em-dashes. */
function Detail({ term, children }: { term: string; children: ReactNode }) {
  return (
    <div className="min-w-0">
      <dt className="text-xs font-medium tracking-wide text-slate-500 uppercase dark:text-slate-400">{term}</dt>
      <dd className="mt-0.5 text-sm break-words text-slate-800 dark:text-slate-200">{children}</dd>
    </div>
  )
}

function Link({ href }: { href: string }) {
  const label = href.replace(/^https?:\/\/(www\.)?/, '').replace(/\/$/, '')
  return (
    <a href={href} target="_blank" rel="noreferrer noopener"
      className="text-indigo-600 underline underline-offset-2 hover:text-indigo-500 dark:text-indigo-400">
      {label}
    </a>
  )
}

function RequestDetails({ request }: { request: AdminAccessRequest }) {
  const rows: { term: string; value: ReactNode }[] = [
    { term: 'Email', value: <a href={`mailto:${request.email}`} className="text-indigo-600 underline underline-offset-2 dark:text-indigo-400">{request.email}</a> },
    { term: 'Gender', value: request.gender },
    { term: 'Phone', value: request.phone },
    { term: 'Organization', value: request.organization },
    { term: 'Role', value: request.role_title },
    { term: 'Country', value: request.country },
    { term: 'GitHub', value: request.github_url ? <Link href={request.github_url} /> : null },
    { term: 'LinkedIn', value: request.linkedin_url ? <Link href={request.linkedin_url} /> : null },
  ].filter(r => r.value)

  return (
    <>
      <dl className="mt-3 grid grid-cols-2 gap-x-6 gap-y-3 sm:grid-cols-3 lg:grid-cols-4">
        {rows.map(r => <Detail key={r.term} term={r.term}>{r.value}</Detail>)}
      </dl>
      {request.motivation && (
        <div className="mt-4 rounded-lg bg-slate-50 px-3 py-2.5 ring-1 ring-slate-200 dark:bg-slate-800/60 dark:ring-slate-700">
          <p className="text-xs font-medium tracking-wide text-slate-500 uppercase dark:text-slate-400">Motivation</p>
          <p className="mt-1 text-sm whitespace-pre-line text-slate-700 dark:text-slate-200">{request.motivation}</p>
        </div>
      )}
    </>
  )
}

function PendingCard({ request, workspaces, teams, onApprove, onReject }: {
  request: AdminAccessRequest
  workspaces: Workspace[]
  teams: Team[]
  onApprove: Props['onApprove']
  onReject: Props['onReject']
}) {
  const [open, setOpen] = useState(false)
  const [workspaceId, setWorkspaceId] = useState(request.requested_workspace_id ?? '')
  const [role, setRole] = useState<WorkspaceRole>('member')
  const [teamId, setTeamId] = useState('')
  const [note, setNote] = useState('')
  const [rejecting, setRejecting] = useState(false)
  const [rejectNote, setRejectNote] = useState('')
  const [busy, setBusy] = useState(false)

  const wsTeams = useMemo(
    () => teams.filter(t => t.workspace_id === workspaceId),
    [teams, workspaceId],
  )

  const chooseWorkspace = (id: string) => { setWorkspaceId(id); setTeamId('') }

  const approve = async () => {
    setBusy(true)
    const ok = await onApprove(request.id, { workspaceId: workspaceId || null, role, teamId: teamId || null, note })
    setBusy(false)
    if (ok) setOpen(false)
  }

  const reject = async () => {
    setBusy(true)
    await onReject(request.id, rejectNote)
    setBusy(false)
    setRejecting(false)
  }

  return (
    <article className="rounded-xl bg-white p-4 shadow-sm ring-1 ring-slate-200 dark:bg-slate-900 dark:ring-slate-800">
      <header className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <h3 className="truncate text-base font-semibold text-slate-900 dark:text-slate-50">{request.full_name}</h3>
          <p className="mt-0.5 text-xs text-slate-500 dark:text-slate-400">
            Requested {relativeTime(request.created_at)}
          </p>
        </div>
        <div className="flex shrink-0 gap-2">
          <Button size="sm" variant="outline" onClick={() => setRejecting(true)} disabled={busy}>Reject</Button>
          <Button size="sm" onClick={() => setOpen(o => !o)} aria-expanded={open} disabled={busy}>
            {open ? 'Cancel' : 'Approve…'}
          </Button>
        </div>
      </header>

      <RequestDetails request={request} />

      {open && (
        <div className="mt-4 rounded-lg bg-indigo-50/60 p-3 ring-1 ring-indigo-200 dark:bg-indigo-950/40 dark:ring-indigo-900">
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
            <Field label="Workspace">
              <Select value={workspaceId} onChange={e => chooseWorkspace(e.target.value)}>
                <option value="">No workspace (activate only)</option>
                {workspaces.map(w => <option key={w.id} value={w.id}>{w.emoji} {w.name}</option>)}
              </Select>
            </Field>
            <Field label="Role">
              <Select value={role} onChange={e => setRole(e.target.value as WorkspaceRole)}>
                {WORKSPACE_ROLES.map(r => <option key={r.id} value={r.id}>{r.label} — {r.blurb}</option>)}
              </Select>
            </Field>
            <Field label="Team (optional)" hint={workspaceId ? undefined : 'Pick a workspace first'}>
              <Select value={teamId} onChange={e => setTeamId(e.target.value)} disabled={!workspaceId || wsTeams.length === 0}>
                <option value="">No team</option>
                {wsTeams.map(t => <option key={t.id} value={t.id}>{t.emoji} {t.name}</option>)}
              </Select>
            </Field>
            <Field label="Note (optional)">
              <Input value={note} onChange={e => setNote(e.target.value)} placeholder="Shown on the decision" />
            </Field>
          </div>
          <div className="mt-3 flex justify-end gap-2">
            <Button size="sm" variant="ghost" onClick={() => setOpen(false)} disabled={busy}>Cancel</Button>
            <Button size="sm" onClick={() => void approve()} disabled={busy}>
              {busy ? 'Approving…' : 'Approve access'}
            </Button>
          </div>
        </div>
      )}

      {rejecting && (
        <Modal
          title={`Reject ${request.full_name}?`}
          onClose={() => setRejecting(false)}
          footer={
            <>
              <Button variant="ghost" onClick={() => setRejecting(false)} disabled={busy}>Keep pending</Button>
              <Button variant="danger" onClick={() => void reject()} disabled={busy}>
                {busy ? 'Rejecting…' : 'Reject request'}
              </Button>
            </>
          }
        >
          <p className="text-sm text-slate-600 dark:text-slate-300">
            This marks <strong>{request.email}</strong> as rejected and sets their account status to
            {' '}<strong>rejected</strong>. They will not be able to reach any board.
          </p>
          <Field label="Note (optional)" hint="Saved with the decision for the record.">
            <Textarea rows={3} value={rejectNote} onChange={e => setRejectNote(e.target.value)}
              placeholder="Why is this being turned down?" />
          </Field>
        </Modal>
      )}
    </article>
  )
}

function ReviewedRow({ request }: { request: AdminAccessRequest }) {
  return (
    <li className="flex flex-wrap items-center gap-x-3 gap-y-1 px-4 py-2.5 text-sm">
      <span className={cx('rounded-full px-2 py-0.5 text-xs font-medium ring-1', STATUS_CHIP[request.status] ?? STATUS_CHIP.pending)}>
        {request.status}
      </span>
      <span className="font-medium text-slate-800 dark:text-slate-100">{request.full_name}</span>
      <span className="text-slate-500 dark:text-slate-400">{request.email}</span>
      <span className="ml-auto text-xs text-slate-400">{relativeTime(request.reviewed_at ?? request.created_at)}</span>
      {request.decision_note && (
        <p className="w-full text-xs text-slate-500 dark:text-slate-400">Note: {request.decision_note}</p>
      )}
    </li>
  )
}

export default function RequestsQueue({ requests, workspaces, teams, onApprove, onReject }: Props) {
  const [showReviewed, setShowReviewed] = useState(false)
  const pending = requests.filter(r => r.status === 'pending')
  const reviewed = requests.filter(r => r.status !== 'pending')

  return (
    <div className="space-y-6">
      <section aria-labelledby="pending-heading" className="space-y-3">
        <h2 id="pending-heading" className="text-sm font-semibold text-slate-700 dark:text-slate-200">
          Pending {pending.length > 0 && <span className="text-slate-400">({pending.length})</span>}
        </h2>
        {pending.length === 0 ? (
          <div className="rounded-xl border border-dashed border-slate-300 px-6 py-12 text-center dark:border-slate-700">
            <p className="text-sm font-medium text-slate-700 dark:text-slate-200">The queue is clear</p>
            <p className="mt-1 text-sm text-slate-500 dark:text-slate-400">
              Every access request has been reviewed. New signups will land here.
            </p>
          </div>
        ) : (
          pending.map(r => (
            <PendingCard key={r.id} request={r} workspaces={workspaces} teams={teams}
              onApprove={onApprove} onReject={onReject} />
          ))
        )}
      </section>

      {reviewed.length > 0 && (
        <section aria-labelledby="reviewed-heading">
          <button
            id="reviewed-heading"
            onClick={() => setShowReviewed(s => !s)}
            aria-expanded={showReviewed}
            className="flex w-full items-center gap-2 rounded-lg px-1 py-2 text-sm font-semibold text-slate-700 transition hover:text-slate-900 dark:text-slate-200 dark:hover:text-white"
          >
            <svg viewBox="0 0 20 20" className={cx('h-4 w-4 transition', showReviewed && 'rotate-90')}
              fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true">
              <path d="M7 4l6 6-6 6" strokeLinecap="round" strokeLinejoin="round" />
            </svg>
            Already reviewed <span className="font-normal text-slate-400">({reviewed.length})</span>
          </button>
          {showReviewed && (
            <ul className="divide-y divide-slate-200 overflow-hidden rounded-xl bg-white ring-1 ring-slate-200 dark:divide-slate-800 dark:bg-slate-900 dark:ring-slate-800">
              {reviewed.map(r => <ReviewedRow key={r.id} request={r} />)}
            </ul>
          )}
        </section>
      )}
    </div>
  )
}
