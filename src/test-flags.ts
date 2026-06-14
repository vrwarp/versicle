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

/**
 * Deterministic kill points for the kill-mid-switch journey
 * (phase4-sync-strangler.md §D8): the staged workspace swap parks forever
 * when it reaches the armed point, so Playwright can `page.close()` there —
 * modelling process death with the migration state machine and IndexedDB
 * exactly as a crash would leave them.
 *
 *  - 'swap:staged'       after STAGED commits, before the reload (switch path)
 *  - 'swap:before-apply' boot STAGED arm, before reading the staging DB
 *  - 'swap:mid-apply'    boot STAGED arm, after the main DB wipe, before
 *                        the rewrite — the most dangerous crash window
 */
export type SwapPausePoint = 'swap:staged' | 'swap:before-apply' | 'swap:mid-apply';

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
    /** Park the staged workspace swap at this point (kill-mid-switch E2E). */
    __VERSICLE_SWAP_PAUSE__?: SwapPausePoint;
    /** E2E sanitization kill-switch (DEV/VITE_E2E builds only — see epubSecurity). */
    __VERSICLE_SANITIZATION_DISABLED__?: boolean;
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

/** The armed swap pause point, or undefined (production: always undefined). */
export function getSwapPausePoint(): SwapPausePoint | undefined {
  return typeof window !== 'undefined' ? window.__VERSICLE_SWAP_PAUSE__ : undefined;
}

/** True when the E2E suite disabled sanitize-at-serialize (perf kill-switch). */
export function isSanitizationDisabled(): boolean {
  return typeof window !== 'undefined' && window.__VERSICLE_SANITIZATION_DISABLED__ === true;
}
