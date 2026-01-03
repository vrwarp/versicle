/// <reference lib="webworker" />
import { cleanupOutdatedCaches, precacheAndRoute } from 'workbox-precaching'
import { clientsClaim } from 'workbox-core'
import { openDB } from 'idb';

declare const self: ServiceWorkerGlobalScope

cleanupOutdatedCaches()

self.skipWaiting()
clientsClaim()

self.addEventListener('activate', () => {
  self.clients.claim();
});

precacheAndRoute(self.__WB_MANIFEST)

const COVERS_ENDPOINT_PREFIX = '/__versicle__/covers/';
const DB_NAME = 'EpubLibraryDB';
const BOOKS_STORE = 'books';

// Helper to open DB - we can't easily share code with src/db/db.ts
// because of module resolution in SW, so we keep it simple.
// We assume the DB is already created by the main thread.
async function getCoverFromDB(bookId: string): Promise<Blob | undefined> {
    const db = await openDB(DB_NAME); // Open with whatever version is current
    if (!db.objectStoreNames.contains(BOOKS_STORE)) {
        return undefined;
    }
    const book = await db.get(BOOKS_STORE, bookId);
    return book.coverBlob;
}

self.addEventListener('fetch', (event) => {
  const url = new URL(event.request.url);

  if (url.origin === self.location.origin && url.pathname.startsWith(COVERS_ENDPOINT_PREFIX)) {
    const bookId = url.pathname.slice(COVERS_ENDPOINT_PREFIX.length);
    if (bookId) {
      event.respondWith(handleCoverRequest(bookId));
    }
  }
});

async function handleCoverRequest(bookId: string): Promise<Response> {
  try {
    const coverBlob = await getCoverFromDB(bookId);

    if (coverBlob && coverBlob instanceof Blob) {
      return new Response(coverBlob, {
        headers: {
          'Content-Type': coverBlob.type || 'image/jpeg',
          'Cache-Control': 'public, max-age=31536000', // Long cache
        },
      });
    }

    return new Response('Cover not found', { status: 404 });
  } catch (error) {
    console.error('Failed to fetch cover from DB:', error);
    return new Response('Internal Server Error', { status: 500 });
  }
}
