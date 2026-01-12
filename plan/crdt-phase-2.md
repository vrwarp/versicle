# Phase 2: Store Refactoring with Middleware Integration

**Goal:** Wrap existing Zustand stores with `zustand-middleware-yjs` to enable automatic Yjs synchronization. This phase does NOT change component interfaces - only the persistence layer.

## Overview: Middleware-Centric Architecture

Instead of manually managing `Y.Map` instances, we wrap entire Zustand stores with the `yjs()` middleware. The middleware handles:
- Creating `Y.Map` instances under a namespace
- Bidirectional sync (Zustand ↔ Yjs ↔ IndexedDB)
- Conflict resolution (LWW for objects, CRDT for arrays)
- Filtering functions (actions are not synced)

**Critical Insight:** Phase 0 already split stores correctly. Phase 2 simply adds middleware wrapping without changing component contracts.

## 1. Pattern: Wrapping a Store with Middleware

### Basic Template

```typescript
import { create } from 'zustand';
import { yjs } from 'zustand-middleware-yjs';
import { yDoc } from './yjs-provider';

interface MyState {
  data: Record<string, MyDataType>;
  
  // Actions (not synced)
  addItem: (item: MyDataType) => void;
  removeItem: (id: string) => void;
}

export const useMyStore = create<MyState>()(
  yjs(
    (set, get) => ({
      // State (synced to yDoc.getMap('my-namespace'))
      data: {},
      
      // Actions (local-only, not synced)
      addItem: (item) => set((state) => ({
        data: { ...state.data, [item.id]: item }
      })),
      
      removeItem: (id) => set((state) => {
        const { [id]: removed, ...remaining } = state.data;
        return { data: remaining };
      })
    }),
    {
      doc: yDoc,
      name: 'my-namespace'  // Creates yDoc.getMap('my-namespace')
    }
  )
);
```

**Key Rules:**
1. **Immutability:** Always use immutable updates (`{ ...state }`)
2. **No manual Y.Map access:** Let middleware handle Yjs
3. **Functions are ignored:** Actions remain local
4. **Namespace uniqueness:** Each store needs unique `name`

## 2. Refactor: `useLibraryStore`

**Current State (Phase 0):** Already converted to `books: Record<string, BookMetadata>` structure.

**Phase 2 Changes:**
1. Wrap with `yjs()` middleware
2. Remove `persist` middleware (Yjs handles persistence)
3. Update state type to include Ghost Book metadata

### Implementation

**File:** `src/store/useLibraryStore.ts`

