/**
 * runDictionaryImport — the `/dict/cedict.json` → `versicle-dict` import,
 * extracted from {@link DictionaryService} so it can run OFF the main thread.
 *
 * Why it moved: `await response.json()` on the compiled CC-CEDICT artifact
 * (15,154,650 bytes, 197,828 keys) measured 183 ms and ~104 MB of transient
 * heap on a desktop x86 node build. On a mid-range Android WebView that is on
 * the order of 1.2–2.4 s of a COMPLETELY FROZEN UI plus a ~100 MB spike on a
 * device that may not have the headroom — and it lands at the worst possible
 * moment, right after the user tapped a Chinese word and is waiting for the
 * vocab card. The parse (and the fetch, and the chunked write) now happen in
 * `src/workers/dictionaryImport.worker.ts`; this module is the logic BOTH
 * sides share — the worker drives it in production, the DictionaryService
 * suite drives it in-process under vitest (where there is no module loader to
 * spawn a worker from).
 *
 * Worker-safe by construction: no DOM, no timers beyond `setTimeout`, no
 * store, and the only storage edge is `@data/repos/dictionary` — which owns
 * its own `versicle-dict` connection with NO write-gate coordination (it is
 * rebuildable static content, not user data; see that repo's module docs), so
 * a worker may drive it directly.
 */
import { dictionary, type DictEntryTuple } from '@data/repos/dictionary';

/** Rows written per readwrite transaction. */
const IMPORT_CHUNK_SIZE = 5000;

const DICT_URL = '/dict/cedict.json';
const DICT_META_URL = '/dict/cedict.meta.json';

/** `versicle-dict` meta keys the import stamps and the service reads back. */
export const META_IMPORTED_AT = 'importedAt';
export const META_ENTRY_COUNT = 'entryCount';

/** Rows written so far / total. Emitted once per chunk, plus once after the parse. */
export interface DictionaryImportProgress {
  imported: number;
  total: number;
}

/**
 * Progress sink. AWAITED by the import loop: across a Comlink boundary a
 * `Comlink.proxy` callback travels on its OWN MessageChannel, so without the
 * await a late progress message could overtake the call's return value and
 * land after the service had already published `status: 'ready'`.
 */
type DictionaryImportProgressCallback = (
  progress: DictionaryImportProgress,
) => void | Promise<void>;

/** Same-origin fetch (kernel/net `localFetch` in production). */
export type LocalFetch = (url: string) => Promise<Response>;

export interface DictionaryImportOptions {
  /** Same-origin fetch. The worker passes `localFetch` (@kernel/net). */
  fetch: LocalFetch;
  onProgress: DictionaryImportProgressCallback;
}

/** The Comlink surface `src/workers/dictionaryImport.worker.ts` exposes. */
export interface DictionaryImportApi {
  run(onProgress: DictionaryImportProgressCallback): Promise<number>;
}

/**
 * The port {@link DictionaryService} drives: runs one whole import and
 * resolves with the number of entries written.
 */
export type DictionaryImportPort = (
  onProgress: DictionaryImportProgressCallback,
) => Promise<number>;

/**
 * Fetch, parse and chunk-write the compiled dictionary. Resolves with the
 * entry count; throws (loudly, with an actionable message) on any failure —
 * the caller owns the `status: 'error'` surface.
 */
export async function runDictionaryImport({
  // Bound to a local name: a bare `fetch(...)` call is lint-banned outside
  // src/kernel/net, and this one IS the kernel's localFetch, injected.
  fetch: fetchLocal,
  onProgress,
}: DictionaryImportOptions): Promise<number> {
  const response = await fetchLocal(DICT_URL);
  if (!response.ok) {
    throw new Error(`HTTP error! status: ${response.status}`);
  }
  // The SPA-shell trap: when /dict/cedict.json is absent (the artifact is
  // git-ignored — built by `npm run compile-dict`, in CI, and the Docker
  // images), both the Vite dev server and GitHub Pages' 404.html serve the
  // app's index.html with a 200, so `response.ok` passes and the JSON parse
  // below dies on "<!doctype html>" with the opaque
  //   SyntaxError: Unexpected token '<', "<!doctype "... is not valid JSON.
  // Detect the HTML shell up front and fail with an actionable message.
  const contentType = response.headers?.get('content-type') ?? '';
  if (/\b(?:html|xml)\b/i.test(contentType)) {
    throw new Error(
      `Expected JSON from ${DICT_URL} but the server returned "${contentType}" ` +
        `(the app shell). The compiled dictionary is missing — run \`npm run compile-dict\` ` +
        `(it is git-ignored and built offline from the vendored CC-CEDICT snapshot).`,
    );
  }
  // THE 183 ms / ~104 MB step. It is here, in the worker, and nowhere else.
  const data = (await response.json()) as Record<string, DictEntryTuple>;
  // Keys only. `Object.entries` built a ~200 000-element array of
  // two-element arrays (one allocation per headword, ~100 MB of transient
  // heap) before a single row was written; the keys array alone is one
  // allocation, and each chunk's pairs are materialized inside the loop —
  // never more than IMPORT_CHUNK_SIZE of them at a time.
  const keys = Object.keys(data);
  const total = keys.length;
  await onProgress({ imported: 0, total });

  // A previous half-built index (crash mid-import) must not survive.
  await dictionary.clearAll();

  for (let offset = 0; offset < total; offset += IMPORT_CHUNK_SIZE) {
    const end = Math.min(offset + IMPORT_CHUNK_SIZE, total);
    const chunk: [string, DictEntryTuple][] = new Array(end - offset);
    for (let i = offset; i < end; i++) {
      const word = keys[i];
      chunk[i - offset] = [word, data[word]];
    }
    await dictionary.bulkPutEntries(chunk);
    await onProgress({ imported: Math.min(offset + IMPORT_CHUNK_SIZE, total), total });
    // Yield between transactions. Kept from the main-thread version: the
    // in-process runner still runs on whatever thread called it, and in the
    // worker it costs ~40 macrotasks across the whole import.
    await new Promise<void>((resolve) => setTimeout(resolve, 0));
  }

  // Provenance sidecar (PR-12 pipeline) — best effort, never fatal.
  try {
    const meta = await fetchLocal(DICT_META_URL);
    if (meta.ok) {
      await dictionary.setMeta('source', await meta.json());
    }
  } catch {
    /* sidecar absent in dev builds without compile-dict — fine */
  }

  await dictionary.setMeta(META_ENTRY_COUNT, total);
  await dictionary.setMeta(META_IMPORTED_AT, Date.now());
  return total;
}

/**
 * The in-process port: the SAME import logic, on the calling thread.
 *
 * Production never uses it — {@link DictionaryService} defaults to the worker
 * port — but the DictionaryService suite injects it so every import assertion
 * (progress sequence, SPA-shell detection, loud failure, retryability,
 * rows-in-IDB) keeps exercising the REAL logic under vitest, where no module
 * worker can be spawned.
 */
export function createInProcessDictionaryImport(fetch: LocalFetch): DictionaryImportPort {
  return (onProgress) => runDictionaryImport({ fetch, onProgress });
}
