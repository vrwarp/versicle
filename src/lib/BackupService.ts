import JSZip from 'jszip';
import * as Y from 'yjs';
import { exportFile } from './export';
import { dbService } from '../db/DBService';
import type { BookLocations, StaticBookManifest, UserInventoryItem } from '../types/db';
import { getDB } from '../db/db';
import { yDoc, waitForYjsSync, yjsPersistence } from '../store/yjs-provider';
import { createLogger } from './logger';
import { useLibraryStore } from '../store/useLibraryStore';
import { IndexeddbPersistence } from 'y-indexeddb';

const logger = createLogger('BackupService');

/**
 * V2 Backup Manifest using Yjs Snapshots
 * 
 * Uses Y.encodeStateAsUpdate() to capture the entire CRDT state,
 * preserving vector clocks and enabling proper merging on restore.
 */
export interface BackupManifestV2 {
  /** Backup schema version. Must be 2 for this format. */
  version: 2;
  /** ISO timestamp of when the backup was created. */
  timestamp: string;

  // === Yjs Snapshot (Base64 encoded) ===
  /** The entire Y.Doc state as a base64-encoded binary snapshot */
  yjsSnapshot: string;

  // === Static/Cache Data (from IDB, not in Yjs) ===
  /** Static manifests for Ghost Book metadata support */
  staticManifests: StaticBookManifest[];
  /** Location data from cache_render_metrics */
  locations: BookLocations[];
}

/**
 * Service responsible for creating and restoring backups of the application data.
 * 
 * v2 Architecture (Yjs Snapshots):
 * - Generate: Captures entire Y.Doc state via encodeStateAsUpdate()
 * - Restore: Applies update via Y.applyUpdate() for proper CRDT merging
 * - Static data (manifests, resources) still uses IDB directly
 */
export class BackupService {
  private readonly BACKUP_VERSION = 2;

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
    const libraryMap = yDoc.getMap('library');
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
   * Generate a v2 backup manifest using Yjs snapshot.
   */
  private async generateManifest(): Promise<BackupManifestV2> {
    // Ensure Yjs is synced before capturing snapshot
    await waitForYjsSync();

    // Capture the entire Y.Doc state as a binary update
    const stateUpdate = Y.encodeStateAsUpdate(yDoc);
    const yjsSnapshot = this.uint8ArrayToBase64(stateUpdate);

    // Read static/cache data from IDB
    const db = await getDB();
    const staticManifests = await db.getAll('static_manifests');
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
      locations
    };
  }

  private async restoreLightBackup(file: File, onProgress?: (percent: number, message: string) => void): Promise<void> {
    const text = await file.text();
    const rawManifest = JSON.parse(text);

    // Check version - reject v1 backups
    if (rawManifest.version === 1 || typeof rawManifest.books !== 'undefined') {
      throw new Error('Backup format v1 is no longer supported. Please re-export from the original device with the latest app version.');
    }

    const manifest = rawManifest as BackupManifestV2;
    await this.processManifest(manifest, undefined, onProgress);
  }

  private async restoreFullBackup(file: File, onProgress?: (percent: number, message: string) => void): Promise<void> {
    const zip = await JSZip.loadAsync(file);

    const manifestFile = zip.file('manifest.json');
    if (!manifestFile) {
      throw new Error('Invalid backup: manifest.json is missing');
    }

    const manifestText = await manifestFile.async('string');
    const rawManifest = JSON.parse(manifestText);

    // Check version - reject v1 backups
    if (rawManifest.version === 1 || typeof rawManifest.books !== 'undefined') {
      throw new Error('Backup format v1 is no longer supported. Please re-export from the original device with the latest app version.');
    }

    const manifest = rawManifest as BackupManifestV2;
    await this.processManifest(manifest, zip, onProgress);
  }

  /**
   * Process a v2 manifest by applying Yjs snapshot.
   * Uses Y.applyUpdate() for proper CRDT merging.
   */
  private async processManifest(
    manifest: BackupManifestV2,
    zip?: JSZip,
    onProgress?: (percent: number, message: string) => void
  ): Promise<void> {
    if (manifest.version > this.BACKUP_VERSION) {
      logger.warn(`Backup version ${manifest.version} is newer than supported ${this.BACKUP_VERSION}. Proceeding with caution.`);
    }

    logger.info('Starting v2 processManifest (Yjs snapshot)');

    onProgress?.(10, 'Applying Yjs snapshot...');

    // === Apply Yjs Snapshot ===
    const stateUpdate = this.base64ToUint8Array(manifest.yjsSnapshot);
    logger.debug(`Applying Yjs snapshot: ${stateUpdate.byteLength} bytes`);

    // CRDT Issue: If we apply snapshot to current doc, deleted items remain deleted (Delete wins).
    // Solution: Wipe IDB data, then write snapshot using a fresh/isolated YDoc.
    // The App must be reloaded after this to pick up the new state.

    // 1. Clear existing persistence
    if (yjsPersistence) {
      logger.debug('Clearing existing database...');
      await yjsPersistence.clearData();
    }

    // 2. Create isolated YDoc and Persistence to write the snapshot as fresh state
    const tempDoc = new Y.Doc();
    Y.applyUpdate(tempDoc, stateUpdate);

    const tempPersistence = new IndexeddbPersistence('versicle-yjs', tempDoc);

    // 3. Wait for temp persistence to save
    logger.debug('Writing snapshot to clean database...');
    await new Promise<void>((resolve) => {
      // IndexeddbPersistence saves updates immediately, but we wait for 'synced' to ensure connection
      // and then a small buffer for write completion.
      tempPersistence.once('synced', () => {
        setTimeout(resolve, 500);
      });
    });

    tempPersistence.destroy();
    tempDoc.destroy();

    onProgress?.(30, 'Syncing stores...');

    // === Write Static Data to IDB ===
    const db = await getDB();

    // Write static manifests (for Ghost Book support)
    if (manifest.staticManifests?.length > 0) {
      onProgress?.(40, 'Restoring metadata...');
      const tx = db.transaction(['static_manifests'], 'readwrite');
      const store = tx.objectStore('static_manifests');
      for (const m of manifest.staticManifests) {
        await store.put(m);
      }
      await tx.done;
    }

    // Write locations
    if (manifest.locations?.length > 0) {
      onProgress?.(60, 'Restoring locations...');
      const tx = db.transaction(['cache_render_metrics'], 'readwrite');
      const locStore = tx.objectStore('cache_render_metrics');
      for (const loc of manifest.locations) {
        await locStore.put({
          bookId: loc.bookId,
          locations: loc.locations
        });
      }
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

    // Wait for Yjs persistence to flush
    onProgress?.(90, 'Persisting data...');
    await new Promise(resolve => setTimeout(resolve, 1000));

    onProgress?.(100, 'Restore complete!');
    logger.info('v2 restore complete (Yjs snapshot applied)');
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

// Type alias for backwards compatibility with tests
export type BackupManifest = BackupManifestV2;
