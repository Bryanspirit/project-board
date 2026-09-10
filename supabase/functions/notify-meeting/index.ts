/**
 * Pushes a meeting invitation the moment somebody is added to one.
 *
 * The GitHub Actions sweep is the safety net, not the mechanism: its cron is
 * best-effort and has in practice run three hours apart, which is useless for
 * a meeting starting this afternoon. A database trigger calls this instead, so
 * an invitation lands in seconds.
 *
 * It only sends the *push*. The sweep still sends the email with the calendar
 * attachment, and still stamps invite_notified_at — so if this function is
 * down, nothing is lost, it just arrives later.
 */

import webpush from 'npm:web-push@3.6.7'

const env = (key: string, fallback = ''): string => Deno.env.get(key) ?? fallback

const SUPABASE_URL = env('SUPABASE_URL')
const SERVICE_KEY = env('SUPABASE_SERVICE_ROLE_KEY')
const WEBHOOK_SECRET = env('WEBHOOK_SECRET')
const APP_URL = env('APP_URL')
const VAPID_PUBLIC = env('VAPID_PUBLIC_KEY')
const VAPID_PRIVATE = env('VAPID_PRIVATE_KEY')
const VAPID_SUBJECT = env('VAPID_SUBJECT', env('MAIL_FROM'))

const JSON_HEADERS = { 'Content-Type': 'application/json' }
const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: JSON_HEADERS })

if (VAPID_PUBLIC && VAPID_PRIVATE) {
  // A push service rejects the request outright unless the subject is a
  // mailto: or https: URL, and MAIL_FROM is usually "Name <a@b.c>".
  const address = (VAPID_SUBJECT.match(/<([^>]+)>/)?.[1] ?? VAPID_SUBJECT).trim()
  webpush.setVapidDetails(
    /^https?:/i.test(address) ? address : `mailto:${address || 'admin@example.com'}`,
    VAPID_PUBLIC,
    VAPID_PRIVATE,
  )
}

const rest = `${SUPABASE_URL.replace(/\/+$/, '')}/rest/v1`
const headers = {
  apikey: SERVICE_KEY,
  Authorization: `Bearer ${SERVICE_KEY}`,
  'Content-Type': 'application/json',
}

async function get<T>(query: string): Promise<T[]> {
  const res = await fetch(`${rest}/${query}`, { headers })
  if (!res.ok) return []
  return await res.json() as T[]
}

function whenText(startsAt: string, timeZone: string): string {
  try {
    return new Intl.DateTimeFormat('en-GB', {
      weekday: 'short', day: 'numeric', month: 'short',
      hour: '2-digit', minute: '2-digit', hour12: false,
      timeZone: timeZone || 'UTC', timeZoneName: 'short',
    }).format(new Date(startsAt))
  } catch {
    return new Date(startsAt).toISOString()
  }
}

Deno.serve(async (req: Request): Promise<Response> => {
  try {
    if (req.method !== 'POST') return json({ ok: false, error: 'POST only' }, 405)
    if (!WEBHOOK_SECRET || req.headers.get('x-webhook-secret') !== WEBHOOK_SECRET) {
      return json({ ok: false, error: 'unauthorised' }, 401)
    }
    if (!VAPID_PUBLIC || !VAPID_PRIVATE) {
      return json({ ok: false, error: 'push not configured' }, 500)
    }

    const payload = await req.json().catch(() => null)
    const record = payload?.record
    if (!record?.meeting_id || !record?.user_id) {
      return json({ ok: false, error: 'no attendee in payload' }, 400)
    }

    // The organiser adding themselves does not need telling.
    const [meeting] = await get<{
      id: string; title: string; starts_at: string; status: string; created_by: string | null
    }>(`meetings?id=eq.${record.meeting_id}&select=id,title,starts_at,status,created_by`)
    if (!meeting) return json({ ok: false, error: 'no such meeting' }, 404)
    if (meeting.status !== 'scheduled') return json({ ok: true, skipped: 'not scheduled' })
    if (meeting.created_by === record.user_id) return json({ ok: true, skipped: 'organiser' })

    const [profile] = await get<{
      id: string; timezone: string; push_alerts: boolean; meeting_alerts: boolean; status: string
    }>(`profiles?id=eq.${record.user_id}&select=id,timezone,push_alerts,meeting_alerts,status`)
    if (!profile || profile.status !== 'active') return json({ ok: true, skipped: 'inactive' })
    if (!profile.push_alerts || profile.meeting_alerts === false) {
      return json({ ok: true, skipped: 'alerts off' })
    }

    const subs = await get<{ id: string; endpoint: string; p256dh: string; auth: string }>(
      `push_subscriptions?user_id=eq.${record.user_id}&failed_at=is.null&select=id,endpoint,p256dh,auth`,
    )
    if (subs.length === 0) return json({ ok: true, skipped: 'no devices' })

    const body = JSON.stringify({
      title: `Invited: ${meeting.title}`,
      body: whenText(meeting.starts_at, profile.timezone),
      url: APP_URL || '.',
      tag: `meeting-${meeting.id}-invite`,
    })

    let delivered = 0
    for (const sub of subs) {
      try {
        await webpush.sendNotification(
          { endpoint: sub.endpoint, keys: { p256dh: sub.p256dh, auth: sub.auth } },
          body,
          { TTL: 60 * 60 * 12 },
        )
        delivered++
        // Same stamp the scheduled sender writes, so a delivery is visible
        // from the database rather than only from this function's log.
        fetch(`${rest}/push_subscriptions?id=eq.${sub.id}`, {
          method: 'PATCH',
          headers: { ...headers, Prefer: 'return=minimal' },
          body: JSON.stringify({ last_used_at: new Date().toISOString() }),
        }).catch(() => {})
      } catch (err) {
        const status = (err as { statusCode?: number })?.statusCode
        // The browser discarded this subscription; stop trying it forever.
        if (status === 404 || status === 410) {
          await fetch(`${rest}/push_subscriptions?id=eq.${sub.id}`, {
            method: 'PATCH',
            headers: { ...headers, Prefer: 'return=minimal' },
            body: JSON.stringify({ failed_at: new Date().toISOString() }),
          }).catch(() => {})
        }
      }
    }

    console.log(`notify-meeting: pushed "${meeting.title}" to ${delivered} device(s)`)
    return json({ ok: true, delivered })
  } catch (err) {
    // Never throw: an unhandled rejection takes the isolate down and the
    // webhook sees an opaque failure rather than a logged one.
    const message = err instanceof Error ? err.message : String(err)
    console.error('notify-meeting failed:', message)
    return json({ ok: false, error: message }, 500)
  }
})