```typescript
import { create } from 'zustand';
import { yjs } from 'zustand-middleware-yjs';
import { yDoc } from './yjs-provider';
import { dbService } from '../db/DBService';
import type { UserInventoryItem, StaticBookManifest } from '../types/db';

interface LibraryState {
  // SYNCED STATE (goes to Yjs 'library' map)
  books: Record<string, UserInventoryItem>;
  
  // TRANSIENT STATE (local-only, reset on mount)
  staticMetadata: Record<string, StaticBookManifest>;
  isHydrating: boolean;
  
  // ACTIONS (not synced)
  addBook: (file: File) => Promise<void>;
  removeBook: (id: string) => Promise<void>;
  updateBook: (id: string, updates: Partial<UserInventoryItem>) => void;
  hydrateStaticMetadata: () => Promise<void>;
}

export const useLibraryStore = create<LibraryState>()(
  yjs(
    (set, get) => ({
      // Synced state
      books: {},
      
      // Transient state (not synced because middleware only syncs serializable data)
      staticMetadata: {},
      isHydrating: false,
      
      // Actions
      addBook: async (file) => {
        // 1. Pure ingestion (writes to static_* IDB stores only)
        const manifest = await dbService.addBook(file);
        
        // 2. Create inventory item with Ghost Book metadata snapshot
        const inventoryItem: UserInventoryItem = {
          bookId: manifest.id,
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
            [manifest.id]: inventoryItem
          },
          staticMetadata: {
            ...state.staticMetadata,
            [manifest.id]: manifest
          }
        }));
      },
      
      removeBook: async (id) => {
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
        await dbService.deleteBook(id);
      },
      
      updateBook: (id, updates) => {
        set((state) => ({
          books: {
            ...state.books,
            [id]: {
              ...state.books[id],
              ...updates,
              lastInteraction: Date.now()
            }
          }
        }));
      },
      
      hydrateStaticMetadata: async () => {
        const { books } = get();
        const bookIds = Object.keys(books);
        
        if (bookIds.length === 0) return;
        
        set({ isHydrating: true });
        
        const manifests = await Promise.all(
          bookIds.map(id => dbService.getBookMetadata(id))
        );
        
        const staticMetadata: Record<string, StaticBookManifest> = {};
        manifests.forEach(manifest => {
          if (manifest) {
            staticMetadata[manifest.id] = manifest;
          }
        });
        
        set({ staticMetadata, isHydrating: false });
      }
    }),
    {
      doc: yDoc,
      name: 'library'  // Creates yDoc.getMap('library')
    }
  )
);

// Selector: All books with static metadata merged
export const useAllBooks = () => {
  const books = useLibraryStore(state => state.books);
  const staticMetadata = useLibraryStore(state => state.staticMetadata);
  
  return Object.values(books).map(book => ({
    ...book,
    // Merge static metadata if available, otherwise use Ghost Book snapshots
    title: staticMetadata[book.bookId]?.title || book.title,
    author: staticMetadata[book.bookId]?.author || book.author,
    coverBlob: staticMetadata[book.bookId]?.coverBlob || null,
    hash: staticMetadata[book.bookId]?.hash
  })).sort((a, b) => b.lastInteraction - a.lastInteraction);
};

// Selector: Single book by ID
export const useBook = (bookId: string | null) => {
  const book = useLibraryStore(state => bookId ? state.books[bookId] : null);
  const staticMeta = useLibraryStore(state => bookId ? state.staticMetadata[bookId] : null);
  
  if (!book) return null;
  
  return {
    ...book,
    title: staticMeta?.title || book.title,
    author: staticMeta?.author || book.author,
    coverBlob: staticMeta?.coverBlob || null
  };
};
```

**Key Changes:**
- ✅ Wrapped with `yjs()` middleware (namespace: `'library'`)
- ✅ Removed `persist` middleware
- ✅ `books` is synced, `staticMetadata` is transient (local cache)
- ✅ Ghost Book metadata (`title`, `author`) included in `UserInventoryItem`
- ✅ `hydrateStaticMetadata()` called on app mount to populate covers

### Type Update: `UserInventoryItem`

**File:** `src/types/db.ts`

```typescript
export interface UserInventoryItem {
  bookId: string;
  
  // Ghost Book metadata (synced to Yjs for cross-device display)
  title: string;
  author: string;
  
  // User metadata
  addedAt: number;
  lastInteraction: number;
  sourceFilename: string;  // Link to reading_list
  status: 'unread' | 'reading' | 'completed';
  tags: string[];
  rating: number;
}
```

## 3. Refactor: `useAnnotationStore`

**Current State (Phase 0):** Uses `persist` middleware with `localStorage`.

**Phase 2 Changes:** Replace `persist` with `yjs()` middleware.

### Implementation

**File:** `src/store/useAnnotationStore.ts`

```typescript
import { create } from 'zustand';
import { yjs } from 'zustand-middleware-yjs';
import { yDoc } from './yjs-provider';
import type { UserAnnotation } from '../types/db';

interface AnnotationState {
  // SYNCED STATE
  annotations: Record<string, UserAnnotation>;
  
  // ACTIONS
  add: (annotation: Omit<UserAnnotation, 'id'>) => string;
  update: (id: string, updates: Partial<UserAnnotation>) => void;
  remove: (id: string) => void;
  getByBook: (bookId: string) => UserAnnotation[];
}

export const useAnnotationStore = create<AnnotationState>()(
  yjs(
    (set, get) => ({
      annotations: {},
      
      add: (annotation) => {
        const id = crypto.randomUUID();
        const newAnnotation: UserAnnotation = {
          ...annotation,
          id,
          createdAt: Date.now(),
          updatedAt: Date.now()
        };
        
        set((state) => ({
          annotations: {
            ...state.annotations,
            [id]: newAnnotation
          }
        }));
        
        return id;
      },
      
      update: (id, updates) => {
        set((state) => {
          if (!state.annotations[id]) return state;
          
          return {
            annotations: {
              ...state.annotations,
              [id]: {
                ...state.annotations[id],
                ...updates,
                updatedAt: Date.now()
              }
            }
          };
        });
      },
      
      remove: (id) => {
        set((state) => {
          const { [id]: removed, ...remaining } = state.annotations;
          return { annotations: remaining };
        });
      },
      
      getByBook: (bookId) => {
        const { annotations } = get();
        return Object.values(annotations)
          .filter(ann => ann.bookId === bookId)
          .sort((a, b) => a.createdAt - b.createdAt);
      }
    }),
    {
      doc: yDoc,
      name: 'annotations'
    }
  )
);
```

