import { useEffect } from 'react'
import type { ButtonHTMLAttributes, InputHTMLAttributes, ReactNode, TextareaHTMLAttributes, SelectHTMLAttributes } from 'react'

export function cx(...parts: (string | false | null | undefined)[]) {
  return parts.filter(Boolean).join(' ')
}

const VARIANTS = {
  primary: 'bg-indigo-600 text-white hover:bg-indigo-500 focus-visible:outline-indigo-600 disabled:bg-indigo-400',
  ghost: 'text-slate-600 hover:bg-slate-200/70 dark:text-slate-300 dark:hover:bg-slate-800',
  outline: 'ring-1 ring-slate-300 text-slate-700 hover:bg-slate-100 dark:ring-slate-700 dark:text-slate-200 dark:hover:bg-slate-800',
  danger: 'bg-rose-600 text-white hover:bg-rose-500 focus-visible:outline-rose-600',
}

type ButtonProps = ButtonHTMLAttributes<HTMLButtonElement> & {
  variant?: keyof typeof VARIANTS
  size?: 'sm' | 'md'
}

export function Button({ variant = 'primary', size = 'md', className, ...rest }: ButtonProps) {
  return (
    <button
      {...rest}
      className={cx(
        'inline-flex items-center justify-center gap-1.5 rounded-lg font-medium transition',
        'focus-visible:outline-2 focus-visible:outline-offset-2 disabled:cursor-not-allowed disabled:opacity-60',
        size === 'sm' ? 'px-2.5 py-1.5 text-xs' : 'px-3.5 py-2 text-sm',
        VARIANTS[variant],
        className,
      )}
    />
  )
}

/** Tailwind resolves conflicting utilities by stylesheet order, not by the
 *  order they appear in the class string — so a caller passing `w-28` would
 *  lose to the base `w-full` and the control would still stretch, squeezing
 *  whatever sits beside it. Only apply the default when no width was given. */
function widthClass(className?: string) {
  return /(^|\s)(w-|min-w-|max-w-|basis-|flex-1|grow)/.test(className ?? '') ? '' : 'w-full'
}

// text-base is 16px, which is the threshold below which iOS Safari zooms the
// page on focus — leaving the viewer to pinch and pan back out by hand. Phones
// therefore get 16px and everything from `sm` up keeps the tighter 14px.

/**
 * Brings a focused field above the on-screen keyboard.
 *
 * Even with the viewport resizing, a field near the bottom of a tall sheet can
 * end up behind the keyboard, and the viewer is left dragging the sheet around
 * with a thumb to see what they are typing. The delay lets the keyboard finish
 * animating first, or the browser measures against the old viewport and scrolls
 * to the wrong place.
 *
 * Any caller-supplied onFocus still runs — MentionInput reaches for the node
 * through exactly this event.
 */
function withFocusScroll<E extends HTMLElement>(
  onFocus?: (e: React.FocusEvent<E>) => void,
) {
  return (e: React.FocusEvent<E>) => {
    onFocus?.(e)
    const el = e.currentTarget
    window.setTimeout(() => {
      el.scrollIntoView({ block: 'center', behavior: 'smooth' })
    }, 250)
  }
}

const FIELD = 'rounded-lg bg-white px-3 py-2.5 text-base sm:py-2 sm:text-sm text-slate-900 ring-1 ring-slate-300 ' +
  'placeholder:text-slate-400 focus:ring-2 focus:ring-indigo-500 focus:outline-none ' +
  'dark:bg-slate-900 dark:text-slate-100 dark:ring-slate-700 dark:placeholder:text-slate-500'

export function Input({ className, onFocus, ...rest }: InputHTMLAttributes<HTMLInputElement>) {
  return <input {...rest} onFocus={withFocusScroll(onFocus)} className={cx(FIELD, widthClass(className), className)} />
}

export function Textarea({ className, onFocus, ...rest }: TextareaHTMLAttributes<HTMLTextAreaElement>) {
  return <textarea {...rest} onFocus={withFocusScroll(onFocus)} className={cx(FIELD, 'resize-y', widthClass(className), className)} />
}

