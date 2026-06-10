/**
 * renderWithStores: render a component against the REAL Zustand stores.
 *
 * Replaces the "mock 8 store modules to render one dialog" pattern
 * (see the former GlobalSettingsDialog.predictability.test.tsx): instead of
 * `vi.mock`, each store is seeded through its real `setState` — including
 * action overrides (spies) — and automatically reset to its module-load
 * initial state when the test finishes.
 *
 * Yjs-backed stores share the singleton Y.Doc; resetting the store resets
 * the doc state it owns (see ./stores.ts). Tests that need a private fresh
 * Y.Doc should construct a store via its factory instead of rendering
 * against the singletons.
 */
import { render } from '@testing-library/react';
import type { RenderOptions, RenderResult } from '@testing-library/react';
import type { ReactElement } from 'react';
import { onTestFinished } from 'vitest';
import { resetStore, seedStore } from './stores';
import type { HarnessStore } from './stores';

export interface StoreSeed<S> {
  store: HarnessStore<S>;
  state: Partial<S>;
}

/**
 * Helper to build a correctly-typed seed entry (keeps `state` checked
 * against the specific store's state type inside the heterogeneous array).
 */
export function storeSeed<S>(store: HarnessStore<S>, state: Partial<S>): StoreSeed<S> {
  return { store, state };
}

export interface RenderWithStoresOptions extends RenderOptions {
  /**
   * Stores to seed before render. Each is reset to its initial state first,
   * then the partial is applied; all seeded stores are reset again when the
   * test finishes.
   */
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  seeds?: Array<StoreSeed<any>>;
}

export type RenderWithStoresResult = RenderResult & {
  /** Reset all seeded stores immediately (also happens automatically at test end). */
  resetSeededStores: () => void;
};

export function renderWithStores(
  ui: ReactElement,
  options: RenderWithStoresOptions = {},
): RenderWithStoresResult {
  const { seeds = [], ...renderOptions } = options;

  for (const seed of seeds) seedStore(seed.store, seed.state);

  const resetSeededStores = () => {
    for (const seed of seeds) resetStore(seed.store);
  };
  // RTL unmounts via its own afterEach cleanup; stores are restored here.
  onTestFinished(resetSeededStores);

  const result = render(ui, renderOptions);
  return Object.assign(result, { resetSeededStores });
}
