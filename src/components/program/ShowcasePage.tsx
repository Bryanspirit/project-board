import { useCallback, useEffect, useMemo, useState } from 'react'
import { Button, Spinner, cx } from '../ui'
import { supabase } from '../../lib/supabase'
import type { ProjectHealth } from '../../lib/types'

export interface ShowcasePageProps {
  workspaceId: string
  onClose: () => void
}

/** Demo day. This goes on a projector in front of an audience, so it is a
 *  full-bleed dark surface with big type rather than another panel in the app. */
export function ShowcasePage({ workspaceId, onClose }: ShowcasePageProps) {
  const [rows, setRows] = useState<ProjectHealth[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [showUnsubmitted, setShowUnsubmitted] = useState(false)

  const load = useCallback(async () => {
    setLoading(true)
    const { data, error: err } = await supabase
      .from('project_health')
      .select('*')
      .eq('workspace_id', workspaceId)
    if (err) setError(err.message)
    else { setError(null); setRows((data ?? []) as ProjectHealth[]) }
    setLoading(false)
  }, [workspaceId])

  useEffect(() => { void load() }, [load])

  useEffect(() => {
    const esc = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose() }
    window.addEventListener('keydown', esc)
    document.body.style.overflow = 'hidden'
    return () => {
      window.removeEventListener('keydown', esc)
      document.body.style.overflow = ''
    }
  }, [onClose])

  const submitted = useMemo(
    () => rows.filter(r => r.submitted_at != null)
      .sort((a, b) => Date.parse(a.submitted_at!) - Date.parse(b.submitted_at!)),
    [rows],
  )
  const pending = useMemo(
    () => rows.filter(r => r.submitted_at == null)
      .sort((a, b) => a.name.localeCompare(b.name)),
    [rows],
  )

  const visible = showUnsubmitted ? [...submitted, ...pending] : submitted

  return (
    <div className="fixed inset-0 z-50 overflow-y-auto bg-slate-950 text-slate-100">
      {/* A quiet aurora behind the grid so the projector image is not flat black. */}
      <div
        aria-hidden
        className="pointer-events-none fixed inset-0 bg-[radial-gradient(60rem_40rem_at_15%_-10%,rgba(99,102,241,0.22),transparent),radial-gradient(50rem_35rem_at_95%_10%,rgba(14,165,233,0.16),transparent)]"
      />

      <div className="relative mx-auto max-w-[1600px] px-6 py-8 sm:px-10 sm:py-12">
        <header className="mb-10 flex flex-wrap items-end gap-x-6 gap-y-4">
          <div className="min-w-0">
            <p className="text-xs font-semibold uppercase tracking-[0.25em] text-indigo-300/80">Demo day</p>
            <h1 className="mt-2 text-4xl font-bold tracking-tight text-white sm:text-5xl">The Showcase</h1>
            <p className="mt-2 text-sm text-slate-400">
              {submitted.length} {submitted.length === 1 ? 'project' : 'projects'} submitted
              {pending.length > 0 && <span className="text-slate-500"> · {pending.length} still building</span>}
            </p>
          </div>

          <div className="ml-auto flex flex-wrap items-center gap-2">
            <button
              type="button"
              onClick={() => setShowUnsubmitted(v => !v)}
              aria-pressed={showUnsubmitted}
              className={cx(
                'inline-flex items-center gap-2 rounded-full px-3.5 py-2 text-xs font-medium ring-1 transition',
                showUnsubmitted
                  ? 'bg-indigo-500/20 text-indigo-200 ring-indigo-400/40'
                  : 'text-slate-300 ring-slate-700 hover:bg-slate-800/70',
              )}
            >
              <span className={cx(
                'h-2 w-2 rounded-full',
                showUnsubmitted ? 'bg-indigo-400' : 'bg-slate-600',
              )} aria-hidden />
              Show unsubmitted
            </button>
            <Button variant="ghost" size="sm" className="text-slate-300 hover:bg-slate-800" onClick={() => void load()}>
              Refresh
            </Button>
            <Button variant="outline" size="sm" className="ring-slate-700 text-slate-200 hover:bg-slate-800" onClick={onClose}>
              Close
            </Button>
          </div>
        </header>

        {error && (
          <p role="alert" className="mb-6 rounded-xl bg-rose-950/70 px-4 py-3 text-sm text-rose-300 ring-1 ring-rose-900">
            {error}
          </p>
        )}

        {loading ? (
          <div className="flex items-center justify-center gap-3 py-32 text-slate-400">
            <Spinner className="h-5 w-5" /> Gathering submissions…
          </div>
        ) : visible.length === 0 ? (
          <EmptyState
            showUnsubmitted={showUnsubmitted}
            pending={pending.length}
            onReveal={() => setShowUnsubmitted(true)}
          />
        ) : (
          <ul className="grid grid-cols-1 gap-5 sm:grid-cols-2 lg:grid-cols-3 2xl:grid-cols-4">
            {visible.map((row, i) => (
              <ShowcaseCard key={row.id} row={row} index={i} />
            ))}
          </ul>
        )}
      </div>
    </div>
  )
}

