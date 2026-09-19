/**
 * DictionaryService — the IDB-backed CC-CEDICT lookup service
 * (Phase 6 §7.4, prep/phase6-reader-engine.md PR-11).
 *
 * Replaces the legacy `useChineseDictionary` module-global fetch: the
 * whole 14 MB cedict.json was parsed into ONE in-memory Record (~80 MB
 * retained) and re-fetched per session, triggered by ANY selection
 * containing a CJK character. Now:
 *
 *  - the compiled dictionary lives in the `versicle-dict` IndexedDB
 *    database (src/data/repos/dictionary — rebuildable static content,
 *    wiped by wipeAllData, served CacheFirst by the SW under /dict/*);
 *  - the first use imports /dict/cedict.json into IDB IN A WORKER
 *    (src/workers/dictionaryImport.worker.ts, driven through the
 *    {@link DictionaryServiceDeps.runImport} port) with progress + a LOUD
 *    error surface (status: 'empty'|'importing'|'ready'|'error' — CH-13's
 *    silent failure dies);
 *  - lookups are async and per-word ({@link getEntry}/{@link getEntries});
 *    nothing retains the full map. The import is gated on first triage
 *    open (the consumer), not on selection.
 *
 * What this class does NOT do any more: fetch, JSON.parse or write the
 * payload. `await response.json()` on the 15,154,650-byte artifact measured
 * 183 ms / ~104 MB of transient heap on desktop x86 — 1.2–2.4 s of frozen UI
 * on a mid-range Android WebView, right when the user is waiting for the
 * vocab card. That whole pipeline lives in ./importDictionary.ts and runs in
 * the worker; the service owns the progress/subscribe surface, the meta
 * stamps it reads back, and the lookup path. The port default is the worker
 * (./workerFactory); tests inject `createInProcessDictionaryImport(fetch)` so
 * they still exercise the real import logic.
 *
 * Boundary: domains-no-store; the service touches only data/ + the port.
 * No module-scope construction — consumers go through
 * {@link getDictionaryService} (lazy, side-effect free at import time;
 * constructing the service does NOT spawn the worker — that happens inside
 * the first import that actually needs it).
 */
import { dictionary, type DictEntryTuple } from '@data/repos/dictionary';
import { createLogger } from '@lib/logger';
import { findCompoundWord, findCompoundWords, type CompoundHit } from './compoundLookup';
import {
  META_ENTRY_COUNT,
  META_IMPORTED_AT,
  type DictionaryImportPort,
  type DictionaryImportProgress,
} from './importDictionary';

const logger = createLogger('DictionaryService');

/**
 * The production import port: the Comlink-wrapped worker (./workerFactory).
 *
 * Loaded LAZILY on purpose. The import runs once per device, but this module
 * rides the entry chunk (the triage card imports it), and a static edge put
 * Comlink + the factory in there for ~1.7 kB gzip that virtually no session
 * executes. A chunk that fails to load (stale precache, post-deploy 404)
 * rejects here and becomes `status: 'error'` like any other import failure —
 * never a spinner that waits forever.
 */
const workerDictionaryImport: DictionaryImportPort = async (onProgress) => {
  const { createWorkerDictionaryImport } = await import('./workerFactory');
  return createWorkerDictionaryImport()(onProgress);
};

export type DictionaryStatus = 'empty' | 'importing' | 'ready' | 'error';

export interface DictionaryProgress {
  status: DictionaryStatus;
  /** Entries written so far / total (only meaningful while importing). */
  imported: number;
  total: number;
  /** Present when status === 'error'. */
  error?: string;
}

type Listener = (progress: DictionaryProgress) => void;

export interface DictionaryServiceDeps {
  /**
   * The import port — fetch + parse + chunked write, as ONE call that
   * resolves with the entry count.
   *
   * Defaults to the lazily-loaded worker port, so in production the 15 MB
   * `JSON.parse` happens in `src/workers/dictionaryImport.worker.ts` and
   * never on the main thread. Tests inject
   * `createInProcessDictionaryImport(fetch)` (./importDictionary) to run the
   * REAL import logic in-process, where vitest has no module worker to spawn.
   */
  runImport?: DictionaryImportPort;
}

