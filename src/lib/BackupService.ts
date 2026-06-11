import JSZip from 'jszip';
// Only the Y.Map cast remains since the snapshot primitives moved to
// YjsSnapshotService — keep yjs out of this module's runtime graph.
import type * as Y from 'yjs';
import { z } from 'zod';
import { exportFile } from './export';
import { dbService } from '@db/DBService';
import type { BookLocations, StaticBookManifest, UserInventoryItem } from '~types/db';
import { getDB } from '@db/db';
import { getYDoc, waitForYjsSync, getYjsPersistence } from '@store/yjs-provider';
import { captureDoc, validateSnapshot, applySnapshot } from '@data/snapshot/YjsSnapshotService';
import { createLogger } from './logger';
import { useLibraryStore } from '@store/useLibraryStore';


const logger = createLogger('BackupService');

/**
 * V2 Backup Manifest using Yjs Snapshots (legacy read format)
 *
 * Uses Y.encodeStateAsUpdate() to capture the entire CRDT state,
 * preserving vector clocks and enabling proper merging on restore.
 *
 * Known defect (the reason v3 exists): `staticManifests` rows were embedded
 * verbatim, so binary `coverBlob` values became `{}` through JSON.stringify.
 * The v2 reader is kept forever and sanitizes those rows on import.
 */
export interface BackupManifestV2 {
  /** Backup schema version. Must be 2 for this format. */
  version: 2;
  /** ISO timestamp of when the backup was created. */
  timestamp: string;

  // === Deterministic Restore Payload (Active Execution) ===
  /** The entire Y.Doc state as a base64-encoded binary snapshot */
  yjsSnapshot: string;
  /** Static manifests for Ghost Book metadata support */
  staticManifests: StaticBookManifest[];
  /** Location data from cache_render_metrics */
  locations: BookLocations[];

  // === Human-Readable Payload (Passive Artifact) ===
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  semanticData?: Partial<any>; // Using any to avoid importing SyncManifest since it's just a passive export
}

/**
 * A static manifest row as serialized in a v3 backup: the binary cover is
 * base64-encoded (`coverBlobBase64`) so the manifest survives JSON.stringify
 * losslessly. `coverBlob` itself is never present in a v3 backup.
 */
export type BackupStaticManifestV3 = Omit<StaticBookManifest, 'coverBlob'> & {
  /** Base64-encoded bytes of the cover image thumbnail, if the book has one. */
  coverBlobBase64?: string;
};

/**
 * V3 Backup Manifest. Identical to v2 except binary fields in
 * `staticManifests` are explicitly base64-encoded instead of being corrupted
 * to `{}` by JSON serialization.
 */
export interface BackupManifestV3 {
  /** Backup schema version. Must be 3 for this format. */
  version: 3;
  /** ISO timestamp of when the backup was created. */
  timestamp: string;

  // === Deterministic Restore Payload (Active Execution) ===
  /** The entire Y.Doc state as a base64-encoded binary snapshot */
  yjsSnapshot: string;
  /** Static manifests for Ghost Book metadata support (covers as base64) */
  staticManifests: BackupStaticManifestV3[];
  /** Location data from cache_render_metrics */
  locations: BookLocations[];

  // === Human-Readable Payload (Passive Artifact) ===
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  semanticData?: Partial<any>; // Using any to avoid importing SyncManifest since it's just a passive export
}

/** Any backup manifest this client can restore. */
export type BackupManifest = BackupManifestV2 | BackupManifestV3;

/**
 * Structural validation for restorable backup manifests (v2 and v3).
 * Deliberately loose beyond the envelope so old v2 files keep restoring;
 * per-row binary sanitization happens in `sanitizeManifestRow`.
 */
const BackupManifestEnvelopeSchema = z.looseObject({
  version: z.union([z.literal(2), z.literal(3)]),
  timestamp: z.string(),
  yjsSnapshot: z.string().min(1),
  staticManifests: z.array(z.looseObject({ bookId: z.string() })).optional(),
  locations: z.array(z.looseObject({ bookId: z.string() })).optional(),
});

/** A loosely-typed manifest row as found inside a backup file. */
type BackupManifestRow = { bookId: string } & Record<string, unknown>;

