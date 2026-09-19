/**
 * DictionaryService suite (Phase 6 §7.4, PR-11): chunked IDB import with a
 * status surface (CH-13's silent failure dies), idempotent re-entry,
 * retryable errors, async lookups. Runs against fake-indexeddb (the global
 * test setup) through the real data/repos/dictionary repo.
 *
 * Since the import moved into a worker, the fetch seam is no longer a
 * constructor dep: the service takes a `runImport` PORT whose production
 * default spawns `src/workers/dictionaryImport.worker.ts`. These suites
 * inject `createInProcessDictionaryImport(fetch)`, which runs the very same
 * `runDictionaryImport` the worker runs — so every assertion below still
 * exercises the real import logic, not a double.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import 'fake-indexeddb/auto';
import * as Comlink from 'comlink';
import { dictionary, DICT_DB_NAME, closeDictionaryConnection, type DictEntryTuple } from '@data/repos/dictionary';
import { DictionaryService, type DictionaryProgress } from './DictionaryService';
import {
  createInProcessDictionaryImport,
  runDictionaryImport,
  type DictionaryImportApi,
} from './importDictionary';

const FIXTURE: Record<string, DictEntryTuple> = {
  我: ['wǒ', 'I; me'],
  你: ['nǐ', 'you (singular)'],
  朋: ['péng', 'friend; companion'],
  友: ['yǒu', 'friend; companion'],
  朋友: ['péng you', 'friend; companion'],
};

const jsonResponse = (body: unknown, ok = true, status = 200): Response =>
  ({
    ok,
    status,
    headers: new Headers({ 'content-type': 'application/json' }),
    json: async () => body,
  }) as unknown as Response;

/**
 * The SPA-shell trap: a missing /dict/cedict.json is served as the app's
 * index.html with a 200 by the dev server and GitHub Pages' 404.html. ok is
 * true, content-type is text/html, and JSON.parse would die on "<!doctype".
 */
const htmlShellResponse = (): Response =>
  ({
    ok: true,
    status: 200,
    headers: new Headers({ 'content-type': 'text/html; charset=utf-8' }),
    json: async () => {
      throw new SyntaxError(`Unexpected token '<', "<!doctype "... is not valid JSON`);
    },
  }) as unknown as Response;

const fetchOk = async (url: string): Promise<Response> => {
  if (url === '/dict/cedict.json') return jsonResponse(FIXTURE);
  if (url === '/dict/cedict.meta.json') {
    return jsonResponse({ license: 'CC-BY-SA-4.0', releaseDate: '2026-06-12' });
  }
  return jsonResponse(null, false, 404);
};

const deleteDb = () =>
  new Promise<void>((resolve, reject) => {
    const request = indexedDB.deleteDatabase(DICT_DB_NAME);
    request.onsuccess = () => resolve();
    request.onblocked = () => resolve();
    request.onerror = () => reject(request.error);
  });

/**
 * Stand-in for `new Worker(new URL('…/dictionaryImport.worker.ts'))`: jsdom
 * has no Worker, so the stub bridges Comlink over a MessageChannel and
 * exposes the REAL worker API (`runDictionaryImport`) on the far side. That
 * keeps the production port honest end to end — wrap, the `Comlink.proxy`
 * progress callback, the error race and terminate all run for real; only the
 * OS thread and the module loader are simulated.
 */
class StubImportWorker extends EventTarget {
  static spawned: StubImportWorker[] = [];
  /** 'serve' answers Comlink; 'dead-module' never answers and fires `error`. */
  static behaviour: 'serve' | 'dead-module' = 'serve';

  static reset(): void {
    StubImportWorker.spawned = [];
    StubImportWorker.behaviour = 'serve';
  }

  readonly url: string;
  readonly options: WorkerOptions | undefined;
  terminated = false;
  private readonly channel = new MessageChannel();

  constructor(url: URL | string, options?: WorkerOptions) {
    super();
    this.url = String(url);
    this.options = options;
    StubImportWorker.spawned.push(this);
    if (StubImportWorker.behaviour === 'dead-module') {
      // What a browser does when a module worker's script 404s: the posted
      // call is never answered and an `error` event fires on the worker.
      setTimeout(() => {
        this.dispatchEvent(
          new ErrorEvent('error', { message: 'Failed to fetch dynamically imported module' }),
        );
      }, 0);
      return;
    }
    const api: DictionaryImportApi = {
      run: (onProgress) => runDictionaryImport({ fetch: fetchOk, onProgress }),
    };
    Comlink.expose(api, this.channel.port2);
    this.channel.port2.start();
  }

