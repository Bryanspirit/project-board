import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react'
import type { ReactNode } from 'react'
import { cx } from '../components/ui'

/** What a caller hands to `show()`. Everything but the message is optional, so
 *  a bare notice is one argument and an undo prompt is three. */
export interface ToastOptions {
  message: string
  /** Label for the single inline action, e.g. "Undo". Omit for a plain notice. */
  actionLabel?: string
  onAction?: () => void | Promise<void>
  /** Milliseconds before it fades. Defaults to 8s with an action, 4s without.
   *  Pass 0 to keep it up until it is dismissed by hand. */
  duration?: number
}

interface ToastRecord extends ToastOptions {
  id: number
}

export interface ToastApi {
  /** Queues a toast and returns its id, so a caller can retract it early. */
  show: (options: ToastOptions) => number
  dismiss: (id: number) => void
}

/** More than three stacked toasts is noise, not feedback — the oldest is
 *  dropped rather than letting the column grow off the top of the screen. */
const MAX_VISIBLE = 3
const WITH_ACTION_MS = 8000
const PLAIN_MS = 4000

const ToastContext = createContext<ToastApi>({ show: () => 0, dismiss: () => {} })

function prefersReducedMotion(): boolean {
  return typeof window !== 'undefined'
    && typeof window.matchMedia === 'function'
    && window.matchMedia('(prefers-reduced-motion: reduce)').matches
}

export function ToastProvider({ children }: { children: ReactNode }) {
  const [toasts, setToasts] = useState<ToastRecord[]>([])
  const nextId = useRef(0)

  const dismiss = useCallback((id: number) => {
    setToasts(prev => prev.filter(t => t.id !== id))
  }, [])

  const show = useCallback((options: ToastOptions) => {
    nextId.current += 1
    const id = nextId.current
    // Newest goes last so it renders at the bottom, nearest the thumb.
    setToasts(prev => [...prev, { ...options, id }].slice(-MAX_VISIBLE))
    return id
  }, [])

  const api = useMemo<ToastApi>(() => ({ show, dismiss }), [show, dismiss])

  return (
    <ToastContext.Provider value={api}>
      {children}
      <div
        aria-live="polite"
        className="pointer-events-none fixed inset-x-0 bottom-0 z-[60] flex flex-col items-center gap-2 p-4 sm:inset-x-auto sm:right-0 sm:items-end sm:p-6"
      >
        {toasts.map(toast => (
          <ToastCard key={toast.id} toast={toast} onDismiss={dismiss} />
        ))}
      </div>
    </ToastContext.Provider>
  )
}

function ToastCard({ toast, onDismiss }: { toast: ToastRecord; onDismiss: (id: number) => void }) {
  const duration = toast.duration ?? (toast.actionLabel ? WITH_ACTION_MS : PLAIN_MS)
  const [paused, setPaused] = useState(false)
  const [entered, setEntered] = useState(() => prefersReducedMotion())
  const remaining = useRef(duration)
  const startedAt = useRef(0)

  // Slide in on the next frame. With reduced motion the card starts settled, so
  // nothing moves and the transition classes never apply.
  useEffect(() => {
    if (entered) return
    const frame = window.requestAnimationFrame(() => setEntered(true))
    return () => window.cancelAnimationFrame(frame)
  }, [entered])

  // One timer at a time, torn down whenever it pauses, the toast changes, or the
  // card unmounts — including when the whole provider goes away.
  useEffect(() => {
    if (paused || duration <= 0 || remaining.current <= 0) return
    const id = toast.id
    startedAt.current = Date.now()
    const handle = window.setTimeout(() => onDismiss(id), remaining.current)
    return () => {
      window.clearTimeout(handle)
      remaining.current = Math.max(0, remaining.current - (Date.now() - startedAt.current))
    }
  }, [paused, duration, toast.id, onDismiss])

  const runAction = () => {
    void toast.onAction?.()
    onDismiss(toast.id)
  }

  return (
    <div
      role="status"
      aria-live="polite"
      onMouseEnter={() => setPaused(true)}
      onMouseLeave={() => setPaused(false)}
      onFocus={() => setPaused(true)}
      onBlur={() => setPaused(false)}
      className={cx(
        'pointer-events-auto flex w-full max-w-sm items-center gap-3 rounded-xl px-4 py-3 shadow-lg ring-1',
        'bg-slate-900 text-sm text-slate-100 ring-slate-700',
        'dark:bg-slate-800 dark:ring-slate-700',
        !prefersReducedMotion() && 'transition duration-200 ease-out',
        entered ? 'translate-y-0 opacity-100' : 'translate-y-2 opacity-0',
      )}
    >
      <span className="min-w-0 flex-1 leading-snug">{toast.message}</span>

      {toast.actionLabel && (
        <button
          type="button"
          onClick={runAction}
          className="shrink-0 rounded-lg px-2.5 py-1.5 text-xs font-semibold text-indigo-300 transition hover:bg-slate-800 hover:text-indigo-200 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-indigo-400 dark:hover:bg-slate-700"
        >
          {toast.actionLabel}
        </button>
      )}

      <button
        type="button"
        onClick={() => onDismiss(toast.id)}
        aria-label="Dismiss notification"
        className="shrink-0 rounded-lg p-1 text-slate-400 transition hover:bg-slate-800 hover:text-slate-100 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-slate-400 dark:hover:bg-slate-700"
      >
        <svg viewBox="0 0 20 20" className="h-3.5 w-3.5" fill="none" stroke="currentColor" strokeWidth="2">
          <path d="M5 5l10 10M15 5L5 15" strokeLinecap="round" />
        </svg>
      </button>
    </div>
  )
}

// eslint-disable-next-line react-refresh/only-export-components
export function useToast(): ToastApi {
  return useContext(ToastContext)
}
