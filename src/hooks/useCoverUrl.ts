import { useState, useEffect } from 'react';

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
 */
export function useCoverUrl(
  bookId: string | undefined,
  coverBlob: Blob | undefined,
  coverUrlFromSelector: string | undefined
): string | undefined {
  const hasController = typeof navigator !== 'undefined' && !!navigator.serviceWorker?.controller;
  const useSwRoute = !!(coverUrlFromSelector && hasController);

  const [objectUrl, setObjectUrl] = useState<string | undefined>(undefined);

  useEffect(() => {
    if (useSwRoute || !coverBlob) {
      const handle = setTimeout(() => {
        setObjectUrl(undefined);
      }, 0);
      return () => clearTimeout(handle);
    }

    const url = URL.createObjectURL(coverBlob);
    const handle = setTimeout(() => {
      setObjectUrl(url);
    }, 0);
    
    return () => {
      clearTimeout(handle);
      URL.revokeObjectURL(url);
    };
  }, [bookId, coverBlob, useSwRoute]);

  return useSwRoute ? coverUrlFromSelector : objectUrl;
}