/**
 * Service responsible for creating and restoring backups of the application data.
 *
 * v3 Architecture (Yjs Snapshots + lossless binary fields):
 * - Generate: Captures entire Y.Doc state via encodeStateAsUpdate(); cover
 *   blobs are base64-encoded so they survive JSON round-trips.
 * - Restore: validates the manifest (zod), dry-runs the snapshot on a scratch
 *   Y.Doc and writes an automatic pre-restore checkpoint BEFORE any
 *   destructive step. v2 backups remain restorable forever (corrupt `{}`
 *   covers are sanitized on import).
 */
export class BackupService {
  private readonly BACKUP_VERSION = 3;

  async createLightBackup(): Promise<void> {
    const manifest = await this.generateManifest();
    const jsonString = JSON.stringify(manifest, null, 2);
    const filename = `versicle_backup_light_${new Date().toISOString().split('T')[0]}.json`;

    await exportFile({
      filename,
      data: jsonString,
      mimeType: 'application/json'
    });
  }

  async createFullBackup(onProgress?: (percent: number, message: string) => void): Promise<void> {
    onProgress?.(0, 'Preparing manifest...');
    const manifest = await this.generateManifest();
    const zip = new JSZip();

    zip.file('manifest.json', JSON.stringify(manifest, null, 2));

    const filesFolder = zip.folder('files');
    if (!filesFolder) throw new Error('Failed to create zip folder');

    // Get book IDs from Yjs library
    const libraryMap = getYDoc().getMap('library');
    // Phase 2: Books are stored in 'books' submap
    const booksMap = libraryMap.get('books') as Y.Map<UserInventoryItem>;
    const bookIds = booksMap ? Array.from(booksMap.keys()) : [];
    const totalBooks = bookIds.length;
    let processed = 0;

    onProgress?.(10, `Processing ${totalBooks} books...`);

    // Get offloaded status
    const offloadedBookIds = useLibraryStore.getState().offloadedBookIds;

    for (const bookId of bookIds) {
      if (offloadedBookIds.has(bookId)) {
        logger.warn(`Skipping offloaded book ${bookId} in full backup`);
        processed++;
        continue;
      }

      try {
        const fileData = await dbService.getBookFile(bookId);
        if (fileData) {
          filesFolder.file(`${bookId}.epub`, fileData);
        } else {
          logger.error(`Missing file for book ${bookId}`);
        }
      } catch (e) {
        logger.error(`Failed to export file for book ${bookId}`, e);
      }

      processed++;
      const percent = 10 + Math.floor((processed / totalBooks) * 80);
      const book = booksMap.get(bookId);
      onProgress?.(percent, `Archiving ${book?.title || bookId}...`);
    }

    onProgress?.(90, 'Compressing archive...');
    const content = await zip.generateAsync({ type: 'blob' }, (metadata) => {
      onProgress?.(90 + (metadata.percent * 0.1), 'Compressing...');
    });

    const filename = `versicle_backup_full_${new Date().toISOString().split('T')[0]}.zip`;

    await exportFile({
      filename,
      data: content,
      mimeType: 'application/zip'
    });

    onProgress?.(100, 'Done!');
  }

  async restoreBackup(file: File, onProgress?: (percent: number, message: string) => void): Promise<void> {
    onProgress?.(0, 'Analyzing file...');

    if (file.name.endsWith('.json')) {
      await this.restoreLightBackup(file, onProgress);
    } else if (file.name.endsWith('.zip') || file.name.endsWith('.vbackup')) {
      await this.restoreFullBackup(file, onProgress);
    } else {
      throw new Error('Unsupported file format. Please use .json or .zip files.');
    }
  }

