/**
 * `startYjsPersistence` boot phase: explicitly start the y-idb persistence
 * binding for the shared Y.Doc.
 *
 * Construction lives behind `startYjsPersistence()` and boot owns the call, so
 * importing store/yjs-provider.ts (or any synced store) has no IndexedDB side
 * effect (plan/overhaul/analysis/layering-deps.md LD-6).
 */
import type { BootTask } from '../bootstrap';
import { startYjsPersistence } from '@store/yjs-provider';

export const yjsPersistenceTask: BootTask = {
  name: 'state/start-yjs-persistence',
  run: () => {
    startYjsPersistence();
  },
};
