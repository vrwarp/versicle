/// <reference lib="webworker" />
import { cleanupOutdatedCaches, precacheAndRoute } from 'workbox-precaching'
import { clientsClaim } from 'workbox-core'
import { registerRoute } from 'workbox-routing'
import { CacheFirst } from 'workbox-strategies'
import { ExpirationPlugin } from 'workbox-expiration'
import { createCoverResponse } from '@data/sw-contract';
import { parseCoverPath } from '@data/covers';

declare const self: ServiceWorkerGlobalScope

cleanupOutdatedCaches()

/**
 * Capacitor-aware update flow.
 *
 * Inside a Capacitor WebView the androidScheme is 'https' on 'localhost'
 * (see capacitor.config.ts). There is no real server to trigger the SW
 * update lifecycle — `cap sync` replaces files on disk, but the old
 * precache keeps serving stale assets. Detect this environment and force
 * skipWaiting so the freshly-synced assets take effect on the next launch.
 *
 * On the web the prompt-style flow (Phase 8 §G) remains: a new SW WAITS
 * until the user accepts the in-app update toast (SWUpdatePrompt →
 * `updateServiceWorker()` → workbox-window posts SKIP_WAITING).
 *
 * `clientsClaim()` stays in both paths: on FIRST install the fresh SW
 * takes control of the already-open page without a reload (covers are
 * served through the fetch handler below, so an uncontrolled first session
 * would show no cover images — see useServiceWorkerGate's degraded notice).
 */
const isCapacitor = self.location.hostname === 'localhost'

if (isCapacitor) {
  // Native: always activate immediately so cap-sync'd assets are served.
  void self.skipWaiting()
} else {
  // Web: wait for the user to accept the update prompt.
  self.addEventListener('message', (event) => {
    if (event.data && event.data.type === 'SKIP_WAITING') {
      void self.skipWaiting()
    }
  })
}
clientsClaim()

precacheAndRoute(self.__WB_MANIFEST)

// ── Runtime caching (Phase 8 §G) ────────────────────────────────────────────
// The precache covers `**/*.{js,css,html}` only (vite.config.ts
// injectManifest); everything below is fetched on demand and far beyond the
// 4 MB precache budget. All routes are SAME-ORIGIN by construction (origin
// check in the matcher), so the strict CSP flip and the PiperRuntime's own
// HF voice-model cache (`piper-voices-v1`, PiperRuntime.ts) are untouched —
// Workbox must never double-cache the cross-origin voice downloads.
// Every cache name here is enumerated by prefix in @data/wipe.ts
// APP_CACHE_PREFIXES (the wipe owns CacheStorage cleanup).

// /dict/* (Phase 6 §7.4, PR-11): the compiled CC-CEDICT json (≈15 MB) is
// cached on first fetch — the DictionaryService import works offline after
// one online import.
registerRoute(
  ({ url }) => url.origin === self.location.origin && url.pathname.startsWith('/dict/'),
  new CacheFirst({
    cacheName: 'versicle-dict-assets',
    plugins: [new ExpirationPlugin({ maxEntries: 4 })],
  }),
)

// /fonts/*: the pinyin overlay TTFs (Versicle Sans Narrow, ~0.9 MB total).
// Matched by PATH PREFIX so the Phase 8 §I font rename (and any future
// file) caches transparently.
registerRoute(
  ({ url }) => url.origin === self.location.origin && url.pathname.startsWith('/fonts/'),
  new CacheFirst({
    cacheName: 'versicle-fonts-v1',
    plugins: [new ExpirationPlugin({ maxEntries: 12 })],
  }),
)

// /piper/*: the vendored Piper runtime pieces the precache skips — the
// onnxruntime .wasm builds (~10 MB each, globIgnores) and the phonemizer
// .data/.wasm blobs. Closes "offline Piper" (phase5 §Follow-ups P8 row):
// after one online synthesis the runtime loads offline. The HF voice
// models are CROSS-origin (egress 'hf-piper-models') and never match.
registerRoute(
  ({ url }) => url.origin === self.location.origin && url.pathname.startsWith('/piper/'),
  new CacheFirst({
    cacheName: 'versicle-piper-runtime-v1',
    plugins: [new ExpirationPlugin({ maxEntries: 16 })],
  }),
)

self.addEventListener('fetch', (event) => {
  const url = new URL(event.request.url);

  if (url.origin === self.location.origin) {
    const bookId = parseCoverPath(url.pathname);
    if (bookId) {
      event.respondWith(createCoverResponse(bookId));
    }
  }
});
