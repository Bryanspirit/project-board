import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'
import { VitePWA } from 'vite-plugin-pwa'

// base: './' keeps asset URLs relative so the same build works on
// GitHub Pages (https://user.github.io/<repo>/) and on a custom domain.
//
// That relative base is also what makes the service worker correct under a
// sub-path deploy. A worker's scope can never exceed its own directory, so
// sw.js must be served from /<repo>/ and registered with a relative URL; the
// precache manifest and navigation fallback it contains are likewise relative
// and resolve against the worker's own location. In the web app manifest the
// same rule applies via the spec: `start_url` and `scope` resolve against the
// manifest URL, so '.' means /<repo>/ in production and / on localhost. Using
// '/' anywhere here would claim the whole github.io origin and the install
// would fail in production while still looking fine locally.
export default defineConfig({
  base: './',
  plugins: [
    react(),
    tailwindcss(),
    VitePWA({
      // 'autoUpdate': a waiting worker that needs a tap to accept is a version
      // people never take. The app reloads itself instead — see the note on
      // skipWaiting below for why that is safe here.
      registerType: 'autoUpdate',
      // We register from src/pwa/registerSW.ts so the app controls the
      // lifecycle; do not let the plugin inject its own <script> as well.
      injectRegister: null,
      // A dev service worker only adds stale-cache confusion while editing.
      devOptions: { enabled: false },
      // The globPatterns below already sweep public/ out of dist, so neither
      // includeAssets nor the manifest-icon pass is needed — both would only
      // duplicate precache entries.
      includeManifestIcons: false,
      manifest: {
        name: 'Project Board',
        short_name: 'Board',
        description: 'Personal project management board',
        // Relative to the manifest URL — see the note above.
        start_url: '.',
        scope: '.',
        display: 'standalone',
        theme_color: '#4f46e5',
        background_color: '#f8fafc',
        icons: [
          { src: 'pwa-192x192.png', sizes: '192x192', type: 'image/png', purpose: 'any' },
          { src: 'pwa-512x512.png', sizes: '512x512', type: 'image/png', purpose: 'any' },
          { src: 'maskable-512x512.png', sizes: '512x512', type: 'image/png', purpose: 'maskable' },
        ],
      },
      workbox: {
        // The shell only: markup, JS, CSS, icons. No API payloads.
        globPatterns: ['**/*.{js,css,html,svg,png,ico,woff,woff2}'],
        // Runs inside the worker, so it must not also be precached as an asset.
        globIgnores: ['sw-force-reload.js'],
        // Prepended to the generated worker. Reloads windows still showing an
        // older build once this worker takes over — their own JavaScript is too
        // old to know an update exists.
        importScripts: ['sw-force-reload.js'],
        // Relative, so the worker resolves it inside its own scope.
        navigateFallback: 'index.html',
        cleanupOutdatedCaches: true,
        // skipWaiting is honoured by the NEW worker during its own install, so
        // an old worker built without it cannot hold the update back. That is
        // what lets a device already stuck on a stale build escape.
        //
        // Swapping the shell under someone mid-edit is the risk this trades
        // against, and it is small here: form state lives in a dialog the
        // reload closes, and everything committed is already in Postgres.
        skipWaiting: true,
        clientsClaim: true,
        runtimeCaching: [
          {
            // Supabase — auth tokens, board data, realtime. Never cached: a
            // stale token or a stale board is worse than an offline error.
            // NetworkOnly with no plugins means the worker passes it straight
            // through and stores nothing.
            urlPattern: ({ url }) => url.hostname.endsWith('.supabase.co') || url.hostname.endsWith('.supabase.in'),
            handler: 'NetworkOnly',
          },
          {
            urlPattern: ({ url }) => url.origin === 'https://fonts.googleapis.com',
            handler: 'StaleWhileRevalidate',
            options: { cacheName: 'google-fonts-stylesheets' },
          },
          {
            urlPattern: ({ url }) => url.origin === 'https://fonts.gstatic.com',
            handler: 'CacheFirst',
            options: {
              cacheName: 'google-fonts-webfonts',
              cacheableResponse: { statuses: [0, 200] },
              expiration: { maxEntries: 20, maxAgeSeconds: 60 * 60 * 24 * 365 },
            },
          },
        ],
      },
    }),
  ],
  build: { outDir: 'dist', sourcemap: false },
})
