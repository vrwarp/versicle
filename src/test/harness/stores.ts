/**
 * Store reset/seed helpers for tests that use the REAL Zustand stores
 * (no `vi.mock` of store modules).
 *
 * Versicle's stores are module-level singletons, so state written by one
 * test leaks into the next unless it is restored. These helpers restore a
 * store to the exact state it had at module load (`getInitialState()` is
 * captured by zustand itself at `create()` time), which also clears any
 * action overrides a test injected via `setState`.
 *
 * For Yjs-backed stores (`zustand-middleware-yjs`) a full-replace
 * `setState` propagates the diff into the shared Y.Doc map, so resetting
 * the store also clears the doc state it owns — no separate Y.Doc surgery
 * is needed for the common case. Tests that need a genuinely fresh doc
 * should build a store instance through its `create*Store` factory instead.
 */
import { afterEach } from 'vitest';

/**
 * Structural store type: any bound zustand store (vanilla or hook form,
 * with or without middleware) satisfies this.
 */
export interface HarnessStore<S> {
  getState(): S;
  getInitialState(): S;
  setState(partial: Partial<S>): void;
  setState(state: S, replace: true): void;
}

/** Restore a store to its module-load initial state (full replace). */
export function resetStore<S>(store: HarnessStore<S>): void {
  store.setState(store.getInitialState(), true);
}

/** Restore several stores at once. */
function resetStores(...stores: Array<HarnessStore<unknown>>): void {
  for (const store of stores) resetStore(store);
}

/**
 * Reset a store to its initial state, then apply `state` on top.
 *
 * `state` may override plain state AND actions (e.g. replace `play` with a
 * `vi.fn()` spy) — replacing an action via `setState` is the supported
 * zustand way to stub behavior without mocking the module.
 *
 * Pair with {@link autoResetStores} (suite-level) or rely on
 * `renderWithStores`, which auto-resets its seeded stores after each test.
 */
export function seedStore<S>(store: HarnessStore<S>, state: Partial<S>): void {
  resetStore(store);
  store.setState(state);
}

/**
 * Suite-level helper: registers an `afterEach` that resets the given stores.
 * Call once at `describe` scope.
 */
export function autoResetStores(...stores: Array<HarnessStore<unknown>>): void {
  afterEach(() => {
    resetStores(...stores);
  });
}
