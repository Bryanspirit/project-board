import { useEffect, useState } from 'react'
import { supabase } from '../lib/supabase'
import type { Profile } from '../lib/types'
import { Button, Modal, Spinner, cx } from './ui'

const TOGGLES: { key: keyof Profile; label: string; detail: string }[] = [
  {
    key: 'daily_digest',
    label: 'Daily digest',
    detail: 'Every weekday morning: what is due today, due soon, and overdue.',
  },
  {
    key: 'weekly_summary',
    label: 'Weekly summary',
    detail: 'Monday morning: progress on every active project and the week ahead.',
  },
  {
    key: 'blocker_alerts',
    label: 'Blocker alerts',
    detail: 'Emailed shortly after a task moves into the Blocked column.',
  },
]

function Toggle({ on, onChange, label }: { on: boolean; onChange: (v: boolean) => void; label: string }) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={on}
      aria-label={label}
      onClick={() => onChange(!on)}
      className={cx(
        'relative h-6 w-11 shrink-0 rounded-full transition',
        on ? 'bg-indigo-600' : 'bg-slate-300 dark:bg-slate-700',
      )}
    >
      <span className={cx(
        'absolute top-0.5 h-5 w-5 rounded-full bg-white shadow transition-all',
        on ? 'left-[22px]' : 'left-0.5',
      )} />
    </button>
  )
}

export default function SettingsDialog({ userId, email, onClose }: {
  userId: string
  email: string
  onClose: () => void
}) {
  const [profile, setProfile] = useState<Profile | null>(null)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    supabase.from('profiles').select('*').eq('id', userId).single().then(({ data, error }) => {
      if (error) setError(error.message)
      else setProfile(data as Profile)
    })
  }, [userId])

  async function update(patch: Partial<Profile>) {
    if (!profile) return
    setProfile({ ...profile, ...patch })
    const { error } = await supabase.from('profiles').update(patch).eq('id', userId)
    if (error) setError(error.message)
  }

  return (
    <Modal title="Email alerts" onClose={onClose} footer={<Button onClick={onClose}>Done</Button>}>
      <p className="text-xs leading-relaxed text-slate-500 dark:text-slate-400">
        Alerts are sent to <span className="font-medium text-slate-700 dark:text-slate-200">{email}</span> by
        a scheduled GitHub Action. Changes here take effect on the next run.
      </p>

      {error && (
        <p role="alert" className="rounded-lg bg-rose-50 px-3 py-2 text-xs text-rose-700 dark:bg-rose-950/50 dark:text-rose-300">
          {error}
        </p>
      )}

      {!profile && !error && (
        <div className="flex justify-center py-6 text-slate-400"><Spinner className="h-5 w-5" /></div>
      )}

      {profile && (
        <ul className="divide-y divide-slate-200 dark:divide-slate-800">
          {TOGGLES.map(t => (
            <li key={t.key} className="flex items-start gap-3 py-3">
              <div className="min-w-0 flex-1">
                <p className="text-sm font-medium">{t.label}</p>
                <p className="mt-0.5 text-xs leading-relaxed text-slate-500 dark:text-slate-400">{t.detail}</p>
              </div>
              <Toggle
                label={t.label}
                on={Boolean(profile[t.key])}
                onChange={v => void update({ [t.key]: v } as Partial<Profile>)}
              />
            </li>
          ))}
        </ul>
      )}
    </Modal>
  )
}
