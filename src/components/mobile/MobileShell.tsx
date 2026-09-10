import { useState } from 'react'
import type { ReactNode } from 'react'
import { Modal, cx } from '../ui'
import { BrandMark } from '../Mark'

export type MobileTab = 'boards' | 'calendar' | 'mine' | 'more'

interface Item {
  id: MobileTab
  label: string
  icon: ReactNode
}

const ICON = 'h-5 w-5'

const ITEMS: Item[] = [
  {
    id: 'boards', label: 'Boards',
    icon: <svg viewBox="0 0 24 24" className={ICON} fill="none" stroke="currentColor" strokeWidth="1.7">
      <rect x="3" y="4" width="6" height="16" rx="1.5" /><rect x="11" y="4" width="6" height="10" rx="1.5" />
      <path d="M19 4h2v7h-2z" />
    </svg>,
  },
  {
    id: 'calendar', label: 'Calendar',
    icon: <svg viewBox="0 0 24 24" className={ICON} fill="none" stroke="currentColor" strokeWidth="1.7">
      <rect x="3" y="5" width="18" height="16" rx="2" /><path d="M3 10h18M8 3v4M16 3v4" strokeLinecap="round" />
    </svg>,
  },
  {
    id: 'mine', label: 'My tasks',
    icon: <svg viewBox="0 0 24 24" className={ICON} fill="none" stroke="currentColor" strokeWidth="1.7">
      <path d="M4 7h16M4 12h16M4 17h9" strokeLinecap="round" />
    </svg>,
  },
  {
    id: 'more', label: 'More',
    icon: <svg viewBox="0 0 24 24" className={ICON} fill="none" stroke="currentColor" strokeWidth="1.7">
      <circle cx="5" cy="12" r="1.5" /><circle cx="12" cy="12" r="1.5" /><circle cx="19" cy="12" r="1.5" />
    </svg>,
  },
]

/**
 * The phone chrome: a compact top bar with a single back affordance, and a
 * bottom tab bar within thumb reach.
 *
 * The desktop header carries nine icon buttons across one row. That is fine
 * with a mouse and unusable with a thumb, so the rarely-pressed half moves into
 * a "More" sheet and the rest becomes four fixed destinations.
 */
export default function MobileShell({
  title, subtitle, onBack, tab, onTabChange, bell, more, children,
}: {
  title: string
  subtitle?: string | null
  /** Omitted at the top of the drill-down, where there is nowhere to go back to. */
  onBack?: () => void
  tab: MobileTab
  onTabChange: (t: MobileTab) => void
  /** The notification bell, passed through so it keeps its own state. */
  bell?: ReactNode
  /** Rows for the More sheet. */
  more: { label: string; hint?: string; onSelect: () => void; danger?: boolean }[]
  children: ReactNode
}) {
  const [moreOpen, setMoreOpen] = useState(false)

  return (
    <div className="flex h-full flex-col overflow-hidden">
      <header className="flex shrink-0 items-center gap-1 border-b border-slate-200 px-2 pt-[env(safe-area-inset-top)] pb-2 dark:border-slate-800">
        {onBack ? (
          <button
            onClick={onBack}
            aria-label="Back"
            className="flex h-11 w-11 shrink-0 items-center justify-center rounded-lg text-slate-500 active:bg-slate-100 dark:text-slate-400 dark:active:bg-slate-800"
          >
            <svg viewBox="0 0 24 24" className="h-5 w-5" fill="none" stroke="currentColor" strokeWidth="2">
              <path d="M15 5l-7 7 7 7" strokeLinecap="round" strokeLinejoin="round" />
            </svg>
          </button>
        ) : (
          <span className="flex h-11 w-11 shrink-0 items-center justify-center text-indigo-600 dark:text-indigo-400">
            <BrandMark />
          </span>
        )}

        <div className="min-w-0 flex-1 px-1">
          <h1 className="truncate text-base font-semibold tracking-tight">{title}</h1>
          {subtitle && (
            <p className="truncate text-xs text-slate-500 dark:text-slate-400">{subtitle}</p>
          )}
        </div>

        {bell}
      </header>

      <div className="min-h-0 flex-1 overflow-hidden">{children}</div>

      <nav
        aria-label="Main"
        className="flex shrink-0 items-stretch border-t border-slate-200 bg-white pb-[env(safe-area-inset-bottom)] dark:border-slate-800 dark:bg-slate-950"
      >
        {ITEMS.map(item => {
          const on = tab === item.id
          return (
            <button
              key={item.id}
              onClick={() => (item.id === 'more' ? setMoreOpen(true) : onTabChange(item.id))}
              aria-current={on ? 'page' : undefined}
              className={cx(
                'flex min-h-14 flex-1 flex-col items-center justify-center gap-0.5 text-[10px] font-medium transition',
                on ? 'text-indigo-600 dark:text-indigo-400' : 'text-slate-500 dark:text-slate-400',
              )}
            >
              {item.icon}
              {item.label}
            </button>
          )
        })}
      </nav>

      {moreOpen && (
        <Modal title="More" onClose={() => setMoreOpen(false)}>
          <ul className="-my-2 divide-y divide-slate-200 dark:divide-slate-800">
            {more.map(row => (
              <li key={row.label}>
                <button
                  onClick={() => { setMoreOpen(false); row.onSelect() }}
                  className={cx(
                    'flex min-h-14 w-full items-center justify-between gap-3 text-left transition active:bg-slate-50 dark:active:bg-slate-800/60',
                    row.danger ? 'text-rose-600 dark:text-rose-400' : '',
                  )}
                >
                  <span className="min-w-0">
                    <span className="block text-sm font-medium">{row.label}</span>
                    {row.hint && (
                      <span className="block text-xs text-slate-500 dark:text-slate-400">{row.hint}</span>
                    )}
                  </span>
                  <svg viewBox="0 0 16 16" className="h-4 w-4 shrink-0 text-slate-300 dark:text-slate-600"
                    fill="none" stroke="currentColor" strokeWidth="2" aria-hidden>
                    <path d="M6 3.5 10.5 8 6 12.5" strokeLinecap="round" strokeLinejoin="round" />
                  </svg>
                </button>
              </li>
            ))}
          </ul>
        </Modal>
      )}
    </div>
  )
}
