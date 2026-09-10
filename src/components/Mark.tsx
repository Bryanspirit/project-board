import { cx } from './ui'

/**
 * The tile that stands in for a workspace, team or project.
 *
 * Replaces the emoji these rows used to carry. An emoji renders differently on
 * every platform, carries meaning nobody agreed on, and looks wrong beside a
 * typeface — initials tinted with the row's own colour identify the thing
 * without any of that.
 */
export function Mark({ name, color, size = 'md', className }: {
  name: string
  color: string
  size?: 'sm' | 'md' | 'lg'
  className?: string
}) {
  const box = size === 'lg' ? 'h-14 w-14 rounded-2xl text-lg'
    : size === 'sm' ? 'h-6 w-6 rounded-md text-[10px]'
      : 'h-10 w-10 rounded-xl text-sm'

  return (
    <span
      aria-hidden
      className={cx('flex shrink-0 items-center justify-center font-semibold tracking-tight', box, className)}
      // The tint is the row's colour at low alpha with the solid colour as ink,
      // so every mark stays legible in both themes without a palette per row.
      style={{ backgroundColor: `${color}1f`, color }}
    >
      {initials(name)}
    </span>
  )
}

/** One letter from each of the first two words, so "Team Falcon" reads TF. */
export function initials(name: string): string {
  const words = name.trim().split(/\s+/).filter(Boolean)
  if (words.length === 0) return '—'
  if (words.length === 1) return words[0].slice(0, 2).toUpperCase()
  return (words[0][0] + words[1][0]).toUpperCase()
}

/** The app's own mark: a small board, drawn rather than typed. */
export function BrandMark({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" className={cx('h-5 w-5', className)} fill="none" aria-hidden>
      <rect x="3" y="4" width="5.5" height="16" rx="1.5" fill="currentColor" opacity="0.9" />
      <rect x="10.25" y="4" width="5.5" height="11" rx="1.5" fill="currentColor" opacity="0.6" />
      <rect x="17.5" y="4" width="3.5" height="7" rx="1.5" fill="currentColor" opacity="0.35" />
    </svg>
  )
}
