const DB_NAME = 'versicle-db';
const STORE_NAME = 'books';

async function getCoverFromIDB(bookId) {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME);
    request.onsuccess = (e) => {
      const db = e.target.result;
      const tx = db.transaction(STORE_NAME, 'readonly');
      const store = tx.objectStore(STORE_NAME);
      const getReq = store.get(bookId);
      getReq.onsuccess = () => resolve(getReq.result?.coverBlob);
      getReq.onerror = () => reject(getReq.error);
    };
    request.onerror = () => reject(request.error);
  });
}

self.addEventListener('fetch', (event) => {
  if (event.request.url.includes('/__versicle_assets__/covers/')) {
    event.respondWith((async () => {
      try {
        const bookId = event.request.url.split('/').pop();
        const blob = await getCoverFromIDB(bookId);

        if (!blob) return new Response(null, { status: 404 });

        // Native Blob.type ensures correct 'image/jpeg' or 'image/png' delivery
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
