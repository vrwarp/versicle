import JSZip from 'jszip';
import { saveAs } from 'file-saver';
import { dbService } from '../db/DBService';
import type { BookMetadata, Annotation, LexiconRule, BookLocations } from '../types/db';
import { getDB } from '../db/db';

export interface BackupManifest {
  version: number;
  timestamp: string;
  books: BookMetadata[];
  annotations: Annotation[];
  lexicon: LexiconRule[];
  locations: BookLocations[];
}

export class BackupService {
  private readonly BACKUP_VERSION = 1;

  /**
   * Generates a Light Backup (JSON) containing only metadata, annotations, lexicon, and locations.
   */
  async createLightBackup(): Promise<void> {
    const manifest = await this.generateManifest();
    const blob = new Blob([JSON.stringify(manifest, null, 2)], { type: 'application/json' });
    const filename = `versicle_backup_light_${new Date().toISOString().split('T')[0]}.json`;
    saveAs(blob, filename);
  }

  /**
   * Generates a Full Backup (ZIP) containing metadata and all EPUB files.
   * Also includes a progress callback for UI feedback.
   */
  async createFullBackup(onProgress?: (percent: number, message: string) => void): Promise<void> {
    onProgress?.(0, 'Preparing manifest...');
    const manifest = await this.generateManifest();
    const zip = new JSZip();

    // Add manifest
    zip.file('manifest.json', JSON.stringify(manifest, null, 2));

    const filesFolder = zip.folder('files');
    if (!filesFolder) throw new Error('Failed to create zip folder');

    const totalBooks = manifest.books.length;
    let processed = 0;

    onProgress?.(10, `Processing ${totalBooks} books...`);

    for (const book of manifest.books) {
      if (book.isOffloaded) {
        console.warn(`Skipping offloaded book ${book.id} in full backup`);
        continue;
      }

      try {
        const fileData = await dbService.getBookFile(book.id);
        if (fileData) {
          filesFolder.file(`${book.id}.epub`, fileData);
        } else {
          console.error(`Missing file for book ${book.title} (${book.id})`);
        }
      } catch (e) {
        console.error(`Failed to export file for book ${book.id}`, e);
      }

      processed++;
      const percent = 10 + Math.floor((processed / totalBooks) * 80); // 10% to 90%
      onProgress?.(percent, `Archiving ${book.title}...`);
    }

    onProgress?.(90, 'Compressing archive...');
    const content = await zip.generateAsync({ type: 'blob' }, (metadata) => {
        onProgress?.(90 + (metadata.percent * 0.1), 'Compressing...');
    });

    const filename = `versicle_backup_full_${new Date().toISOString().split('T')[0]}.zip`;
    saveAs(content, filename);
    onProgress?.(100, 'Done!');
  }

  /**
   * Restores a backup from a File (JSON or ZIP).
   */
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

  private async generateManifest(): Promise<BackupManifest> {
    const db = await getDB();

    const [books, annotations, lexicon, locations] = await Promise.all([
      db.getAll('books'),
      db.getAll('annotations'),
      db.getAll('lexicon'),
      db.getAll('locations')
    ]);

    // Sanitize books to remove non-serializable objects or large blobs
    const sanitizedBooks = books.map(book => {
        // eslint-disable-next-line @typescript-eslint/no-unused-vars
        const { coverBlob, coverUrl, ...rest } = book;
        return rest;
    });

    return {
      version: this.BACKUP_VERSION,
      timestamp: new Date().toISOString(),
      books: sanitizedBooks,
      annotations,
      lexicon,
      locations
    };
  }

  private async restoreLightBackup(file: File, onProgress?: (percent: number, message: string) => void): Promise<void> {
    const text = await file.text();
    const manifest: BackupManifest = JSON.parse(text);
    await this.processManifest(manifest, undefined, onProgress);
  }