export function Select({ className, onFocus, ...rest }: SelectHTMLAttributes<HTMLSelectElement>) {
  return <select {...rest} onFocus={withFocusScroll(onFocus)} className={cx(FIELD, 'appearance-none pr-8', widthClass(className), className)} />
}

export function Field({ label, children, hint }: { label: string; children: ReactNode; hint?: string }) {
  return (
    <label className="block">
      <span className="mb-1.5 block text-xs font-medium text-slate-600 dark:text-slate-400">{label}</span>
      {children}
      {hint && <span className="mt-1 block text-xs text-slate-400">{hint}</span>}
    </label>
  )
}

export function Modal({ title, onClose, children, footer }: {
  title: string
  onClose: () => void
  children: ReactNode
  footer?: ReactNode
}) {
  useEffect(() => {
    const esc = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose() }
    window.addEventListener('keydown', esc)
    document.body.style.overflow = 'hidden'
    return () => {
      window.removeEventListener('keydown', esc)
      document.body.style.overflow = ''
    }
  }, [onClose])

  return (
    // Bottom sheet on a phone, centred dialog from `sm` up. Doing it in CSS
    // rather than behind a media-query hook means there is no first-paint flash
    // of the wrong shape, and it works with the keyboard open on iOS.
    <div className="fixed inset-0 z-50 flex items-end justify-center bg-slate-900/50 backdrop-blur-sm sm:items-start sm:overflow-y-auto sm:p-8">
      <div
        role="dialog"
        aria-modal="true"
        aria-label={title}
        className={cx(
          'flex w-full flex-col bg-white shadow-2xl ring-1 ring-slate-200 dark:bg-slate-900 dark:ring-slate-800',
          // Phone: anchored to the bottom edge, never taller than the viewport,
          // and clear of the home indicator.
          'max-h-[92dvh] rounded-t-2xl pb-[env(safe-area-inset-bottom)]',
          // Desktop: the familiar centred card.
          'sm:my-auto sm:max-h-none sm:max-w-lg sm:rounded-2xl sm:pb-0',
        )}
        onClick={e => e.stopPropagation()}
      >
        {/* Grab handle reads as "this drags down" even though the close button
            is what actually dismisses it. Hidden from assistive tech. */}
        <div className="flex justify-center pt-2 sm:hidden" aria-hidden>
          <span className="h-1 w-9 rounded-full bg-slate-300 dark:bg-slate-700" />
        </div>

        <header className="flex shrink-0 items-center justify-between border-b border-slate-200 px-5 py-3.5 sm:py-4 dark:border-slate-800">
          <h2 className="text-base font-semibold">{title}</h2>
          <button onClick={onClose} aria-label="Close"
            className="-mr-1.5 rounded-lg p-2.5 text-slate-400 transition hover:bg-slate-100 hover:text-slate-700 sm:p-1.5 dark:hover:bg-slate-800 dark:hover:text-slate-200">
            <svg viewBox="0 0 20 20" className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth="2">
              <path d="M5 5l10 10M15 5L5 15" strokeLinecap="round" />
            </svg>
          </button>
        </header>

        {/* Only the body scrolls, so the title and the actions stay reachable
            however long the form gets. */}
        <div className="min-h-0 flex-1 space-y-4 overflow-y-auto overscroll-contain px-5 py-5">
          {children}
        </div>

        {footer && (
          <footer className="flex shrink-0 flex-wrap items-center justify-end gap-2 border-t border-slate-200 px-5 py-3.5 sm:py-4 dark:border-slate-800">
            {footer}
          </footer>
        )}
      </div>
    </div>
  )
}

export function Spinner({ className }: { className?: string }) {
  return (
    <svg className={cx('animate-spin', className)} viewBox="0 0 24 24" fill="none">
      <circle cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="3" className="opacity-25" />
      <path d="M22 12a10 10 0 0 1-10 10" stroke="currentColor" strokeWidth="3" strokeLinecap="round" />
    </svg>
  )
}
