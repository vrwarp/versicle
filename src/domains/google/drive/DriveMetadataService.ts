/**
 * DriveMetadataService — the orchestrator behind partial-fetch Drive previews.
 * It turns a Drive `{fileId, size, md5}` into a metadata+cover preview through
 * ranged reads (@lib/epub/remoteEpub), a read-through device-local cache keyed
 * on {fileId, md5}, and a priority scheduler so interactive taps preempt
 * background hydration and the whole thing stays under Drive's per-user quota.
 *
 * No store/data imports: the cache and the index are injected ports (app/
 * wires the drivePreviews repo + useDriveStore adapters), mirroring
 * DriveLibrarySync. The service consumes the PERSISTED index only — it never
 * triggers a Drive scan.
 *
 * Failure policy (each maps to a DrivePreviewOutcome status the UI can act on):
 *  - UnextractableEpubError → negative-cache the file (status 'unextractable')
 *    so the trickle crawler never retries a broken file forever.
 *  - DriveRangeUnsupportedError → 'unsupported' (environmental, not cached).
 *  - GoogleAuthRequiredError → 'auth' (UI shows a reconnect affordance; the
 *    silent boot policy means no popup ever originates here).
 *  - NET_OFFLINE → 'offline' (serve cache only).
 *  - Drive 404 → evict the stale preview + notify the index; 'gone'.
 */
import { AppError } from '~types/errors';
import { sanitizeMetadata } from '@lib/sanitizer';
import { readRemoteEpubPreview, UnextractableEpubError, type RangeReader } from '@lib/epub/remoteEpub';
import { GoogleAuthRequiredError } from '../auth/errors';
import type { DriveClient, DriveRequestOptions } from './DriveClient';
import { DriveApiError, DriveRangeUnsupportedError } from './errors';
import type {
  DriveEpubPreview,
  DrivePreviewOutcome,
  DrivePreviewPriority,
} from './types';

/** A cached preview as returned by the injected cache port (cover as a Blob). */
export interface CachedDrivePreview {
  fileId: string;
  md5Checksum?: string;
  status: 'ok' | 'unextractable';
  title?: string;
  author?: string;
  description?: string;
  language?: string;
  identifiers?: string[];
  cover?: Blob;
}

/** What the service writes back to the cache on a successful/negative fetch. */
export interface DrivePreviewCacheInput {
  fileId: string;
  md5Checksum?: string;
  status: 'ok' | 'unextractable';
  title?: string;
  author?: string;
  description?: string;
  language?: string;
  identifiers?: string[];
  cover?: Blob;
}

/** A minimal index entry the service needs (size drives tail math; md5 keys the cache). */
export interface DriveIndexEntry {
  id: string;
  size: number;
  md5Checksum?: string;
  modifiedTime?: string;
}

export interface DriveMetadataServicePorts {
  client: Pick<DriveClient, 'downloadFileRange'>;
  cache: {
    get(fileId: string): Promise<CachedDrivePreview | undefined>;
    put(input: DrivePreviewCacheInput): Promise<void>;
    delete(fileId: string): Promise<void>;
    listFileIds(): Promise<string[]>;
    runEviction(validFileIds?: Set<string>): Promise<unknown>;
  };
  index: {
    getEntry(fileId: string): DriveIndexEntry | undefined;
    getIndex(): DriveIndexEntry[];
    /** Optional: called when a file 404s so the store can drop it from the index. */
    onFileGone?(fileId: string): void;
  };
  /** Max concurrent ranged fetches across all priorities (quota-safety cap). */
  concurrency?: number;
  log?: {
    info(...args: unknown[]): void;
    warn(...args: unknown[]): void;
    error(...args: unknown[]): void;
  };
}

const noopLog = { info: () => {}, warn: () => {}, error: () => {} };

interface GetPreviewOptions {
  priority?: DrivePreviewPriority;
  interactive?: boolean;
  signal?: AbortSignal;
}

const PRIORITY_ORDER: DrivePreviewPriority[] = ['interactive', 'viewport', 'trickle'];

/** A concurrency-capped, priority-ordered task runner. */
class PriorityScheduler {
  private running = 0;
  private readonly queues: Record<DrivePreviewPriority, Array<() => void>> = {
    interactive: [],
    viewport: [],
    trickle: [],
  };

  constructor(private readonly concurrency: number) {}

  run<T>(priority: DrivePreviewPriority, task: () => Promise<T>): Promise<T> {
    return new Promise<T>((resolve, reject) => {
      const start = () => {
        this.running += 1;
        task()
          .then(resolve, reject)
          .finally(() => {
            this.running -= 1;
            this.pump();
          });
      };
      this.queues[priority].push(start);
      this.pump();
    });
  }

  private pump(): void {
    while (this.running < this.concurrency) {
      const next = this.dequeue();
      if (!next) break;
      next();
    }
  }

  private dequeue(): (() => void) | undefined {
    for (const p of PRIORITY_ORDER) {
      const q = this.queues[p];
      if (q.length > 0) return q.shift();
    }
    return undefined;
  }
}

export class DriveMetadataService {
  private readonly log: NonNullable<DriveMetadataServicePorts['log']>;
  private readonly scheduler: PriorityScheduler;
  private readonly inflight = new Map<string, Promise<DrivePreviewOutcome>>();