**Key Changes:**
- ✅ Removed `persist` middleware
- ✅ Wrapped with `yjs()` middleware (namespace: `'annotations'`)
- ✅ UUIDs ensure no conflicts across devices

## 4. Refactor: `usePreferencesStore`

**Current State (Phase 0):** Stores theme, font settings with `persist` middleware.

**Phase 2 Changes:** Wrap with `yjs()` to sync preferences across devices.

### Implementation

**File:** `src/store/usePreferencesStore.ts`

```typescript
import { create } from 'zustand';
import { yjs } from 'zustand-middleware-yjs';
import { yDoc } from './yjs-provider';

interface PreferencesState {
  // SYNCED STATE
  currentTheme: 'light' | 'dark' | 'sepia';
  customTheme: { bg: string; fg: string } | null;
  fontFamily: string;
  fontSize: number;
  lineHeight: number;
  shouldForceFont: boolean;
  
  // ACTIONS
  setTheme: (theme: 'light' | 'dark' | 'sepia') => void;
  setCustomTheme: (theme: { bg: string; fg: string } | null) => void;
  setFont: (font: string) => void;
  setFontSize: (size: number) => void;
  setLineHeight: (height: number) => void;
  toggleForceFont: () => void;
  reset: () => void;
}

const defaultPreferences = {
  currentTheme: 'light' as const,
  customTheme: null,
  fontFamily: 'serif',
  fontSize: 18,
  lineHeight: 1.6,
  shouldForceFont: false
};

export const usePreferencesStore = create<PreferencesState>()(
  yjs(
    (set) => ({
      ...defaultPreferences,
      
      setTheme: (theme) => set({ currentTheme: theme }),
      setCustomTheme: (theme) => set({ customTheme: theme }),
      setFont: (font) => set({ fontFamily: font }),
      setFontSize: (size) => set({ fontSize: size }),
      setLineHeight: (height) => set({ lineHeight: height }),
      toggleForceFont: () => set((state) => ({ shouldForceFont: !state.shouldForceFont })),
      reset: () => set(defaultPreferences)
    }),
    {
      doc: yDoc,
      name: 'preferences'
    }
  )
);
```

**Key Changes:**
- ✅ Removed `persist` middleware
- ✅ All preferences now sync across devices
- ✅ Middleware handles localStorage via `y-indexeddb`

## 5. Refactor: `useReadingStateStore` (Progress)

**Current State (Phase 0):** Stores current book progress.

**Phase 2 Changes:** Wrap with middleware, but use **per-book keying**.

### Implementation

**File:** `src/store/useReadingStateStore.ts`

```typescript
import { create } from 'zustand';
import { yjs } from 'zustand-middleware-yjs';
import { yDoc } from './yjs-provider';
import type { UserProgress } from '../types/db';

interface ReadingStateState {
  // SYNCED STATE (Record keyed by bookId)
  progress: Record<string, UserProgress>;
  
  // TRANSIENT STATE
  currentBookId: string | null;
  
  // ACTIONS
  updateLocation: (bookId: string, cfi: string, percentage: number) => void;
  setCurrentBook: (bookId: string | null) => void;
  getProgress: (bookId: string) => UserProgress | null;
}

export const useReadingStateStore = create<ReadingStateState>()(
  yjs(
    (set, get) => ({
      progress: {},
      currentBookId: null,
      
      updateLocation: (bookId, cfi, percentage) => {
        set((state) => ({
          progress: {
            ...state.progress,
            [bookId]: {
              bookId,
              currentCfi: cfi,
              percentage,
              lastRead: Date.now(),
              completedRanges: state.progress[bookId]?.completedRanges || []
            }
          }
        }));
      },
      
      setCurrentBook: (bookId) => set({ currentBookId: bookId }),
      
      getProgress: (bookId) => {
        const { progress } = get();
        return progress[bookId] || null;
      }
    }),
    {
      doc: yDoc,
      name: 'progress'
    }
  )
);

// Hook: Get progress for specific book
export const useBookProgress = (bookId: string | null) => {
  return useReadingStateStore(state => 
    bookId ? state.progress[bookId] || null : null
  );
};
```

