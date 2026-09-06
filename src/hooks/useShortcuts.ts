import { createElement as h, useEffect, useRef } from 'react'
import { Modal } from '../components/ui'

/** One entry per binding the board understands. Every handler is optional so a
 *  screen can take only the shortcuts it can actually service. */
export interface ShortcutHandlers {
  /** `n` — start a new task. */
  newTask?: () => void
  /** `/` — move focus into the search box. */
  focusSearch?: () => void
  /** `p` — open the project switcher. */
  openProjects?: () => void
  /** `?` — show the cheatsheet. */
  showHelp?: () => void
  /** `Escape` — close whatever is open. */
  closeOverlays?: () => void
}

export const SHORTCUTS: { keys: string; label: string }[] = [
  { keys: 'n', label: 'New task' },
  { keys: '/', label: 'Search tasks' },
  { keys: 'p', label: 'Switch project' },
  { keys: '?', label: 'Show this cheatsheet' },
  { keys: 'Esc', label: 'Close dialogs and popovers' },
]

/** True for anything that swallows plain letters — a shortcut firing here would
 *  eat the keystroke the person meant to type. */
function isTypingTarget(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false
  if (target.isContentEditable) return true
  const tag = target.tagName
  return tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT'
}

/**
 * Binds the board's single-key shortcuts to the window.
 *
 * Handlers are read through a ref so passing fresh closures on every render
 * (the normal case) does not re-bind the listener.
 */
export function useShortcuts(handlers: ShortcutHandlers, enabled = true) {
  const latest = useRef(handlers)
  latest.current = handlers

  useEffect(() => {
    if (!enabled) return

    function onKeyDown(e: KeyboardEvent) {
      // Shift is deliberately allowed — `?` needs it on most layouts.
      if (e.ctrlKey || e.metaKey || e.altKey) return
      if (e.isComposing) return
      if (isTypingTarget(e.target)) return
      // A modal owns the keyboard while it is open — it handles its own Escape,
      // and `n` must not file a task behind the dialog someone is editing.
      if (document.querySelector('[role="dialog"][aria-modal="true"]')) return

      const map = latest.current
      const run = (fn: (() => void) | undefined) => {
        if (!fn) return
        e.preventDefault()
        fn()
      }

      switch (e.key) {
        case 'n': case 'N': return run(map.newTask)
        case '/': return run(map.focusSearch)
        case 'p': case 'P': return run(map.openProjects)
        case '?': return run(map.showHelp)
        case 'Escape': return run(map.closeOverlays)
        default: return
      }
    }

    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [enabled])
}

const KBD = 'rounded-md bg-slate-100 px-2 py-1 font-mono text-xs font-semibold ' +
  'text-slate-700 ring-1 ring-slate-300 dark:bg-slate-800 dark:text-slate-200 dark:ring-slate-700'

/** The `?` cheatsheet. Written with createElement so the hook can stay a `.ts`
 *  module while still owning its own presentation. */
export function ShortcutHelp({ onClose }: { onClose: () => void }) {
  return h(Modal, {
    title: 'Keyboard shortcuts',
    onClose,
    children: h(
      'ul',
      { className: 'divide-y divide-slate-200 dark:divide-slate-800' },
      SHORTCUTS.map(s =>
        h(
          'li',
          { key: s.keys, className: 'flex items-center justify-between gap-4 py-2.5' },
          h('span', { className: 'text-sm text-slate-600 dark:text-slate-300' }, s.label),
          h('kbd', { className: KBD }, s.keys),
        )),
    ),
  })
}