  /**
   * Generate a v3 backup manifest using a Yjs snapshot.
   *
   * v3: binary cover blobs are base64-encoded (`coverBlobBase64`) so they
   * survive JSON.stringify losslessly. v2 embedded the raw rows and silently
   * corrupted every cover to `{}`.
   */
  async generateManifest(): Promise<BackupManifestV3> {
    // Ensure Yjs is synced before capturing snapshot, and drain the y-idb
    // debounce queue (fork flush(), packages/y-idb/PROVENANCE.md surgery 1)
    // so a backup can never miss the last 200ms write window.
    await waitForYjsSync();
    await getYjsPersistence()?.flush();

    // 1. Capture the entire Y.Doc state as a binary update
    // 2. Concurrently read static data from IDB and capture semantic tree
    const [db, semanticData] = await Promise.all([
      getDB(),
      import('./sync/semantic-tree').then(m => m.generateSemanticTree())
    ]);

    const stateUpdate = captureDoc(getYDoc());
    const yjsSnapshot = this.uint8ArrayToBase64(stateUpdate);

    const staticManifestRows = await db.getAll('static_manifests');
    const staticManifests = await Promise.all(
      staticManifestRows.map(row => this.toBackupManifestRow(row))
    );
    const metrics = await db.getAll('cache_render_metrics');

    // Map metrics to locations
    const locations: BookLocations[] = metrics.map(met => ({
      bookId: met.bookId,
      locations: met.locations
    }));

    // Note: Lexicon (formerly user_overrides) is now in Yjs, so it's captured in yjsSnapshot.

    return {
      version: this.BACKUP_VERSION,
      timestamp: new Date().toISOString(),
      yjsSnapshot,
      staticManifests,
      locations,
      semanticData
    };
  }

  private async restoreLightBackup(file: File, onProgress?: (percent: number, message: string) => void): Promise<void> {
    const text = await file.text();
    const manifest = JSON.parse(text) as BackupManifest;

    await this.processManifest(manifest, undefined, onProgress);
  }

  private async restoreFullBackup(file: File, onProgress?: (percent: number, message: string) => void): Promise<void> {
    const zip = await JSZip.loadAsync(file);

    const manifestFile = zip.file('manifest.json');
    if (!manifestFile) {
      throw new Error('Invalid backup: manifest.json is missing');
    }

    const manifestText = await manifestFile.async('string');
    const manifest = JSON.parse(manifestText) as BackupManifest;

    await this.processManifest(manifest, zip, onProgress);
  }

