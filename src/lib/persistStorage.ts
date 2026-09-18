import { createJSONStorage, type PersistStorage, type StateStorage } from 'zustand/middleware';

/**
 * Write-deduplicating `persist` storage (shared by the localStorage-persisted
 * stores whose state churns far faster than their PERSISTED slice).
 *
 * zustand's persist middleware re-runs `partialize`, `JSON.stringify`s the
 * result and calls `localStorage.setItem` SYNCHRONOUSLY after EVERY `set` —
 * see the `setItem()` appended to the wrapped set in
 * `node_modules/zustand/esm/middleware.mjs`. It does that even when the set
 * touched nothing in the allowlist, so a hot in-memory field (useGenAIStore's
 * `logs` ring buffer, useDriveStore's `isScanning` flag) blocks the main
 * thread on a serialize + storage commit of the whole persisted blob per
 * update — during a GenAI backfill, many per second.
 *
 * The wrapper below skips the commit when the serialized payload is
 * byte-identical to the last string it wrote (or read) for that key. The
 * stored bytes are therefore always what an unwrapped persist would have
 * stored; only the redundant commits disappear.
 *
 * ASSUMPTION: within a page session this wrapper is the only writer of the
 * keys it owns. The app's data wipe (`src/data/wipe.ts`) removes them behind
 * its back, but it reloads the page afterwards — which drops the closure below
 * with the document. A caller that wiped WITHOUT reloading would have to write
 * a genuinely new payload before the key reappeared.
 *
 * Deliberately NOT a store, and deliberately NOT under `src/store/`: the
 * stores that use it are reachable from the TTS worker's TYPE graph, and the
 * `worker-no-state-typegraph` ratchet (.dependency-cruiser.cjs) counts every
 * reachable `src/store/**` module. A generic zustand helper with no internal
 * dependencies has no business spending one of those frozen slots, so it
 * lives here — the same way `@lib/device-id` and `@lib/entity-resolution`
 * already serve store modules.
 */

/** Wraps a `StateStorage` so a repeated identical `setItem` is a no-op. */
function dedupeWrites(base: StateStorage): StateStorage {
  // The last (key, value) this wrapper is certain is in the backing store.
  let lastKey: string | null = null;
  let lastValue: string | null = null;

  return {
    getItem: (name) => {
      const value = base.getItem(name);
      // Only a synchronous backing store (localStorage) can be tracked; a
      // promise-returning one simply never dedupes.
      if (typeof value === 'string' || value === null) {
        lastKey = name;
        lastValue = value;
      }
      return value;
    },
    setItem: (name, value) => {
      if (name === lastKey && value === lastValue) return;
      lastKey = name;
      lastValue = value;
      return base.setItem(name, value);
    },
    removeItem: (name) => {
      if (name === lastKey) lastValue = null;
      return base.removeItem(name);
    },
  };
}

/**
 * `createJSONStorage(() => localStorage)` with the identical-payload skip.
 * Drop-in for a persist `storage` option; like `createJSONStorage`, it returns
 * `undefined` when localStorage is unreachable (persist then warns and keeps
 * the store in memory).
 */
export function createDedupedJSONStorage<S>(): PersistStorage<S> | undefined {
  return createJSONStorage<S>(() => dedupeWrites(localStorage));
}
