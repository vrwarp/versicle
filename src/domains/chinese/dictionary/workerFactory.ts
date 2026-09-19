/**
 * Production {@link DictionaryImportPort}: the Comlink-wrapped dictionary
 * import worker (`src/workers/dictionaryImport.worker.ts`). Mirrors
 * `src/domains/search/workerFactory.ts`, including terminate-on-teardown.
 *
 * The worker is ONE-SHOT: spawned for a single import and terminated the
 * moment it settles. The import runs once per device, so keeping a thread
 * (and a second `versicle-dict` connection) alive for the rest of the session
 * buys nothing.
 *
 * The failure mode this port owns — the one a worker INTRODUCES. If the
 * module never loads (a stale precache, a chunk 404 after a deploy, a
 * `worker-src` CSP refusal, a browser with no module-worker support), the
 * Comlink call is posted into the void and NEVER settles: the service would
 * sit on `status: 'importing'` forever and the vocab card would spin for the
 * rest of the session. The worker's `error` / `messageerror` events are
 * therefore raced against the call, so a dead worker surfaces as
 * `status: 'error'` — the same loud surface CH-13 bought for every other
 * import failure. A `new Worker(…)` that throws outright needs no race: the
 * rejection already propagates.
 */
import * as Comlink from 'comlink';
import { installAppErrorTransferHandler } from '@lib/comlinkAppError';
import type { DictionaryImportApi, DictionaryImportPort } from './importDictionary';

/** Worker construction seam — tests inject a stub; production spawns the module worker. */
export type DictionaryImportWorkerSpawn = () => Worker;

const spawnDictionaryImportWorker: DictionaryImportWorkerSpawn = () =>
  // Deliberately relative: `new URL(…, import.meta.url)` is how Vite finds a
  // worker entry, and the alias rule does not cover it (eslint.config.js).
  new Worker(new URL('../../../workers/dictionaryImport.worker.ts', import.meta.url), {
    type: 'module',
  });

function describeWorkerFailure(event: Event): string {
  const detail =
    event instanceof ErrorEvent ? event.message || String(event.error ?? '') : event.type;
  return (
    `The dictionary import worker failed to load${detail ? `: ${detail}` : ''}. ` +
    `The compiled dictionary could not be imported — reload the app to retry.`
  );
}

export function createWorkerDictionaryImport(
  spawn: DictionaryImportWorkerSpawn = spawnDictionaryImportWorker,
): DictionaryImportPort {
  return async (onProgress) => {
    // Both sides of the channel carry AppError codes (lib/comlinkAppError.ts).
    installAppErrorTransferHandler();
    // Construction itself can throw (no Worker in the realm, a CSP refusal);
    // that rejection IS the service's `status: 'error'`.
    const worker = spawn();
    const loadFailure = new Promise<never>((_, reject) => {
      const fail = (event: Event) => reject(new Error(describeWorkerFailure(event)));
      worker.addEventListener('error', fail);
      worker.addEventListener('messageerror', fail);
    });
    const remote = Comlink.wrap<DictionaryImportApi>(worker);
    try {
      // Promise.race subscribes to BOTH sides immediately, so a load error
      // arriving after the call settled can never become an unhandled
      // rejection.
      return await Promise.race([remote.run(Comlink.proxy(onProgress)), loadFailure]);
    } finally {
      // Drops the worker, its Comlink endpoint and the progress proxy's
      // MessageChannel in one go — success or failure.
      worker.terminate();
    }
  };
}
