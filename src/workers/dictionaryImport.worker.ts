/**
 * Dictionary-import Web Worker entry.
 *
 * Fetches `/dict/cedict.json` (15 MB, ~198 000 headwords), parses it and
 * writes it into the `versicle-dict` IndexedDB database in chunked
 * transactions — all of it OFF the main thread. The main-thread
 * {@link DictionaryService} keeps only the progress/subscribe surface and the
 * lookup path; it drives this worker through
 * `@domains/chinese/dictionary/workerFactory`.
 *
 * Service-worker caching still applies: a dedicated worker spawned by a
 * controlled page inherits that page's service-worker controller, so
 * `localFetch('/dict/cedict.json')` from here goes through the CacheFirst
 * `/dict/*` route in `src/sw.ts` exactly as it did from the page.
 *
 * Mirrors src/workers/search.worker.ts.
 */
import * as Comlink from 'comlink';
import {
  runDictionaryImport,
  type DictionaryImportApi,
} from '@domains/chinese/dictionary/importDictionary';
import { installAppErrorTransferHandler } from '@lib/comlinkAppError';
import { localFetch } from '@kernel/net';

installAppErrorTransferHandler();

const api: DictionaryImportApi = {
  run: (onProgress) => runDictionaryImport({ fetch: localFetch, onProgress }),
};

Comlink.expose(api);
