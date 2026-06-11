/// <reference lib="webworker" />
import { cleanupOutdatedCaches, precacheAndRoute } from 'workbox-precaching'
import { clientsClaim } from 'workbox-core'
import { createCoverResponse } from '@data/sw-contract';
import { parseCoverPath } from '@data/covers';

declare const self: ServiceWorkerGlobalScope

cleanupOutdatedCaches()

self.skipWaiting()
clientsClaim()

precacheAndRoute(self.__WB_MANIFEST)

self.addEventListener('fetch', (event) => {
  const url = new URL(event.request.url);

  if (url.origin === self.location.origin) {
    const bookId = parseCoverPath(url.pathname);
    if (bookId) {
      event.respondWith(createCoverResponse(bookId));
    }
  }
});