  start(): void {
    this.channel.port1.start();
  }

  postMessage(message: unknown, transfer: Transferable[] = []): void {
    this.channel.port1.postMessage(message, transfer);
  }

  override addEventListener(
    type: string,
    listener: EventListenerOrEventListenerObject | null,
    options?: boolean | AddEventListenerOptions,
  ): void {
    if (listener && (type === 'message' || type === 'messageerror')) {
      this.channel.port1.addEventListener(type, listener, options);
      this.channel.port1.start();
      return;
    }
    super.addEventListener(type, listener, options);
  }

  override removeEventListener(
    type: string,
    listener: EventListenerOrEventListenerObject | null,
    options?: boolean | EventListenerOptions,
  ): void {
    if (listener && (type === 'message' || type === 'messageerror')) {
      this.channel.port1.removeEventListener(type, listener, options);
      return;
    }
    super.removeEventListener(type, listener, options);
  }

  terminate(): void {
    this.terminated = true;
    this.channel.port1.close();
    this.channel.port2.close();
  }
}

describe('DictionaryService', () => {
  beforeEach(async () => {
    await closeDictionaryConnection();
    await deleteDb();
  });

  it('imports /dict/cedict.json into IDB with a ready status and provenance meta', async () => {
    const service = new DictionaryService({ runImport: createInProcessDictionaryImport(fetchOk) });
    const statuses: DictionaryProgress['status'][] = [];
    service.subscribe((p) => statuses.push(p.status));

    await service.ensureReady();

    expect(statuses[0]).toBe('empty'); // subscribe replays current state
    expect(statuses).toContain('importing');
    expect(statuses[statuses.length - 1]).toBe('ready');
    expect(service.getProgress()).toMatchObject({ status: 'ready', total: 5, imported: 5 });

    expect(await service.getEntry('朋友')).toEqual(['péng you', 'friend; companion']);
    expect(await service.getEntry('missing')).toBeUndefined();
    expect(await dictionary.getMeta('source')).toMatchObject({ license: 'CC-BY-SA-4.0' });
  });

  it('a second ensureReady (same or new instance) is a no-op — no re-fetch', async () => {
    let fetches = 0;
    const counting = async (url: string) => {
      if (url === '/dict/cedict.json') fetches += 1;
      return fetchOk(url);
    };
    const first = new DictionaryService({ runImport: createInProcessDictionaryImport(counting) });
    await first.ensureReady();
    await first.ensureReady();
    expect(fetches).toBe(1);

    // A fresh instance (new session) sees the IDB meta stamp and skips.
    const second = new DictionaryService({ runImport: createInProcessDictionaryImport(counting) });
    await second.ensureReady();
    expect(fetches).toBe(1);
    expect(second.getProgress().status).toBe('ready');
  });

  it('CH-13 dies: a failed import surfaces status error AND stays retryable', async () => {
    let fail = true;
    const flaky = async (url: string) => {
      if (url === '/dict/cedict.json' && fail) return jsonResponse(null, false, 503);
      return fetchOk(url);
    };
    const service = new DictionaryService({ runImport: createInProcessDictionaryImport(flaky) });

    await expect(service.ensureReady()).rejects.toThrow(/503/);
    expect(service.getProgress().status).toBe('error');
    expect(service.getProgress().error).toContain('503');

    fail = false;
    await service.ensureReady();
    expect(service.getProgress().status).toBe('ready');
    expect(await service.getEntry('我')).toEqual(['wǒ', 'I; me']);
  });

  it('a missing artifact (HTML app shell, 200 OK) fails loudly, not with a cryptic JSON error', async () => {
    // Regression for "[DictionaryService] Dictionary import failed SyntaxError:
    // Unexpected token '<', "<!doctype "... is not valid JSON": response.ok is
    // true so the status check passes; we must catch the HTML shell ourselves.
    let missing = true;
    const flaky = async (url: string) => {
      if (url === '/dict/cedict.json' && missing) return htmlShellResponse();
      return fetchOk(url);
    };
    const service = new DictionaryService({ runImport: createInProcessDictionaryImport(flaky) });

    await expect(service.ensureReady()).rejects.toThrow(/compile-dict/);
    expect(service.getProgress().status).toBe('error');
    expect(service.getProgress().error).not.toMatch(/Unexpected token/);
    expect(service.getProgress().error).toMatch(/compile-dict/);

    // Retryable: once the artifact is served, a later call recovers.
    missing = false;
    await service.ensureReady();
    expect(service.getProgress().status).toBe('ready');
    expect(await service.getEntry('我')).toEqual(['wǒ', 'I; me']);
  });

  /**
   * The import ran `Object.entries(data)` over ~198 000 headwords on the MAIN
   * thread — one two-element array per entry, ~100 MB of transient heap, all of
   * it built BEFORE the first row was written. The pairs for a chunk are now
   * built inside the write loop, so at most one chunk is materialized at a time.
   */
  describe('regression: dictionary import does not build a full entries array', () => {
    it('materializes at most one chunk of pairs before the first write', async () => {
      const ENTRY_COUNT = 12_000; // > 2 chunks (IMPORT_CHUNK_SIZE = 5000)
      const raw: Record<string, DictEntryTuple> = {};
      for (let i = 0; i < ENTRY_COUNT; i++) raw[`w${i}`] = [`p${i}`, `d${i}`];

      // Counts how many VALUES have been read off the parsed payload (the
      // `then` probe `await` performs on the resolved object is not one).
      let valueReads = 0;
      const counted = new Proxy(raw, {
        get(target, prop, receiver) {
          if (typeof prop === 'string' && prop in target) valueReads += 1;
          return Reflect.get(target, prop, receiver);
        },
      });

      const service = new DictionaryService({
        runImport: createInProcessDictionaryImport(async (url: string) =>
          url === '/dict/cedict.json' ? jsonResponse(counted) : jsonResponse(null, false, 404),
        ),
      });

      let readsAtFirstWrite: number | null = null;
      service.subscribe((progress) => {
        if (readsAtFirstWrite === null && progress.status === 'importing' && progress.imported > 0) {
          readsAtFirstWrite = valueReads;
        }
      });

      await service.ensureReady();

      // Before: every one of the 12 000 values was read (and paired) up front.
      expect(readsAtFirstWrite).not.toBeNull();
      expect(readsAtFirstWrite).toBeLessThanOrEqual(5000);
      // The import itself is unchanged: every entry landed, exactly once.
      expect(service.getProgress()).toMatchObject({ status: 'ready', total: ENTRY_COUNT });
      expect(valueReads).toBe(ENTRY_COUNT);
      expect(await service.getEntry('w11999')).toEqual(['p11999', 'd11999']);
      expect(await service.getEntry('w0')).toEqual(['p0', 'd0']);
    });
  });

  /**
   * `await response.json()` on /dict/cedict.json — 15,154,650 bytes, 197,828
   * keys — ran on the MAIN THREAD: 183 ms and ~104 MB of transient heap on a
   * desktop x86 node build, i.e. 1.2–2.4 s of a completely frozen UI and a
   * ~100 MB spike on a mid-range Android WebView, landing exactly when the
   * user has tapped a Chinese word and is waiting for the vocab card. The
   * fetch, the parse and the chunked write now live behind the `runImport`
   * port, whose production default is the Comlink-wrapped
   * src/workers/dictionaryImport.worker.ts.
   */
  describe('regression: the 15 MB dictionary parse runs in a worker, not on the main thread', () => {
    afterEach(() => {
      vi.unstubAllGlobals();
      StubImportWorker.reset();
    });

    it('delegates the whole import to the runImport port — the service never fetches or parses', async () => {
      // Anything the service fetched itself would land here. Before the port
      // existed it called localFetch('/dict/cedict.json') directly.
      const mainThreadFetches: string[] = [];
      vi.stubGlobal('fetch', async (input: unknown) => {
        mainThreadFetches.push(String(input));
        return fetchOk(String(input));
      });

      let portCalls = 0;
      const service = new DictionaryService({
        runImport: (onProgress) => {
          portCalls += 1;
          return runDictionaryImport({ fetch: fetchOk, onProgress });
        },
      });
      const statuses: DictionaryProgress['status'][] = [];
      service.subscribe((p) => statuses.push(p.status));

      await service.ensureReady();

      expect(portCalls).toBe(1);
      expect(mainThreadFetches).toEqual([]);
      // Behaviour is unchanged on the far side of the port.
      expect(statuses[0]).toBe('empty');
      expect(statuses[statuses.length - 1]).toBe('ready');
      expect(service.getProgress()).toMatchObject({ status: 'ready', total: 5, imported: 5 });
      expect(await service.getEntry('朋友')).toEqual(['péng you', 'friend; companion']);
    });

    it('defaults to the dictionary-import worker and terminates it when the import settles', async () => {
      vi.stubGlobal('Worker', StubImportWorker);

      const service = new DictionaryService(); // production wiring, no deps
      const progress: DictionaryProgress[] = [];
      service.subscribe((p) => progress.push({ ...p }));

      await service.ensureReady();

      expect(StubImportWorker.spawned).toHaveLength(1);
      const [worker] = StubImportWorker.spawned;
      expect(worker.url).toMatch(/dictionaryImport\.worker/);
      expect(worker.options).toMatchObject({ type: 'module' });
      // One-shot: the thread (and its second versicle-dict connection) goes
      // away as soon as the import is done.
      expect(worker.terminated).toBe(true);

      // The progress sequence that reaches subscribers is the production one,
      // in order — the Comlink progress proxy travels on its own channel, so
      // a stray late event would show up here as a post-'ready' 'importing'.
      expect(progress.map((p) => `${p.status}:${p.imported}/${p.total}`)).toEqual([
        'empty:0/0',
        'importing:0/0',
        'importing:0/5',
        'importing:5/5',
        'ready:5/5',
      ]);
      // Every row landed in versicle-dict, written from the worker side.
      expect(await service.getEntry('朋友')).toEqual(['péng you', 'friend; companion']);
      expect(await dictionary.getMeta('source')).toMatchObject({ license: 'CC-BY-SA-4.0' });
    });
  });

  /**
   * The failure mode a worker INTRODUCES. A module that never loads (stale
   * precache, a chunk 404 after a deploy, a worker-src CSP refusal) leaves the
   * Comlink call unanswered forever: without the error race below the service
   * would sit on 'importing' and the vocab card would spin for the rest of the
   * session. It must fail as loudly as every other import failure (CH-13).
   */
  describe('regression: a dictionary-import worker that never runs fails loudly', () => {
    afterEach(() => {
      vi.unstubAllGlobals();
      StubImportWorker.reset();
    });

    it('surfaces status error when the worker cannot be constructed', async () => {
      vi.stubGlobal(
        'Worker',
        class {
          constructor() {
            throw new Error('Worker construction blocked by CSP');
          }
        },
      );
      const service = new DictionaryService();

      await expect(service.ensureReady()).rejects.toThrow(/Worker construction blocked by CSP/);
      expect(service.getProgress().status).toBe('error');
      expect(service.getProgress().error).toMatch(/Worker construction blocked by CSP/);
    });

    it('surfaces status error when the worker module fails to load, instead of hanging forever', async () => {
      StubImportWorker.behaviour = 'dead-module';
      vi.stubGlobal('Worker', StubImportWorker);
      const service = new DictionaryService();

      // No fake timers, no manual settling: if the error event were not raced
      // against the Comlink call this would never resolve and the test would
      // die on the suite timeout.
      await expect(service.ensureReady()).rejects.toThrow(
        /dictionary import worker failed to load: Failed to fetch dynamically imported module/,
      );
      expect(service.getProgress().status).toBe('error');
      expect(service.getProgress().error).toMatch(/reload the app to retry/);
      expect(StubImportWorker.spawned[0].terminated).toBe(true);

      // Still retryable — a reload-free second attempt gets a fresh worker.
      StubImportWorker.behaviour = 'serve';
      await service.ensureReady();
      expect(service.getProgress().status).toBe('ready');
      expect(await service.getEntry('我')).toEqual(['wǒ', 'I; me']);
    });
  });

  it('getEntries batches; getCompound resolves the longest hit in the selection', async () => {
    const service = new DictionaryService({ runImport: createInProcessDictionaryImport(fetchOk) });
    await service.ensureReady();

    const entries = await service.getEntries(['我', '朋', 'missing']);
    expect(entries.size).toBe(2);
    expect(entries.get('朋')).toEqual(['péng', 'friend; companion']);

    const compound = await service.getCompound('我的朋友', 2);
    expect(compound).toMatchObject({ word: '朋友', pinyin: 'péng you' });

    // The batched form resolves every index in ONE dictionary transaction.
    const compounds = await service.getCompounds('我的朋友', [0, 2, 3]);
    expect(compounds.get(2)).toMatchObject({ word: '朋友', pinyin: 'péng you' });
    expect(compounds.get(0)).toBeNull();
  });
});
