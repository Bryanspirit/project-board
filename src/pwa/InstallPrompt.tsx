import { useCallback, useEffect, useRef, useState } from 'react'
import { Button, cx } from '../components/ui'
import { setupSW, updateServiceWorker } from './registerSW'

/** Not in lib.dom — Chromium-only, and still not in the manifest spec. */
type BeforeInstallPromptEvent = Event & {
  prompt: () => Promise<void>
  userChoice: Promise<{ outcome: 'accepted' | 'dismissed' }>
}

const DISMISS_KEY = 'pwa-install-dismissed-at'
const DISMISS_MS = 30 * 24 * 60 * 60 * 1000 // 30 days

/** Every storage read is guarded: private windows can throw on access. */
function dismissedRecently(): boolean {
  try {
    const raw = localStorage.getItem(DISMISS_KEY)
    if (!raw) return false
    const at = Number(raw)
    return Number.isFinite(at) && Date.now() - at < DISMISS_MS
  } catch {
    return false
  }
}

function rememberDismissal(): void {
  try {
    localStorage.setItem(DISMISS_KEY, String(Date.now()))
  } catch {
    /* nothing to remember it in; the bar just returns next visit */
  }
}

/** Already launched from the home screen — there is nothing left to install. */
function isStandalone(): boolean {
  try {
    const modes = ['standalone', 'fullscreen', 'minimal-ui']
    if (modes.some(m => window.matchMedia(`(display-mode: ${m})`).matches)) return true
    // iOS Safari predates display-mode and uses its own flag.
    return (navigator as Navigator & { standalone?: boolean }).standalone === true
  } catch {
    return false
  }
}

/**
 * iOS never fires `beforeinstallprompt`; installing is a manual trip through
 * the Share sheet, so the only thing we can offer there is instructions.
 */
function isIOSSafari(): boolean {
  try {
    const ua = navigator.userAgent
    const iOS = /iPad|iPhone|iPod/.test(ua) ||
      // iPadOS 13+ reports as a Mac; touch points give it away.
      (/Macintosh/.test(ua) && navigator.maxTouchPoints > 1)
    if (!iOS) return false
    // Chrome/Firefox/Edge on iOS are WebKit shells without Add to Home Screen.
    return !/CriOS|FxiOS|EdgiOS|OPiOS|Mercury/.test(ua)
  } catch {
    return false
  }
}

const BAR = 'fixed inset-x-0 bottom-0 z-40 safe-bottom safe-x ' +
  'border-t border-slate-200 bg-white/95 backdrop-blur ' +
  'dark:border-slate-800 dark:bg-slate-900/95'

const ROW = 'mx-auto flex max-w-3xl items-center gap-3 px-4 py-3'

const CLOSE = 'flex h-11 w-11 shrink-0 items-center justify-center rounded-lg text-slate-400 ' +
  'transition hover:bg-slate-100 hover:text-slate-700 ' +
  'dark:hover:bg-slate-800 dark:hover:text-slate-200'

function BoardMark() {
  return (
    <span
      aria-hidden="true"
      className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl bg-indigo-600"
    >
      <svg viewBox="0 0 24 24" className="h-6 w-6" fill="currentColor">
        <g className="text-white" fill="currentColor">
          <rect x="3" y="4" width="5" height="16" rx="1.5" />
          <rect x="9.5" y="4" width="5" height="10" rx="1.5" opacity="0.75" />
          <rect x="16" y="4" width="5" height="13" rx="1.5" opacity="0.88" />
        </g>
      </svg>
    </span>
  )
}

function CloseIcon() {
  return (
    <svg viewBox="0 0 20 20" className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth="2">
      <path d="M5 5l10 10M15 5L5 15" strokeLinecap="round" />
    </svg>
  )
}

/**
 * A dismissible bar offering installation. Renders nothing when the app is
 * already running standalone, when the browser has no install path, or within
 * 30 days of a dismissal.
 */