**Key Changes:**
- ✅ Progress keyed by `bookId` (allows sync across all books)
- ✅ `currentBookId` is transient (device-specific)
- ✅ Middleware handles progress persistence

## 6. Migration Preparation: Static Metadata Hydration

Since `staticMetadata` is transient, we need to hydrate it on app mount.

**File:** `src/main.tsx` (or `App.tsx`)

```typescript
import { useEffect } from 'react';
import { useLibraryStore } from './store/useLibraryStore';
import { waitForYjsSync } from './store/yjs-provider';

function App() {
  useEffect(() => {
    const init = async () => {
      // Wait for Yjs to load from IndexedDB
      await waitForYjsSync();
      
      // Hydrate static metadata (covers, etc.) from IDB
      await useLibraryStore.getState().hydrateStaticMetadata();
    };
    
    init();
  }, []);
  
  return <>{/* Your app */}</>;
}
```

## 7. DBService Updates (Dismantling Write Logic)

**Goal:** Make `DBService` a **pure ingestion engine** for static data only.

### Method Changes

**File:** `src/db/DBService.ts`

#### `addBook` → Pure Ingestion

```typescript
async addBook(file: File): Promise<StaticBookManifest> {
  const metadata = await extractBookData(file);
  
  // Write ONLY static data (blobs, structure)
  const db = await this.getDB();
  const tx = db.transaction(['static_manifests', 'static_resources', 'static_structure'], 'readwrite');
  
  await tx.objectStore('static_manifests').put(metadata.manifest);
  await tx.objectStore('static_resources').put({ id: metadata.manifest.id, blob: file });
  await tx.objectStore('static_structure').put(metadata.structure);
  
  await tx.done;
  
  // Return manifest (caller writes to Yjs via store)
  return metadata.manifest;
}
```

#### Remove User Data Methods

```typescript
// DELETE these methods - handled by stores now
// - updateBookMetadata()
// - saveProgress()
// - addAnnotation()
// - deleteAnnotation()
// - updateUserInventory()
```

## 8. Component Updates (Minimal)

Components should already use selectors from Phase 0. No major changes needed.

### Example: `LibraryView.tsx`

```typescript
import { useAllBooks } from '../store/useLibraryStore';

function LibraryView() {
  const books = useAllBooks();  // Already implemented in Phase 0
  
  return (
    <div>
      {books.map(book => (
        <BookCard
          key={book.bookId}
          title={book.title}  // Uses staticMeta OR Ghost Book snapshot
          author={book.author}
          cover={book.coverBlob}  // null if Ghost Book
        />
      ))}
    </div>
  );
}
```

**Ghost Book Handling:**
- If `coverBlob` is `null`, UI shows placeholder + "Download from another device" icon
- Title and author come from Yjs snapshot

## 9. Verification Plan

1. **Unit Tests:** Update store tests to use fresh `Y.Doc` instances
2. **Integration Test:** 
   - Add book on Device A
   - Open DevTools → IndexedDB → `versicle-yjs` → Verify `library` map exists
   - Simulate sync (manually copy Yjs doc) to Device B
   - Verify book appears in library (as Ghost Book if blob missing)
3. **Conflict Test:**
   - Offline: Update book tags on Device A and B differently
   - Bring online: Verify LWW resolves correctly

## 10. Risks & Mitigations

| Risk | Mitigation |
| :--- | :--- |
| **Large TOC arrays synced** | Keep TOC in `useReaderUIStore` (transient, not wrapped with Yjs) |
| **Middleware overwrites initial state** | Don't rely on defaults in `create()` - check Yjs first |
| **Hydration lag** | Show loading state for covers; books display immediately with Ghost metadata |
| **Circular references** | Validate all data with Zod before setting state |

## 11. Phase 2 Success Criteria

- [ ] All stores wrapped with `yjs()` middleware
- [ ] `DBService` no longer writes user data
- [ ] Books sync across devices (Ghost Books display with metadata)
- [ ] Preferences sync across devices
- [ ] Progress syncs per book
- [ ] All tests pass with Yjs persistence
