import JSZip from 'jszip';
import { exportFile } from './export';
import { dbService } from '../db/DBService';
import type { BookMetadata, Annotation, LexiconRule, BookLocations, UserInventoryItem, UserProgress, UserAnnotation } from '../types/db';
import { getSanitizedBookMetadata } from '../db/validators';
import { getDB } from '../db/db';
import { yDoc } from '../store/yjs-provider';

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
 * Updated to v18 store names.
 */
export class BackupService {
  private readonly BACKUP_VERSION = 1;

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
      const percent = 10 + Math.floor((processed / totalBooks) * 80);
      onProgress?.(percent, `Archiving ${book.title}...`);
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

  private async generateManifest(): Promise<BackupManifest> {
    const db = await getDB();

    // Map new stores to BackupManifest structure
    // We construct legacy-like objects from v18 schema for portability
    const manifests = await db.getAll('static_manifests');

    // Read inventory from Yjs (Source of Truth for Inventory)
    // Legacy user_inventory might be empty for new books
    const yLibrary = yDoc.getMap<UserInventoryItem>('library');
    const yInventory = Array.from(yLibrary.values()).filter(i => i && i.bookId);

    const progress = await db.getAll('user_progress');
    const annotations = await db.getAll('user_annotations');
    const overrides = await db.getAll('user_overrides');
    const metrics = await db.getAll('cache_render_metrics');

    const invMap = new Map(yInventory.map(i => [i.bookId, i]));
    const progMap = new Map(progress.map(p => [p.bookId, p]));

    const books: BookMetadata[] = manifests.map(m => {
      const inv = invMap.get(m.bookId);
      const prog = progMap.get(m.bookId);
      return {
        id: m.bookId,
        title: inv?.customTitle || m.title,
        author: inv?.customAuthor || m.author,
        description: m.description,
        addedAt: inv?.addedAt || Date.now(),

        bookId: m.bookId,
        filename: inv?.sourceFilename,
        fileHash: m.fileHash,
        fileSize: m.fileSize,
        totalChars: m.totalChars,
        version: m.schemaVersion,

        lastRead: prog?.lastRead,
        progress: prog?.percentage,
        currentCfi: prog?.currentCfi,
        lastPlayedCfi: prog?.lastPlayedCfi,
        isOffloaded: false // Not accurate here, but irrelevant for export mostly
      };
    });

    // Flatten Overrides to LexiconRule[]
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

    // Map UserAnnotations to Annotation[] (Identical mostly)

    // Map Metrics to BookLocations[]
    const locations: BookLocations[] = metrics.map(met => ({
      bookId: met.bookId,
      locations: met.locations
    }));

    return {
      version: this.BACKUP_VERSION,
      timestamp: new Date().toISOString(),
      books,
      annotations: annotations as Annotation[],
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

    console.log('[BackupService] Starting processManifest');

    const db = await getDB();
    const totalItems = manifest.books.length + manifest.annotations.length + manifest.lexicon.length + manifest.locations.length;
    let processed = 0;

    const updateProgress = (msg: string) => {
      processed++;
      const percent = Math.floor((processed / totalItems) * 100);
      onProgress?.(percent, msg);
    };

    const booksToSave: BookMetadata[] = [];
    const rawBooks = Array.isArray(manifest.books) ? manifest.books : [];

    for (const rawBook of rawBooks) {
      if (!rawBook || typeof rawBook !== 'object') continue;
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
      booksToSave.push(check.sanitized);
    }

    const tx = db.transaction([
      'static_manifests', 'static_resources', 'static_structure',
      'user_inventory', 'user_progress', 'user_annotations',
      'user_overrides', 'cache_render_metrics'
    ], 'readwrite');

    // 1.1 Restore Books Metadata
    const manStore = tx.objectStore('static_manifests');
    const invStore = tx.objectStore('user_inventory');
    const progStore = tx.objectStore('user_progress');
    const structStore = tx.objectStore('static_structure');

    // Collect updates for Yjs to apply in a single transaction later
    const updates = {
      library: [] as UserInventoryItem[],
      progress: [] as UserProgress[],
      annotations: [] as UserAnnotation[]
    };

    for (const book of booksToSave) {
      const existingMan = await manStore.get(book.id);

      if (existingMan) {
        // Merge Progress
        const prog = await progStore.get(book.id);
        const resolvedProg: UserProgress = {
          bookId: book.id,
          percentage: book.progress || 0,
          lastRead: book.lastRead || 0,
          currentCfi: book.currentCfi,
          completedRanges: [],
          ...prog // keep existing if available, but check timestamps?
        };

        // Simple merge logic: overwrite if backup is newer?

        let shouldUpdate = false;
        if (prog) {
          if ((book.lastRead || 0) > (prog.lastRead || 0)) {
            resolvedProg.lastRead = book.lastRead || 0;
            resolvedProg.percentage = book.progress || 0;
            resolvedProg.currentCfi = book.currentCfi;
            resolvedProg.lastPlayedCfi = book.lastPlayedCfi;
            shouldUpdate = true;
          }
        } else {
          shouldUpdate = true;
        }

        if (shouldUpdate) {
          await progStore.put(resolvedProg);
          updates.progress.push(resolvedProg);
        }
      } else {
        // Create New from Backup Metadata
        await manStore.put({
          bookId: book.id,
          title: book.title,
          author: book.author,
          description: book.description,
          fileHash: book.fileHash || 'unknown',
          fileSize: book.fileSize || 0,
          totalChars: book.totalChars || 0,
          schemaVersion: book.version || 1,
          isbn: undefined
        });

        const invItem: UserInventoryItem = {
          bookId: book.id,
          title: book.title,
          author: book.author,
          addedAt: book.addedAt,
          sourceFilename: book.filename,
          tags: [],
          status: 'unread',
          lastInteraction: book.lastRead || 0,
          customTitle: book.title,
          customAuthor: book.author
        };
        await invStore.put(invItem);
        updates.library.push(invItem);

        const progItem: UserProgress = {
          bookId: book.id,
          percentage: book.progress || 0,
          lastRead: book.lastRead || 0,
          currentCfi: book.currentCfi,
          completedRanges: []
        };
        await progStore.put(progItem);
        updates.progress.push(progItem);

        if (book.syntheticToc) {
          await structStore.put({
            bookId: book.id,
            toc: book.syntheticToc,
            spineItems: [] // Missing from backup usually, or need to parse from file later
          });
        }
      }
      updateProgress(`Restoring metadata for ${book.title}...`);
    }

    // 1.2 Restore Annotations
    const annStore = tx.objectStore('user_annotations');
    const annotations = Array.isArray(manifest.annotations) ? manifest.annotations : [];
    for (const ann of annotations) {
      const userAnn: UserAnnotation = {
        id: ann.id,
        bookId: ann.bookId,
        cfiRange: ann.cfiRange,
        text: ann.text,
        type: ann.type,
        color: ann.color,
        note: ann.note,
        created: ann.created
      };
      await annStore.put(userAnn);
      updates.annotations.push(userAnn);

      updateProgress('Restoring annotations...');
    }

    // 1.3 Restore Lexicon
    const ovStore = tx.objectStore('user_overrides');
    const lexicon = Array.isArray(manifest.lexicon) ? manifest.lexicon : [];

    // Group by bookId first
    const ruleMap = new Map<string, LexiconRule[]>();
    for (const r of lexicon) {
      const bid = r.bookId || 'global';
      if (!ruleMap.has(bid)) ruleMap.set(bid, []);
      ruleMap.get(bid)?.push(r);
    }

    for (const [bid, rules] of ruleMap.entries()) {
      const ov = await ovStore.get(bid) || { bookId: bid, lexicon: [] };
      // Simple append/replace logic
      for (const r of rules) {
        // Avoid dups by ID?
        if (!ov.lexicon.some(lx => lx.id === r.id)) {
          ov.lexicon.push({
            id: r.id,
            original: r.original,
            replacement: r.replacement,
            isRegex: r.isRegex,
            created: r.created
          });
        }
        if (r.applyBeforeGlobal !== undefined) ov.lexiconConfig = { applyBefore: r.applyBeforeGlobal };
      }
      await ovStore.put(ov);
      updateProgress('Restoring dictionary...');
    }

    // 1.4 Restore Locations
    const locStore = tx.objectStore('cache_render_metrics');
    const locations = Array.isArray(manifest.locations) ? manifest.locations : [];
    for (const loc of locations) {
      await locStore.put({
        bookId: loc.bookId,
        locations: loc.locations
      });
      updateProgress('Restoring map...');
    }

    await tx.done;

    // Update Zustand stores directly - middleware will sync to Yjs automatically
    console.log(`[BackupService] Syncing to stores: ${updates.library.length} books, ${updates.progress.length} progress, ${updates.annotations.length} annotations`);

    // Import stores dynamically to avoid circular dependencies
    const { useLibraryStore } = await import('../store/useLibraryStore');
    const { useReadingStateStore } = await import('../store/useReadingStateStore');
    const { useAnnotationStore } = await import('../store/useAnnotationStore');

    // Update library store
    if (updates.library.length > 0) {
      const currentBooks = useLibraryStore.getState().books;
      const mergedBooks: Record<string, UserInventoryItem> = { ...currentBooks };
      updates.library.forEach(item => {
        mergedBooks[item.bookId] = item;
      });
      useLibraryStore.setState({ books: mergedBooks });
      console.log('[BackupService] Library books count after update:', Object.keys(mergedBooks).length);
    }

    // Update reading state store
    if (updates.progress.length > 0) {
      const currentProgress = useReadingStateStore.getState().progress;
      const mergedProgress: Record<string, UserProgress> = { ...currentProgress };
      updates.progress.forEach(item => {
        mergedProgress[item.bookId] = item;
      });
      useReadingStateStore.setState({ progress: mergedProgress });
    }

    // Update annotation store
    if (updates.annotations.length > 0) {
      const currentAnnotations = useAnnotationStore.getState().annotations;
      const mergedAnnotations: Record<string, UserAnnotation> = { ...currentAnnotations };
      updates.annotations.forEach(item => {
        mergedAnnotations[item.id] = item;
      });
      useAnnotationStore.setState({ annotations: mergedAnnotations });
    }

    console.log('[BackupService] Store updates complete');

    // Wait for Yjs persistence to flush (middleware syncs state to Yjs, then y-indexeddb persists)
    await new Promise(resolve => setTimeout(resolve, 2000));

    // Explicitly disconnect to ensure flush
    const { disconnectYjs } = await import('../store/yjs-provider');
    await disconnectYjs();
    console.log('[BackupService] Yjs persistence disconnected');

    // Step 3: Restore Files (if ZIP)
    if (zip) {
      for (const book of booksToSave) {
        const zipFile = zip.file(`files/${book.id}.epub`);
        if (zipFile) {
          const arrayBuffer = await zipFile.async('arraybuffer');

          const fileTx = db.transaction(['static_resources'], 'readwrite');
          const store = fileTx.objectStore('static_resources');

          const existing = await store.get(book.id) || { bookId: book.id, epubBlob: arrayBuffer };
          existing.epubBlob = arrayBuffer;

          await store.put(existing);
          await fileTx.done;
        }
      }
    }

    onProgress?.(100, 'Restore complete!');

    // Hydration now happens on LibraryView mount after page reload
  }
}

export const backupService = new BackupService();
