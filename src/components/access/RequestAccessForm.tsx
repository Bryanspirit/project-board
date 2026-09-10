import { useState } from 'react'
import { supabase } from '../../lib/supabase'
import { GENDERS, ROLE_TITLES } from '../../lib/types'
import { Button, Field, Input, Select, Spinner, Textarea } from '../ui'
import JoinCodeCard from './JoinCodeCard'

interface FormState {
  full_name: string
  email: string
  password: string
  gender: string
  phone: string
  organization: string
  role_title: string
  github_url: string
  linkedin_url: string
  country: string
  motivation: string
}

const EMPTY: FormState = {
  full_name: '', email: '', password: '', gender: '', phone: '', organization: '',
  role_title: '', github_url: '', linkedin_url: '', country: '', motivation: '',
}

export default function RequestAccessForm({ onBackToSignIn }: { onBackToSignIn: () => void }) {
  const [form, setForm] = useState<FormState>(EMPTY)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [sent, setSent] = useState(false)
  const [showCode, setShowCode] = useState(false)

  const set = <K extends keyof FormState>(key: K) => (
    (e: { target: { value: string } }) => setForm(f => ({ ...f, [key]: e.target.value }))
  )

  async function submit(e: React.FormEvent) {
    e.preventDefault()
    setBusy(true); setError(null)
    try {
      const { email, password, ...rest } = form
      // Drop blanks so the trigger's `meta ->> key` yields null rather than an
      // empty string, keeping "not answered" distinguishable in the DB.
      const meta = Object.fromEntries(
        Object.entries(rest).filter(([, v]) => v.trim() !== '').map(([k, v]) => [k, v.trim()]),
      )
      // The `handle_new_user` trigger reads this metadata to build the profile
      // (status `pending`) and the access_requests row, so the client never
      // writes to either table itself.
      const { error } = await supabase.auth.signUp({
        email: email.trim(),
        password,
        options: { data: meta, emailRedirectTo: window.location.origin },
      })
      if (error) throw error
      setSent(true)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not send your request. Try again.')
    } finally {
      setBusy(false)
    }
  }

  if (sent) {
    return (
      <div className="space-y-4">
        <div role="status" className="rounded-2xl bg-white p-6 text-center shadow-xl shadow-slate-200/60 ring-1 ring-slate-200 dark:bg-slate-900 dark:shadow-none dark:ring-slate-800">
          <div className="mx-auto mb-3 flex h-11 w-11 items-center justify-center rounded-2xl bg-emerald-100 text-xl dark:bg-emerald-950"></div>
          <h2 className="text-base font-semibold">Request received</h2>
          <p className="mt-2 text-sm text-slate-500 dark:text-slate-400">
            Confirm your email address if we sent you a link, then sit tight — a real person
            reviews every request and decides which workspace you land in. You’ll get an email
            the moment your account is approved.
          </p>
          <Button variant="outline" className="mt-5 w-full" onClick={onBackToSignIn}>
            Back to sign in
          </Button>
        </div>
        <JoinCodeCard onJoined={() => window.location.reload()} />
      </div>
    )
  }

  return (
    <div className="space-y-4">
      <form
        onSubmit={submit}
        className="rounded-2xl bg-white p-6 shadow-xl shadow-slate-200/60 ring-1 ring-slate-200 dark:bg-slate-900 dark:shadow-none dark:ring-slate-800"
      >
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="Full name *">
            <Input required value={form.full_name} onChange={set('full_name')}
              placeholder="Ada Lovelace" autoComplete="name" />
          </Field>

          <Field label="Email *">
            <Input required type="email" value={form.email} onChange={set('email')}
              placeholder="you@example.com" autoComplete="email" />
          </Field>

          <Field label="Password *" hint="At least 6 characters.">
            <Input required type="password" minLength={6} value={form.password}
              onChange={set('password')} placeholder="••••••••" autoComplete="new-password" />
          </Field>

          <Field label="Gender">
            <Select value={form.gender} onChange={set('gender')}>
              <option value="">Prefer not to say</option>
              {GENDERS.map(g => <option key={g} value={g}>{g}</option>)}
            </Select>
          </Field>

          <Field label="Phone / WhatsApp">
            <Input type="tel" value={form.phone} onChange={set('phone')}
              placeholder="+233 20 000 0000" autoComplete="tel" />
          </Field>

          <Field label="Country">
            <Input value={form.country} onChange={set('country')}
              placeholder="Ghana" autoComplete="country-name" />
          </Field>

          <Field label="Organization or school">
            <Input value={form.organization} onChange={set('organization')}
              placeholder="Star Assurance" autoComplete="organization" />
          </Field>

          <Field label="Role you’d play">
            <Select value={form.role_title} onChange={set('role_title')}>
              <option value="">Not sure yet</option>
              {ROLE_TITLES.map(r => <option key={r} value={r}>{r}</option>)}
            </Select>
          </Field>

          <Field label="GitHub">
            <Input type="url" value={form.github_url} onChange={set('github_url')}
              placeholder="https://github.com/you" inputMode="url" />
          </Field>

          <Field label="LinkedIn">
            <Input type="url" value={form.linkedin_url} onChange={set('linkedin_url')}
              placeholder="https://linkedin.com/in/you" inputMode="url" />
          </Field>

          <div className="sm:col-span-2">
            <Field label="What do you want to build?" hint="A couple of sentences is plenty — it is what the reviewer actually reads.">
              <Textarea rows={3} value={form.motivation} onChange={set('motivation')}
                placeholder="I'm joining the hackathon with a team building…" />
            </Field>
          </div>
        </div>

        {error && (
          <p role="alert" className="mt-4 rounded-lg bg-rose-50 px-3 py-2 text-xs text-rose-700 ring-1 ring-rose-200 dark:bg-rose-950/50 dark:text-rose-300 dark:ring-rose-900">
            {error}
          </p>
        )}

        <Button type="submit" disabled={busy} className="mt-5 w-full">
          {busy && <Spinner className="h-4 w-4" />}
          Request access
        </Button>

        <p className="mt-3 text-center text-xs text-slate-400 dark:text-slate-500">
          Fields marked * are required. Everything else helps the reviewer place you.
        </p>
      </form>

      {showCode ? (
        <JoinCodeCard onJoined={() => window.location.reload()} />
      ) : (
        <button
          type="button"
          onClick={() => setShowCode(true)}
          className="w-full rounded-xl px-3 py-2 text-xs text-slate-500 transition hover:text-indigo-600 dark:text-slate-400 dark:hover:text-indigo-400"
        >
          I have a join code
        </button>
      )}
    </div>
  )
}
