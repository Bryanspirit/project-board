/// <reference types="vite-plugin-pwa/client" />

import { registerSW } from 'virtual:pwa-register'

/** Reloads into the waiting worker. Resolves to a no-op before setup runs. */
export type UpdateSW = (reloadPage?: boolean) => Promise<void>

const noop: UpdateSW = async () => {}

let updateSW: UpdateSW = noop
let started = false

/**
 * Activates the waiting service worker and reloads. Safe to call at any time —
 * before `setupSW`, or where service workers do not exist, it does nothing.
 */
export function updateServiceWorker(): void {
  void Promise.resolve(updateSW(true)).catch(() => {
    // The worker went away between the prompt and the click. Falling back to a
    // plain reload still gets the user onto the newest shell.
    try {
      window.location.reload()
    } catch {
      /* nothing sensible left to do */
    }
  })
}

/** True where a service worker could plausibly register. */
function supported(): boolean {
  try {
    // Secure context is required; localhost counts. In-app browsers and some
    // private windows expose navigator but throw or return undefined here.
    return (
      typeof window !== 'undefined' &&
      typeof navigator !== 'undefined' &&
      'serviceWorker' in navigator &&
      window.isSecureContext === true
    )
  } catch {
    return false
  }
}

/**
 * Registers the generated service worker.
 *
 * Everything here is best-effort and silent on failure: private windows, some
 * in-app browsers (Instagram, older WebViews) and locked-down enterprise
 * policies either hide `navigator.serviceWorker` or reject `register()`, and
 * none of that should surface to the user or break the app. Registration is
 * also deferred past `load` so it never competes with first paint.
 *
 * @param onNeedRefresh  a new version is waiting — show the UpdateToast
 * @param onOfflineReady the shell is cached and the app now works offline
 */
export function setupSW(onNeedRefresh?: () => void, onOfflineReady?: () => void): void {
  if (started || !supported()) return
  started = true

  const start = () => {
    try {
      updateSW = registerSW({
        // We schedule registration ourselves, below.
        immediate: true,
        onNeedRefresh: () => {
          try {
            onNeedRefresh?.()
          } catch {
            /* a broken callback must not break the worker */
          }
        },
        onOfflineReady: () => {
          try {
            onOfflineReady?.()
          } catch {
            /* as above */
          }
        },
        onRegisterError: () => {
          // Blocked or unsupported. The app works fine without a worker.
          updateSW = noop
        },
      })
    } catch {
      updateSW = noop
    }
  }

  try {
    if (document.readyState === 'complete') {
      // Already loaded (e.g. a late mount) — yield a frame rather than
      // registering inside the current task.
      setTimeout(start, 0)
    } else {
      window.addEventListener('load', start, { once: true })
    }
  } catch {
    /* no window/document: nothing to register against */
  }
}
