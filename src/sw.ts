/// <reference lib="webworker" />
import { cleanupOutdatedCaches, precacheAndRoute } from 'workbox-precaching'
import { clientsClaim } from 'workbox-core'
import { createCoverResponse } from './sw-utils';

declare const self: ServiceWorkerGlobalScope

cleanupOutdatedCaches()

self.skipWaiting()
clientsClaim()

precacheAndRoute(self.__WB_MANIFEST)

const COVERS_ENDPOINT_PREFIX = '/__versicle__/covers/';

self.addEventListener('fetch', (event) => {
  const url = new URL(event.request.url);

  if (url.origin === self.location.origin && url.pathname.startsWith(COVERS_ENDPOINT_PREFIX)) {
    const bookId = url.pathname.slice(COVERS_ENDPOINT_PREFIX.length);
    if (bookId) {
      event.respondWith(createCoverResponse(bookId));
    }
  }
});
