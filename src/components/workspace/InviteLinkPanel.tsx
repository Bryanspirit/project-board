import { useEffect, useRef, useState } from 'react'
import type { InviteLink, Team, WorkspaceRole } from '../../lib/types'
import { WORKSPACE_ROLES } from '../../lib/types'
import { useInvites, inviteUrl } from '../../hooks/useInvites'
import { Button, Field, Input, Modal, Select, Spinner, cx } from '../ui'

// -------------------------------------------------------------- state -----

type InviteState = 'active' | 'expired' | 'used-up' | 'revoked'

/** The order matters: a revoked link is revoked whatever its expiry says. */
function stateOf(link: InviteLink): InviteState {
  if (link.revoked) return 'revoked'
  if (link.expires_at && new Date(link.expires_at).getTime() <= Date.now()) return 'expired'
  if (link.max_uses !== null && link.uses >= link.max_uses) return 'used-up'
  return 'active'
}

const STATE_CHIP: Record<InviteState, { label: string; chip: string }> = {
  'active':  { label: 'Active',  chip: 'bg-emerald-50 text-emerald-700 ring-emerald-200 dark:bg-emerald-950/50 dark:text-emerald-300 dark:ring-emerald-900' },
  'expired': { label: 'Expired', chip: 'bg-amber-50 text-amber-700 ring-amber-200 dark:bg-amber-950/50 dark:text-amber-300 dark:ring-amber-900' },
  'used-up': { label: 'Used up', chip: 'bg-slate-100 text-slate-600 ring-slate-200 dark:bg-slate-800 dark:text-slate-300 dark:ring-slate-700' },
  'revoked': { label: 'Revoked', chip: 'bg-rose-50 text-rose-700 ring-rose-200 dark:bg-rose-950/50 dark:text-rose-300 dark:ring-rose-900' },
}

// -------------------------------------------------------------- dates -----

const RELATIVE = new Intl.RelativeTimeFormat(undefined, { numeric: 'auto' })
const STEPS: [Intl.RelativeTimeFormatUnit, number][] = [
  ['minute', 60_000], ['hour', 3_600_000], ['day', 86_400_000],
  ['week', 604_800_000], ['month', 2_629_800_000], ['year', 31_557_600_000],
]

/** "in 3 days" / "2 hours ago" — the shape an admin actually reads. */
function relativeTime(iso: string): string {
  const diff = new Date(iso).getTime() - Date.now()
  let unit: Intl.RelativeTimeFormatUnit = 'minute'
  let span = 60_000
  for (const [u, ms] of STEPS) {
    if (Math.abs(diff) >= ms) { unit = u; span = ms }
  }
  return RELATIVE.format(Math.round(diff / span), unit)
}

const pad = (n: number) => String(n).padStart(2, '0')

/** `datetime-local` speaks wall-clock time with no zone, so the value must be
 *  built from the local getters — `toISOString().slice(0, 16)` would show the
 *  UTC instant instead and shift the time by the viewer's offset. */
