/**
 * `whenHydrated` boot phase: resolve when the Yjs-backed stores have been
 * hydrated from local persistence, then load static book metadata.
 *
 * `whenHydrated()` is deliberately ONE named function wrapping the legacy
 * mechanism (waitForYjsSync + the short book poll that used to live inline
 * in App.tsx). Phase 2's fork surgery replaces its body with the real
 * `whenHydrated()` signal from the zustand-middleware-yjs fork — callers and
 * phase position stay put (contract-first.md C2/C11).
 */
import type { BootTask } from '../bootstrap';
import { waitForYjsSync } from '@store/yjs-provider';
import { useLibraryStore, useBookStore } from '@store/useLibraryStore';

export async function whenHydrated(): Promise<void> {
  await waitForYjsSync();

  // Wait for the yjs middleware to deliver books into the store (short poll).
  // An empty library (first boot / post-wipe) exhausts the poll in ~1s.
  let attempts = 0;
  while (Object.keys(useBookStore.getState().books).length === 0 && attempts < 10) {
    await new Promise(resolve => setTimeout(resolve, 100));
    attempts++;
  }
}

export const whenHydratedTask: BootTask = {
  name: 'state/when-hydrated',
  run: () => whenHydrated(),
};

export const hydrateStaticMetadataTask: BootTask = {
  name: 'library/hydrate-static-metadata',
  run: async () => {
    await useLibraryStore.getState().hydrateStaticMetadata();
  },
};
