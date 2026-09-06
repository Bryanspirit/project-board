import { cx } from '../ui'
import type { AuditEntry, Profile } from '../../lib/types'
import { relativeTime } from '../../hooks/useAdmin'

interface Props {
  entries: AuditEntry[]
  profileById: Record<string, Profile>
}

/** Turn a snake_case identifier into something a person reads. */
function humanize(value: string): string {
  const words = value.replace(/[_.]+/g, ' ').trim()
  return words.charAt(0).toUpperCase() + words.slice(1)
}

/** Flatten a detail value into a short readable string — never a raw JSON blob. */
function readable(value: unknown, depth = 0): string {
  if (value === null || value === undefined) return '—'
  if (typeof value === 'boolean') return value ? 'yes' : 'no'
  if (typeof value === 'number') return String(value)
  if (typeof value === 'string') return value
  if (Array.isArray(value)) {
    return value.length === 0 ? 'none' : value.map(v => readable(v, depth + 1)).join(', ')
  }
  if (typeof value === 'object') {
    if (depth > 1) return 'details'
    return Object.entries(value as Record<string, unknown>)
      .map(([k, v]) => `${humanize(k)}: ${readable(v, depth + 1)}`)
      .join(' · ')
  }
  return String(value)
}

function truncate(text: string, max = 80) {
  return text.length > max ? `${text.slice(0, max - 1)}…` : text
}

const ACTION_TONE = (action: string) => {
  if (/reject|delete|remove|suspend/.test(action)) return 'bg-rose-50 text-rose-700 ring-rose-200 dark:bg-rose-950 dark:text-rose-300 dark:ring-rose-900'
  if (/approve|create|activate|add/.test(action)) return 'bg-emerald-50 text-emerald-700 ring-emerald-200 dark:bg-emerald-950 dark:text-emerald-300 dark:ring-emerald-900'
  return 'bg-slate-100 text-slate-700 ring-slate-200 dark:bg-slate-800 dark:text-slate-200 dark:ring-slate-700'
}

export default function AuditPanel({ entries, profileById }: Props) {
  if (entries.length === 0) {
    return (
      <div className="rounded-xl border border-dashed border-slate-300 px-6 py-12 text-center dark:border-slate-700">
        <p className="text-sm font-medium text-slate-700 dark:text-slate-200">No activity recorded</p>
        <p className="mt-1 text-sm text-slate-500 dark:text-slate-400">
          Approvals, role changes and other admin actions show up here.
        </p>
      </div>
    )
  }

  return (
    <ol className="divide-y divide-slate-200 overflow-hidden rounded-xl bg-white ring-1 ring-slate-200 dark:divide-slate-800 dark:bg-slate-900 dark:ring-slate-800">
      {entries.map(entry => {
        const actor = entry.actor_id ? profileById[entry.actor_id] : undefined
        const actorName = actor?.full_name?.trim() || actor?.email || 'System'
        const chips = Object.entries(entry.detail ?? {})
        return (
          <li key={entry.id} className="px-4 py-3">
            <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
              <span aria-hidden="true"
                className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-slate-100 text-xs font-semibold text-slate-600 dark:bg-slate-800 dark:text-slate-300">
                {actorName.charAt(0).toUpperCase()}
              </span>
              <span className="text-sm font-medium text-slate-900 dark:text-slate-50">{actorName}</span>
              <span className={cx('rounded-full px-2 py-0.5 text-xs font-medium ring-1', ACTION_TONE(entry.action))}>
                {humanize(entry.action)}
              </span>
              <span className="text-sm text-slate-500 dark:text-slate-400">
                on {humanize(entry.entity_type)}
              </span>
              <time dateTime={entry.created_at}
                title={new Date(entry.created_at).toLocaleString()}
                className="ml-auto shrink-0 text-xs text-slate-400">
                {relativeTime(entry.created_at)}
              </time>
            </div>
            {chips.length > 0 && (
              <ul className="mt-2 flex flex-wrap gap-1.5 pl-9">
                {chips.map(([key, value]) => (
                  <li key={key}
                    className="rounded-md bg-slate-50 px-2 py-0.5 text-xs text-slate-600 ring-1 ring-slate-200 dark:bg-slate-800/60 dark:text-slate-300 dark:ring-slate-700">
                    <span className="font-medium text-slate-500 dark:text-slate-400">{humanize(key)}:</span>{' '}
                    {truncate(readable(value))}
                  </li>
                ))}
              </ul>
            )}
          </li>
        )
      })}
    </ol>
  )
}
