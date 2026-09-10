import { useState } from 'react'
import { supabase } from '../../lib/supabase'
import { useAuth } from '../../lib/auth'
import { Button, Field, Input, Spinner } from '../ui'

/**
 * Where a password-reset link actually lands.
 *
 * Supabase signs the visitor in with a short-lived recovery session and sends
 * them back here. Without this screen they would drop straight onto the board
 * still holding the password they had forgotten — the reset would appear to
 * work and change nothing.
 */
export default function ResetPassword({ onDone }: { onDone: () => void }) {
  const { signOut } = useAuth()
  const [password, setPassword] = useState('')
  const [confirm, setConfirm] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [done, setDone] = useState(false)

  const tooShort = password.length > 0 && password.length < 6
  const mismatch = confirm.length > 0 && password !== confirm
  const ready = password.length >= 6 && password === confirm

  async function submit(e: React.FormEvent) {
    e.preventDefault()
    if (!ready) return
    setBusy(true)
    setError(null)

    const { error: err } = await supabase.auth.updateUser({ password })
    setBusy(false)

    if (err) {
      // An expired or already-used link is the common case, and the raw
      // message ("Auth session missing") explains nothing.
      setError(/session|expired|invalid/i.test(err.message)
        ? 'That reset link has expired or was already used. Request a new one from the sign-in screen.'
        : err.message)
      return
    }
    setDone(true)
  }

  return (
    <div className="flex min-h-full items-center justify-center bg-gradient-to-br from-slate-50 via-indigo-50/40 to-slate-100 px-4 py-12 dark:from-slate-950 dark:via-indigo-950/20 dark:to-slate-900">
      <div className="w-full max-w-sm">
        <div className="mb-8 text-center">
          <div className="mx-auto mb-4 flex h-12 w-12 items-center justify-center rounded-2xl bg-indigo-600 text-white shadow-lg shadow-indigo-600/25">
            <svg viewBox="0 0 24 24" className="h-6 w-6" fill="none" stroke="currentColor" strokeWidth="1.8" aria-hidden>
              <rect x="4" y="10" width="16" height="10" rx="2" />
              <path d="M8 10V7a4 4 0 0 1 8 0v3" strokeLinecap="round" />
            </svg>
          </div>
          <h1 className="text-xl font-semibold tracking-tight">
            {done ? 'Password changed' : 'Choose a new password'}
          </h1>
          <p className="mt-1 text-sm text-slate-500 dark:text-slate-400">
            {done
              ? 'You are signed in with your new password.'
              : 'Pick something you have not used here before.'}
          </p>
        </div>

        {done ? (
          <div className="space-y-3 rounded-2xl bg-white p-6 shadow-xl ring-1 ring-slate-200 dark:bg-slate-900 dark:ring-slate-800">
            <Button className="w-full" onClick={onDone}>Continue to the board</Button>
            <Button variant="ghost" className="w-full" onClick={() => { onDone(); void signOut() }}>
              Sign out instead
            </Button>
          </div>
        ) : (
          <form onSubmit={submit}
            className="space-y-4 rounded-2xl bg-white p-6 shadow-xl ring-1 ring-slate-200 dark:bg-slate-900 dark:ring-slate-800">
            <Field label="New password" hint="At least 6 characters.">
              <Input
                type="password" autoFocus required minLength={6} autoComplete="new-password"
                value={password} onChange={e => setPassword(e.target.value)} placeholder="••••••••"
                aria-invalid={tooShort || undefined}
              />
            </Field>

            <Field label="Confirm new password">
              <Input
                type="password" required minLength={6} autoComplete="new-password"
                value={confirm} onChange={e => setConfirm(e.target.value)} placeholder="••••••••"
                aria-invalid={mismatch || undefined}
              />
            </Field>

            {mismatch && (
              <p role="alert" className="text-xs text-rose-600 dark:text-rose-400">
                Those two do not match.
              </p>
            )}

            {error && (
              <p role="alert" className="rounded-lg bg-rose-50 px-3 py-2 text-xs text-rose-700 ring-1 ring-rose-200 dark:bg-rose-950/50 dark:text-rose-300 dark:ring-rose-900">
                {error}
              </p>
            )}

            <Button type="submit" disabled={busy || !ready} className="w-full">
              {busy && <Spinner className="h-4 w-4" />}
              Save new password
            </Button>

            <button
              type="button"
              onClick={() => { onDone(); void signOut() }}
              className="w-full text-center text-xs text-slate-500 hover:text-indigo-600 dark:text-slate-400"
            >
              Cancel and sign out
            </button>
          </form>
        )}
      </div>
    </div>
  )
}
