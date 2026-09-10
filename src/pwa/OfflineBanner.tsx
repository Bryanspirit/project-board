import { useEffect, useState } from 'react'
import { cx } from '../components/ui'

/**
 * `navigator.onLine` only reports whether a network interface is up, so it can
 * read true on a captive portal. It is still the right trigger for this
 * banner: a false reading is unambiguous, and the message is advisory rather
 * than a hard block on anything.
 */
function online(): boolean {
  try {
    return navigator.onLine !== false
  } catch {
    return true
  }
}

const BAR = 'sticky top-0 z-30 safe-x w-full border-b px-4 py-2 text-center text-xs font-medium'

const TONE = 'border-amber-200 bg-amber-50 text-amber-900 ' +
  'dark:border-amber-900/60 dark:bg-amber-950/60 dark:text-amber-200'

/**
 * A slim banner shown while the device reports no connection, warning that
 * edits will not reach the server until it returns.
 */
export default function OfflineBanner() {
  const [isOnline, setIsOnline] = useState(online)

  useEffect(() => {
    const goOnline = () => setIsOnline(true)
    const goOffline = () => setIsOnline(false)
    // Re-read on mount: the state may have changed between render and effect.
    setIsOnline(online())
    window.addEventListener('online', goOnline)
    window.addEventListener('offline', goOffline)
    return () => {
      window.removeEventListener('online', goOnline)
      window.removeEventListener('offline', goOffline)
    }
  }, [])

  return (
    <div role="status" aria-live="polite">
      {!isOnline && (
        <div className={cx(BAR, TONE)}>
          <span aria-hidden="true" className="mr-1.5">︎</span>
          You are offline — changes will not save until the connection returns.
        </div>
      )}
    </div>
  )
}
