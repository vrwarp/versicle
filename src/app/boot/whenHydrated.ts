/**
 * `whenHydrated` boot phase: resolve when the Yjs-backed stores have been
 * hydrated from local persistence, then load static book metadata.
 *
 * Composition (phase2-fork-surgery.md §2.4): `waitForYjsSync` gates on the
 * IDB load; stores whose Y.Map is empty start from their declared defaults
 * and are marked hydrated explicitly (the fork alone cannot distinguish
 * "doc loaded and legitimately empty" from "not loaded yet" — that
 * knowledge belongs to the persistence layer); the rest resolve via the
 * middleware's `api.yjs.whenHydrated()`, which is the structural
 * replacement for the legacy App.tsx book-poll (IDB-synced ≠ store-patched:
 * the inbound patch is a microtask behind the 'synced' event, which the
 * poll papered over with sleep(100) retries).
 *
 * Timeout behavior intentionally mirrors `waitForYjsSync`: warn and
 * proceed, never hang boot (risk R3 — a corrupt IDB or swallowed
 * persistence error must not brick startup).
 */
import type { BootTask } from '../bootstrap';
import type { YjsStoreHandle } from 'zustand-middleware-yjs';
import { getYDoc, getYjsPersistence, isYjsSyncSettled, waitForYjsSync } from '@store/yjs-provider';
import { SYNCED_STORES, syncedDataMapIsEmpty, yjsHandleOf } from '@store/registry';
import { getLibrary } from '../library/createLibrary';
import { createLogger } from '@lib/logger';

const logger = createLogger('Boot');

async function whenHydrated(timeoutMs = 8000): Promise<void> {
  // 1. IDB load complete (existing gate; resolves immediately without persistence).
  await waitForYjsSync(timeoutMs);

  // 2. Empty data maps: those stores start from their declared defaults — no
  // inbound patch will ever arrive, so the provider marks them hydrated.
  // (Scope-aware: a scoped store hydrates from a nested child map, which may
  // be absent even when its root map carries other devices' entries.)
  //
  // ONLY when the IDB load actually completed (isYjsSyncSettled): on the
  // warn-and-proceed timeout path every map is empty simply because nothing
  // has loaded yet, and marking them all hydrated here collapsed the whole
  // gate into a no-op — boot proceeded positively believing it was hydrated,
  // a direct /read/:id entry opened at the book's start, and the first
  // relocation could overwrite the still-in-transit saved position. Instead,
  // the emptiness pass is deferred to the real 'synced' event; stores whose
  // maps carry data hydrate naturally via the middleware's inbound-update
  // markHydrated, and step 3 below gives the load one more window to land
  // before boot proceeds regardless (never hang boot — risk R3 holds).
  const yDoc = getYDoc();
  const markEmptyMapsHydrated = () => {
    for (const { def, store } of SYNCED_STORES) {
      const handle = yjsHandleOf(store);
      if (handle === undefined) continue; // store module mocked in tests
      if (syncedDataMapIsEmpty(yDoc, def)) handle.markHydrated();
    }
  };
  if (isYjsSyncSettled()) {
    markEmptyMapsHydrated();
  } else {
    // Late load: run the same pass the moment the load really lands, so
    // legitimately-empty stores don't stall step 3 for the full window.
    getYjsPersistence()?.once('synced', markEmptyMapsHydrated);
  }

  const handles: YjsStoreHandle[] = [];
  for (const { store } of SYNCED_STORES) {
    const handle = yjsHandleOf(store);
    if (handle === undefined) continue; // store module mocked in tests
    handles.push(handle);
  }

  // 3. Await the rest, warn-and-proceed on timeout (parity with waitForYjsSync).
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<void>((resolve) => {
    timer = setTimeout(() => {
      logger.warn('whenHydrated timeout — proceeding (parity with waitForYjsSync).');
      resolve();
    }, timeoutMs);
  });
  try {
    await Promise.race([
      Promise.all(handles.map((handle) => handle.whenHydrated())).then(() => undefined),
      timeout,
    ]);
  } finally {
    clearTimeout(timer);
  }
}

export const whenHydratedTask: BootTask = {
  name: 'state/when-hydrated',
  run: () => whenHydrated(),
};

export const hydrateStaticMetadataTask: BootTask = {
  name: 'library/hydrate-static-metadata',
  run: async () => {
    // Phase 7 §D (D16 paid in full): ONE owner for static-metadata
    // hydration. The service subscribes to inventory deltas — newly synced
    // books hydrate without LibraryView's old prevBookCountRef heuristic —
    // and this boot task performs the initial pass.
    const { service } = getLibrary();
    service.start();
    await service.hydrate();
  },
};
