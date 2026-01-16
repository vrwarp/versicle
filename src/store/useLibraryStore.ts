import { create } from 'zustand';
import yjs from 'zustand-middleware-yjs';
import { yDoc } from './yjs-provider';
import { dbService } from '../db/DBService';
import type { UserInventoryItem, BookMetadata, StaticBookManifest } from '../types/db';
import { StorageFullError } from '../types/errors';
import { useTTSStore } from './useTTSStore';
import { useReadingListStore } from './useReadingListStore';
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
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  addBook: (file: File, options: any, onProgress: (progress: number, message: string) => void) => Promise<StaticBookManifest>;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  importBookWithId: (bookId: string, file: File, options: any, onProgress: (progress: number, message: string) => void) => Promise<StaticBookManifest>;
  deleteBook: (id: string) => Promise<void>;
  offloadBook: (id: string) => Promise<void>;
  restoreBook: (id: string, file: File) => Promise<void>;
  getBookMetadata: (id: string) => Promise<BookMetadata | undefined>;
  getAllInventoryItems: () => Promise<UserInventoryItem[]>;
  getOffloadedStatus: (bookIds?: string[]) => Promise<Map<string, boolean>>;
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export const createLibraryStore = (injectedDB: IDBService = dbService as any) => create<LibraryState>()(
  yjs(
    yDoc,
    'library',
    (set, get) => ({
      // Synced state
      books: {},

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
      viewMode: 'grid',
      sortOrder: 'last_read',

      // Actions
      setViewMode: (mode) => set({ viewMode: mode }),
      setSortOrder: (sort) => set({ sortOrder: sort }),

      hydrateStaticMetadata: async () => {
        const { books } = get();
        let bookIds = Object.keys(books);
        console.error(`[Hydrate] Called. Books in store: ${bookIds.length}`);

        if (bookIds.length === 0) {
          // Self-healing: Check if user_inventory has items that Yjs missed (e.g. after restore)
          try {
            const legacyBooks = await injectedDB.getAllInventoryItems();
            if (legacyBooks && legacyBooks.length > 0) {
              console.log(`[Library] Found ${legacyBooks.length} items in user_inventory but 0 in Yjs. Migrating...`);

              // Update state (middleware will sync to Yjs)
              const updates: Record<string, UserInventoryItem> = {};

              // Enrich legacy items with metadata from IDB if missing (Ghost Book requirements)
              await Promise.all(legacyBooks.map(async (item) => {
                let { title, author } = item;

                // If title/author missing (legacy), try to fetch from static manifest
                if (!title || !author || author === 'Unknown Author') {
                  try {
                    const meta = await injectedDB.getBookMetadata(item.bookId);
                    if (meta) {
                      if (!title) title = meta.title;
                      if (!author || author === 'Unknown Author') author = meta.author;
                    }
                  } catch (e) {
                    console.warn(`[Library] Failed to fetch metadata for legacy book ${item.bookId}`, e);
                  }
                }

                updates[item.bookId] = {
                  ...item,
                  title: title || 'Untitled',
                  author: author || 'Unknown Author'
                };
              }));

              set((state) => ({
                books: {
                  ...state.books,
                  ...updates
                }
              }));

              // Refresh IDs
              bookIds = Object.keys(updates);
            } else {
              return;
            }
          } catch (e) {
            console.error("[Library] Failed to self-heal from user_inventory", e);
            return;
          }
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
            console.error(`[Hydrate] Offloaded Map for ${bookIds.length} books: ${JSON.stringify(Array.from(offloadedMap.entries()))}`);
            const offloadedSet = new Set<string>();
            offloadedMap.forEach((isOffloaded, id) => {
              if (isOffloaded) offloadedSet.add(id);
            });
            set({ offloadedBookIds: offloadedSet });
          } catch (e) {
            console.error('Failed to hydrate offload status:', e);
          }
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

          // 4. Add to Reading List
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

          // Phase 2: Explicitly add new books to Yjs inventory to ensure metadata (esp. Author) syncs correctly
          set((state) => {
            const newBooks = { ...state.books };
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
              newBooks[manifest.bookId] = inventoryItem;
            });
            return { books: newBooks };
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
            // eslint-disable-next-line @typescript-eslint/no-unused-vars
            const { [id]: _removed, ...remainingBooks } = state.books;
            // eslint-disable-next-line @typescript-eslint/no-unused-vars
            const { [id]: _removedMeta, ...remainingMeta } = state.staticMetadata;
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
        console.log('[Store] offloadBook called. ID:', id);
        // Optimistic update
        set((state) => {
          const set = state.offloadedBookIds || new Set();
          console.log('[Store] prev offloaded set size:', set.size);
          const newSet = new Set([...set, id]);
          console.log('[Store] new offloaded set size:', newSet.size);
          return { offloadedBookIds: newSet };
        });

        try {
          await injectedDB.offloadBook(id);
          // Metadata remains in Yjs, just blob is removed from IDB
        } catch (err) {
          console.error('Failed to offload book:', err);
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
            console.log(`[Library] Book ${id} has no local manifest. Importing with existing ID for synced book.`);
            const { sentenceStarters, sanitizationEnabled } = useTTSStore.getState();

            // Preserve existing inventory data before import
            const existingBook = get().books[id];

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

// Selectors removed and moved to selectors.ts