export class DictionaryService {
  private progress: DictionaryProgress = { status: 'empty', imported: 0, total: 0 };
  private listeners = new Set<Listener>();
  private readyPromise: Promise<void> | null = null;
  private readonly runImport: DictionaryImportPort;

  constructor(deps: DictionaryServiceDeps = {}) {
    // Holding the port neither loads ./workerFactory nor spawns a worker;
    // the first import that actually needs one does both.
    this.runImport = deps.runImport ?? workerDictionaryImport;
  }

  getProgress(): DictionaryProgress {
    return { ...this.progress };
  }

  subscribe(listener: Listener): () => void {
    this.listeners.add(listener);
    listener(this.getProgress());
    return () => this.listeners.delete(listener);
  }

  /**
   * Make the dictionary queryable: no-op when the IDB index exists,
   * otherwise import /dict/cedict.json (chunked). Concurrent callers share
   * one import; a failed import resets so a later call can retry.
   */
  ensureReady(): Promise<void> {
    this.readyPromise ??= this.importIfNeeded().catch((error) => {
      this.readyPromise = null; // retryable
      throw error;
    });
    return this.readyPromise;
  }

  /** One headword (await ensureReady() first — the consumers gate on it). */
  async getEntry(word: string): Promise<DictEntryTuple | undefined> {
    return dictionary.getEntry(word);
  }

  /** Batched lookup (one transaction). */
  async getEntries(words: readonly string[]): Promise<Map<string, DictEntryTuple>> {
    return dictionary.getEntries(words);
  }

  /** Longest compound covering `charIndex` (code-point index) in `text`. */
  async getCompound(text: string, charIndex: number): Promise<CompoundHit | null> {
    return findCompoundWord(text, charIndex, (words) => dictionary.getEntries(words));
  }

  /**
   * {@link getCompound} for many indices in ONE dictionary transaction — what
   * the triage card needs for a whole selection (one lookup, not one per Han
   * character).
   */
  async getCompounds(
    text: string,
    charIndices: readonly number[],
  ): Promise<Map<number, CompoundHit | null>> {
    return findCompoundWords(text, charIndices, (words) => dictionary.getEntries(words));
  }

  private setProgress(next: DictionaryProgress): void {
    this.progress = next;
    for (const listener of this.listeners) listener({ ...next });
  }

  private async importIfNeeded(): Promise<void> {
    const importedAt = await dictionary.getMeta<number>(META_IMPORTED_AT);
    if (importedAt) {
      const total = (await dictionary.getMeta<number>(META_ENTRY_COUNT)) ?? 0;
      this.setProgress({ status: 'ready', imported: total, total });
      return;
    }

    this.setProgress({ status: 'importing', imported: 0, total: 0 });
    try {
      // Everything heavy — the fetch, the 15 MB parse, clearAll(), the
      // chunked bulkPut transactions and the provenance sidecar — happens
      // behind this one call. The port emits the same progress sequence the
      // inline loop used to publish directly.
      const total = await this.runImport((progress: DictionaryImportProgress) => {
        this.setProgress({ status: 'importing', imported: progress.imported, total: progress.total });
      });
      this.setProgress({ status: 'ready', imported: total, total });
      logger.info(`Dictionary imported: ${total} entries.`);
    } catch (error) {
      // Covers a failed import AND the failure a worker introduces: a module
      // that never loads rejects here (workerFactory races the worker's
      // `error` event against the Comlink call) instead of leaving every
      // subscriber on 'importing' forever.
      const message = error instanceof Error ? error.message : String(error);
      logger.error('Dictionary import failed', error);
      this.setProgress({ status: 'error', imported: 0, total: 0, error: message });
      throw error;
    }
  }
}

let singleton: DictionaryService | null = null;

/** Lazy accessor — no module-scope construction (boundary rule 8). */
export function getDictionaryService(): DictionaryService {
  singleton ??= new DictionaryService();
  return singleton;
}
