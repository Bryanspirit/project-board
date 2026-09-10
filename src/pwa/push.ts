import { supabase } from '../lib/supabase'

/** The public half of the VAPID pair. Safe in the bundle — it only lets the
 *  browser verify that pushes came from whoever holds the private half. */
const VAPID_PUBLIC_KEY = import.meta.env.VITE_VAPID_PUBLIC_KEY ?? ''

export type PushState =
  | 'unsupported'   // no service worker or no Push API on this browser
  | 'ios-needs-install' // iOS only delivers push to a home-screen install
  | 'unconfigured'  // built without a VAPID key
  | 'denied'        // the user said no, and only they can undo it
  | 'off'           // supported and permitted to ask, not subscribed
  | 'on'            // subscribed

/** VAPID keys travel as base64url; PushManager wants raw bytes. */
function urlBase64ToUint8Array(base64: string): Uint8Array {
  const padded = base64.padEnd(base64.length + ((4 - (base64.length % 4)) % 4), '=')
  const raw = atob(padded.replace(/-/g, '+').replace(/_/g, '/'))
  const out = new Uint8Array(raw.length)
  for (let i = 0; i < raw.length; i++) out[i] = raw.charCodeAt(i)
  return out
}

function isStandalone(): boolean {
  try {
    return window.matchMedia('(display-mode: standalone)').matches
      || (navigator as unknown as { standalone?: boolean }).standalone === true
  } catch {
    return false
  }
}

/** iOS gained Web Push in 16.4, but only for a home-screen install — in a
 *  normal Safari tab `PushManager` is absent entirely, which would otherwise
 *  read as "your browser cannot do this" when the real answer is "install it". */
function isIOS(): boolean {
  try {
    return /iP(hone|ad|od)/.test(navigator.userAgent)
      || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1)
  } catch {
    return false
  }
}

export function pushSupported(): boolean {
  try {
    return 'serviceWorker' in navigator
      && 'PushManager' in window
      && 'Notification' in window
      && window.isSecureContext
  } catch {
    return false
  }
}

export async function pushState(): Promise<PushState> {
  if (!pushSupported()) {
    return isIOS() && !isStandalone() ? 'ios-needs-install' : 'unsupported'
  }
  if (!VAPID_PUBLIC_KEY) return 'unconfigured'
  if (Notification.permission === 'denied') return 'denied'

  try {
    const reg = await navigator.serviceWorker.ready
    const sub = await reg.pushManager.getSubscription()
    return sub ? 'on' : 'off'
  } catch {
    return 'off'
  }
}

/**
 * Asks permission, subscribes, and records the subscription.
 *
 * Must be called from a click: Safari and Firefox both refuse a permission
 * prompt that did not come from a user gesture, and a refusal here is
 * permanent until the user digs into browser settings.
 */
export async function enablePush(): Promise<{ ok: boolean; state: PushState; error?: string }> {
  const state = await pushState()
  if (state === 'on') return { ok: true, state }
  if (state !== 'off') {
    return { ok: false, state, error: describe(state) }
  }

  let permission: NotificationPermission
  try {
    permission = await Notification.requestPermission()
  } catch {
    return { ok: false, state: 'unsupported', error: 'This browser refused the permission prompt.' }
  }
  if (permission !== 'granted') {
    return {
      ok: false,
      state: permission === 'denied' ? 'denied' : 'off',
      error: permission === 'denied'
        ? 'Notifications are blocked for this site. You can re-allow them in your browser settings.'
        : 'Notifications were not enabled.',
    }
  }

  try {
    const reg = await navigator.serviceWorker.ready
    // An existing subscription is reused: re-subscribing would hand back the
    // same endpoint anyway, and asking twice risks a different key pair.
    const sub = await reg.pushManager.getSubscription()
      ?? await reg.pushManager.subscribe({
        userVisibleOnly: true,   // required by Chrome; silent push is not allowed
        applicationServerKey: urlBase64ToUint8Array(VAPID_PUBLIC_KEY) as BufferSource,
      })

    const json = sub.toJSON()
    const { data: auth } = await supabase.auth.getUser()
    const userId = auth.user?.id
    if (!userId) return { ok: false, state: 'off', error: 'Sign in first.' }

    // Upsert on endpoint: the same device re-subscribing must refresh its row,
    // not accumulate one per visit.
    const { error } = await supabase.from('push_subscriptions').upsert({
      user_id: userId,
      endpoint: sub.endpoint,
      p256dh: json.keys?.p256dh ?? '',
      auth: json.keys?.auth ?? '',
      user_agent: navigator.userAgent.slice(0, 300),
      failed_at: null,
    }, { onConflict: 'endpoint' })
    if (error) return { ok: false, state: 'off', error: error.message }

    await supabase.from('profiles').update({ push_alerts: true }).eq('id', userId)
    return { ok: true, state: 'on' }
  } catch (err) {
    return { ok: false, state: 'off', error: err instanceof Error ? err.message : 'Could not subscribe.' }
  }
}

/** Unsubscribes this device and forgets its row. Other devices keep working. */
export async function disablePush(): Promise<{ ok: boolean; error?: string }> {
  try {
    const reg = await navigator.serviceWorker.ready
    const sub = await reg.pushManager.getSubscription()
    if (sub) {
      await supabase.from('push_subscriptions').delete().eq('endpoint', sub.endpoint)
      await sub.unsubscribe()
    }
    const { data: auth } = await supabase.auth.getUser()
    if (auth.user?.id) {
      // Only clear the account-wide flag once no device is left subscribed.
      const { count } = await supabase.from('push_subscriptions')
        .select('id', { count: 'exact', head: true }).eq('user_id', auth.user.id)
      if (!count) await supabase.from('profiles').update({ push_alerts: false }).eq('id', auth.user.id)
    }
    return { ok: true }
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : 'Could not turn them off.' }
  }
}

export function describe(state: PushState): string {
  switch (state) {
    case 'ios-needs-install':
      return 'On iPhone and iPad, notifications only work once the app is added to your Home Screen. Use Share → Add to Home Screen, open it from there, then turn this on.'
    case 'unsupported':
      return 'This browser cannot show push notifications.'
    case 'unconfigured':
      return 'Push is not configured for this build.'
    case 'denied':
      return 'Notifications are blocked for this site. Re-allow them in your browser settings, then try again.'
    case 'on':
      return 'This device will receive notifications.'
    default:
      return 'Notifications are off on this device.'
  }
}
