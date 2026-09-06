import type { ReactNode } from 'react'
import type { Project, Task } from '../lib/types'
import { Button, cx } from './ui'

function progress(tasks: Task[]) {
  if (tasks.length === 0) return 0
  return Math.round((tasks.filter(t => t.status === 'done').length / tasks.length) * 100)
}

export default function Sidebar({
  projects, byProject, activeId, onSelect, onNew, onEdit, open, onClose, header,
}: {
  projects: Project[]
  byProject: Map<string, Task[]>
  activeId: string | null
  onSelect: (id: string) => void
  onNew: () => void
  onEdit: (p: Project) => void
  open: boolean
  onClose: () => void
  /** Workspace switcher and team list, rendered above the project list. */
  header?: ReactNode
}) {
  const visible = projects.filter(p => p.status !== 'archived')
  const archived = projects.filter(p => p.status === 'archived')

  const list = (items: Project[]) => items.map(p => {
    const tasks = byProject.get(p.id) ?? []
    const pct = progress(tasks)
    const blocked = tasks.filter(t => t.status === 'blocked').length
    const active = p.id === activeId

    return (
      <li key={p.id}>
        <div
          role="button"
          tabIndex={0}
          onClick={() => { onSelect(p.id); onClose() }}
          onKeyDown={e => { if (e.key === 'Enter') { onSelect(p.id); onClose() } }}
          className={cx(
            'group w-full cursor-pointer rounded-lg px-2.5 py-2 text-left transition',
            active
              ? 'bg-white shadow-sm ring-1 ring-slate-200 dark:bg-slate-800 dark:ring-slate-700'
              : 'hover:bg-slate-200/60 dark:hover:bg-slate-800/60',
          )}
        >
          <div className="flex items-center gap-2">
            <span className="h-2.5 w-2.5 shrink-0 rounded-full" style={{ backgroundColor: p.color }} aria-hidden />
            <span className="min-w-0 flex-1 truncate text-sm font-medium">{p.name}</span>
            {blocked > 0 && (
              <span title={`${blocked} blocked`}
                className="shrink-0 rounded-full bg-rose-100 px-1.5 text-[10px] font-semibold text-rose-700 dark:bg-rose-950 dark:text-rose-300">
                {blocked}
              </span>
            )}
            <button
              onClick={e => { e.stopPropagation(); onEdit(p) }}
              aria-label={`Edit ${p.name}`}
              className="shrink-0 rounded p-0.5 text-slate-400 opacity-0 transition group-hover:opacity-100 hover:text-slate-700 focus:opacity-100 dark:hover:text-slate-200"
            >
              <svg viewBox="0 0 16 16" className="h-3.5 w-3.5" fill="none" stroke="currentColor" strokeWidth="1.5">
                <path d="M11.5 2.5a1.7 1.7 0 0 1 2.4 2.4L5.6 13.2l-3.1.7.7-3.1 8.3-8.3Z" strokeLinejoin="round" />
              </svg>
            </button>
          </div>

          <div className="mt-1.5 flex items-center gap-2 pl-4.5">
            <div className="h-1 flex-1 overflow-hidden rounded-full bg-slate-200 dark:bg-slate-700">
              <div className="h-full rounded-full transition-all"
                style={{ width: `${pct}%`, backgroundColor: p.color }} />
            </div>
            <span className="w-8 shrink-0 text-right text-[10px] tabular-nums text-slate-400">{pct}%</span>
          </div>
        </div>
      </li>
    )
  })

  return (
    <>
      {open && <div className="fixed inset-0 z-30 bg-slate-900/40 lg:hidden" onClick={onClose} aria-hidden />}

      <aside className={cx(
        'z-40 flex w-64 shrink-0 flex-col border-r border-slate-200 bg-slate-100 dark:border-slate-800 dark:bg-slate-900/60',
        'fixed inset-y-0 left-0 transition-transform lg:static lg:translate-x-0',
        open ? 'translate-x-0' : '-translate-x-full',
      )}>
        {header ?? (
          <div className="flex items-center gap-2 px-4 py-4">
            <span className="text-lg" aria-hidden>🗂️</span>
            <span className="text-sm font-semibold tracking-tight">Project Board</span>
          </div>
        )}

        <nav className="flex-1 overflow-y-auto px-2.5 pb-4">
          <h2 className="px-2.5 py-1.5 text-[10px] font-semibold tracking-wider text-slate-400 uppercase">
            Projects
          </h2>
          <ul className="space-y-0.5">{list(visible)}</ul>

          {archived.length > 0 && (
            <>
              <h2 className="mt-4 px-2.5 py-1.5 text-[10px] font-semibold tracking-wider text-slate-400 uppercase">
                Archived
              </h2>
              <ul className="space-y-0.5 opacity-60">{list(archived)}</ul>
            </>
          )}

          {projects.length === 0 && (
            <p className="px-2.5 py-4 text-xs leading-relaxed text-slate-400">
              No projects yet. Create one to start tracking work.
            </p>
          )}
        </nav>

        <div className="border-t border-slate-200 p-2.5 dark:border-slate-800">
          <Button variant="outline" className="w-full" onClick={onNew}>
            <svg viewBox="0 0 16 16" className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth="2">
              <path d="M8 3v10M3 8h10" strokeLinecap="round" />
            </svg>
            New project
          </Button>
        </div>
      </aside>
    </>
  )
}