  private async restoreFullBackup(file: File, onProgress?: (percent: number, message: string) => void): Promise<void> {
    const zip = await JSZip.loadAsync(file);

    const manifestFile = zip.file('manifest.json');
    if (!manifestFile) {
      throw new Error('Invalid backup: manifest.json is missing');
    }

    const manifestText = await manifestFile.async('string');
    const manifest: BackupManifest = JSON.parse(manifestText);

    await this.processManifest(manifest, zip, onProgress);
  }

  private async processManifest(
    manifest: BackupManifest,
    zip?: JSZip,
    onProgress?: (percent: number, message: string) => void
  ): Promise<void> {
    if (manifest.version > this.BACKUP_VERSION) {
      console.warn(`Backup version ${manifest.version} is newer than supported ${this.BACKUP_VERSION}. Proceeding with caution.`);
    }

    // Step 1: Restore Metadata (Books, Annotations, Lexicon, Locations)
    // We use a single transaction for metadata to ensure consistency
    const db = await getDB();

    const totalItems = manifest.books.length + manifest.annotations.length + manifest.lexicon.length + manifest.locations.length;
    let processed = 0;

    const updateProgress = (msg: string) => {
        processed++;
        const percent = Math.floor((processed / totalItems) * 100);
        onProgress?.(percent, msg);
    };

    // Metadata Transaction
    const tx = db.transaction(['books', 'annotations', 'locations', 'lexicon'], 'readwrite');

    // 1.1 Restore Books Metadata
    for (const book of manifest.books) {
      const existingBook = await tx.objectStore('books').get(book.id);

      if (existingBook) {
        // Smart Merge: Update progress if newer
        if ((book.lastRead || 0) > (existingBook.lastRead || 0)) {
          existingBook.lastRead = book.lastRead;
          existingBook.progress = book.progress;
          existingBook.currentCfi = book.currentCfi;
        }
        await tx.objectStore('books').put(existingBook);
      } else {
        // New Book - initially mark as offloaded until we confirm file
        // If it's a light backup, it remains offloaded.
        // If it's a full backup, we will update it in the next step.
        book.isOffloaded = true;
        await tx.objectStore('books').put(book);
      }
      updateProgress(`Restoring metadata for ${book.title}...`);
    }

    // 1.2 Restore Annotations
    for (const ann of manifest.annotations) {
        await tx.objectStore('annotations').put(ann);
        updateProgress('Restoring annotations...');
    }

    // 1.3 Restore Lexicon
    for (const rule of manifest.lexicon) {
        await tx.objectStore('lexicon').put(rule);
        updateProgress('Restoring dictionary...');
    }

    // 1.4 Restore Locations
    for (const loc of manifest.locations) {
        await tx.objectStore('locations').put(loc);
        updateProgress('Restoring map...');
    }

    await tx.done;

    // Step 2: Restore Files (if ZIP)
    // We do this OUTSIDE the metadata transaction to avoid TransactionInactiveError during async unzip
    if (zip) {
        for (const book of manifest.books) {
            const zipFile = zip.file(`files/${book.id}.epub`);
            if (zipFile) {
                // Async decompression
                const arrayBuffer = await zipFile.async('arraybuffer');

                // New short-lived transaction for file write
                const fileTx = db.transaction(['books', 'files'], 'readwrite');
                await fileTx.objectStore('files').put(arrayBuffer, book.id);

                // Update book status to not offloaded
                const bookRecord = await fileTx.objectStore('books').get(book.id);
                if (bookRecord) {
                    bookRecord.isOffloaded = false;
                    await fileTx.objectStore('books').put(bookRecord);
                }
                await fileTx.done;
            } else {
                 if (!book.isOffloaded) {
                     // Check if we already have the file locally?
                     // If not, it remains offloaded as set in step 1.
                     // No action needed, as Step 1 set isOffloaded=true for new books.
                     // For existing books, we kept their state.
                 }
            }
        }
    }

    onProgress?.(100, 'Restore complete!');
  }
}

export const backupService = new BackupService();
