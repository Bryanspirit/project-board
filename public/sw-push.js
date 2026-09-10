/* eslint-disable no-undef */
/**
 * Push handling, imported into the generated service worker.
 *
 * This runs with the app closed, so it can rely on nothing from the page: no
 * React, no Supabase client, no auth session. Everything it needs to draw the
 * notification arrives inside the push payload.
 */

/** Shown when a payload is missing or unreadable, so a push is never silent. */
const FALLBACK = {
  title: 'Project Board',
  body: 'Something needs your attention.',
  url: '.',
  tag: 'board-generic',
}

function parse(event) {
  try {
    const data = event.data && event.data.json()
    if (!data || typeof data !== 'object') return FALLBACK
    return {
      title: typeof data.title === 'string' && data.title ? data.title : FALLBACK.title,
      body: typeof data.body === 'string' ? data.body : '',
      url: typeof data.url === 'string' && data.url ? data.url : FALLBACK.url,
      // Collapsing on a tag means three mentions on one task replace each other
      // rather than stacking three notifications for the same thing.
      tag: typeof data.tag === 'string' && data.tag ? data.tag : FALLBACK.tag,
      renotify: data.renotify === true,
    }
  } catch {
    return FALLBACK
  }
}

self.addEventListener('push', event => {
  const n = parse(event)

  // waitUntil keeps the worker alive until the notification is actually shown.
  // Without it the browser may kill the worker first and show its own generic
  // "This site has been updated in the background" instead.
  event.waitUntil(
    self.registration.showNotification(n.title, {
      body: n.body,
      tag: n.tag,
      renotify: n.renotify,
      icon: 'pwa-192x192.png',
      badge: 'pwa-192x192.png',
      // The click handler needs the destination, and only `data` survives the
      // round trip through the notification.
      data: { url: n.url },
      timestamp: Date.now(),
    }),
  )
})

self.addEventListener('notificationclick', event => {
  event.notification.close()

  const target = new URL(
    (event.notification.data && event.notification.data.url) || '.',
    self.registration.scope,
  ).href

  event.waitUntil(
    (async () => {
      const windows = await self.clients.matchAll({
        type: 'window',
        includeUncontrolled: true,
      })

      // Reuse a window that is already open rather than stacking another copy
      // of the app — and steer it at what the notification was about.
      for (const client of windows) {
        if (!client.url.startsWith(self.registration.scope)) continue
        try {
          await client.focus()
          if (client.url !== target && 'navigate' in client) await client.navigate(target)
          return
        } catch {
          /* fall through to opening a fresh window */
        }
      }

      try {
        await self.clients.openWindow(target)
      } catch {
        /* the browser refused; nothing further to try */
      }
    })(),
  )
})
