/** All date helpers work on plain 'YYYY-MM-DD' strings so a due date means the
 *  same calendar day regardless of the viewer's timezone. */

export function todayISO(): string {
  const d = new Date()
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}

export function daysUntil(iso: string): number {
  const [y, m, d] = iso.split('-').map(Number)
  const target = Date.UTC(y, m - 1, d)
  const [ty, tm, td] = todayISO().split('-').map(Number)
  const today = Date.UTC(ty, tm - 1, td)
  return Math.round((target - today) / 86_400_000)
}

export function formatDue(iso: string): string {
  const diff = daysUntil(iso)
  if (diff === 0) return 'Today'
  if (diff === 1) return 'Tomorrow'
  if (diff === -1) return 'Yesterday'
  if (diff < 0) return `${Math.abs(diff)}d overdue`
  if (diff <= 7) return `In ${diff}d`
  const [y, m, d] = iso.split('-').map(Number)
  return new Date(Date.UTC(y, m - 1, d)).toLocaleDateString(undefined, {
    month: 'short', day: 'numeric', timeZone: 'UTC',
  })
}

export type DueTone = 'overdue' | 'today' | 'soon' | 'later'

export function dueTone(iso: string): DueTone {
  const diff = daysUntil(iso)
  if (diff < 0) return 'overdue'
  if (diff === 0) return 'today'
  if (diff <= 3) return 'soon'
  return 'later'
}
