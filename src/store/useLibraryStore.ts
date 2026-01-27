import { create } from 'zustand';
import { dbService } from '../db/DBService';
import type { UserInventoryItem, BookMetadata, StaticBookManifest } from '../types/db';
import { StorageFullError, DuplicateBookError } from '../types/errors';
import { useTTSStore } from './useTTSStore';
import { useReadingListStore } from './useReadingListStore';
import { processBatchImport } from '../lib/batch-ingestion';
import { extractBookMetadata } from '../lib/ingestion';
import { useBookStore } from './useBookStore';
import { createLogger } from '../lib/logger';

const logger = createLogger('LibraryStore');

export type SortOption = 'recent' | 'last_read' | 'author' | 'title';

/**
 * State interface for the Library store.
 * 
 * Phase 2 (Yjs Migration): This store is NOW LOCAL-ONLY (except for coordination).
 * - `books`: MOVED TO `useBookStore` (Synced).
 * - `staticMetadata`: Transient local cache (covers, etc.) -> REMAINS HERE.
 */
interface LibraryState {
  // === TRANSIENT STATE (local-only, not synced) ===
  /** Static metadata cache (title, author, cover) from static_manifests. */
  staticMetadata: Record<string, BookMetadata>;
  /** Set of book IDs that are offloaded (locally missing binary content). */
  offloadedBookIds: Set<string>;
  /** Flag indicating if static metadata is currently being hydrated. */
  isHydrating: boolean;
  /** Flag indicating if the library is currently loading. */
  isLoading: boolean;
  /** Flag indicating if a book is currently being imported. */
  isImporting: boolean;
  /** Progress percentage of the current import (0-100). */
  importProgress: number;
  /** Status message of the current import. */
  importStatus: string;
  /** Progress percentage of the current upload/extraction (0-100). */
  uploadProgress: number;
  /** Status message of the current upload/extraction. */
  uploadStatus: string;
  /** Error message if an operation failed, or null. */
  error: string | null;

  /** The current sort order of the library. */
  sortOrder: SortOption;

  // === ACTIONS (not synced to Yjs) ===

  /**
   * Sets the sort order of the library.
   * @param sort - The new sort order.
   */
  setSortOrder: (sort: SortOption) => void;
  /**
   * Hydrates static metadata (covers, etc.) from IDB for all books in inventory.
   * Should be called on app mount after Yjs syncs.
   */
  hydrateStaticMetadata: () => Promise<void>;
  /**
   * Imports a new EPUB file into the library.
   * @param file - The EPUB file to import.
   * @param options - Import options.
   */
  addBook: (file: File, options?: { overwrite?: boolean }) => Promise<void>;
  /**
   * Imports multiple files (EPUBs or ZIPs) into the library.
   * @param files - The array of files to import.
   */
  addBooks: (files: File[]) => Promise<void>;
  /**
   * Updates user-editable metadata for a book.
   * @param id - The unique identifier of the book to update.
   * @param updates - Partial updates to apply.
   */
  updateBook: (id: string, updates: Partial<UserInventoryItem>) => void;
  /**
   * Removes a book and its associated data (files, annotations) from the library.
   * @param id - The unique identifier of the book to remove.
   */
  removeBook: (id: string) => Promise<void>;
  /**
   * Offloads the binary file of a book to save space, retaining metadata.
   * @param id - The unique identifier of the book to offload.
   */
  offloadBook: (id: string) => Promise<void>;
  /**
   * Restores the binary file of an offloaded book.
   * @param id - The unique identifier of the book to restore.
   * @param file - The EPUB file to upload.
   */
  restoreBook: (id: string, file: File) => Promise<void>;
}

