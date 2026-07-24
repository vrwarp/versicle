/**
 * `cache_drive_previews` repository — partial-fetch EPUB previews for Google
 * Drive files (metadata + cover extracted by ranged reads, no full download;
 * store created by the v31 migration step).
 *
 * Device-local and never synced (a synced cover/metadata store would grow a
 * shadow-library data model in the CRDT). Keyed by Drive fileId; the paired
 * `md5Checksum` is the freshness key (a re-uploaded file keeps its id but
 * changes md5). `status:'unextractable'` rows are the NEGATIVE cache so the
 * trickle crawler never retries a broken file forever.
 *
 * Worker-safe like every repo: no store/UI imports; writes go through the
 * navigator.locks write-gate. Covers are stored canonically as ArrayBuffer
 * (WebKit structured-clone safety) and re-wrapped to a Blob on read.
 */
import { getConnection } from '../connection';
import { write } from '../write-gate';
import { handleDbError } from '../errors';
import { cacheDrivePreviewRowSchema, type CacheDrivePreviewRow } from '../rows/cache';
import { createLogger } from '@lib/logger';

const logger = createLogger('DrivePreviewsRepo');

/** Default byte budget the eviction sweep enforces (cover bytes dominate). */
const DRIVE_PREVIEW_BUDGET_BYTES = 60 * 1024 * 1024;

/** Skip the read-path lastAccessed bump while the stored stamp is this fresh. */
const LAST_ACCESSED_BUMP_INTERVAL_MS = 60 * 60 * 1000;

/** Deletes per gated transaction during eviction. */
const EVICTION_DELETE_BATCH = 50;

/** A preview as handed to callers: cover re-wrapped as a Blob (or undefined). */
interface DrivePreview {
  fileId: string;
  md5Checksum?: string;
  fetchedAt: number;
  status: 'ok' | 'unextractable';
  title?: string;
  author?: string;
  description?: string;
  language?: string;
  identifiers?: string[];
  cover?: Blob;
}

function rowByteSize(row: CacheDrivePreviewRow): number {
  const cover = row.cover;
  if (cover instanceof ArrayBuffer) return cover.byteLength;
  if (typeof Blob !== 'undefined' && cover instanceof Blob) return cover.size;
  return 0;
}

function toPreview(row: CacheDrivePreviewRow): DrivePreview {
  let cover: Blob | undefined;
  if (row.cover instanceof ArrayBuffer) {
    cover = new Blob([row.cover], { type: row.coverType || 'image/jpeg' });
  } else if (typeof Blob !== 'undefined' && row.cover instanceof Blob) {
    cover = row.cover;
  }
  return {
    fileId: row.fileId,
    md5Checksum: row.md5Checksum,
    fetchedAt: row.fetchedAt,
    status: row.status,
    title: row.title,
    author: row.author,
    description: row.description,
    language: row.language,
    identifiers: row.identifiers,
    cover,
  };
}

class DrivePreviewsRepo {
  /**
   * The cached preview for a Drive file, or undefined when never fetched.
   * Bumps `lastAccessedAt` (debounced, fire-and-forget) so LRU tracks reads.
   * The caller compares the returned `md5Checksum` against the live index to
   * decide whether the row is stale.
   */
  async get(fileId: string): Promise<DrivePreview | undefined> {
    try {
      const db = await getConnection();
      const raw = await db.get('cache_drive_previews', fileId);
      if (!raw) return undefined;
      const parsed = cacheDrivePreviewRowSchema.safeParse(raw);
      if (!parsed.success) {
        logger.warn(`Discarding malformed preview row for ${fileId}:`, parsed.error);
        return undefined;
      }
      const row = parsed.data as CacheDrivePreviewRow;

      const now = Date.now();
      if (now - row.lastAccessedAt >= LAST_ACCESSED_BUMP_INTERVAL_MS) {
        const bumped = { ...row, lastAccessedAt: now };
        void write(['cache_drive_previews'], (tx) => {
          tx.objectStore('cache_drive_previews').put(bumped);
        }).catch(() => {});
      }

      return toPreview(row);
    } catch (error) {
      handleDbError(error);
    }
  }

