/// <reference lib="webworker" />
import { getDB } from './db/db';

import { precacheAndRoute } from 'workbox-precaching';

declare let self: ServiceWorkerGlobalScope;

precacheAndRoute(self.__WB_MANIFEST);

// A simple pass-through for assets or standard caching could be added here
// For now, we only implement the cover interception.

self.addEventListener('install', () => {
  self.skipWaiting();
});

self.addEventListener('activate', (event) => {
  event.waitUntil(self.clients.claim());
});

self.addEventListener('fetch', (event) => {
  if (event.request.url.includes('/__versicle_assets__/covers/')) {
    event.respondWith((async () => {
      try {
        const bookId = event.request.url.split('/').pop();
        if (!bookId) return new Response(null, { status: 404 });

        const db = await getDB();
        // Try getting the high-res cover first
        let blob = await db.get('covers', bookId);

        // Fallback to metadata thumbnail
        if (!blob) {
            const book = await db.get('books', bookId);
            blob = book?.coverBlob;
        }

        if (!blob) return new Response(null, { status: 404 });

        return new Response(blob, {
          headers: {
            'Content-Type': blob.type,
            'Cache-Control': 'public, max-age=31536000, immutable'
          }
        });
      } catch (error) {
        console.error('Service Worker: Failed to fetch cover', error);
        return new Response(null, { status: 500 });
      }
    })());
  }
});
