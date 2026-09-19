import { useState, useEffect } from 'react';
import { bookContent } from '@data/repos/bookContent';

/**
 * useCoverUrl hook resolves the cover URL for a book.
 * 
 * If the Service Worker is active and controlling the page, it uses the virtual
 * same-origin route (served straight from IndexedDB by the SW).
 * 
 * If the Service Worker is not active or controlling the page (e.g., Capacitor on Android
 * when SW is degraded/not loaded, dev server, or test environments), it falls back to
 * `URL.createObjectURL(coverBlob)` and properly revokes it on unmount or when dependencies change
 * to prevent memory leaks.
 *
 * perf (P-mem): the fallback lane no longer depends on the projection holding
 * every book's cover bytes. `BookRepository` omits `coverBlob` while the page
 * is SW controlled, so when the controller is absent but the projection still
 * says a cover exists (`coverUrlFromSelector` is set), this hook reads THAT
 * ONE cover on demand through the data layer — the covers actually rendered,
 * not the whole library.
 */
export function useCoverUrl(
  bookId: string | undefined,
  coverBlob: Blob | undefined,
  coverUrlFromSelector: string | undefined
): string | undefined {
  const hasController = typeof navigator !== 'undefined' && !!navigator.serviceWorker?.controller;
  const useSwRoute = !!(coverUrlFromSelector && hasController);

  const [objectUrl, setObjectUrl] = useState<string | undefined>(undefined);

  // A cover exists (the selector emitted a route for it) but its bytes were
  // not materialized and the SW cannot serve them: read the single row.
  const needsOnDemandRead = !useSwRoute && !coverBlob && !!coverUrlFromSelector && !!bookId;

  useEffect(() => {
    if (useSwRoute || (!coverBlob && !needsOnDemandRead)) {
      const handle = setTimeout(() => {
        setObjectUrl(undefined);
      }, 0);
      return () => clearTimeout(handle);
    }

    let cancelled = false;
    let url: string | undefined;
    let handle: ReturnType<typeof setTimeout> | undefined;

    const publish = (blob: Blob): void => {
      if (cancelled) return;
      url = URL.createObjectURL(blob);
      handle = setTimeout(() => {
        setObjectUrl(url);
      }, 0);
    };

    if (coverBlob) {
      publish(coverBlob);
    } else if (bookId) {
      void bookContent
        .getCoverBlob(bookId)
        .then((blob) => {
          if (blob) publish(blob);
        })
        .catch(() => {
          // A cover that cannot be read simply renders the palette fallback.
        });
    }

    return () => {
      cancelled = true;
      if (handle !== undefined) clearTimeout(handle);
      if (url) URL.revokeObjectURL(url);
    };
  }, [bookId, coverBlob, useSwRoute, needsOnDemandRead]);

  return useSwRoute ? coverUrlFromSelector : objectUrl;
}
