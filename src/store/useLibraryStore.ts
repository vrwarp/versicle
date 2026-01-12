import { create } from 'zustand';
import yjs from 'zustand-middleware-yjs';
import { yDoc } from './yjs-provider';
import { dbService } from '../db/DBService';
import type { UserInventoryItem, StaticBookManifest } from '../types/db';
import { StorageFullError } from '../types/errors';
import { useTTSStore } from './useTTSStore';
import { processBatchImport } from '../lib/batch-ingestion';

export type SortOption = 'recent' | 'last_read' | 'author' | 'title';

/**
 * State interface for the Library store.
 * 
 * Phase 2 (Yjs Migration): This store is wrapped with yjs() middleware.
 * - `books` (UserInventoryItem): Synced to yDoc.getMap('library')
 * - `staticMetadata`: Transient local cache (covers, etc.)
 * - Actions (functions): Not synced, local-only
 */
interface LibraryState {
  // === SYNCED STATE (persisted to Yjs) ===
  /** Map of user inventory items (book metadata + user data), keyed by Book ID. */
  books: Record<string, UserInventoryItem>;

  // === TRANSIENT STATE (local-only, not synced) ===
  /** Static metadata cache (title, author, cover) from static_manifests. */
  staticMetadata: Record<string, StaticBookManifest>;
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
  /** The current view mode of the library. */
  viewMode: 'grid' | 'list';
  /** The current sort order of the library. */
  sortOrder: SortOption;

  // === ACTIONS (not synced to Yjs) ===
  /**
   * Sets the view mode of the library.
   * @param mode - The new view mode.
   */
  setViewMode: (mode: 'grid' | 'list') => void;
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
   */
  addBook: (file: File) => Promise<void>;
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
  addBook: (file: File, options: any, onProgress: (progress: number, message: string) => void) => Promise<StaticBookManifest>;
  deleteBook: (id: string) => Promise<void>;
  offloadBook: (id: string) => Promise<void>;
  restoreBook: (id: string, file: File) => Promise<void>;
  getBookMetadata: (id: string) => Promise<StaticBookManifest | undefined>;
}

