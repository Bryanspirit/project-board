import { useEffect, useRef, useState } from 'react'
import type { WorkspaceRole } from '../../lib/types'
import { WORKSPACE_ROLES } from '../../lib/types'
import { Button, Field, Select, cx } from '../ui'

/**
 * The self-serve door into a workspace. Everything here is controlled by the
 * parent dialog so the code, the toggle and the role all save in one write.
 */
export default function InviteCodePanel({
  code, enabled, role, onToggle, onRoleChange, onRegenerate, busy = false,
}: {
  code: string | null
  enabled: boolean
  role: WorkspaceRole
  onToggle: (enabled: boolean) => void
  onRoleChange: (role: WorkspaceRole) => void
  onRegenerate: () => void | Promise<void>
  busy?: boolean
}) {
  const [copied, setCopied] = useState(false)
  const [confirming, setConfirming] = useState(false)
  const [copyError, setCopyError] = useState<string | null>(null)
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null)

  useEffect(() => () => { if (timer.current) clearTimeout(timer.current) }, [])

  async function copy() {
    if (!code) return
    try {
      await navigator.clipboard.writeText(code)
      setCopyError(null)
      setCopied(true)
      if (timer.current) clearTimeout(timer.current)
      timer.current = setTimeout(() => setCopied(false), 2000)
    } catch {
      setCopyError('Copy the code by hand — the clipboard is blocked here.')
    }
  }

  return (
    <section className="rounded-xl bg-slate-50 p-3.5 ring-1 ring-slate-200 dark:bg-slate-950/40 dark:ring-slate-800">
      <div className="flex items-start justify-between gap-3">
        <div>
          <h3 className="text-sm font-semibold text-slate-800 dark:text-slate-100">Join code</h3>
          <p className="mt-0.5 text-xs text-slate-500 dark:text-slate-400">
            Anyone who enters this code joins the workspace immediately, with no approval step.
          </p>
        </div>
        <label className="flex shrink-0 cursor-pointer items-center gap-2 pt-0.5">
          <input
            type="checkbox"
            checked={enabled}
            onChange={e => onToggle(e.target.checked)}
            className="h-4 w-4 rounded border-slate-300 text-indigo-600 focus:ring-indigo-500 dark:border-slate-600 dark:bg-slate-900"
          />
          <span className="text-xs font-medium text-slate-600 dark:text-slate-300">Enabled</span>
        </label>
      </div>

      <div className={cx('mt-3 space-y-3', !enabled && 'opacity-60')}>
        <div className="flex items-end gap-2">
          <div className="min-w-0 flex-1">
            <span className="mb-1.5 block text-xs font-medium text-slate-600 dark:text-slate-400">Code</span>
            <output className={cx(
              'block w-full truncate rounded-lg bg-white px-3 py-2 font-mono text-sm tracking-[0.25em] uppercase',
              'text-slate-900 ring-1 ring-slate-300 dark:bg-slate-900 dark:text-slate-100 dark:ring-slate-700',
              !code && 'text-slate-400 tracking-normal dark:text-slate-500',
            )}>
              {code || 'No code yet'}
            </output>
          </div>
          <Button type="button" variant="outline" onClick={() => void copy()} disabled={!code}>
            {copied ? 'Copied' : 'Copy'}
          </Button>
        </div>

        <Field label="Role a redeemer receives" hint={WORKSPACE_ROLES.find(r => r.id === role)?.blurb}>
          <Select value={role} onChange={e => onRoleChange(e.target.value as WorkspaceRole)}>
            {WORKSPACE_ROLES.map(r => <option key={r.id} value={r.id}>{r.label}</option>)}
          </Select>
        </Field>

        {confirming ? (
          <div className="flex flex-wrap items-center gap-2 rounded-lg bg-amber-50 px-3 py-2 ring-1 ring-amber-200 dark:bg-amber-950/40 dark:ring-amber-900">
            <span className="text-xs text-amber-800 dark:text-amber-200">
              Regenerating replaces the code — anyone still holding the old one can no longer join.
            </span>
            <Button size="sm" variant="danger" disabled={busy}
              onClick={async () => { await onRegenerate(); setConfirming(false); setCopied(false) }}>
              Yes, regenerate
            </Button>
            <Button size="sm" variant="ghost" onClick={() => setConfirming(false)}>Cancel</Button>
          </div>
        ) : (
          <Button type="button" size="sm" variant="ghost" disabled={busy} onClick={() => setConfirming(true)}>
            {code ? 'Regenerate code' : 'Generate code'}
          </Button>
        )}

        {copyError && (
          <p role="alert" className="text-xs text-rose-600 dark:text-rose-400">{copyError}</p>
        )}
      </div>
    </section>
  )
}
