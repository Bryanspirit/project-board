import { useState } from 'react'
import { supabase } from '../lib/supabase'
import { Button, Field, Input, Spinner } from './ui'
import { BrandMark } from './Mark'

import RequestAccessForm from './access/RequestAccessForm'

type Mode = 'signin' | 'request' | 'reset'

const COPY: Record<Mode, { title: string; sub: string; cta: string }> = {
  signin:  { title: 'Welcome back',   sub: 'Sign in to open your board.',                              cta: 'Sign in' },
  request: { title: 'Request access', sub: 'Membership is approved by hand. Tell us who you are.',      cta: 'Request access' },
  reset:   { title: 'Reset password', sub: "We'll email you a link to set a new one.",                  cta: 'Send reset link' },
}

export default function LoginPage() {
  const [mode, setMode] = useState<Mode>('signin')
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [notice, setNotice] = useState<string | null>(null)

  const switchTo = (next: Mode) => { setMode(next); setError(null); setNotice(null) }

  async function submit(e: React.FormEvent) {
    e.preventDefault()
    setBusy(true); setError(null); setNotice(null)

    try {
      if (mode === 'signin') {
        const { error } = await supabase.auth.signInWithPassword({ email, password })
        if (error) throw error
        // The auth listener swaps in the gate; nothing else to do here.
      } else {
        const { error } = await supabase.auth.resetPasswordForEmail(email, {
          redirectTo: window.location.href,
        })
        if (error) throw error
        setNotice('If that address has an account, a reset link is on its way.')
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Something went wrong. Try again.')
    } finally {
      setBusy(false)
    }
  }

  const copy = COPY[mode]

  return (
    <div className="flex min-h-full items-center justify-center bg-gradient-to-br from-slate-50 via-indigo-50/40 to-slate-100 px-4 py-12 dark:from-slate-950 dark:via-indigo-950/20 dark:to-slate-900">
      <div className={mode === 'request' ? 'w-full max-w-2xl' : 'w-full max-w-sm'}>
        <div className="mb-8 text-center">
          <div className="mx-auto mb-4 flex h-12 w-12 items-center justify-center rounded-2xl bg-indigo-600 text-white shadow-lg shadow-indigo-600/25">
            <BrandMark className="h-6 w-6" />
          </div>
          <h1 className="text-xl font-semibold tracking-tight">{copy.title}</h1>
          <p className="mt-1 text-sm text-slate-500 dark:text-slate-400">{copy.sub}</p>
        </div>

        {mode === 'request' ? (
          <RequestAccessForm onBackToSignIn={() => switchTo('signin')} />
        ) : (
          <form onSubmit={submit}
            className="space-y-4 rounded-2xl bg-white p-6 shadow-xl shadow-slate-200/60 ring-1 ring-slate-200 dark:bg-slate-900 dark:shadow-none dark:ring-slate-800">

            <Field label="Email">
              <Input type="email" required value={email} onChange={e => setEmail(e.target.value)}
                placeholder="you@example.com" autoComplete="email" />
            </Field>

            {mode === 'signin' && (
              <Field label="Password">
                <Input type="password" required minLength={6} value={password}
                  onChange={e => setPassword(e.target.value)} placeholder="••••••••"
                  autoComplete="current-password" />
              </Field>
            )}

            {error && (
              <p role="alert" className="rounded-lg bg-rose-50 px-3 py-2 text-xs text-rose-700 ring-1 ring-rose-200 dark:bg-rose-950/50 dark:text-rose-300 dark:ring-rose-900">
                {error}
              </p>
            )}
            {notice && (
              <p role="status" className="rounded-lg bg-emerald-50 px-3 py-2 text-xs text-emerald-700 ring-1 ring-emerald-200 dark:bg-emerald-950/50 dark:text-emerald-300 dark:ring-emerald-900">
                {notice}
              </p>
            )}

            <Button type="submit" disabled={busy} className="w-full">
              {busy && <Spinner className="h-4 w-4" />}
              {copy.cta}
            </Button>

          </form>
        )}

        <div className="mt-5 flex flex-col items-center gap-2 text-xs text-slate-500 dark:text-slate-400">
          {mode === 'signin' && <>
            <button type="button" onClick={() => switchTo('request')} className="hover:text-indigo-600">
              No account yet? <span className="font-medium text-indigo-600">Request access</span>
            </button>
            <button type="button" onClick={() => switchTo('reset')} className="hover:text-indigo-600">
              Forgot your password?
            </button>
          </>}
          {mode !== 'signin' && (
            <button type="button" onClick={() => switchTo('signin')} className="hover:text-indigo-600">
               Back to sign in
            </button>
          )}
        </div>
      </div>
    </div>
  )
}
