import { useCallback, useEffect, useRef, useState } from 'react'
import { useAuth } from '../../lib/auth'
import { useCollab, relativeTime } from '../../hooks/useCollab'
import type { MentionRow } from '../../hooks/useCollab'
import { displayName } from './MentionInput'
import { Spinner, cx } from '../ui'

/** Long enough to read, short enough to sit on one line in the popover. */
function excerpt(body: string, max = 110): string {
  const flat = body.replace(/\s+/g, ' ').trim()
  return flat.length > max ? flat.slice(0, max - 1).trimEnd() + '…' : flat
}

export interface NotificationBellProps {
  /** Called with the task the mention lives on, after it is marked read. */
  onOpenTask: (taskId: string) => void
  /** How often to re-check for new mentions, in ms. */
  pollMs?: number
}

export function NotificationBell({ onOpenTask, pollMs = 60_000 }: NotificationBellProps) {
  const { user } = useAuth()
  const { myMentions, markMentionRead } = useCollab()
  const [rows, setRows] = useState<MentionRow[]>([])
  const [open, setOpen] = useState(false)
  const [ready, setReady] = useState(false)
  const wrapRef = useRef<HTMLDivElement | null>(null)

  const load = useCallback(async () => {
    const list = await myMentions()
    setRows(list)
    setReady(true)
  }, [myMentions])

  useEffect(() => {
    if (!user) { setRows([]); setReady(true); return }
    let alive = true
    void load().catch(() => { if (alive) setReady(true) })
    const timer = window.setInterval(() => { if (alive) void load() }, pollMs)
    return () => { alive = false; window.clearInterval(timer) }
  }, [user, load, pollMs])

  // Close on an outside click or Escape, the way every other popover behaves.
  useEffect(() => {
    if (!open) return
    const onDown = (e: MouseEvent) => {
      if (wrapRef.current && !wrapRef.current.contains(e.target as Node)) setOpen(false)
    }
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') setOpen(false) }
    document.addEventListener('mousedown', onDown)
    document.addEventListener('keydown', onKey)
    return () => {
      document.removeEventListener('mousedown', onDown)
      document.removeEventListener('keydown', onKey)
    }
  }, [open])

  const openMention = async (row: MentionRow) => {
    setRows(prev => prev.filter(r => r.id !== row.id))
    setOpen(false)
    await markMentionRead(row.id)
    const taskId = row.comment?.task_id
    if (taskId) onOpenTask(taskId)
  }

  const count = rows.length
  const label = count === 0
    ? 'Notifications'
    : `Notifications, ${count} unread mention${count === 1 ? '' : 's'}`

  return (
    <div className="relative" ref={wrapRef}>
      <button
        type="button"
        onClick={() => { setOpen(v => !v); if (!open) void load() }}
        aria-label={label}
        aria-haspopup="dialog"
        aria-expanded={open}
        className="relative rounded-lg p-2 text-slate-500 transition hover:bg-slate-200/70 hover:text-slate-800 dark:text-slate-400 dark:hover:bg-slate-800 dark:hover:text-slate-100"
      >
        <svg viewBox="0 0 24 24" className="h-5 w-5" fill="none" stroke="currentColor" strokeWidth="1.8" aria-hidden="true">
          <path d="M6 9a6 6 0 1 1 12 0c0 4 1.5 5.5 1.5 5.5h-15S6 13 6 9Z" strokeLinejoin="round" />
          <path d="M10 18a2 2 0 0 0 4 0" strokeLinecap="round" />
        </svg>
        {count > 0 && (
          <span className="absolute right-0.5 top-0.5 flex h-4 min-w-4 items-center justify-center rounded-full bg-rose-600 px-1 text-[10px] font-semibold text-white">
            {count > 9 ? '9+' : count}
          </span>
        )}
      </button>

      {open && (
        <div
          role="dialog"
          aria-label="Recent mentions"
          className="absolute right-0 z-40 mt-2 w-80 max-w-[calc(100vw-1.5rem)] overflow-hidden rounded-xl bg-white shadow-xl ring-1 ring-slate-200 dark:bg-slate-900 dark:ring-slate-700"
        >
          <header className="border-b border-slate-200 px-3 py-2 text-xs font-semibold uppercase tracking-wide text-slate-500 dark:border-slate-800 dark:text-slate-400">
            Mentions
          </header>

          {!ready ? (
            <div className="flex items-center gap-2 px-3 py-6 text-sm text-slate-500">
              <Spinner className="h-4 w-4" /> Checking…
            </div>
          ) : count === 0 ? (
            <p className="px-3 py-6 text-center text-sm text-slate-500 dark:text-slate-400">
              You are all caught up.
            </p>
          ) : (
            <ul className="max-h-80 divide-y divide-slate-100 overflow-y-auto dark:divide-slate-800">
              {rows.map(row => {
                const author = row.comment?.author
                const who = author ? displayName(author) : 'Someone'
                const body = row.comment?.body ?? ''
                const openable = Boolean(row.comment?.task_id)
                return (
                  <li key={row.id}>
                    <button
                      type="button"
                      onClick={() => void openMention(row)}
                      className={cx(
                        'flex w-full gap-2.5 px-3 py-2.5 text-left transition',
                        'hover:bg-slate-50 dark:hover:bg-slate-800/70',
                      )}
                    >
                      <span
                        aria-hidden="true"
                        className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-indigo-100 text-xs font-semibold text-indigo-700 dark:bg-indigo-950 dark:text-indigo-300"
                      >
                        {who.charAt(0).toUpperCase()}
                      </span>
                      <span className="min-w-0 flex-1">
                        <span className="flex items-baseline gap-1.5">
                          <span className="truncate text-sm font-medium text-slate-800 dark:text-slate-100">{who}</span>
                          <span className="text-xs text-slate-400">mentioned you</span>
                          <span className="ml-auto shrink-0 text-xs text-slate-400">
                            {relativeTime(row.created_at)}
                          </span>
                        </span>
                        <span className="mt-0.5 block break-words text-xs text-slate-600 dark:text-slate-300">
                          {excerpt(body)}
                        </span>
                        {!openable && (
                          <span className="mt-0.5 block text-[11px] text-slate-400">
                            Marking this read is all there is to do — it is not on a task.
                          </span>
                        )}
                      </span>
                    </button>
                  </li>
                )
              })}
            </ul>
          )}
        </div>
      )}
    </div>
  )
}

export default NotificationBell
