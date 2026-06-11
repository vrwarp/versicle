/**
 * Typed readers for the E2E INPUT flags (`window.__VERSICLE_MOCK_*`,
 * `__VERSICLE_FIRESTORE_DEBOUNCE_MS__`).
 *
 * These are the page-side knobs the Playwright suite injects via
 * `page.addInitScript()` BEFORE the app boots (see
 * verification/test_journey_*.spec.ts) — which is why, unlike the OUTPUT
 * test API (`window.__versicleTest`, src/test-api.ts), they cannot live
 * behind `installTestApi()`: they must already be set when the sync manager
 * first reads them. This module is the one place that reads them; production
 * code must never touch `window.__VERSICLE_*` directly.
 *
 * Side-effect-free and dependency-free, so importing it from production sync
 * code costs nothing; in production builds the flags are simply absent and
 * every reader returns its inert default.
 */

declare global {
  interface Window {
    /** Route sync through MockFireProvider instead of Firestore. */
    __VERSICLE_MOCK_FIRESTORE__?: boolean;
    /** Fake authenticated user id for mock mode (default 'mock-user'). */
    __VERSICLE_MOCK_USER_ID__?: string;
    /** Artificial latency (ms) for MockFireProvider operations. */
    __VERSICLE_MOCK_SYNC_DELAY__?: number;
    /** Override the Firestore flush debounce (ms) to speed up sync E2Es. */
    __VERSICLE_FIRESTORE_DEBOUNCE_MS__?: number;
  }
}

/** True when the Playwright suite asked for the mock Firestore backend. */
export function isMockFirestoreEnabled(): boolean {
  return typeof window !== 'undefined' && window.__VERSICLE_MOCK_FIRESTORE__ === true;
}

/** The injected mock user id, or the conventional default. */
export function getMockFirestoreUserId(): string {
  return (typeof window !== 'undefined' && window.__VERSICLE_MOCK_USER_ID__) || 'mock-user';
}

/** Artificial mock-sync latency in ms; undefined when not injected. */
export function getMockSyncDelayMs(): number | undefined {
  return typeof window !== 'undefined' ? window.__VERSICLE_MOCK_SYNC_DELAY__ : undefined;
}

/** Firestore flush-debounce override in ms; undefined when not injected. */
export function getFirestoreDebounceOverrideMs(): number | undefined {
  return typeof window !== 'undefined' ? window.__VERSICLE_FIRESTORE_DEBOUNCE_MS__ : undefined;
}