  /**
   * Process a v2/v3 manifest by applying the Yjs snapshot.
   *
   * Order of operations (validate-before-destroy):
   * 1. zod-validate the manifest envelope.
   * 2. Decode the snapshot and dry-run Y.applyUpdate on a scratch Y.Doc.
   * 3. Write an automatic pre-restore checkpoint (CheckpointService).
   * 4. Only then perform the destructive replacement.
   * Any failure before step 4 leaves local data untouched.
   */
  async processManifest(
    manifest: BackupManifest,
    zip?: JSZip,
    onProgress?: (percent: number, message: string) => void
  ): Promise<void> {
    // === Phase 1: Validation — nothing destructive may run until every check passes ===
    if (!manifest || !manifest.yjsSnapshot) {
      throw new Error("Fatal: yjsSnapshot is missing. Legacy V1 restoration is not supported.");
    }

    onProgress?.(2, 'Validating backup...');

    const envelope = BackupManifestEnvelopeSchema.safeParse(manifest);
    if (!envelope.success) {
      const detail = envelope.error.issues
        .map(issue => `${issue.path.join('.') || '(root)'}: ${issue.message}`)
        .join('; ');
      throw new Error(`Invalid backup manifest: ${detail}`);
    }

    logger.info(`Starting processManifest (v${manifest.version} Yjs snapshot)`);

    // Decode the snapshot and prove it is an applicable Yjs update on a
    // scratch doc BEFORE touching local persistence.
    let stateUpdate: Uint8Array;
    try {
      stateUpdate = this.base64ToUint8Array(manifest.yjsSnapshot);
    } catch {
      throw new Error('Invalid backup: yjsSnapshot is not valid base64. Local data was left untouched.');
    }

    try {
      validateSnapshot(stateUpdate);
    } catch (e) {
      logger.error('Backup snapshot failed dry-run validation', e);
      throw new Error('Invalid backup: yjsSnapshot is not a decodable Yjs update. Local data was left untouched.');
    }

    logger.debug(`Validated Yjs snapshot: ${stateUpdate.byteLength} bytes`);

    // === Phase 2: Safety net — automatic pre-restore checkpoint ===
    onProgress?.(5, 'Creating pre-restore checkpoint...');
    // Dynamic import to keep CheckpointService (and its sync deps) out of this
    // module's eager import graph, mirroring the semantic-tree import above.
    const { CheckpointService } = await import('./sync/CheckpointService');
    try {
      const checkpointId = await CheckpointService.createCheckpoint('pre-restore');
      logger.info(`Created pre-restore checkpoint #${checkpointId}`);
    } catch (e) {
      logger.error('Failed to create pre-restore checkpoint; aborting restore', e);
      throw new Error('Restore aborted: could not create a pre-restore checkpoint. Local data was left untouched.');
    }

    // === Phase 3: Destructive replacement (only reachable after validation + checkpoint) ===
    onProgress?.(10, 'Applying Yjs snapshot...');

    // CRDT Issue: If we apply snapshot to current doc, deleted items remain deleted (Delete wins).
    // Solution: Wipe IDB data, then write snapshot cleanly.
    // The App must be reloaded after this to pick up the new state.

    // 1. Clear existing persistence (clearData destroys the live binding —
    //    applySnapshot's precondition).
    const persistence = getYjsPersistence();
    if (persistence) {
      logger.debug('Clearing existing database...');
      await persistence.clearData();
    }

    // 2. Write the snapshot durably: applySnapshot resolves only after the
    //    transaction has COMMITTED (the vendored y-idb fork's writeSnapshot,
    //    through the cross-context write gate), so the reload after restore
    //    cannot lose it. This replaces the raw indexedDB.open() block that
    //    re-implemented y-idb's store layout here.
    logger.debug('Writing Yjs snapshot via YjsSnapshotService...');
    await applySnapshot(stateUpdate);

    onProgress?.(30, 'Syncing stores...');

    // === Write Static Data to IDB ===
    const db = await getDB();

    // Write static manifests (for Ghost Book support)
    const incomingManifests = (manifest.staticManifests ?? []) as unknown as BackupManifestRow[];
    if (incomingManifests.length > 0) {
      onProgress?.(40, 'Restoring metadata...');

      // Read existing rows BEFORE opening the readwrite transaction so we can
      // merge covers without awaiting reads inside the transaction.
      const existingRows = ((await db.getAll('static_manifests')) ?? []) as unknown as BackupManifestRow[];
      const existingByBookId = new Map(existingRows.map(row => [row.bookId, row]));
      const sanitized = incomingManifests.map(row =>
        this.sanitizeManifestRow(row, existingByBookId.get(row.bookId))
      );

      const tx = db.transaction(['static_manifests'], 'readwrite');
      const store = tx.objectStore('static_manifests');
      await Promise.all(sanitized.map(m => store.put(m as unknown as StaticBookManifest)));
      await tx.done;
    }

    // Write locations
    if (manifest.locations && manifest.locations.length > 0) {
      onProgress?.(60, 'Restoring locations...');
      const tx = db.transaction(['cache_render_metrics'], 'readwrite');
      const locStore = tx.objectStore('cache_render_metrics');
      await Promise.all(manifest.locations.map(loc => locStore.put({
        bookId: loc.bookId,
        locations: loc.locations
      })));
      await tx.done;
    }

    // === Restore Files (if ZIP) ===
    if (zip) {
      onProgress?.(70, 'Restoring files...');

      const filesFolder = zip.folder('files');
      const restoredBookIds: string[] = [];

      if (filesFolder) {
        // Iterate over files in the zip folder directly
        const filePromises: Promise<void>[] = [];

        filesFolder.forEach((relativePath, zipFile) => {
          if (relativePath.endsWith('.epub')) {
            const bookId = relativePath.replace('.epub', '');

            const p = (async () => {
              const arrayBuffer = await zipFile.async('arraybuffer');

              // Direct IDB write to bypass any store logic
              const db = await getDB();
              const tx = db.transaction(['static_resources'], 'readwrite');
              const store = tx.objectStore('static_resources');

              const existing = await store.get(bookId) || { bookId, epubBlob: arrayBuffer };
              existing.epubBlob = arrayBuffer;

              await store.put(existing);
              await tx.done;

              restoredBookIds.push(bookId);
            })();
            filePromises.push(p);
          }
        });

        await Promise.all(filePromises);
      }

      // Clear offloaded status for restored books
      if (restoredBookIds.length > 0) {
        try {
          const currentOffloaded = useLibraryStore.getState().offloadedBookIds || new Set();
          const newOffloaded = new Set([...currentOffloaded].filter(id => !restoredBookIds.includes(id)));
          useLibraryStore.setState({ offloadedBookIds: newOffloaded });
        } catch {
          // Ignore store update errors during restore
        }
        logger.debug(`Cleared offload status for ${restoredBookIds.length} restored books`);
      }
    }

    // No flush wait needed: applySnapshot already awaited the commit (the
    // 1000ms sleep that used to live here was covering for the lack of a
    // durable write primitive).
    onProgress?.(100, 'Restore complete!');
    logger.info('Restore complete (Yjs snapshot applied)');
  }

