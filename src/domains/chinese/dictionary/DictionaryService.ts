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
 *  - the first use streams /dict/cedict.json into IDB in CHUNKED bulkPut
 *    transactions with progress + a LOUD error surface
 *    (status: 'empty'|'importing'|'ready'|'error' — CH-13's silent
 *    failure dies);
 *  - lookups are async and per-word ({@link getEntry}/{@link getEntries});
 *    nothing retains the full map. The import is gated on first triage
 *    open (the consumer), not on selection.
 *
 * Boundary: domains-no-store; the service touches only data/ + kernel/net.
 * No module-scope construction — consumers go through
 * {@link getDictionaryService} (lazy, side-effect free at import time).
 */
import { dictionary, type DictEntryTuple } from '@data/repos/dictionary';
import { localFetch } from '@kernel/net';
import { createLogger } from '@lib/logger';
import { findCompoundWord, type CompoundHit } from './compoundLookup';

const logger = createLogger('DictionaryService');

export type DictionaryStatus = 'empty' | 'importing' | 'ready' | 'error';

export interface DictionaryProgress {
  status: DictionaryStatus;
  /** Entries written so far / total (only meaningful while importing). */
  imported: number;
  total: number;
  /** Present when status === 'error'. */
  error?: string;
}

const IMPORT_CHUNK_SIZE = 5000;
const META_IMPORTED_AT = 'importedAt';
const META_ENTRY_COUNT = 'entryCount';

type Listener = (progress: DictionaryProgress) => void;

export interface DictionaryServiceDeps {
  /** Same-origin fetch (test seam). Defaults to kernel/net localFetch. */
  fetch?: (url: string) => Promise<Response>;
}

export class DictionaryService {
  private progress: DictionaryProgress = { status: 'empty', imported: 0, total: 0 };
  private listeners = new Set<Listener>();
  private readyPromise: Promise<void> | null = null;
  private readonly fetch: (url: string) => Promise<Response>;

  constructor(deps: DictionaryServiceDeps = {}) {
    this.fetch = deps.fetch ?? localFetch;
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
      const response = await this.fetch('/dict/cedict.json');
      if (!response.ok) {
        throw new Error(`HTTP error! status: ${response.status}`);
      }
      const data = (await response.json()) as Record<string, DictEntryTuple>;
      const entries = Object.entries(data);
      const total = entries.length;
      this.setProgress({ status: 'importing', imported: 0, total });

      // A previous half-built index (crash mid-import) must not survive.
      await dictionary.clearAll();

      for (let offset = 0; offset < total; offset += IMPORT_CHUNK_SIZE) {
        const chunk = entries.slice(offset, offset + IMPORT_CHUNK_SIZE);
        await dictionary.bulkPutEntries(chunk);
        this.setProgress({
          status: 'importing',
          imported: Math.min(offset + IMPORT_CHUNK_SIZE, total),
          total,
        });
        // Yield between transactions: the import runs on first triage open,
        // potentially mid-reading on a low-end WebView.
        await new Promise<void>((resolve) => setTimeout(resolve, 0));
      }

      // Provenance sidecar (PR-12 pipeline) — best effort, never fatal.
      try {
        const meta = await this.fetch('/dict/cedict.meta.json');
        if (meta.ok) {
          await dictionary.setMeta('source', await meta.json());
        }
      } catch {
        /* sidecar absent in dev builds without compile-dict — fine */
      }

      await dictionary.setMeta(META_ENTRY_COUNT, total);
      await dictionary.setMeta(META_IMPORTED_AT, Date.now());
      this.setProgress({ status: 'ready', imported: total, total });
      logger.info(`Dictionary imported: ${total} entries.`);
    } catch (error) {
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

/** Test seam. */
export function __resetDictionaryServiceForTests(): void {
  singleton = null;
}
