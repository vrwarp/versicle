import JSZip from 'jszip';
import * as Y from 'yjs';
import { exportFile } from './export';
import { dbService } from '../db/DBService';
import type { LexiconRule, BookLocations, StaticBookManifest, UserOverrides, UserInventoryItem } from '../types/db';
import { getDB } from '../db/db';
import { yDoc, waitForYjsSync } from '../store/yjs-provider';

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
  /** Lexicon rules (flattened from user_overrides) */
  lexicon: LexiconRule[];
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
    const libraryMap = yDoc.getMap<UserInventoryItem>('library');
    const bookIds = Array.from(libraryMap.keys());
    const totalBooks = bookIds.length;
    let processed = 0;

    onProgress?.(10, `Processing ${totalBooks} books...`);

    // Get offloaded status
    const { useLibraryStore } = await import('../store/useLibraryStore');
    const offloadedBookIds = useLibraryStore.getState().offloadedBookIds;

    for (const bookId of bookIds) {
      if (offloadedBookIds.has(bookId)) {
        console.warn(`Skipping offloaded book ${bookId} in full backup`);
        processed++;
        continue;
      }

      try {
        const fileData = await dbService.getBookFile(bookId);
        if (fileData) {
          filesFolder.file(`${bookId}.epub`, fileData);
        } else {
          console.error(`Missing file for book ${bookId}`);
        }
      } catch (e) {
        console.error(`Failed to export file for book ${bookId}`, e);
      }

      processed++;
      const percent = 10 + Math.floor((processed / totalBooks) * 80);
      const book = libraryMap.get(bookId);
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

    console.log(`[BackupService] Yjs snapshot size: ${stateUpdate.byteLength} bytes`);

    // Read static/cache data from IDB
    const db = await getDB();
    const staticManifests = await db.getAll('static_manifests');
    const overrides: UserOverrides[] = await db.getAll('user_overrides');
    const metrics = await db.getAll('cache_render_metrics');

    // Flatten overrides to lexicon rules
    const lexicon: LexiconRule[] = [];
    for (const ov of overrides) {
      for (const r of ov.lexicon) {
        lexicon.push({
          id: r.id,
          original: r.original,
          replacement: r.replacement,
          isRegex: r.isRegex,
          created: r.created,
          bookId: ov.bookId === 'global' ? undefined : ov.bookId,
          applyBeforeGlobal: ov.lexiconConfig?.applyBefore
        });
      }
    }

    // Map metrics to locations
    const locations: BookLocations[] = metrics.map(met => ({
      bookId: met.bookId,
      locations: met.locations
    }));

    return {
      version: this.BACKUP_VERSION,
      timestamp: new Date().toISOString(),
      yjsSnapshot,
      staticManifests,
      lexicon,
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
      console.warn(`Backup version ${manifest.version} is newer than supported ${this.BACKUP_VERSION}. Proceeding with caution.`);
    }

    console.log('[BackupService] Starting v2 processManifest (Yjs snapshot)');

    onProgress?.(10, 'Applying Yjs snapshot...');

    // === Apply Yjs Snapshot ===
    // This properly merges with existing state using CRDT semantics
    const stateUpdate = this.base64ToUint8Array(manifest.yjsSnapshot);
    console.log(`[BackupService] Applying Yjs snapshot: ${stateUpdate.byteLength} bytes`);

    Y.applyUpdate(yDoc, stateUpdate);

    // Wait for middleware to sync Zustand stores from Yjs
    await new Promise(resolve => setTimeout(resolve, 500));

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

    // Write lexicon rules
    if (manifest.lexicon?.length > 0) {
      onProgress?.(50, 'Restoring dictionary...');
      const tx = db.transaction(['user_overrides'], 'readwrite');
      const ovStore = tx.objectStore('user_overrides');

      // Group by bookId
      const ruleMap = new Map<string, LexiconRule[]>();
      for (const r of manifest.lexicon) {
        const bid = r.bookId || 'global';
        if (!ruleMap.has(bid)) ruleMap.set(bid, []);
        ruleMap.get(bid)?.push(r);
      }

      for (const [bid, rules] of ruleMap.entries()) {
        const ov = await ovStore.get(bid) || { bookId: bid, lexicon: [] };
        for (const r of rules) {
          if (!ov.lexicon.some((lx: LexiconRule) => lx.id === r.id)) {
            ov.lexicon.push({
              id: r.id,
              original: r.original,
              replacement: r.replacement,
              isRegex: r.isRegex,
              created: r.created
            });
          }
          if (r.applyBeforeGlobal !== undefined) {
            ov.lexiconConfig = { applyBefore: r.applyBeforeGlobal };
          }
        }
        await ovStore.put(ov);
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

      const libraryMap = yDoc.getMap<UserInventoryItem>('library');
      const bookIds = Array.from(libraryMap.keys());
      const restoredBookIds: string[] = [];

      for (const bookId of bookIds) {
        const zipFile = zip.file(`files/${bookId}.epub`);
        if (zipFile) {
          const arrayBuffer = await zipFile.async('arraybuffer');

          const fileTx = db.transaction(['static_resources'], 'readwrite');
          const store = fileTx.objectStore('static_resources');

          const existing = await store.get(bookId) || { bookId, epubBlob: arrayBuffer };
          existing.epubBlob = arrayBuffer;

          await store.put(existing);
          await fileTx.done;

          restoredBookIds.push(bookId);
        }
      }

      // Clear offloaded status for restored books
      if (restoredBookIds.length > 0) {
        const { useLibraryStore } = await import('../store/useLibraryStore');
        const currentOffloaded = useLibraryStore.getState().offloadedBookIds;
        const newOffloaded = new Set([...currentOffloaded].filter(id => !restoredBookIds.includes(id)));
        useLibraryStore.setState({ offloadedBookIds: newOffloaded });
        console.log(`[BackupService] Cleared offload status for ${restoredBookIds.length} restored books`);
      }
    }

    // Wait for Yjs persistence to flush
    onProgress?.(90, 'Persisting data...');
    await new Promise(resolve => setTimeout(resolve, 1000));

    onProgress?.(100, 'Restore complete!');
    console.log('[BackupService] v2 restore complete (Yjs snapshot applied)');
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