// DB Service Interface for injection (updated for Phase 2)
interface IDBService {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  addBook: (file: File, options: any, onProgress: (progress: number, message: string) => void) => Promise<StaticBookManifest>;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  importBookWithId: (bookId: string, file: File, options: any, onProgress: (progress: number, message: string) => void) => Promise<StaticBookManifest>;
  deleteBook: (id: string) => Promise<void>;
  offloadBook: (id: string) => Promise<void>;
  restoreBook: (id: string, file: File) => Promise<void>;
  getBookMetadata: (id: string) => Promise<BookMetadata | undefined>;
  getOffloadedStatus: (bookIds?: string[]) => Promise<Map<string, boolean>>;
  getBookIdByFilename: (filename: string) => string | undefined;
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export const createLibraryStore = (injectedDB: IDBService = dbService as any) => create<LibraryState>()(
  (set, get) => ({
    // Transient state
    staticMetadata: {},
    offloadedBookIds: new Set<string>(),
    isHydrating: false,
    isLoading: false,
    isImporting: false,
    importProgress: 0,
    importStatus: '',
    uploadProgress: 0,
    uploadStatus: '',
    error: null,

    sortOrder: 'last_read',

    // Actions

    setSortOrder: (sort) => set({ sortOrder: sort }),

    hydrateStaticMetadata: async () => {
      // Access books from the SYNCED store (Yjs)
      const books = useBookStore.getState().books;
      const bookIds = Object.keys(books);
      logger.debug(`Hydrate called. Books in store: ${bookIds.length}`);

      if (bookIds.length === 0) {
        return; // No books to hydrate
      }

      set({ isHydrating: true });

      try {
        const manifests = await Promise.all(
          bookIds.map(id => injectedDB.getBookMetadata(id))
        );

        const staticMetadata: Record<string, BookMetadata> = {};
        manifests.forEach(manifest => {
          if (manifest && manifest.id) {
            staticMetadata[manifest.id] = manifest;
          }
        });

        set({ staticMetadata, isHydrating: false });

        // Hydrate Offload Status
        try {
          const offloadedMap = await injectedDB.getOffloadedStatus(bookIds);
          // logger.debug(`Offloaded Map for ${bookIds.length} books: ${JSON.stringify(Array.from(offloadedMap.entries()))}`);
          const offloadedSet = new Set<string>();
          offloadedMap.forEach((isOffloaded, id) => {
            if (isOffloaded) offloadedSet.add(id);
          });
          set({ offloadedBookIds: offloadedSet });
        } catch (e) {
          logger.error('Failed to hydrate offload status:', e);
        }
      } catch (err) {
        logger.error('Failed to hydrate static metadata:', err);
        set({ isHydrating: false });
      }
    },

    addBook: async (file: File, options?: { overwrite?: boolean }) => {
      set({
        isImporting: true,
        importProgress: 0,
        importStatus: 'Starting import...',
        uploadProgress: 0,
        uploadStatus: '',
        error: null
      });

      try {
        // Check for duplicates
        // Use Store state first (synchronous check to avoid race conditions with recent adds)
        const books = useBookStore.getState().books;
        let existingId = Object.values(books).find(b => b.sourceFilename === file.name)?.bookId;

        // If not found in store (e.g. not fully synced?), try DB as backup
        if (!existingId) {
          existingId = await injectedDB.getBookIdByFilename(file.name);
        }

        if (existingId) {
          if (options?.overwrite) {
            set({ importStatus: 'Removing existing copy...' });
            await get().removeBook(existingId);
          } else {
            set({ isImporting: false, importProgress: 0, importStatus: '' });
            throw new DuplicateBookError(file.name);
          }
        }

        // Smart Matching: Check for "Ghost Books" (Synced but no local file)
        try {
          set({ importStatus: 'Checking for existing library entries...' });
          const meta = await extractBookMetadata(file);
          const staticMeta = get().staticMetadata;
          const books = useBookStore.getState().books;

          // Find a ghost book that matches Title + Author
          const ghostMatch = Object.values(books).find(b => {
            const isGhost = !staticMeta[b.bookId]; // Not in local static manifest
            const isMatch = b.title.trim() === meta.title.trim() && b.author.trim() === meta.author.trim();
            return isGhost && isMatch;
          });

          if (ghostMatch) {
            logger.info(`Found Ghost Book match: "${ghostMatch.title}" (${ghostMatch.bookId}). Linking file...`);
            set({ importStatus: `Linking to existing entry: ${ghostMatch.title}...` });

            const { sentenceStarters, sanitizationEnabled } = useTTSStore.getState();

            // Import using the EXISTING ID
            const manifest = await injectedDB.importBookWithId(ghostMatch.bookId, file, {
              abbreviations: [],
              alwaysMerge: [],
              sentenceStarters,
              sanitizationEnabled
            }, (progress, message) => {
              set({ importProgress: progress, importStatus: message });
            });

            // Update Static Metadata
            set((state) => ({
              staticMetadata: {
                ...state.staticMetadata,
                [manifest.bookId]: {
                  ...manifest,
                  id: manifest.bookId,
                  version: manifest.schemaVersion,
                  addedAt: ghostMatch.addedAt
                } as BookMetadata
              },
              offloadedBookIds: new Set([...state.offloadedBookIds].filter(id => id !== manifest.bookId)),
              isImporting: false,
              importProgress: 0,
              importStatus: ''
            }));
            return; // Stop here, we served the request
          }
        } catch (e) {
          logger.warn("Smart matching check failed, proceeding with standard import", e);
        }

        const { sentenceStarters, sanitizationEnabled } = useTTSStore.getState();

        // 1. Pure ingestion: Write to static_* stores only
        const manifest = await injectedDB.addBook(file, {
          abbreviations: [],
          alwaysMerge: [],
          sentenceStarters,
          sanitizationEnabled
        }, (progress, message) => {
          set({ importProgress: progress, importStatus: message });
        });

        // 2. Create inventory item with Ghost Book metadata snapshot
        const inventoryItem: UserInventoryItem = {
          bookId: manifest.bookId,
          title: manifest.title,      // Ghost Book snapshot
          author: manifest.author,    // Ghost Book snapshot
          addedAt: Date.now(),
          lastInteraction: Date.now(),
          sourceFilename: file.name,
          status: 'unread',
          tags: [],
          rating: 0
        };

        // 3. Update Sync Store
        useBookStore.getState().addBook(inventoryItem);

        // 4. Update Local Static Metadata
        set((state) => ({
          staticMetadata: {
            ...state.staticMetadata,
            // Map StaticBookManifest to BookMetadata-compatible object
            [manifest.bookId]: {
              ...manifest,
              id: manifest.bookId,  // Alias bookId to id for BookMetadata compatibility
              version: manifest.schemaVersion,  // Alias schemaVersion to version
              addedAt: Date.now()  // Required for Book type
            } as BookMetadata
          },
          // Ensure new book is NOT marked as offloaded
          offloadedBookIds: new Set(
            [...state.offloadedBookIds].filter(id => id !== manifest.bookId)
          ),
          isImporting: false,
          importProgress: 0,
          importStatus: ''
        }));

        // 5. Add to Reading List
        useReadingListStore.getState().upsertEntry({
          filename: file.name,
          title: manifest.title,
          author: manifest.author,
          percentage: 0,
          lastUpdated: Date.now(),
          status: 'to-read',
          rating: 0
        });
      } catch (err) {
        logger.error('Failed to import book:', err);
        let errorMessage = 'Failed to import book.';
        if (err instanceof StorageFullError) {
          errorMessage = 'Device storage full. Please delete some books.';
        }
        set({ error: errorMessage, isImporting: false, importProgress: 0, importStatus: '' });
        throw err;
      }
    },

    addBooks: async (files: File[]) => {
      set({
        isImporting: true,
        importProgress: 0,
        importStatus: 'Pending...',
        uploadProgress: 0,
        uploadStatus: 'Starting processing...',
        error: null
      });
      try {
        const { sentenceStarters, sanitizationEnabled } = useTTSStore.getState();

        // Process files and get returns manifests
        const { successful } = await processBatchImport(
          files,
          {
            abbreviations: [],
            alwaysMerge: [],
            sentenceStarters,
            sanitizationEnabled
          },
          (processed, total, filename) => {
            const percent = Math.round((processed / total) * 100);
            set({
              importProgress: percent,
              importStatus: `Importing ${processed + 1} of ${total}: ${filename}`
            });
          },
          (percent, status) => {
            set({
              uploadProgress: percent,
              uploadStatus: status
            });
          }
        );

        // Phase 2: Explicitly add new books to Yjs inventory
        successful.forEach(manifest => {
          const inventoryItem: UserInventoryItem = {
            bookId: manifest.bookId,
            title: manifest.title,
            author: manifest.author || 'Unknown Author', // Ensure author is captured
            addedAt: Date.now(),
            sourceFilename: files.find(f => f.name.includes(manifest.title) || f.size === manifest.fileSize)?.name, // Best effort match
            tags: [],
            status: 'unread',
            lastInteraction: Date.now()
          };
          useBookStore.getState().addBook(inventoryItem);
        });

        // Hydrate newly imported books
        await get().hydrateStaticMetadata();

        set({
          isImporting: false,
          importProgress: 0,
          importStatus: '',
          uploadProgress: 0,
          uploadStatus: ''
        });
      } catch (err) {
        logger.error('Failed to batch import books:', err);
        let errorMessage = 'Failed to import books.';
        if (err instanceof StorageFullError) {
          errorMessage = 'Device storage full. Please delete some books.';
        }
        set({
          error: errorMessage,
          isImporting: false,
          importProgress: 0,
          importStatus: '',
          uploadProgress: 0,
          uploadStatus: ''
        });
        throw err;
      }
    },

    updateBook: (id, updates) => {
      // Delegate to SYNCED store
      useBookStore.getState().updateBook(id, updates);
    },

    removeBook: async (id: string) => {
      try {
        // Delete from SYNCED store
        useBookStore.getState().removeBook(id);

        // Delete from LOCAL state
        set((state) => {
          // eslint-disable-next-line @typescript-eslint/no-unused-vars
          const { [id]: _removedMeta, ...remainingMeta } = state.staticMetadata;
          return {
            staticMetadata: remainingMeta
          };
        });

        // Clean up static blobs from IDB
        await injectedDB.deleteBook(id);
      } catch (err) {
        logger.error('Failed to remove book:', err);
        set({ error: 'Failed to remove book.' });
        // Re-hydrate to revert on failure
        await get().hydrateStaticMetadata();
      }
    },

    offloadBook: async (id: string) => {
      logger.debug('offloadBook called. ID:', id);
      // Optimistic update
      set((state) => {
        const set = state.offloadedBookIds || new Set();
        logger.debug('prev offloaded set size:', set.size);
        const newSet = new Set([...set, id]);
        logger.debug('new offloaded set size:', newSet.size);
        return { offloadedBookIds: newSet };
      });

      try {
        await injectedDB.offloadBook(id);
        // Metadata remains in Yjs, just blob is removed from IDB
      } catch (err) {
        logger.error('Failed to offload book:', err);
        // Revert optimistic update
        set((state) => ({
          error: 'Failed to offload book.',
          offloadedBookIds: new Set([...state.offloadedBookIds].filter(bid => bid !== id))
        }));
      }
    },

    restoreBook: async (id: string, file: File) => {
      set({ isImporting: true, error: null });
      try {
        // Check if we have a local manifest (determines if this is a true restore or a sync download)
        const existingMetadata = await injectedDB.getBookMetadata(id);

        if (existingMetadata) {
          // True restore: manifest exists, just restore the binary
          await injectedDB.restoreBook(id, file);
        } else {
          // Synced book download: no local manifest, need to fully import with existing ID
          logger.info(`Book ${id} has no local manifest. Importing with existing ID for synced book.`);

          const { sentenceStarters, sanitizationEnabled } = useTTSStore.getState();

          // Preserve existing inventory data before import
          const existingBook = useBookStore.getState().books[id];

          // Import with specific book ID (preserves the synced book's ID)
          const manifest = await injectedDB.importBookWithId(id, file, {
            abbreviations: [],
            alwaysMerge: [],
            sentenceStarters,
            sanitizationEnabled
          }, (progress, message) => {
            set({ importProgress: progress, importStatus: message });
          });

          // Update static metadata with the new manifest
          set((state) => ({
            staticMetadata: {
              ...state.staticMetadata,
              [id]: {
                ...manifest,
                id: id,
                version: manifest.schemaVersion,
                addedAt: existingBook?.addedAt || Date.now()
              } as BookMetadata
            }
          }));
        }

        // Re-hydrate to get the restored cover
        await get().hydrateStaticMetadata();

        // Update offload state
        set((state) => ({
          offloadedBookIds: new Set([...state.offloadedBookIds].filter(bid => bid !== id)),
          isImporting: false,
          importProgress: 0,
          importStatus: ''
        }));
      } catch (err) {
        logger.error('Failed to restore book:', err);
        set({ error: err instanceof Error ? err.message : 'Failed to restore book.', isImporting: false });
      }
    },
  })
);

/**
 * Zustand store for managing the user's library of books (Local, non-synced UI state).
 * 
 * Note: Book inventory data is managed by `useBookStore`.
 */
export const useLibraryStore = createLibraryStore();

// Export access to helper store for debugging if needed
export { useBookStore };
