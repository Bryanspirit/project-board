import { useEffect, useState } from 'react'
import { supabase } from '../../lib/supabase'
import { useAuth } from '../../lib/auth'
import type { MemberStatus, Profile } from '../../lib/types'
import { Button } from '../ui'
import JoinCodeCard from './JoinCodeCard'

const COPY: Record<Exclude<MemberStatus, 'active'>, { title: string; body: string; tone: string }> = {
  pending: {
    title: 'We’re reviewing your request',
    body: 'Your account exists, it just isn’t switched on yet. An administrator looks at every request by hand and picks the workspace you belong in. This page unlocks itself the moment that happens — no need to refresh.',
    tone: 'bg-amber-100 dark:bg-amber-950',
  },
  rejected: {
        title: 'Your request wasn’t approved',
    body: 'An administrator reviewed your request and decided not to grant access this time. If you were given a join code by an organiser, you can still use it below.',
    tone: 'bg-rose-100 dark:bg-rose-950',
  },
  suspended: {
        title: 'Your account is suspended',
    body: 'Access to this workspace has been paused. Contact the administrator who invited you to have it restored — a join code will not lift a suspension.',
    tone: 'bg-slate-200 dark:bg-slate-800',
  },
}

/** `profile` may be null in the seconds between signup and the trigger writing
 *  the row, so an absent profile is treated as the pending case. */
export default function PendingApproval({ profile, onActivated }: {
  profile: Profile | null
  onActivated: () => void
}) {
  const { user, signOut } = useAuth()
  const [note, setNote] = useState<string | null>(null)
  const status: Exclude<MemberStatus, 'active'> =
    profile && profile.status !== 'active' ? profile.status : 'pending'

  // Approval happens in another browser entirely, so nothing pushes it to us —
  // poll until the status flips rather than making the user reload.
  useEffect(() => {
    if (!user) return
    const tick = async () => {
      const { data } = await supabase
        .from('profiles').select('status').eq('id', user.id).maybeSingle()
      if ((data as { status?: MemberStatus } | null)?.status === 'active') onActivated()
    }
    const id = window.setInterval(tick, 20_000)
    return () => window.clearInterval(id)
  }, [user, onActivated])

  // The rejection reason lives on the request, not the profile.
  useEffect(() => {
    if (status !== 'rejected' || !user) return
    let live = true
    supabase
      .from('access_requests')
      .select('decision_note')
      .eq('user_id', user.id)
      .order('created_at', { ascending: false })
      .limit(1)
      .maybeSingle()
      .then(({ data }) => {
        if (live) setNote((data as { decision_note?: string | null } | null)?.decision_note ?? null)
      })
    return () => { live = false }
  }, [status, user])

  const copy = COPY[status]

  return (
    <div className="flex min-h-full items-center justify-center bg-gradient-to-br from-slate-50 via-indigo-50/40 to-slate-100 px-4 py-12 dark:from-slate-950 dark:via-indigo-950/20 dark:to-slate-900">
      <div className="w-full max-w-md space-y-4">
        <div className="rounded-2xl bg-white p-6 text-center shadow-xl shadow-slate-200/60 ring-1 ring-slate-200 dark:bg-slate-900 dark:shadow-none dark:ring-slate-800">
          <div className={`mx-auto mb-4 flex h-12 w-12 items-center justify-center rounded-2xl text-2xl ${copy.tone}`}>
          </div>
          <h1 className="text-lg font-semibold tracking-tight">{copy.title}</h1>
          <p className="mt-2 text-sm text-slate-500 dark:text-slate-400">{copy.body}</p>

          {profile?.email && (
            <p className="mt-4 text-xs text-slate-400 dark:text-slate-500">
              Signed in as <span className="font-medium text-slate-600 dark:text-slate-300">{profile.email}</span>
            </p>
          )}

          {note && (
            <p className="mt-4 rounded-lg bg-slate-50 px-3 py-2 text-left text-xs text-slate-600 ring-1 ring-slate-200 dark:bg-slate-950/50 dark:text-slate-300 dark:ring-slate-800">
              <span className="font-medium">Reviewer’s note:</span> {note}
            </p>
          )}

          <Button variant="outline" className="mt-5 w-full" onClick={() => { void signOut() }}>
            Sign out
          </Button>
        </div>

        {status !== 'suspended' && <JoinCodeCard onJoined={onActivated} />}
      </div>
    </div>
  )
}
