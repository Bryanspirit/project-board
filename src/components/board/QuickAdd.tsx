import { useEffect, useRef, useState } from 'react'
import type { TaskStatus } from '../../lib/types'
import { Input, Spinner, cx } from '../ui'

/**
 * The "+ Add task" row at the foot of a column.
 *
 * Enter files the task and immediately reopens the field, so a list can be typed
 * out in one go. A failure keeps the text exactly where it was — losing a typed
 * title to a dropped connection is the one thing this control must never do.
 */
export default function QuickAdd({ status, onCreate, disabled, label = 'Add task' }: {
  status: TaskStatus
  onCreate: (title: string, status: TaskStatus) => Promise<unknown>
  disabled?: boolean
  label?: string
}) {
  const [open, setOpen] = useState(false)
  const [title, setTitle] = useState('')
  const [pending, setPending] = useState(false)
  const [error, setError] = useState<string | null>(null)

  // `Input` is a plain function component, so it takes no ref — reach the real
  // element through the wrapper instead of reimplementing the field's styling.
  const boxRef = useRef<HTMLDivElement>(null)
  const focusInput = () => boxRef.current?.querySelector('input')?.focus()
  // Blur fires when the input is disabled mid-flight; state is stale inside that
  // handler, so the ref is what decides whether the row may close.
  const pendingRef = useRef(false)

  // Focus on open, and again once a create settles so the next title can be typed.
  useEffect(() => {
    if (open && !pending) focusInput()
  }, [open, pending])

  function close() {
    setOpen(false)
    setTitle('')
    setError(null)
  }

  async function submit() {
    const value = title.trim()
    if (!value || pendingRef.current) return

    pendingRef.current = true
    setPending(true)
    setError(null)
    try {
      await onCreate(value, status)
      setTitle('')
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not add that task.')
    } finally {
      pendingRef.current = false
      setPending(false)
    }
  }

  if (!open) {
    return (
      <button
        type="button"
        disabled={disabled}
        onClick={() => setOpen(true)}
        className={cx(
          'mt-2 flex w-full items-center gap-1.5 rounded-lg px-2 py-2 text-xs font-medium transition',
          'text-slate-500 hover:bg-white hover:text-slate-800 hover:shadow-sm',
          'dark:text-slate-400 dark:hover:bg-slate-800 dark:hover:text-slate-100',
          'focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-indigo-600',
          'disabled:cursor-not-allowed disabled:opacity-50 disabled:hover:bg-transparent disabled:hover:shadow-none',
        )}
      >
        <svg viewBox="0 0 16 16" className="h-3.5 w-3.5" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden>
          <path d="M8 3v10M3 8h10" strokeLinecap="round" />
        </svg>
        {label}
      </button>
    )
  }

  return (
    <div className="mt-2">
      <div className="relative" ref={boxRef}>
        <Input
          value={title}
          disabled={pending}
          aria-busy={pending || undefined}
          aria-label={label}
          aria-invalid={error ? true : undefined}
          placeholder="Task title, then Enter"
          className={cx('py-1.5 pr-8 text-sm', error && 'ring-rose-400 dark:ring-rose-700')}
          onChange={e => { setTitle(e.target.value); if (error) setError(null) }}
          onKeyDown={e => {
            if (e.key === 'Enter') { e.preventDefault(); void submit() }
            else if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); close() }
          }}
          onBlur={() => {
            // Keep the row open while anything is in flight or still typed out.
            if (pendingRef.current || title.trim()) return
            close()
          }}
        />
        {pending && (
          <Spinner className="pointer-events-none absolute top-1/2 right-2.5 h-3.5 w-3.5 -translate-y-1/2 text-slate-400" />
        )}
      </div>

      {error && (
        <p role="alert" className="mt-1 px-1 text-[11px] leading-snug text-rose-600 dark:text-rose-400">
          {error} <span className="text-slate-500 dark:text-slate-400">Press Enter to retry.</span>
        </p>
      )}
    </div>
  )
}