function toLocalInput(date: Date): string {
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}` +
    `T${pad(date.getHours())}:${pad(date.getMinutes())}`
}

/** The reverse trip. A bare `YYYY-MM-DDTHH:mm` parses as local time, so the
 *  instant stored is the one the admin picked on their own clock. */
function fromLocalInput(value: string): string | null {
  if (!value) return null
  const at = new Date(value)
  return Number.isNaN(at.getTime()) ? null : at.toISOString()
}

// --------------------------------------------------------------- copy -----

function CopyButton({ url, size = 'sm', variant = 'outline', className }: {
  url: string
  size?: 'sm' | 'md'
  variant?: 'primary' | 'outline'
  className?: string
}) {
  const [copied, setCopied] = useState(false)
  const [failed, setFailed] = useState(false)
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null)

  useEffect(() => () => { if (timer.current) clearTimeout(timer.current) }, [])

  function copy() {
    void navigator.clipboard.writeText(url)
      .then(() => { setFailed(false); setCopied(true) })
      .catch(() => { setCopied(false); setFailed(true) })
      .finally(() => {
        if (timer.current) clearTimeout(timer.current)
        timer.current = setTimeout(() => { setCopied(false); setFailed(false) }, 2000)
      })
  }

  return (
    <Button
      type="button"
      size={size}
      variant={variant}
      className={className}
      onClick={copy}
      title={failed ? 'Clipboard blocked — select the link and copy it by hand' : 'Copy the invite link'}
    >
      {copied ? 'Copied' : failed ? 'Copy failed' : 'Copy'}
    </Button>
  )
}

// -------------------------------------------------------------- panel -----

/**
 * Many links per workspace, where the join code is one. Each carries its own
 * role, team, expiry and cap, so a link can be handed to a single cohort and
 * pulled back later without disturbing anyone else's way in.
 */
export default function InviteLinkPanel({ workspaceId, teams, canManage }: {
  workspaceId: string
  teams: Team[]
  canManage: boolean
}) {
  const { invites, loading, error, createInvite, revokeInvite, clearError } = useInvites(workspaceId)

  const [label, setLabel] = useState('')
  const [role, setRole] = useState<WorkspaceRole>('member')
  const [teamId, setTeamId] = useState('')
  const [expiresLocal, setExpiresLocal] = useState('')
  const [maxUses, setMaxUses] = useState('')

  const [busy, setBusy] = useState(false)
  const [created, setCreated] = useState<InviteLink | null>(null)
  const [confirming, setConfirming] = useState<InviteLink | null>(null)

  async function submit(e: React.FormEvent) {
    e.preventDefault()
    setBusy(true)
    clearError()
    try {
      const parsed = Number.parseInt(maxUses, 10)
      const row = await createInvite({
        label,
        role,
        teamId: teamId || null,
        expiresAt: fromLocalInput(expiresLocal),
        maxUses: Number.isFinite(parsed) && parsed > 0 ? parsed : null,
      })
      if (row) {
        setCreated(row)
        setLabel(''); setTeamId(''); setExpiresLocal(''); setMaxUses('')
      }
    } catch {
      // The hook has already surfaced the message on `error`.
    } finally {
      setBusy(false)
    }
  }

  // Nothing here is even readable without admin rights — the RLS policy on
  // invite_links is admin-only — so the section stays out of the way entirely.
  if (!canManage) return null

  return (
    <section className="rounded-xl bg-slate-50 p-3.5 ring-1 ring-slate-200 dark:bg-slate-950/40 dark:ring-slate-800">
      <h3 className="text-sm font-semibold text-slate-800 dark:text-slate-100">Invite links</h3>
      <p className="mt-0.5 text-xs text-slate-500 dark:text-slate-400">
        Anyone who opens one of these links joins the workspace straight away — no approval step.
      </p>

      {created && (
        <div className="mt-3 rounded-xl bg-indigo-50 p-3 ring-1 ring-indigo-200 dark:bg-indigo-950/40 dark:ring-indigo-900">
          <p className="text-xs font-medium text-indigo-900 dark:text-indigo-200">
            Link ready{created.label ? ` — ${created.label}` : ''}. Send it out; you can revoke it any time.
          </p>
          <div className="mt-2 flex items-center gap-2">
            <Input
              readOnly
              value={inviteUrl(created.token)}
              aria-label="Invite link"
              onFocus={e => e.currentTarget.select()}
              className="min-w-0 flex-1 font-mono text-xs"
            />
            <CopyButton url={inviteUrl(created.token)} size="md" variant="primary" />
            <Button type="button" size="sm" variant="ghost" onClick={() => setCreated(null)}>Done</Button>
          </div>
        </div>
      )}

      <div className="mt-3 space-y-2">
        {loading && (
          <div className="flex items-center gap-2 py-2 text-xs text-slate-500 dark:text-slate-400">
            <Spinner className="h-4 w-4" /> Loading invite links…
          </div>
        )}

        {!loading && invites.length === 0 && (
          <p className="rounded-lg border border-dashed border-slate-300 px-3 py-4 text-center text-xs text-slate-500 dark:border-slate-700 dark:text-slate-400">
            No invite links yet. Create one below.
          </p>
        )}

        {invites.map(link => {
          const state = stateOf(link)
          const chip = STATE_CHIP[state]
          const team = link.team_id ? teams.find(t => t.id === link.team_id) : null
          const roleLabel = WORKSPACE_ROLES.find(r => r.id === link.role)?.label ?? link.role
          return (
            <div
              key={link.id}
              className={cx(
                'rounded-lg bg-white px-3 py-2.5 ring-1 ring-slate-200 dark:bg-slate-900 dark:ring-slate-800',
                state !== 'active' && 'opacity-70',
              )}
            >
              <div className="flex flex-wrap items-start justify-between gap-2">
                <div className="min-w-0">
                  <div className="flex items-center gap-2">
                    <span className="truncate text-sm font-medium text-slate-800 dark:text-slate-100">
                      {link.label || 'Untitled link'}
                    </span>
                    <span className={cx('shrink-0 rounded-full px-2 py-0.5 text-[11px] font-medium ring-1', chip.chip)}>
                      {chip.label}
                    </span>
                  </div>
                  <p className="mt-1 flex flex-wrap items-center gap-x-2 gap-y-0.5 text-xs text-slate-500 dark:text-slate-400">
                    <span>
                      Joins as <span className="font-medium text-slate-600 dark:text-slate-300">{roleLabel}</span>
                    </span>
                    {team && <span aria-hidden="true">·</span>}
                    {team && <span>Team {team.emoji} {team.name}</span>}
                    <span aria-hidden="true">·</span>
                    <span>
                      {link.max_uses === null
                        ? `${link.uses} used, no limit`
                        : `${link.uses} of ${link.max_uses} used`}
                    </span>
                    <span aria-hidden="true">·</span>
                    <span>
                      {link.expires_at
                        ? `${state === 'expired' ? 'Expired' : 'Expires'} ${relativeTime(link.expires_at)}`
                        : 'No expiry'}
                    </span>
                  </p>
                </div>

                <div className="flex shrink-0 items-center gap-1.5">
                  <CopyButton url={inviteUrl(link.token)} />
                  {!link.revoked && (
                    <Button
                      type="button"
                      size="sm"
                      variant="ghost"
                      className="text-rose-600 hover:bg-rose-50 dark:text-rose-400 dark:hover:bg-rose-950/50"
                      onClick={() => setConfirming(link)}
                    >
                      Revoke
                    </Button>
                  )}
                </div>
              </div>
            </div>
          )
        })}
      </div>

      <form onSubmit={submit} className="mt-4 space-y-3 border-t border-slate-200 pt-4 dark:border-slate-800">
        <Field label="Label" hint="For you, not the person joining — “Design cohort”, “Mentors”.">
          <Input value={label} onChange={e => setLabel(e.target.value)} placeholder="Design cohort" maxLength={80} />
        </Field>

        <div className="grid gap-3 sm:grid-cols-2">
          <Field label="Role granted" hint={WORKSPACE_ROLES.find(r => r.id === role)?.blurb}>
            <Select value={role} onChange={e => setRole(e.target.value as WorkspaceRole)}>
              {WORKSPACE_ROLES.map(r => <option key={r.id} value={r.id}>{r.label}</option>)}
            </Select>
          </Field>

          <Field label="Team (optional)" hint="Also drops them into this team.">
            <Select value={teamId} onChange={e => setTeamId(e.target.value)} disabled={teams.length === 0}>
              <option value="">No team</option>
              {teams.map(t => <option key={t.id} value={t.id}>{t.name}</option>)}
            </Select>
          </Field>

          <Field label="Expires (optional)" hint="Your local time. Blank never expires.">
            <Input
              type="datetime-local"
              value={expiresLocal}
              min={toLocalInput(new Date())}
              onChange={e => setExpiresLocal(e.target.value)}
            />
          </Field>

          <Field label="Max uses (optional)" hint="Blank is unlimited.">
            <Input
              type="number"
              min={1}
              step={1}
              inputMode="numeric"
              placeholder="Unlimited"
              value={maxUses}
              onChange={e => setMaxUses(e.target.value)}
            />
          </Field>
        </div>

        <Button type="submit" disabled={busy}>
          {busy && <Spinner className="h-4 w-4" />}
          Create invite link
        </Button>
      </form>

      {error && (
        <p role="alert" className="mt-3 rounded-lg bg-rose-50 px-3 py-2 text-xs text-rose-700 ring-1 ring-rose-200 dark:bg-rose-950/50 dark:text-rose-300 dark:ring-rose-900">
          {error}
        </p>
      )}

      {confirming && (
        <Modal
          title="Revoke this invite link?"
          onClose={() => setConfirming(null)}
          footer={
            <>
              <Button variant="ghost" onClick={() => setConfirming(null)}>Cancel</Button>
              <Button
                variant="danger"
                onClick={() => {
                  const target = confirming
                  setConfirming(null)
                  void revokeInvite(target.id)
                }}
              >
                Revoke link
              </Button>
            </>
          }
        >
          <p className="text-sm leading-relaxed text-slate-600 dark:text-slate-300">
            <span className="font-medium text-slate-800 dark:text-slate-100">
              {confirming.label || 'This link'}
            </span>{' '}
            stops working immediately. Everyone still holding it will be turned away when they open
            it — including the people you have already sent it to. Members who joined through it
            keep their place.
          </p>
        </Modal>
      )}
    </section>
  )
}
