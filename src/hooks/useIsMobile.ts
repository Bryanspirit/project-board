import { useSyncExternalStore } from 'react'

/**
 * Below this the desktop shell stops working rather than merely looking tight:
 * five kanban columns cannot be reached on a 390px screen at any zoom. It
 * matches Tailwind's `md`, so a tablet keeps the full layout and only phones
 * get the dedicated one.
 */
export const MOBILE_QUERY = '(max-width: 767px)'

/**
 * A coarse pointer with no hover is a touch device regardless of width, which
 * catches a phone held in landscape — 844px wide but still a thumb.
 */
export const TOUCH_QUERY = '(pointer: coarse) and (hover: none)'

function subscribe(query: string) {
  return (onChange: () => void) => {
    if (typeof window === 'undefined' || !window.matchMedia) return () => {}
    const mql = window.matchMedia(query)
    mql.addEventListener('change', onChange)
    return () => mql.removeEventListener('change', onChange)
  }
}

function snapshot(query: string) {
  return () => {
    if (typeof window === 'undefined' || !window.matchMedia) return false
    return window.matchMedia(query).matches
  }
}

/** Subscribed rather than measured once, so a rotation or a resized window
 *  swaps the shell instead of leaving the wrong one on screen. */
function useMediaQuery(query: string) {
  return useSyncExternalStore(subscribe(query), snapshot(query), () => false)
}

/**
 * True on a phone: either narrow, or a landscape phone that is wide but has no
 * mouse. Deliberately not user-agent sniffing — the thing that matters is how
 * much room there is and whether there is a pointer, not who made the device.
 */
export function useIsMobile() {
  const narrow = useMediaQuery(MOBILE_QUERY)
  const touch = useMediaQuery(TOUCH_QUERY)
  const shortAndTouch = useMediaQuery('(max-height: 500px)')
  return narrow || (touch && shortAndTouch)
}

export { useMediaQuery }
