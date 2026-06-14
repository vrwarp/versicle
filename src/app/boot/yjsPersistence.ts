/**
 * `startYjsPersistence` boot phase: explicitly start the y-idb persistence
 * binding for the shared Y.Doc.
 *
 * Until Phase 1b this happened as a module-scope side effect of importing
 * store/yjs-provider.ts (importing ANY synced store booted IndexedDB
 * persistence — layering-deps.md LD-6). Construction now lives behind
 * `startYjsPersistence()` and boot owns the call.
 */
import type { BootTask } from '../bootstrap';
import { startYjsPersistence } from '@store/yjs-provider';

export const yjsPersistenceTask: BootTask = {
  name: 'state/start-yjs-persistence',
  run: () => {
    startYjsPersistence();
  },
};
