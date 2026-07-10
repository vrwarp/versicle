/**
 * Recovery for failed lazy-chunk imports (chunkReload).
 *
 * A dynamic import() that fails — network hiccup, or a fetch aborted by a
 * reload issued mid-flight (the staged workspace switch does back-to-back
 * window.location.reload()s) — is cached as REJECTED for the lifetime of the
 * document: browsers memoize the module record (WebKit most aggressively) and
 * React.lazy memoizes the rejection on top. Every later visit to that route
 * then fails instantly without touching the network, so a Safari user whose
 * connection blipped once is locked out of the reader until they manually
 * refresh. The only cure is a reload, which gives the page a fresh module map.
 *
 * reloadOnceForChunkError() performs that reload at most once per
 * RELOAD_WINDOW_MS (sessionStorage-guarded) so a genuinely broken deploy
 * degrades to the normal error surface instead of a reload loop.
 *
 * Verified per failure mode (forced via a one-shot-failing proxy):
 * - Chromium, HTTP error response: heals — reload refetches, route opens.
 * - WebKit, fetch cancelled mid-flight (the reload-storm mode): heals — a
 *   cancelled load is not cached, so the post-reload fetch succeeds.
 * - WebKit, connection reset: WebKit retries transparently; we never fire.
 * - WebKit, completed HTTP error response: does NOT heal — WebKit's per-page
 *   memory cache keeps the failed module entry across a JS-initiated reload
 *   (fetch() of the same URL succeeds; import() keeps failing). The guard
 *   then surfaces the error normally, so this mode is no worse than before.
 */
import { createLogger } from '@lib/logger';

const logger = createLogger('ChunkReload');

const RELOAD_AT_KEY = 'versicle:chunk-reload-at';
const RELOAD_WINDOW_MS = 60_000;

/**
 * Matches the browser-specific messages for a failed dynamic import():
 * WebKit "Importing a module script failed.", Chromium "Failed to fetch
 * dynamically imported module: …", Firefox "error loading dynamically
 * imported module".
 */
export function isChunkLoadError(error: unknown): boolean {
  if (!(error instanceof Error)) return false;
  return /importing a module script failed|dynamically imported module/i.test(error.message);
}

/**
 * Reload the page to heal a poisoned module map, at most once per
 * RELOAD_WINDOW_MS. Returns true when a reload was initiated (callers should
 * render nothing / stay pending); false when the guard says we already tried
 * (callers should surface the error normally).
 */
export function reloadOnceForChunkError(scope: string): boolean {
  let lastAt = 0;
  try {
    lastAt = Number(sessionStorage.getItem(RELOAD_AT_KEY) ?? 0);
  } catch {
    // Storage unavailable: never auto-reload — we could not break a loop.
    return false;
  }
  if (Date.now() - lastAt < RELOAD_WINDOW_MS) {
    logger.warn(`chunk '${scope}' failed again within the reload window; surfacing the error`);
    return false;
  }
  try {
    sessionStorage.setItem(RELOAD_AT_KEY, String(Date.now()));
  } catch {
    return false;
  }
  logger.warn(`chunk '${scope}' failed to import; reloading once to refresh the module map`);
  window.location.reload();
  return true;
}

/**
 * Wrap a React.lazy importer so a chunk-load failure triggers the
 * reload-once recovery. While the reload is in flight the returned promise
 * stays pending, so Suspense keeps its fallback up instead of flashing the
 * error boundary during the last frames of the dying document.
 */
export function importWithChunkReload<T>(importer: () => Promise<T>, scope: string): () => Promise<T> {
  return async () => {
    try {
      return await importer();
    } catch (error) {
      if (isChunkLoadError(error) && reloadOnceForChunkError(scope)) {
        return new Promise<never>(() => {});
      }
      throw error;
    }
  };
}
