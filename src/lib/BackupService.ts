import JSZip from 'jszip';
import { saveAs } from 'file-saver';
import { dbService } from '../db/DBService';
import type { BookMetadata, Annotation, LexiconRule, BookLocations, Book, BookSource, BookState } from '../types/db';
import { getSanitizedBookMetadata } from '../db/validators';
import { getDB } from '../db/db';

/**
 * Represents the structure of a backup manifest file.
 */
export interface BackupManifest {
  /** The version of the backup schema. */
  version: number;
  /** ISO timestamp of when the backup was created. */
  timestamp: string;
  /** List of book metadata records. */
  books: BookMetadata[];
  /** List of user annotations. */
  annotations: Annotation[];
  /** List of custom pronunciation rules. */
  lexicon: LexiconRule[];
  /** List of reading positions/locations. */
  locations: BookLocations[];
}

/**
 * Service responsible for creating and restoring backups of the application data.
 * Supports both "Light" backups (metadata only) and "Full" backups (including EPUB files).
 */
export class BackupService {
  private readonly BACKUP_VERSION = 1;

  /**
   * Generates a Light Backup (JSON) containing only metadata, annotations, lexicon, and locations.
   * The backup is downloaded as a .json file.
   *
   * @returns A Promise that resolves when the download has been initiated.
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
   *
   * @param onProgress - Optional callback function to report progress.
   * @returns A Promise that resolves when the download has been initiated.
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
   *
   * @param file - The backup file to restore.
   * @param onProgress - Optional callback function to report progress.
   * @returns A Promise that resolves when the restoration is complete.
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

    const [books, bookSources, bookStates, annotations, lexicon, locations] = await Promise.all([
      db.getAll('books'),
      db.getAll('book_sources'),
      db.getAll('book_states'),
      db.getAll('annotations'),
      db.getAll('lexicon'),
      db.getAll('locations')
    ]);

    // Create lookup maps for source and state
    const sourceMap = new Map<string, BookSource>(bookSources.map(s => [s.bookId, s]));
    const stateMap = new Map<string, BookState>(bookStates.map(s => [s.bookId, s]));

    // Sanitize books to remove non-serializable objects or large blobs, and join with source/state
    const sanitizedBooks: BookMetadata[] = books.map(book => {
        // eslint-disable-next-line @typescript-eslint/no-unused-vars
        const { coverBlob, coverUrl, ...bookRest } = book;
        const source = sourceMap.get(book.id) || {};
        const state = stateMap.get(book.id) || {};

        return {
            ...bookRest,
            ...source,
            ...state
        } as BookMetadata;
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

  /**
   * Processes the manifest and restores data to the database.
   *
   * @param manifest - The backup manifest object.
   * @param zip - Optional JSZip object if restoring from a full backup.
   * @param onProgress - Optional callback for progress updates.
   */
  private async processManifest(
    manifest: BackupManifest,
    zip?: JSZip,
    onProgress?: (percent: number, message: string) => void
  ): Promise<void> {
    if (manifest.version > this.BACKUP_VERSION) {
      console.warn(`Backup version ${manifest.version} is newer than supported ${this.BACKUP_VERSION}. Proceeding with caution.`);
    }

    const db = await getDB();

    const totalItems = manifest.books.length + manifest.annotations.length + manifest.lexicon.length + manifest.locations.length;
    let processed = 0;

    const updateProgress = (msg: string) => {
        processed++;
        const percent = Math.floor((processed / totalItems) * 100);
        onProgress?.(percent, msg);
    };

    // --- PHASE 1: Sanitization Checks (User Interaction) ---
    // We prepare the list of books to be saved, asking the user if needed, BEFORE starting the transaction.
    const booksToSave: BookMetadata[] = [];
    const rawBooks = Array.isArray(manifest.books) ? manifest.books : [];

    for (const rawBook of rawBooks) {
      if (!rawBook || typeof rawBook !== 'object') continue;

      // Sanitization / Defaulting (Pre-validation fixup)
      // We cast to any to allow modification before type check
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const candidate: any = rawBook;
      if (typeof candidate.title !== 'string' || !candidate.title.trim()) candidate.title = 'Untitled';
      if (typeof candidate.author !== 'string') candidate.author = 'Unknown Author';
      if (typeof candidate.addedAt !== 'number') candidate.addedAt = Date.now();

      const check = getSanitizedBookMetadata(candidate);

      if (!check) {
        console.warn('Skipping invalid book record in backup', rawBook);
        updateProgress('Skipping invalid record...');
        continue;
      }

      // Always sanitize metadata to ensure security (XSS prevention) and DB integrity
      const book = check.sanitized;

      if (check.wasModified) {
          console.warn(`Metadata sanitized for backup book "${candidate.title}":`, check.modifications);
      }

      booksToSave.push(book);
      // We don't increment "processed" here because we want to track the actual write progress
    }

    // --- PHASE 2: Database Operations ---

    // Metadata Transaction
    const tx = db.transaction(['books', 'book_sources', 'book_states', 'annotations', 'locations', 'lexicon'], 'readwrite');

    // 1.1 Restore Books Metadata
    for (const book of booksToSave) {
      // Use DBService logic for splitting data or do it manually
      // We do it manually here to control the transaction

      const existingBook = await tx.objectStore('books').get(book.id);
      // Removed unused existingSource
      const existingState = await tx.objectStore('book_states').get(book.id);

      if (existingBook) {
        // Smart Merge: Update progress if newer
        if ((book.lastRead || 0) > (existingState?.lastRead || 0)) {
            // Update state
            const newState: BookState = {
                ...(existingState || { bookId: book.id }),
                lastRead: book.lastRead,
                progress: book.progress,
                currentCfi: book.currentCfi,
            };
            await tx.objectStore('book_states').put(newState);
        }

        // Update Book Metadata (Identity) if needed? Usually we trust existing local or favor backup?
        // Let's assume backup is authoritative for metadata properties if newer?
        // For now, only merging progress as per original logic.
      } else {
        // New Book
        // Split into Book, Source, State

        const bookData: Book = {
            id: book.id,
            title: book.title,
            author: book.author,
            description: book.description,
            addedAt: book.addedAt,
            // coverBlob is excluded in backup, so undefined
        };

        const sourceData: BookSource = {
            bookId: book.id,
            filename: book.filename,
            fileHash: book.fileHash,
            fileSize: book.fileSize,
            totalChars: book.totalChars,
            syntheticToc: book.syntheticToc,
            version: book.version
        };

        const stateData: BookState = {
            bookId: book.id,
            lastRead: book.lastRead,
            progress: book.progress,
            currentCfi: book.currentCfi,
            lastPlayedCfi: book.lastPlayedCfi,
            lastPauseTime: book.lastPauseTime,
            isOffloaded: true, // initially mark as offloaded until we confirm file
            aiAnalysisStatus: book.aiAnalysisStatus
        };

        await tx.objectStore('books').put(bookData);
        await tx.objectStore('book_sources').put(sourceData);
        await tx.objectStore('book_states').put(stateData);
      }
      updateProgress(`Restoring metadata for ${book.title}...`);
    }

    // 1.2 Restore Annotations
    const annotations = Array.isArray(manifest.annotations) ? manifest.annotations : [];
    for (const ann of annotations) {
        await tx.objectStore('annotations').put(ann);
        updateProgress('Restoring annotations...');
    }

    // 1.3 Restore Lexicon
    const lexicon = Array.isArray(manifest.lexicon) ? manifest.lexicon : [];
    for (const rule of lexicon) {
        await tx.objectStore('lexicon').put(rule);
        updateProgress('Restoring dictionary...');
    }

    // 1.4 Restore Locations
    const locations = Array.isArray(manifest.locations) ? manifest.locations : [];
    for (const loc of locations) {
        await tx.objectStore('locations').put(loc);
        updateProgress('Restoring map...');
    }

    await tx.done;

    // Step 3: Restore Files (if ZIP)
    // We do this OUTSIDE the metadata transaction to avoid TransactionInactiveError during async unzip
    if (zip) {
        // We iterate booksToSave because we only want to restore files for valid/accepted books
        for (const book of booksToSave) {
            // No need to validate again, booksToSave contains valid BookMetadata objects

            const zipFile = zip.file(`files/${book.id}.epub`);
            if (zipFile) {
                // Async decompression
                const arrayBuffer = await zipFile.async('arraybuffer');

                // New short-lived transaction for file write
                const fileTx = db.transaction(['book_states', 'files'], 'readwrite');
                await fileTx.objectStore('files').put(arrayBuffer, book.id);

                // Update book status to not offloaded
                const bookState = await fileTx.objectStore('book_states').get(book.id);
                if (bookState) {
                    bookState.isOffloaded = false;
                    await fileTx.objectStore('book_states').put(bookState);
                } else {
                    // Create if missing (should exist from Step 2)
                    await fileTx.objectStore('book_states').put({ bookId: book.id, isOffloaded: false });
                }
                await fileTx.done;
            }
        }
    }

    onProgress?.(100, 'Restore complete!');
  }
}

export const backupService = new BackupService();