export const createLibraryStore = (injectedDB: IDBService = dbService as any) => create<LibraryState>()(
  yjs(
    yDoc,
    'library',
    (set, get) => ({
      // Synced state
      books: {},

      // Transient state
      staticMetadata: {},
      isHydrating: false,
      isLoading: false,
      isImporting: false,
      importProgress: 0,
      importStatus: '',
      uploadProgress: 0,
      uploadStatus: '',
      error: null,
      viewMode: 'grid',
      sortOrder: 'last_read',

      // Actions
      setViewMode: (mode) => set({ viewMode: mode }),
      setSortOrder: (sort) => set({ sortOrder: sort }),

      hydrateStaticMetadata: async () => {
        const { books } = get();
        const bookIds = Object.keys(books);

        if (bookIds.length === 0) {
          return;
        }

        set({ isHydrating: true });

        try {
          const manifests = await Promise.all(
            bookIds.map(id => injectedDB.getBookMetadata(id))
          );

          const staticMetadata: Record<string, StaticBookManifest> = {};
          manifests.forEach(manifest => {
            if (manifest) {
              staticMetadata[manifest.bookId] = manifest;
            }
          });

          set({ staticMetadata, isHydrating: false });
        } catch (err) {
          console.error('Failed to hydrate static metadata:', err);
          set({ isHydrating: false });
        }
      },

      addBook: async (file: File) => {
        set({
          isImporting: true,
          importProgress: 0,
          importStatus: 'Starting import...',
          uploadProgress: 0,
          uploadStatus: '',
          error: null
        });
        try {
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

          // 3. Update Zustand state (middleware syncs to Yjs automatically)
          set((state) => ({
            books: {
              ...state.books,
              [manifest.bookId]: inventoryItem
            },
            staticMetadata: {
              ...state.staticMetadata,
              [manifest.bookId]: manifest
            },
            isImporting: false,
            importProgress: 0,
            importStatus: ''
          }));
        } catch (err) {
          console.error('Failed to import book:', err);
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

          // Use batch import utility (will need to be updated to return manifests)
          await processBatchImport(
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
          console.error('Failed to batch import books:', err);
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
        set((state) => {
          if (!state.books[id]) {
            console.warn(`Book ${id} not found in store`);
            return state;
          }

          return {
            books: {
              ...state.books,
              [id]: {
                ...state.books[id],
                ...updates,
                lastInteraction: Date.now()
              }
            }
          };
        });
      },

      removeBook: async (id: string) => {
        try {
          // Delete from Zustand (middleware syncs deletion to Yjs)
          set((state) => {
            const { [id]: removed, ...remainingBooks } = state.books;
            const { [id]: removedMeta, ...remainingMeta } = state.staticMetadata;
            return {
              books: remainingBooks,
              staticMetadata: remainingMeta
            };
          });

          // Clean up static blobs from IDB
          await injectedDB.deleteBook(id);
        } catch (err) {
          console.error('Failed to remove book:', err);
          set({ error: 'Failed to remove book.' });
          // Re-hydrate to revert on failure
          await get().hydrateStaticMetadata();
        }
      },

      offloadBook: async (id: string) => {
        try {
          await injectedDB.offloadBook(id);
          // Metadata remains in Yjs, just blob is removed from IDB
          // No state update needed
        } catch (err) {
          console.error('Failed to offload book:', err);
          set({ error: 'Failed to offload book.' });
        }
      },

      restoreBook: async (id: string, file: File) => {
        set({ isImporting: true, error: null });
        try {
          await injectedDB.restoreBook(id, file);
          // Re-hydrate to get the restored cover
          await get().hydrateStaticMetadata();
          set({ isImporting: false });
        } catch (err) {
          console.error('Failed to restore book:', err);
          set({ error: err instanceof Error ? err.message : 'Failed to restore book.', isImporting: false });
        }
      },
    })
  )
);

/**
 * Zustand store for managing the user's library of books.
 * Wrapped with yjs() middleware for automatic CRDT synchronization.
 */
export const useLibraryStore = createLibraryStore();

// Selectors

/**
 * Returns all books with static metadata merged.
 * Static metadata (cover, full title/author) is used if available,
 * otherwise falls back to Ghost Book metadata from Yjs inventory.
 */
export const useAllBooks = () => {
  const books = useLibraryStore(state => state.books);
  const staticMetadata = useLibraryStore(state => state.staticMetadata);

  return Object.values(books).map(book => ({
    ...book,
    // Merge static metadata if available, otherwise use Ghost Book snapshots
    id: book.bookId,  // Alias for backwards compatibility
    title: staticMetadata[book.bookId]?.title || book.title,
    author: staticMetadata[book.bookId]?.author || book.author,
    coverBlob: staticMetadata[book.bookId]?.coverBlob || undefined,
    coverUrl: staticMetadata[book.bookId]?.coverBlob
      ? URL.createObjectURL(staticMetadata[book.bookId]!.coverBlob!)
      : undefined,
    // Add other static fields for compatibility
    fileHash: staticMetadata[book.bookId]?.fileHash,
    fileSize: staticMetadata[book.bookId]?.fileSize,
    totalChars: staticMetadata[book.bookId]?.totalChars
  })).sort((a, b) => b.lastInteraction - a.lastInteraction);
};

/**
 * Returns a single book by ID with static metadata merged.
 */
export const useBook = (id: string | null) => {
  const book = useLibraryStore(state => id ? state.books[id] : null);
  const staticMeta = useLibraryStore(state => id ? state.staticMetadata[id] : null);

  if (!book) return null;

  return {
    ...book,
    id: book.bookId,  // Alias
    title: staticMeta?.title || book.title,
    author: staticMeta?.author || book.author,
    coverBlob: staticMeta?.coverBlob || null,
    coverUrl: staticMeta?.coverBlob ? URL.createObjectURL(staticMeta.coverBlob!) : undefined,
    fileHash: staticMeta?.fileHash,
    fileSize: staticMeta?.fileSize,
    totalChars: staticMeta?.totalChars
  };
};
