/**
 * DictionaryService suite (Phase 6 §7.4, PR-11): chunked IDB import with a
 * status surface (CH-13's silent failure dies), idempotent re-entry,
 * retryable errors, async lookups. Runs against fake-indexeddb (the global
 * test setup) through the real data/repos/dictionary repo.
 */
import { describe, it, expect, beforeEach } from 'vitest';
import 'fake-indexeddb/auto';
import { dictionary, DICT_DB_NAME, closeDictionaryConnection, type DictEntryTuple } from '@data/repos/dictionary';
import { DictionaryService, type DictionaryProgress } from './DictionaryService';

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

describe('DictionaryService', () => {
  beforeEach(async () => {
    await closeDictionaryConnection();
    await deleteDb();
  });

  it('imports /dict/cedict.json into IDB with a ready status and provenance meta', async () => {
    const service = new DictionaryService({ fetch: fetchOk });
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
    const first = new DictionaryService({ fetch: counting });
    await first.ensureReady();
    await first.ensureReady();
    expect(fetches).toBe(1);

    // A fresh instance (new session) sees the IDB meta stamp and skips.
    const second = new DictionaryService({ fetch: counting });
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
    const service = new DictionaryService({ fetch: flaky });

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
    const service = new DictionaryService({ fetch: flaky });

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
        fetch: async (url: string) =>
          url === '/dict/cedict.json' ? jsonResponse(counted) : jsonResponse(null, false, 404),
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

  it('getEntries batches; getCompound resolves the longest hit in the selection', async () => {
    const service = new DictionaryService({ fetch: fetchOk });
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
