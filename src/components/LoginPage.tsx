import { useState } from 'react'
import { supabase } from '../lib/supabase'
import { Button, Field, Input, Spinner } from './ui'

type Mode = 'signin' | 'signup' | 'reset'

const COPY: Record<Mode, { title: string; sub: string; cta: string }> = {
  signin: { title: 'Welcome back',    sub: 'Sign in to open your board.',                 cta: 'Sign in' },
  signup: { title: 'Create account',  sub: 'Your board is private to your account.',      cta: 'Create account' },
  reset:  { title: 'Reset password',  sub: "We'll email you a link to set a new one.",    cta: 'Send reset link' },
}

export default function LoginPage() {
  const [mode, setMode] = useState<Mode>('signin')
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [fullName, setFullName] = useState('')
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
        // The auth listener swaps in the board; nothing else to do here.
      } else if (mode === 'signup') {
        const { data, error } = await supabase.auth.signUp({
          email, password,
          options: { data: { full_name: fullName }, emailRedirectTo: window.location.href },
        })
        if (error) throw error
        if (!data.session) setNotice('Check your inbox to confirm your email address, then sign in.')
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

  async function google() {
    setError(null)
    const { error } = await supabase.auth.signInWithOAuth({
      provider: 'google',
      options: { redirectTo: window.location.href },
    })
    if (error) setError(error.message)
  }

  const copy = COPY[mode]

  return (
    <div className="flex min-h-full items-center justify-center bg-gradient-to-br from-slate-50 via-indigo-50/40 to-slate-100 px-4 py-12 dark:from-slate-950 dark:via-indigo-950/20 dark:to-slate-900">
      <div className="w-full max-w-sm">
        <div className="mb-8 text-center">
          <div className="mx-auto mb-4 flex h-12 w-12 items-center justify-center rounded-2xl bg-indigo-600 text-2xl shadow-lg shadow-indigo-600/25">
            🗂️
          </div>
          <h1 className="text-xl font-semibold tracking-tight">{copy.title}</h1>
          <p className="mt-1 text-sm text-slate-500 dark:text-slate-400">{copy.sub}</p>
        </div>

        <form onSubmit={submit}
          className="space-y-4 rounded-2xl bg-white p-6 shadow-xl shadow-slate-200/60 ring-1 ring-slate-200 dark:bg-slate-900 dark:shadow-none dark:ring-slate-800">

          {mode === 'signup' && (
            <Field label="Name">
              <Input value={fullName} onChange={e => setFullName(e.target.value)}
                placeholder="Your name" autoComplete="name" />
            </Field>
          )}

          <Field label="Email">
            <Input type="email" required value={email} onChange={e => setEmail(e.target.value)}
              placeholder="you@example.com" autoComplete="email" />
          </Field>

          {mode !== 'reset' && (
            <Field label="Password" hint={mode === 'signup' ? 'At least 6 characters.' : undefined}>
              <Input type="password" required minLength={6} value={password}
                onChange={e => setPassword(e.target.value)} placeholder="••••••••"
                autoComplete={mode === 'signup' ? 'new-password' : 'current-password'} />
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

          {mode !== 'reset' && (
            <>
              <div className="flex items-center gap-3 text-xs text-slate-400">
                <span className="h-px flex-1 bg-slate-200 dark:bg-slate-800" />
                or
                <span className="h-px flex-1 bg-slate-200 dark:bg-slate-800" />
              </div>
              <Button type="button" variant="outline" onClick={google} className="w-full">
                <svg viewBox="0 0 24 24" className="h-4 w-4">
                  <path fill="#4285F4" d="M23.5 12.3c0-.8-.1-1.6-.2-2.3H12v4.5h6.5a5.6 5.6 0 0 1-2.4 3.6v3h3.9c2.3-2.1 3.5-5.2 3.5-8.8Z" />
                  <path fill="#34A853" d="M12 24c3.2 0 5.9-1.1 7.9-2.9l-3.9-3c-1 .7-2.4 1.1-4 1.1-3.1 0-5.7-2-6.6-4.8h-4v3.1A12 12 0 0 0 12 24Z" />
                  <path fill="#FBBC05" d="M5.4 14.4a7.2 7.2 0 0 1 0-4.6v-3.1h-4a12 12 0 0 0 0 10.8l4-3.1Z" />
                  <path fill="#EA4335" d="M12 4.8c1.8 0 3.3.6 4.6 1.8l3.4-3.4A12 12 0 0 0 1.4 6.7l4 3.1C6.3 6.8 8.9 4.8 12 4.8Z" />
                </svg>
                Continue with Google
              </Button>
            </>
          )}
        </form>

        <div className="mt-5 flex flex-col items-center gap-2 text-xs text-slate-500 dark:text-slate-400">
          {mode === 'signin' && <>
            <button type="button" onClick={() => switchTo('signup')} className="hover:text-indigo-600">
              No account yet? <span className="font-medium text-indigo-600">Create one</span>
            </button>
            <button type="button" onClick={() => switchTo('reset')} className="hover:text-indigo-600">
              Forgot your password?
            </button>
          </>}
          {mode !== 'signin' && (
            <button type="button" onClick={() => switchTo('signin')} className="hover:text-indigo-600">
              ← Back to sign in
            </button>
          )}
        </div>
      </div>
    </div>
  )
}