  constructor(private readonly ports: DriveMetadataServicePorts) {
    this.log = ports.log ?? noopLog;
    this.scheduler = new PriorityScheduler(ports.concurrency ?? 4);
  }

  /**
   * Resolve a preview for a Drive file: fresh cache hit → returned instantly;
   * otherwise a scheduled ranged fetch (deduped per fileId). A cached row whose
   * md5 no longer matches the live index is treated as stale and re-fetched.
   */
  async getPreview(fileId: string, opts: GetPreviewOptions = {}): Promise<DrivePreviewOutcome> {
    const entry = this.ports.index.getEntry(fileId);
    if (!entry) return { status: 'gone' };

    const cached = await this.ports.cache.get(fileId).catch(() => undefined);
    if (cached && cached.md5Checksum === entry.md5Checksum) {
      if (cached.status === 'unextractable') return { status: 'unextractable' };
      return { status: 'ok', preview: this.toPreview(fileId, entry.md5Checksum, cached) };
    }

    const existing = this.inflight.get(fileId);
    if (existing) return existing;

    const promise = this.fetchAndCache(fileId, entry, opts).finally(() => {
      this.inflight.delete(fileId);
    });
    this.inflight.set(fileId, promise);
    return promise;
  }

  /** Cache-only read (no network). Used by ambient surfaces that must not fetch. */
  async getCached(fileId: string): Promise<DriveEpubPreview | undefined> {
    const entry = this.ports.index.getEntry(fileId);
    const cached = await this.ports.cache.get(fileId).catch(() => undefined);
    if (!cached) return undefined;
    // Only serve a cache hit that still matches the index md5 (or when md5 is
    // unknown on both sides). Stale rows are hidden rather than shown wrong.
    if (entry && cached.md5Checksum !== entry.md5Checksum) return undefined;
    if (cached.status === 'unextractable') return undefined;
    return this.toPreview(fileId, cached.md5Checksum, cached);
  }

  private toPreview(
    fileId: string,
    md5Checksum: string | undefined,
    cached: CachedDrivePreview,
  ): DriveEpubPreview {
    return {
      fileId,
      md5Checksum,
      status: 'ok',
      title: cached.title,
      author: cached.author,
      description: cached.description,
      language: cached.language,
      identifiers: cached.identifiers,
      cover: cached.cover,
    };
  }

  private async fetchAndCache(
    fileId: string,
    entry: DriveIndexEntry,
    opts: GetPreviewOptions,
  ): Promise<DrivePreviewOutcome> {
    const priority = opts.priority ?? 'viewport';
    return this.scheduler.run(priority, async () => {
      const reqOpts: DriveRequestOptions = { interactive: opts.interactive, signal: opts.signal };
      const port: RangeReader = {
        size: entry.size,
        readRange: (start, end) => this.ports.client.downloadFileRange(fileId, start, end, reqOpts),
      };
      try {
        const raw = await readRemoteEpubPreview(port);
        const cover = raw.cover
          ? new Blob([raw.cover.bytes], { type: raw.cover.mediaType })
          : undefined;
        const preview: DriveEpubPreview = {
          fileId,
          md5Checksum: entry.md5Checksum,
          status: 'ok',
          title: raw.title ? sanitizeMetadata(raw.title) : undefined,
          author: raw.author ? sanitizeMetadata(raw.author) : undefined,
          description: raw.description ? sanitizeMetadata(raw.description) : undefined,
          language: raw.language,
          identifiers: raw.identifiers,
          cover,
        };
        await this.ports.cache
          .put({
            fileId,
            md5Checksum: entry.md5Checksum,
            status: 'ok',
            title: preview.title,
            author: preview.author,
            description: preview.description,
            language: preview.language,
            identifiers: preview.identifiers,
            cover,
          })
          .catch((err) => this.log.warn(`Preview cache write failed for ${fileId}:`, err));
        return { status: 'ok', preview };
      } catch (error) {
        return this.classifyError(fileId, entry, error);
      }
    });
  }

  private async classifyError(
    fileId: string,
    entry: DriveIndexEntry,
    error: unknown,
  ): Promise<DrivePreviewOutcome> {
    if (error instanceof UnextractableEpubError) {
      // Negative cache: don't retry a broken file until its md5 changes.
      await this.ports.cache
        .put({ fileId, md5Checksum: entry.md5Checksum, status: 'unextractable' })
        .catch(() => {});
      return { status: 'unextractable' };
    }
    if (error instanceof DriveRangeUnsupportedError) {
      // Environmental (a proxy stripped Range); not the file's fault — no cache.
      this.log.warn(`Ranged download unsupported for ${fileId}; skipping preview.`);
      return { status: 'unsupported' };
    }
    if (error instanceof GoogleAuthRequiredError) {
      return { status: 'auth' };
    }
    if (error instanceof AppError && error.code === 'NET_OFFLINE') {
      return { status: 'offline' };
    }
    if (error instanceof DriveApiError && error.status === 404) {
      await this.ports.cache.delete(fileId).catch(() => {});
      this.ports.index.onFileGone?.(fileId);
      return { status: 'gone' };
    }
    this.log.warn(`Preview fetch failed for ${fileId}:`, error);
    return { status: 'error' };
  }
}