  // === Manifest row conversion / sanitization ===

  /**
   * Convert an IDB manifest row to its v3 backup form: a binary cover (stored
   * as ArrayBuffer for WebKit compatibility, or as Blob in older rows) becomes
   * base64; non-binary garbage (e.g. `{}` left behind by pre-v3 restores) is
   * stripped so it never re-enters a backup file.
   */
  private async toBackupManifestRow(manifest: StaticBookManifest): Promise<BackupStaticManifestV3> {
    const { coverBlob, ...rest } = manifest;
    const row: BackupStaticManifestV3 = { ...rest };
    const cover: unknown = coverBlob;

    if (cover instanceof ArrayBuffer) {
      row.coverBlobBase64 = this.uint8ArrayToBase64(new Uint8Array(cover));
    } else if (cover instanceof Blob) {
      row.coverBlobBase64 = this.uint8ArrayToBase64(new Uint8Array(await cover.arrayBuffer()));
    }

    return row;
  }

  /**
   * Sanitize an incoming backup manifest row before it is written to IDB.
   *
   * - v3 rows carry the cover as base64 (`coverBlobBase64`) → decoded back to
   *   an ArrayBuffer (matching how ingestion stores covers).
   * - v2 rows that went through JSON carry `coverBlob: {}` garbage
   *   (JSON.stringify of an ArrayBuffer/Blob); any non-binary coverBlob is
   *   stripped.
   * - If the incoming row has no usable cover but the local row does, the
   *   local cover is preserved (merge, not blind-put), so a restore can never
   *   destroy a healthy local cover.
   */
  private sanitizeManifestRow(
    incoming: BackupManifestRow,
    existing: BackupManifestRow | undefined
  ): BackupManifestRow {
    const { coverBlobBase64, coverBlob, ...rest } = incoming;
    const row: BackupManifestRow = { ...rest };

    if (typeof coverBlobBase64 === 'string' && coverBlobBase64.length > 0) {
      try {
        row.coverBlob = this.base64ToUint8Array(coverBlobBase64).buffer;
      } catch {
        logger.warn(`Dropping undecodable cover for book ${incoming.bookId}`);
      }
    } else if (coverBlob instanceof Blob || coverBlob instanceof ArrayBuffer) {
      // Direct (in-memory) v2 manifest with a real binary cover — keep it.
      row.coverBlob = coverBlob;
    }

    if (row.coverBlob === undefined && existing) {
      const localCover: unknown = existing.coverBlob;
      if (localCover instanceof Blob || localCover instanceof ArrayBuffer) {
        row.coverBlob = localCover;
      }
    }

    return row;
  }

  // === Utility Methods ===

  private uint8ArrayToBase64(bytes: Uint8Array): string {
    let binary = '';
    for (let i = 0; i < bytes.byteLength; i++) {
      binary += String.fromCharCode(bytes[i]);
    }
    return btoa(binary);
  }

  private base64ToUint8Array(base64: string): Uint8Array {
    const binary = atob(base64);
    const bytes = new Uint8Array(binary.length);
    for (let i = 0; i < binary.length; i++) {
      bytes[i] = binary.charCodeAt(i);
    }
    return bytes;
  }
}

export const backupService = new BackupService();
