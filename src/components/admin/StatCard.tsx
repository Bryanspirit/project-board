import { cx } from '../ui'

export type StatTone = 'neutral' | 'warn' | 'danger' | 'good'

const TONES: Record<StatTone, { ring: string; value: string; label: string }> = {
  neutral: {
    ring: 'ring-slate-200 bg-white dark:ring-slate-800 dark:bg-slate-900',
    value: 'text-slate-900 dark:text-slate-50',
    label: 'text-slate-500 dark:text-slate-400',
  },
  good: {
    ring: 'ring-emerald-200 bg-emerald-50 dark:ring-emerald-900 dark:bg-emerald-950/50',
    value: 'text-emerald-700 dark:text-emerald-300',
    label: 'text-emerald-700/70 dark:text-emerald-400/80',
  },
  warn: {
    ring: 'ring-amber-200 bg-amber-50 dark:ring-amber-900 dark:bg-amber-950/50',
    value: 'text-amber-700 dark:text-amber-300',
    label: 'text-amber-700/70 dark:text-amber-400/80',
  },
  danger: {
    ring: 'ring-rose-200 bg-rose-50 dark:ring-rose-900 dark:bg-rose-950/50',
    value: 'text-rose-700 dark:text-rose-300',
    label: 'text-rose-700/70 dark:text-rose-400/80',
  },
}

export default function StatCard({ label, value, tone = 'neutral', sublabel }: {
  label: string
  value: number | string
  tone?: StatTone
  sublabel?: string
}) {
  const t = TONES[tone]
  return (
    <div className={cx('min-w-[8.5rem] flex-1 rounded-xl px-4 py-3 ring-1', t.ring)}>
      <p className={cx('text-xs font-medium tracking-wide uppercase', t.label)}>{label}</p>
      <p className={cx('mt-1 text-2xl font-semibold tabular-nums', t.value)}>{value}</p>
      {sublabel && (
        <p className="mt-0.5 text-xs text-slate-500 dark:text-slate-400">{sublabel}</p>
      )}
    </div>
  )
}
