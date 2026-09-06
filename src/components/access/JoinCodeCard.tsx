import { useState } from 'react'
import { supabase } from '../../lib/supabase'
import { useAuth } from '../../lib/auth'
import { Button, Field, Input, Spinner } from '../ui'

/** Shape of the jsonb the `redeem_join_code` SQL function hands back. */
interface RedeemResult {
  ok: boolean
  error?: string
  workspace_id?: string
  name?: string
}

export default function JoinCodeCard({ onJoined }: { onJoined: () => void }) {
  const { user } = useAuth()
  const [code, setCode] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [joined, setJoined] = useState<string | null>(null)

  async function redeem(e: React.FormEvent) {
    e.preventDefault()
    setBusy(true); setError(null)
    try {
      // The code is stored case-insensitively but with its own spacing, so the
      // uppercasing stays purely visual and only the trim goes to the server.
      const { data, error } = await supabase.rpc('redeem_join_code', { code: code.trim() })
      if (error) throw error
      const result = data as RedeemResult | null
      if (!result?.ok) throw new Error(result?.error || 'That code is not valid.')
      setJoined(result.name ?? 'the workspace')
      onJoined()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not redeem that code.')
    } finally {
      setBusy(false)
    }
  }

  if (joined) {
    return (
      <div role="status" className="rounded-xl bg-emerald-50 p-4 text-sm text-emerald-800 ring-1 ring-emerald-200 dark:bg-emerald-950/40 dark:text-emerald-200 dark:ring-emerald-900">
        You’re in — welcome to <span className="font-semibold">{joined}</span>. Loading your board…
      </div>
    )
  }

  return (
    <form onSubmit={redeem} className="rounded-xl bg-slate-50 p-4 ring-1 ring-slate-200 dark:bg-slate-950/40 dark:ring-slate-800">
      <h3 className="text-sm font-semibold text-slate-800 dark:text-slate-100">Have a join code?</h3>
      <p className="mt-1 mb-3 text-xs text-slate-500 dark:text-slate-400">
        A workspace code skips the approval queue and drops you straight into that workspace.
      </p>

      <div className="flex items-end gap-2">
        <div className="flex-1">
          <Field label="Join code">
            <Input
              value={code}
              onChange={e => setCode(e.target.value.toUpperCase())}
              placeholder="HACK-2026"
              autoComplete="off"
              spellCheck={false}
              className="font-mono tracking-widest uppercase"
            />
          </Field>
        </div>
        <Button type="submit" disabled={busy || !code.trim()}>
          {busy && <Spinner className="h-4 w-4" />}
          Join
        </Button>
      </div>

      {!user && (
        <p className="mt-3 text-xs text-slate-500 dark:text-slate-400">
          Sign in first — or request access below — then redeem the code from this screen.
        </p>
      )}

      {error && (
        <p role="alert" className="mt-3 rounded-lg bg-rose-50 px-3 py-2 text-xs text-rose-700 ring-1 ring-rose-200 dark:bg-rose-950/50 dark:text-rose-300 dark:ring-rose-900">
          {error}
        </p>
      )}
    </form>
  )
}
