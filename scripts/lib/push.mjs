/**
 * Web Push delivery for the alert sweeps.
 *
 * Push supplements e-mail rather than replacing it: a phone that is off, a
 * subscription the browser silently expired, or a user who never granted
 * permission must not mean the notice is lost. Every caller here still sends
 * its e-mail regardless of what this returns.
 */

import webpush from 'web-push'

const {
  VAPID_PUBLIC_KEY = '',
  VAPID_PRIVATE_KEY = '',
  VAPID_SUBJECT = '',
  SUPABASE_URL = '',
  SUPABASE_SERVICE_ROLE_KEY = '',
} = process.env

export const pushConfigured = Boolean(VAPID_PUBLIC_KEY && VAPID_PRIVATE_KEY)

if (pushConfigured) {
  // The subject must be a mailto: or https: URL — a push service will reject
  // the request outright otherwise. MAIL_FROM is often "Name <a@b.c>", so the
  // address is pulled out of it.
  const address = (VAPID_SUBJECT.match(/<([^>]+)>/)?.[1] ?? VAPID_SUBJECT).trim()
  const subject = /^https?:/i.test(address)
    ? address
    : `mailto:${address || 'admin@example.com'}`
  webpush.setVapidDetails(subject, VAPID_PUBLIC_KEY, VAPID_PRIVATE_KEY)
}

const rest = `${SUPABASE_URL.replace(/\/+$/, '')}/rest/v1`
const headers = {
  apikey: SUPABASE_SERVICE_ROLE_KEY,
  Authorization: `Bearer ${SUPABASE_SERVICE_ROLE_KEY}`,
  'Content-Type': 'application/json',
}

/** Every live subscription for the given users, keyed by user id. */
export async function subscriptionsFor(userIds) {
  if (!pushConfigured || userIds.length === 0) return new Map()

  const ids = [...new Set(userIds)].filter(Boolean)
  const url = `${rest}/push_subscriptions`
    + `?select=id,user_id,endpoint,p256dh,auth`
    + `&failed_at=is.null`
    + `&user_id=in.(${ids.join(',')})`

  const res = await fetch(url, { headers })
  if (!res.ok) return new Map()

  const map = new Map()
  for (const row of await res.json()) {
    const list = map.get(row.user_id)
    if (list) list.push(row)
    else map.set(row.user_id, [row])
  }
  return map
}

/** A dead subscription is stamped rather than deleted, so a spike is visible. */
async function markFailed(id) {
  await fetch(`${rest}/push_subscriptions?id=eq.${id}`, {
    method: 'PATCH',
    headers: { ...headers, Prefer: 'return=minimal' },
    body: JSON.stringify({ failed_at: new Date().toISOString() }),
  }).catch(() => {})
}

async function markUsed(id) {
  await fetch(`${rest}/push_subscriptions?id=eq.${id}`, {
    method: 'PATCH',
    headers: { ...headers, Prefer: 'return=minimal' },
    body: JSON.stringify({ last_used_at: new Date().toISOString() }),
  }).catch(() => {})
}

/**
 * Pushes one notice to every device a person has registered.
 *
 * Never throws: the sweep that calls this has an e-mail to send afterwards and
 * must not be derailed by one unreachable push service.
 *
 * @returns how many devices accepted it
 */
export async function pushTo(subs, { title, body, url, tag, dryRun = false }) {
  if (!pushConfigured || !subs?.length) return 0

  const payload = JSON.stringify({ title, body, url, tag })
  let delivered = 0

  for (const sub of subs) {
    if (dryRun) {
      console.log(`  [dry run] push -> ${sub.endpoint.slice(0, 48)}… ${JSON.stringify({ title, body })}`)
      delivered++
      continue
    }
    try {
      await webpush.sendNotification(
        { endpoint: sub.endpoint, keys: { p256dh: sub.p256dh, auth: sub.auth } },
        payload,
        { TTL: 60 * 60 * 12 },   // a stale notice helps nobody after half a day
      )
      delivered++
      void markUsed(sub.id)
    } catch (err) {
      const status = err?.statusCode
      // 404/410 mean the browser threw the subscription away — the user
      // cleared site data, or reinstalled. Retrying it forever is pointless.
      if (status === 404 || status === 410) {
        await markFailed(sub.id)
      } else {
        console.warn(`  push failed (${status ?? 'network'}) for ${sub.endpoint.slice(0, 40)}…`)
      }
    }
  }
  return delivered
}
