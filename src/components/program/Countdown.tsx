import { useEffect, useState } from 'react'
import { cx } from '../ui'

const HOUR = 3_600_000
const DAY = 86_400_000

/** True when the viewer has asked the OS for less motion. Read live so a
 *  mid-session change is honoured without a reload. */
function usePrefersReducedMotion(): boolean {
  const [reduced, setReduced] = useState(() =>
    typeof window !== 'undefined' && typeof window.matchMedia === 'function'
      ? window.matchMedia('(prefers-reduced-motion: reduce)').matches
      : false)

  useEffect(() => {
    if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') return
    const mq = window.matchMedia('(prefers-reduced-motion: reduce)')
    const onChange = () => setReduced(mq.matches)
    mq.addEventListener('change', onChange)
    return () => mq.removeEventListener('change', onChange)
  }, [])

  return reduced
}

export interface CountdownProps {
  /** ISO timestamp (`timestamptz` from the database) to count down to. */
  target: string
  label?: string
  compact?: boolean
}

export function Countdown({ target, label, compact = false }: CountdownProps) {
  const reduced = usePrefersReducedMotion()
  // A calm countdown updates once a minute; otherwise once a second so the
  // seconds place is honest. Either way it is exactly one interval.
  const period = reduced ? 60_000 : 1_000
  const [now, setNow] = useState(() => Date.now())

  useEffect(() => {
    setNow(Date.now())
    const id = setInterval(() => setNow(Date.now()), period)
    return () => clearInterval(id)
  }, [period, target])

  const due = new Date(target).getTime()
  if (!Number.isFinite(due)) return null

  const remaining = due - now
  const ended = remaining <= 0

  const tone = ended
    ? 'text-slate-400 ring-slate-300 dark:text-slate-500 dark:ring-slate-700'
    : remaining < 6 * HOUR
      ? 'text-rose-600 ring-rose-300 dark:text-rose-400 dark:ring-rose-900'
      : remaining < 48 * HOUR
        ? 'text-amber-600 ring-amber-300 dark:text-amber-400 dark:ring-amber-900'
        : 'text-slate-700 ring-slate-300 dark:text-slate-200 dark:ring-slate-700'

  if (ended) {
    return (
      <span className={cx(
        'inline-flex items-center gap-1.5 rounded-lg px-2 py-1 text-xs font-medium ring-1',
        tone,
      )}>
        {label ? <span>{label}</span> : null}
        <span>Ended</span>
      </span>
    )
  }

  const total = Math.floor(remaining / 1000)
  const days = Math.floor(total / 86_400)
  const hours = Math.floor((total % 86_400) / 3_600)
  const minutes = Math.floor((total % 3_600) / 60)
  const seconds = total % 60

  const parts: { value: number; unit: string }[] = [
    { value: days, unit: 'd' },
    { value: hours, unit: 'h' },
    { value: minutes, unit: 'm' },
  ]
  if (!compact) parts.push({ value: seconds, unit: 's' })

  const spoken = `${days}d ${hours}h ${minutes}m${compact ? '' : ` ${seconds}s`} remaining`

  if (compact) {
    return (
      <span
        className={cx('inline-flex items-center gap-1 rounded-lg px-2 py-1 text-xs font-semibold tabular-nums ring-1', tone)}
        title={remaining < DAY ? 'Less than a day left' : undefined}
        aria-label={label ? `${label}: ${spoken}` : spoken}
      >
        {label ? <span className="font-medium opacity-70">{label}</span> : null}
        <span>{days > 0 ? `${days}d ` : ''}{pad(hours)}:{pad(minutes)}</span>
      </span>
    )
  }

  return (
    <div
      className={cx('inline-flex flex-col gap-1 rounded-xl px-3 py-2 ring-1', tone)}
      aria-label={label ? `${label}: ${spoken}` : spoken}
    >
      {label ? (
        <span className="text-[11px] font-medium uppercase tracking-wide opacity-70">{label}</span>
      ) : null}
      <div className="flex items-end gap-2 tabular-nums" aria-hidden>
        {parts.map(p => (
          <span key={p.unit} className="flex items-baseline gap-0.5">
            <span className="text-xl font-semibold leading-none">{pad(p.value)}</span>
            <span className="text-[11px] font-medium opacity-60">{p.unit}</span>
          </span>
        ))}
      </div>
    </div>
  )
}

function pad(n: number) {
  return String(n).padStart(2, '0')
}
