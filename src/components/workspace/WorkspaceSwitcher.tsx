import { useEffect, useMemo, useRef, useState } from 'react'
import type { Workspace, WorkspaceKind, WorkspaceRole } from '../../lib/types'
import { WORKSPACE_ROLES } from '../../lib/types'
import { cx } from '../ui'
import { Mark } from '../Mark'

const KIND_LABELS: Record<WorkspaceKind, string> = {
  personal: 'Personal',
  hackathon: 'Hackathons',
  program: 'Programmes',
  team: 'Teams',
}

/** Group order in the menu — the private workspace first, then the cohorts. */
const KIND_ORDER: WorkspaceKind[] = ['personal', 'hackathon', 'program', 'team']

function roleLabel(role: WorkspaceRole | null): string | null {
  if (!role) return null
  return WORKSPACE_ROLES.find(r => r.id === role)?.label ?? role
}

export default function WorkspaceSwitcher({
  workspaces, activeWorkspace, onSelect, myRole, canCreate = false, onNew, className,
}: {
  workspaces: Workspace[]
  activeWorkspace: Workspace | null
  onSelect: (id: string) => void
  myRole: (workspaceId: string) => WorkspaceRole | null
  canCreate?: boolean
  onNew?: () => void
  className?: string
}) {
  const [open, setOpen] = useState(false)
  const [cursor, setCursor] = useState(0)
  const rootRef = useRef<HTMLDivElement>(null)
  const triggerRef = useRef<HTMLButtonElement>(null)
  const itemRefs = useRef<(HTMLButtonElement | null)[]>([])

  // Flat, in menu order — the keyboard walks this, the render walks the groups.
  const groups = useMemo(() => {
    const buckets = new Map<WorkspaceKind, Workspace[]>()
    for (const w of workspaces) {
      const list = buckets.get(w.kind)
      if (list) list.push(w)
      else buckets.set(w.kind, [w])
    }
    return KIND_ORDER
      .filter(kind => buckets.has(kind))
      .map(kind => ({ kind, items: buckets.get(kind) as Workspace[] }))
  }, [workspaces])

  const flat = useMemo(() => groups.flatMap(g => g.items), [groups])
  const showNew = canCreate && Boolean(onNew)
  const itemCount = flat.length + (showNew ? 1 : 0)

  function close(focusTrigger = true) {
    setOpen(false)
    if (focusTrigger) triggerRef.current?.focus()
  }

  // Escape anywhere, and any click that lands outside the menu, dismiss it.
  useEffect(() => {
    if (!open) return
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') { e.stopPropagation(); close() } }
    const onDown = (e: MouseEvent) => {
      if (!rootRef.current?.contains(e.target as Node)) setOpen(false)
    }
    document.addEventListener('keydown', onKey, true)
    document.addEventListener('mousedown', onDown)
    return () => {
      document.removeEventListener('keydown', onKey, true)
      document.removeEventListener('mousedown', onDown)
    }
  }, [open])

  useEffect(() => {
    if (open) itemRefs.current[cursor]?.focus()
  }, [open, cursor])

  function openAt(index: number) {
    setCursor(Math.max(0, Math.min(index, itemCount - 1)))
    setOpen(true)
  }

  function onTriggerKeyDown(e: React.KeyboardEvent) {
    if (e.key === 'ArrowDown' || e.key === 'Enter' || e.key === ' ') {
      e.preventDefault()
      const current = flat.findIndex(w => w.id === activeWorkspace?.id)
      openAt(current < 0 ? 0 : current)
    } else if (e.key === 'ArrowUp') {
      e.preventDefault()
      openAt(itemCount - 1)
    }
  }

  function onMenuKeyDown(e: React.KeyboardEvent) {
    if (itemCount === 0) return
    if (e.key === 'ArrowDown') { e.preventDefault(); setCursor(c => (c + 1) % itemCount) }
    else if (e.key === 'ArrowUp') { e.preventDefault(); setCursor(c => (c - 1 + itemCount) % itemCount) }
    else if (e.key === 'Home') { e.preventDefault(); setCursor(0) }
    else if (e.key === 'End') { e.preventDefault(); setCursor(itemCount - 1) }
    else if (e.key === 'Tab') close(false)
  }

  const activeRole = roleLabel(activeWorkspace ? myRole(activeWorkspace.id) : null)
  itemRefs.current = []

  let index = -1
  const register = (el: HTMLButtonElement | null, at: number) => { itemRefs.current[at] = el }

  return (
    <div ref={rootRef} className={cx('relative', className)}>
      <button
        ref={triggerRef}
        type="button"
        onClick={() => (open ? close(false) : openAt(Math.max(0, flat.findIndex(w => w.id === activeWorkspace?.id))))}
        onKeyDown={onTriggerKeyDown}
        aria-haspopup="menu"
        aria-expanded={open}
        aria-label="Switch workspace"
        className={cx(
          'flex w-full items-center gap-2.5 rounded-xl px-2.5 py-2 text-left transition',
          'ring-1 ring-slate-200 hover:bg-white dark:ring-slate-800 dark:hover:bg-slate-800/70',
          open && 'bg-white dark:bg-slate-800/70',
        )}
      >
        {activeWorkspace
          ? <Mark name={activeWorkspace.name} color={activeWorkspace.color} size="sm" />
          : <span className="h-6 w-6 shrink-0 rounded-md bg-slate-200 dark:bg-slate-700" aria-hidden />}
        <span className="min-w-0 flex-1">
          <span className="block truncate text-sm font-semibold text-slate-800 dark:text-slate-100">
            {activeWorkspace?.name ?? 'No workspace'}
          </span>
          <span className="block truncate text-[11px] text-slate-500 dark:text-slate-400">
            {activeWorkspace
              ? `${KIND_LABELS[activeWorkspace.kind].replace(/s$/, '')}${activeRole ? ` · ${activeRole}` : ''}`
              : 'Nothing to show yet'}
          </span>
        </span>
        <svg viewBox="0 0 16 16" className="h-3.5 w-3.5 shrink-0 text-slate-400" fill="none"
          stroke="currentColor" strokeWidth="1.8" aria-hidden>
          <path d="M4.5 6.5 8 3l3.5 3.5M4.5 9.5 8 13l3.5-3.5" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
      </button>

      {open && (
        <div
          role="menu"
          aria-label="Workspaces"
          onKeyDown={onMenuKeyDown}
          className={cx(
            'absolute inset-x-0 top-full z-50 mt-1 max-h-80 overflow-y-auto rounded-xl p-1.5 shadow-xl',
            'bg-white ring-1 ring-slate-200 dark:bg-slate-900 dark:ring-slate-700',
          )}
        >
          {groups.length === 0 && (
            <p className="px-2.5 py-3 text-xs text-slate-500 dark:text-slate-400">
              You are not in any workspace yet.
            </p>
          )}

          {groups.map(group => (
            <div key={group.kind} className="mb-1 last:mb-0">
              <p className="px-2.5 py-1 text-[10px] font-semibold tracking-wider text-slate-400 uppercase">
                {KIND_LABELS[group.kind]}
              </p>
              {group.items.map(w => {
                index += 1
                const at = index
                const selected = w.id === activeWorkspace?.id
                const role = roleLabel(myRole(w.id))
                return (
                  <button
                    key={w.id}
                    ref={el => register(el, at)}
                    role="menuitemradio"
                    aria-checked={selected}
                    tabIndex={cursor === at ? 0 : -1}
                    onFocus={() => setCursor(at)}
                    onClick={() => { onSelect(w.id); close() }}
                    className={cx(
                      'flex w-full items-center gap-2.5 rounded-lg px-2.5 py-2 text-left transition',
                      'focus:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500',
                      selected
                        ? 'bg-slate-100 dark:bg-slate-800'
                        : 'hover:bg-slate-100 dark:hover:bg-slate-800/70',
                    )}
                  >
                    <Mark name={w.name} color={w.color} size="sm" />
                    <span className="min-w-0 flex-1">
                      <span className="block truncate text-sm text-slate-800 dark:text-slate-100">
                        {w.name}
                        {w.is_archived && <span className="ml-1.5 text-[10px] text-slate-400">archived</span>}
                      </span>
                    </span>
                    {role && (
                      <span className="shrink-0 rounded-full bg-slate-100 px-1.5 py-0.5 text-[10px] font-medium text-slate-600 ring-1 ring-slate-200 dark:bg-slate-800 dark:text-slate-300 dark:ring-slate-700">
                        {role}
                      </span>
                    )}
                    {selected && (
                      <svg viewBox="0 0 16 16" className="h-3.5 w-3.5 shrink-0 text-indigo-500" fill="none"
                        stroke="currentColor" strokeWidth="2" aria-hidden>
                        <path d="m3.5 8.5 3 3 6-7" strokeLinecap="round" strokeLinejoin="round" />
                      </svg>
                    )}
                  </button>
                )
              })}
            </div>
          ))}

          {showNew && (() => {
            index += 1
            const at = index
            return (
              <div className="mt-1 border-t border-slate-200 pt-1.5 dark:border-slate-800">
                <button
                  ref={el => register(el, at)}
                  type="button"
                  role="menuitem"
                  tabIndex={cursor === at ? 0 : -1}
                  onFocus={() => setCursor(at)}
                  onClick={() => { close(false); onNew?.() }}
                  className={cx(
                    'flex w-full items-center gap-2 rounded-lg px-2.5 py-2 text-left text-sm font-medium transition',
                    'text-slate-600 hover:bg-slate-100 dark:text-slate-300 dark:hover:bg-slate-800/70',
                    'focus:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500',
                  )}
                >
                  <svg viewBox="0 0 16 16" className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden>
                    <path d="M8 3v10M3 8h10" strokeLinecap="round" />
                  </svg>
                  New workspace
                </button>
              </div>
            )
          })()}
        </div>
      )}
    </div>
  )
}
