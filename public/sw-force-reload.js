/* eslint-disable no-undef */
/**
 * Imported at the top of the generated service worker.
 *
 * skipWaiting + clientsClaim get a new worker in charge immediately, but the
 * page already on screen is still running whatever JavaScript it loaded before
 * that happened. Its own code cannot fix this: an old build has no idea a new
 * one exists. So the *worker* reloads the open windows instead, which works no
 * matter how stale the page is.
 *
 * `activate` fires once per new worker version, so this cannot loop.
 *
 * Only an *update* reloads. On a first install there is nothing stale on
 * screen, and navigating would give every new visitor a gratuitous second load
 * of the page they just opened. `registration.active` during install is the old
 * worker, so its presence is what distinguishes the two cases.
 */
let replacingAnOlderWorker = false

self.addEventListener('install', () => {
  replacingAnOlderWorker = Boolean(self.registration && self.registration.active)
})

self.addEventListener('activate', event => {
  if (!replacingAnOlderWorker) return

  event.waitUntil(
    (async () => {
      try {
        // Be in charge before navigating anything.
        await self.clients.claim()

        const windows = await self.clients.matchAll({
          type: 'window',
          includeUncontrolled: true,
        })

        for (const client of windows) {
          // Never navigate somewhere this worker does not own.
          if (!client.url.startsWith(self.registration.scope)) continue
          try {
            // navigate() re-fetches through the new worker. Where it is not
            // permitted (some browsers restrict it), postMessage lets a newer
            // page reload itself; an older one simply ignores the message and
            // updates on its next launch.
            await client.navigate(client.url)
          } catch {
            try {
              client.postMessage({ type: 'SW_UPDATED' })
            } catch {
              /* client went away mid-activate */
            }
          }
        }
      } catch {
        /* activation must never fail because of this */
      }
    })(),
  )
})
