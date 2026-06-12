/// <reference lib="webworker" />
import { cleanupOutdatedCaches, precacheAndRoute } from 'workbox-precaching'
import { clientsClaim } from 'workbox-core'
import { registerRoute } from 'workbox-routing'
import { CacheFirst } from 'workbox-strategies'
import { createCoverResponse } from '@data/sw-contract';
import { parseCoverPath } from '@data/covers';

declare const self: ServiceWorkerGlobalScope

cleanupOutdatedCaches()

self.skipWaiting()
clientsClaim()

precacheAndRoute(self.__WB_MANIFEST)

// /dict/* runtime cache (Phase 6 §7.4, PR-11 — the ONE SW change in P6;
// the full runtime-caching pass is P8). The compiled CC-CEDICT json is far
// beyond the precache budget (≈15 MB > maximumFileSizeToCacheInBytes), so
// it is cached on first fetch instead: the DictionaryService import works
// offline after one online import. Cache name is enumerated in
// @data/wipe.ts APP_CACHE_PREFIXES.
registerRoute(
  ({ url }) => url.origin === self.location.origin && url.pathname.startsWith('/dict/'),
  new CacheFirst({ cacheName: 'versicle-dict-assets' }),
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