  /**
   * Upsert a preview row. Covers are normalized to ArrayBuffer at the write
   * boundary (WebKit cannot structured-clone every Blob into IDB). Stamps
   * `fetchedAt`/`lastAccessedAt` to now unless the caller supplied them.
   */
  async put(
    input: Omit<CacheDrivePreviewRow, 'fetchedAt' | 'lastAccessedAt' | 'cover'> & {
      cover?: Blob | ArrayBuffer;
      coverType?: string;
      fetchedAt?: number;
      lastAccessedAt?: number;
    },
  ): Promise<void> {
    try {
      const now = Date.now();
      let cover: ArrayBuffer | undefined;
      let coverType = input.coverType;
      if (input.cover instanceof ArrayBuffer) {
        cover = input.cover;
      } else if (typeof Blob !== 'undefined' && input.cover instanceof Blob) {
        cover = await input.cover.arrayBuffer();
        coverType = coverType || input.cover.type || undefined;
      }
      const row: CacheDrivePreviewRow = {
        fileId: input.fileId,
        md5Checksum: input.md5Checksum,
        fetchedAt: input.fetchedAt ?? now,
        lastAccessedAt: input.lastAccessedAt ?? now,
        status: input.status,
        title: input.title,
        author: input.author,
        description: input.description,
        language: input.language,
        identifiers: input.identifiers,
        cover,
        coverType,
      };
      await write(['cache_drive_previews'], (tx) => {
        tx.objectStore('cache_drive_previews').put(row);
      });
    } catch (error) {
      handleDbError(error);
    }
  }

  /** Remove a preview row (e.g. its Drive file 404'd / left the index). */
  async delete(fileId: string): Promise<void> {
    try {
      await write(['cache_drive_previews'], (tx) => {
        tx.objectStore('cache_drive_previews').delete(fileId);
      });
    } catch (error) {
      handleDbError(error);
    }
  }

  /** All cached fileIds (keys only — used to diff against the live index). */
  async listFileIds(): Promise<string[]> {
    try {
      const db = await getConnection();
      return (await db.getAllKeys('cache_drive_previews')) as string[];
    } catch (error) {
      handleDbError(error);
    }
  }

  /**
   * Eviction sweep. Deletes (a) orphans — rows whose fileId is no longer in
   * `validFileIds` (the file left the Drive index), when a set is supplied —
   * and (b) LRU rows beyond `budgetBytes`. Streams a readonly cursor (no
   * getAll of cover blobs) then deletes oldest-first in gated batches.
   */
  async runEviction(
    validFileIds?: Set<string>,
    budgetBytes: number = DRIVE_PREVIEW_BUDGET_BYTES,
  ): Promise<{ deleted: number; freedBytes: number }> {
    try {
      const db = await getConnection();

      const entries: { fileId: string; lastAccessedAt: number; size: number; orphan: boolean }[] =
        [];
      let totalBytes = 0;
      {
        const tx = db.transaction('cache_drive_previews', 'readonly');
        let cursor = await tx.store.openCursor();
        while (cursor) {
          const row = cursor.value;
          const size = rowByteSize(row);
          const orphan = validFileIds ? !validFileIds.has(row.fileId) : false;
          entries.push({ fileId: row.fileId, lastAccessedAt: row.lastAccessedAt ?? 0, size, orphan });
          totalBytes += size;
          cursor = await cursor.continue();
        }
        await tx.done;
      }

      const toDelete: string[] = [];
      let freedBytes = 0;
      let remaining = totalBytes;

      // Orphans first — they no longer correspond to any Drive file.
      for (const e of entries) {
        if (e.orphan) {
          toDelete.push(e.fileId);
          freedBytes += e.size;
          remaining -= e.size;
        }
      }

      // Then LRU beyond budget among the survivors.
      const survivors = entries
        .filter((e) => !e.orphan)
        .sort((a, b) => a.lastAccessedAt - b.lastAccessedAt);
      for (const e of survivors) {
        if (remaining <= budgetBytes) break;
        toDelete.push(e.fileId);
        freedBytes += e.size;
        remaining -= e.size;
      }

      let deleted = 0;
      for (let i = 0; i < toDelete.length; i += EVICTION_DELETE_BATCH) {
        const batch = toDelete.slice(i, i + EVICTION_DELETE_BATCH);
        await write(['cache_drive_previews'], (tx) => {
          const store = tx.objectStore('cache_drive_previews');
          for (const fileId of batch) store.delete(fileId);
        });
        deleted += batch.length;
      }

      if (deleted > 0) {
        logger.info(`Drive preview eviction: deleted ${deleted} row(s), freed ${freedBytes} bytes.`);
      }
      return { deleted, freedBytes };
    } catch (error) {
      handleDbError(error);
    }
    return { deleted: 0, freedBytes: 0 };
  }
}

export const drivePreviews = new DrivePreviewsRepo();