export default function InstallPrompt() {
  const [prompt, setPrompt] = useState<BeforeInstallPromptEvent | null>(null)
  const [showIOS, setShowIOS] = useState(false)
  const [hidden, setHidden] = useState(true)

  useEffect(() => {
    if (isStandalone() || dismissedRecently()) return
    setHidden(false)

    // iOS gets the instructions immediately; everyone else waits for the event.
    if (isIOSSafari()) setShowIOS(true)

    const onBeforeInstall = (e: Event) => {
      // Suppress Chrome's own mini-infobar so ours is the only offer.
      e.preventDefault()
      setPrompt(e as BeforeInstallPromptEvent)
    }
    const onInstalled = () => {
      setPrompt(null)
      setShowIOS(false)
      setHidden(true)
    }

    window.addEventListener('beforeinstallprompt', onBeforeInstall)
    window.addEventListener('appinstalled', onInstalled)
    return () => {
      window.removeEventListener('beforeinstallprompt', onBeforeInstall)
      window.removeEventListener('appinstalled', onInstalled)
    }
  }, [])

  const dismiss = useCallback(() => {
    rememberDismissal()
    setHidden(true)
  }, [])

  const install = useCallback(async () => {
    if (!prompt) return
    try {
      await prompt.prompt()
      const { outcome } = await prompt.userChoice
      // A declined install should not nag; treat it like a dismissal.
      if (outcome === 'dismissed') rememberDismissal()
    } catch {
      /* the event can only be used once; nothing to recover */
    }
    setPrompt(null)
    setHidden(true)
  }, [prompt])

  if (hidden || (!prompt && !showIOS)) return null

  return (
    <div className={BAR} role="region" aria-label="Install this app">
      <div className={ROW}>
        <BoardMark />
        <div className="min-w-0 flex-1">
          <p className="text-sm font-medium text-slate-900 dark:text-slate-100">
            Install Project Board
          </p>
          <p className="mt-0.5 text-xs leading-snug text-slate-600 dark:text-slate-400">
            {showIOS ? (
              <>
                Tap <span aria-hidden="true">⬆︎</span> <span className="font-medium">Share</span>, then{' '}
                <span className="font-medium">Add to Home Screen</span>.
              </>
            ) : (
              'Get a full-screen app icon and faster launches.'
            )}
          </p>
        </div>
        {prompt && (
          <Button onClick={() => void install()} className="min-h-[44px] shrink-0">
            Install
          </Button>
        )}
        <button type="button" onClick={dismiss} aria-label="Dismiss install prompt" className={CLOSE}>
          <CloseIcon />
        </button>
      </div>
    </div>
  )
}

const TOAST = 'fixed inset-x-0 bottom-0 z-50 safe-bottom safe-x pointer-events-none'

const CARD = 'pointer-events-auto mx-auto m-3 flex max-w-md items-center gap-3 rounded-xl px-4 py-3 ' +
  'shadow-lg ring-1 ring-slate-200 bg-white dark:bg-slate-900 dark:ring-slate-800'

/**
 * Owns the service worker lifecycle: mounting this registers the worker and
 * surfaces the "new version" prompt. Mount it once, near the app root — there
 * is no need to call `setupSW` anywhere else.
 */
export function UpdateToast() {
  const [needRefresh, setNeedRefresh] = useState(false)
  const [offlineReady, setOfflineReady] = useState(false)
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null)

  useEffect(() => {
    // useState setters are stable, so these callbacks stay valid for the life
    // of the component even though setupSW only ever keeps the first pair.
    setupSW(
      () => setNeedRefresh(true),
      () => setOfflineReady(true),
    )
  }, [])

  useEffect(() => {
    if (!offlineReady) return
    timer.current = setTimeout(() => setOfflineReady(false), 4000)
    return () => {
      if (timer.current) clearTimeout(timer.current)
    }
  }, [offlineReady])

  if (!needRefresh && !offlineReady) return null

  return (
    <div className={TOAST} role="status" aria-live="polite">
      <div className={CARD}>
        <p
          className={cx(
            'min-w-0 flex-1 text-sm',
            needRefresh
              ? 'font-medium text-slate-900 dark:text-slate-100'
              : 'text-slate-600 dark:text-slate-300',
          )}
        >
          {needRefresh ? 'A new version is available.' : 'Ready to work offline.'}
        </p>
        {needRefresh ? (
          <>
            <Button onClick={updateServiceWorker} className="min-h-[44px] shrink-0">
              Reload
            </Button>
            <button
              type="button"
              onClick={() => setNeedRefresh(false)}
              aria-label="Dismiss update notice"
              className={CLOSE}
            >
              <CloseIcon />
            </button>
          </>
        ) : (
          <button
            type="button"
            onClick={() => setOfflineReady(false)}
            aria-label="Dismiss"
            className={CLOSE}
          >
            <CloseIcon />
          </button>
        )}
      </div>
    </div>
  )
}