function ShowcaseCard({ row, index }: { row: ProjectHealth; index: number }) {
  const isSubmitted = row.submitted_at != null
  const percent = Math.max(0, Math.min(100, Math.round(Number(row.percent_done) || 0)))
  const accent = row.color || '#6366f1'

  const links: { href: string | null; label: string; emoji: string }[] = [
    { href: row.repo_url, label: 'Code', emoji: '' },
    { href: row.demo_url, label: 'Demo', emoji: '' },
    { href: row.video_url, label: 'Video', emoji: '' },
  ]
  const present = links.filter(l => l.href)

  return (
    <li
      className={cx(
        'group relative flex flex-col overflow-hidden rounded-2xl bg-slate-900/70 p-5 ring-1 backdrop-blur transition',
        isSubmitted
          ? 'ring-slate-800 hover:-translate-y-0.5 hover:ring-slate-700'
          : 'opacity-60 ring-slate-800/70 saturate-50',
      )}
    >
      <span aria-hidden className="absolute inset-x-0 top-0 h-1" style={{ background: accent }} />

      <div className="flex items-start gap-3">
        <span
          aria-hidden
          className="mt-0.5 flex h-9 w-9 shrink-0 items-center justify-center rounded-xl text-sm font-bold text-white"
          style={{ background: accent }}
        >
          {String(index + 1).padStart(2, '0')}
        </span>
        <div className="min-w-0 flex-1">
          <p className="truncate text-xs font-medium uppercase tracking-wider text-slate-400">
            {row.team_name ?? 'No team'}
          </p>
          <h2 className="mt-0.5 text-lg font-semibold leading-tight text-white" title={row.name}>
            {row.name}
          </h2>
        </div>
      </div>

      <div className="mt-5">
        <div className="flex items-center justify-between text-xs text-slate-400">
          <span>Progress</span>
          <span className="font-semibold tabular-nums text-slate-200">{percent}%</span>
        </div>
        <div className="mt-1.5 h-2 overflow-hidden rounded-full bg-slate-800" role="img" aria-label={`${percent} percent of tasks done`}>
          <div className="h-full rounded-full transition-[width]" style={{ width: `${percent}%`, background: accent }} />
        </div>
        <p className="mt-1.5 text-[11px] text-slate-500">
          {row.done_tasks} of {row.total_tasks} tasks done
          {row.blocked_tasks > 0 && <span className="text-rose-400"> · {row.blocked_tasks} blocked</span>}
        </p>
      </div>

      <div className="mt-auto pt-5">
        {present.length > 0 ? (
          <div className="flex flex-wrap gap-2">
            {present.map(l => (
              <a
                key={l.label}
                href={l.href!}
                target="_blank"
                rel="noreferrer noopener"
                className="inline-flex items-center gap-1.5 rounded-lg bg-slate-800/80 px-3 py-1.5 text-xs font-medium text-slate-200 ring-1 ring-slate-700 transition hover:bg-slate-700 hover:text-white"
              >
                <span aria-hidden>{l.emoji}</span>
                {l.label}
              </a>
            ))}
          </div>
        ) : (
          <p className="text-xs text-slate-600">No links shared</p>
        )}

        <p className="mt-3 text-[11px] text-slate-500">
          {isSubmitted && row.submitted_at
            ? <>Submitted {new Date(row.submitted_at).toLocaleString(undefined, { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' })}</>
            : 'Not submitted yet'}
        </p>
      </div>
    </li>
  )
}

function EmptyState({ showUnsubmitted, pending, onReveal }: {
  showUnsubmitted: boolean
  pending: number
  onReveal: () => void
}) {
  return (
    <div className="mx-auto max-w-md rounded-2xl border border-dashed border-slate-800 px-8 py-16 text-center">
      <p className="text-4xl" aria-hidden></p>
      <h2 className="mt-4 text-lg font-semibold text-white">Nothing on stage yet</h2>
      <p className="mt-2 text-sm text-slate-400">
        {pending > 0
          ? `${pending} ${pending === 1 ? 'project is' : 'projects are'} still being built. They appear here the moment a team marks their work as submitted.`
          : 'Projects appear here the moment a team marks their work as submitted.'}
      </p>
      {pending > 0 && !showUnsubmitted && (
        <Button className="mt-5" size="sm" variant="outline" onClick={onReveal}>
          Show what is in progress
        </Button>
      )}
    </div>
  )
}
