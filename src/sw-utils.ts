import { openDB } from 'idb';

export const DB_NAME = 'EpubLibraryDB';
export const STATIC_MANIFESTS_STORE = 'static_manifests';
export const BOOKS_STORE = 'books'; // Legacy

export async function getCoverFromDB(bookId: string): Promise<Blob | undefined> {
  const db = await openDB(DB_NAME); // Opens with whatever version is current

  try {
    // V18 Architecture
    if (db.objectStoreNames.contains(STATIC_MANIFESTS_STORE)) {
        const manifest = await db.get(STATIC_MANIFESTS_STORE, bookId);
        return manifest?.coverBlob;
    }

    // Legacy Architecture (Fallback)
    if (db.objectStoreNames.contains(BOOKS_STORE)) {
        const book = await db.get(BOOKS_STORE, bookId);
        return book?.coverBlob;
    }

    return undefined;
  } finally {
      db.close();
  }
}

export async function createCoverResponse(bookId: string): Promise<Response> {
  try {
    const coverBlob = await getCoverFromDB(bookId);

    if (coverBlob && (coverBlob instanceof Blob || (coverBlob as { size: number }).size > 0)) {
       // Check for blob-like object since instanceof might be flaky in tests
      return new Response(coverBlob, {
        headers: {
          'Content-Type': coverBlob.type || 'image/jpeg',
          'Cache-Control': 'public, max-age=31536000', // Long cache
        },
      });
    }

    return new Response('Cover not found', { status: 404 });
  } catch {
    return new Response('Internal Server Error', { status: 500 });
  }
}
