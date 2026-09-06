import { useCallback, useEffect, useRef, useState } from 'react'
import { supabase } from '../../lib/supabase'
import { useAuth } from '../../lib/auth'
import { Button, Modal, Spinner } from '../ui'

const STORAGE_KEY = 'pending-invite-token'

// sessionStorage is unavailable in a few hardened browser configurations, and
// throws rather than returning null. An invite is a convenience, not a
// requirement, so every access is best-effort.
function stash(token: string) {
  try { sessionStorage.setItem(STORAGE_KEY, token) } catch { /* ignore */ }
}

function unstash(): string | null {
  try {
    const token = sessionStorage.getItem(STORAGE_KEY)
    sessionStorage.removeItem(STORAGE_KEY)
    return token
  } catch { return null }
}

/**
 * Read `#invite=<token>` out of the address bar, remember it, and take it back
 * out of the URL. Stripping matters: without it a refresh — or the redirect the
 * auth flow performs — would re-enter this screen and spend a second use of a
 * capped link. Call once at startup, before anything else reads the hash.
 */
export function captureInviteFromUrl(): string | null {
  const match = /(?:^|[#&])invite=([^&]+)/.exec(window.location.hash)
  if (!match) return null
  const token = decodeURIComponent(match[1])
  stash(token)
  window.history.replaceState(null, '', window.location.pathname + window.location.search)
  return token
}

/** The token held over a sign-in, read once and cleared. */
export function pendingInviteToken(): string | null {
  return unstash()
}

/** Shape of the jsonb `redeem_invite_link` hands back. */
interface RedeemResult {
  ok: boolean
  error?: string
  workspace_id?: string
  team_id?: string | null
}

type Phase =
  | { kind: 'signed-out' }
  | { kind: 'working' }
  | { kind: 'joined'; workspace: string }
  | { kind: 'refused'; reason: string }

/**
 * The landing screen for someone arriving on an invite link. Signed in, it
 * redeems immediately — the link *is* the approval. Signed out, it holds the
 * token so the redemption can happen the moment they have an account.
 */
export default function AcceptInvite({ token, onAccepted, onDismiss }: {
  token: string
  onAccepted: () => void
  onDismiss: () => void
}) {
  const { user, loading: authLoading } = useAuth()
  const [phase, setPhase] = useState<Phase>({ kind: 'working' })
  // React runs effects twice in development; a second redemption would burn a
  // use of the link, so the attempt is latched rather than merely debounced.
  const attempted = useRef(false)

  const dismiss = useCallback(() => {
    unstash()
    onDismiss()
  }, [onDismiss])

  useEffect(() => {
    if (authLoading) return

    if (!user) {
      // Survive the round trip through the sign-in screen.
      stash(token)
      setPhase({ kind: 'signed-out' })
      return
    }

    if (attempted.current) return
    attempted.current = true

    void (async () => {
      setPhase({ kind: 'working' })
      try {
        const { data, error } = await supabase.rpc('redeem_invite_link', { link_token: token })
        if (error) throw error
        const result = data as RedeemResult | null
        if (!result?.ok) {
          setPhase({ kind: 'refused', reason: result?.error || 'That invite link is not valid.' })
          unstash()
          return
        }
        // Membership exists by now, so the workspace is finally readable and
        // the confirmation can name the place they actually landed.
        let name = 'the workspace'
        if (result.workspace_id) {
          const { data: ws } = await supabase
            .from('workspaces').select('name').eq('id', result.workspace_id).maybeSingle()
          const row = ws as { name: string } | null
          if (row?.name) name = row.name
        }
        unstash()
        setPhase({ kind: 'joined', workspace: name })
        onAccepted()
      } catch (err) {
        setPhase({
          kind: 'refused',
          reason: err instanceof Error ? err.message : 'Could not redeem that invite link.',
        })
      }
    })()
  }, [authLoading, user, token, onAccepted])

  const title =
    phase.kind === 'joined' ? 'Invite accepted'
    : phase.kind === 'refused' ? 'That invite did not work'
    : phase.kind === 'signed-out' ? 'You have been invited'
    : 'Accepting your invite'

  return (
    <Modal
      title={title}
      onClose={dismiss}
      footer={
        phase.kind === 'working' ? null : (
          <Button variant={phase.kind === 'joined' ? 'primary' : 'outline'} onClick={dismiss}>
            {phase.kind === 'joined' ? 'Go to the workspace' : 'Close'}
          </Button>
        )
      }
    >
      {phase.kind === 'working' && (
        <div className="flex items-center gap-3 text-sm text-slate-600 dark:text-slate-300">
          <Spinner className="h-5 w-5 text-indigo-500" />
          Checking your invite and adding you to the workspace…
        </div>
      )}

      {phase.kind === 'signed-out' && (
        <div className="space-y-3">
          <p className="text-sm leading-relaxed text-slate-600 dark:text-slate-300">
            Sign in — or request access, if this is your first time here — and this invite
            will be applied the moment your account is ready. Nothing else to enter.
          </p>
          <p className="rounded-lg bg-slate-50 px-3 py-2 text-xs text-slate-500 ring-1 ring-slate-200 dark:bg-slate-950/40 dark:text-slate-400 dark:ring-slate-800">
            Your invite is held for this browser tab only. If you close it, open the link again.
          </p>
        </div>
      )}

      {phase.kind === 'joined' && (
        <div role="status" className="rounded-xl bg-emerald-50 p-4 text-sm leading-relaxed text-emerald-800 ring-1 ring-emerald-200 dark:bg-emerald-950/40 dark:text-emerald-200 dark:ring-emerald-900">
          You’re in — welcome to <span className="font-semibold">{phase.workspace}</span>.
          It is on your workspace list now.
        </div>
      )}

      {phase.kind === 'refused' && (
        <div className="space-y-3">
          <p role="alert" className="rounded-xl bg-rose-50 p-4 text-sm leading-relaxed text-rose-700 ring-1 ring-rose-200 dark:bg-rose-950/50 dark:text-rose-300 dark:ring-rose-900">
            {phase.reason}
          </p>
          <p className="text-xs text-slate-500 dark:text-slate-400">
            Ask whoever sent it for a fresh link — invites can be revoked, time-limited or
            capped to a set number of people.
          </p>
        </div>
      )}
    </Modal>
  )
}
