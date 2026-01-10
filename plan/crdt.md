# Design Document: Versicle "Store-First" Architecture (Yjs)

**Status:** Draft
**Target Architecture:** Local-First / Store-First using Yjs & Zustand

## 1. The Core Architectural Shift

Currently, Versicle uses a "Database-First" architecture:
*   **State Source:** IndexedDB (`idb`) is the source of truth.
*   **Read:** Zustand stores (`useLibraryStore`, etc.) fetch data via `DBService` to populate their state.
*   **Write:** Actions call `DBService` to write to IDB, then manually update local state.

The Migration moves to a **"Store-First" (Local-First)** architecture:
*   **State Source:** The `Y.Doc` (held in memory and persisted via `y-indexeddb`) becomes the source of truth for user data.
*   **Read/Write:** Zustand stores read/write directly to the Yjs structure via `zustand-middleware-yjs`.
*   **Persistence:** The middleware and Yjs provider handle the saving to disk (IndexedDB) and syncing to peers automatically.

## 2. Data Segmentation Strategy

We separate data into two distinct categories to optimize performance. Yjs is excellent for JSON-serializable metadata but poor for large binary blobs.

### A. Remains in Legacy IDB (DBService)
These stores contain large files or reconstitutable cache. They are **not** migrated to Yjs.
*   `static_manifests` (Source of truth for immutable book metadata)
*   `static_resources` (The .epub blobs)
*   `static_structure` (TOC, Spine)
*   `cache_*` stores (Generated assets)

### B. Migrates to Yjs (User Data)
These will be removed from `DBService` write logic and handled strictly by Zustand+Yjs.
*   `user_inventory` → `Y.Map<BookId, InventoryItem>` (User-specific metadata like rating, added date)
*   `user_progress` → `Y.Map<BookId, ProgressItem>` (CFI, progress percentage)
*   `user_annotations` → `Y.Map<AnnotationId, Annotation>`
*   `user_overrides` → `Y.Map<BookId, Overrides>` (Lexicon rules, covers)
*   `user_journey` → `Y.Array<JourneyEntry>` (Append-only log)
*   `app_metadata` → `Y.Map<Key, Value>` (Settings)

## 3. High-Level Migration Plan

### Step 1: Initialize the Yjs Runtime
*   Create a central singleton `src/store/yjs-provider.ts`.
*   Initialize a single `Y.Doc`.
*   Connect `y-indexeddb` to persist this doc to a new IDB database (e.g., `versicle-yjs`).
*   (Future) Connect `y-webrtc` or similar for real-time sync.

### Step 2: Store Refactoring (Split & Bind)
`zustand-middleware-yjs` warns against mixing transient UI state with synced state.

**Refactoring `useReaderStore`:**
*   **Split into:**
    *   `useReaderUIStore` (Transient): `isLoading`, `viewMode`, `immersiveMode`, `toc`, `currentBookId`.
    *   `useReaderSyncStore` (Synced): `currentCfi`, `progress`, `customTheme`, `fontFamily`, `fontSize`, `lineHeight`.
*   **Binding:** `useReaderSyncStore` binds to a shared Y.Map named `reader-settings`.

**Refactoring `useLibraryStore`:**
*   **Structure:** Bind a `books` map to a Y.Map named `inventory`.
*   **Logic:** `addBook` calls `DBService` (for blobs) -> then mutates Zustand state (`set(state => ...)`). The middleware handles persistence.

**Refactoring `useAnnotationStore`:**
*   Bind to a Y.Map named `annotations`.
*   Use UUIDs as keys for fast lookups.

### Step 3: The "Great Migration" Script
*   Create a startup service (`MigrationService`).
*   **Check:** Is `inventory` in Yjs empty?
*   **If Empty:**
    *   Pull data from `DBService.getLibrary()`, `getAnnotations()`, etc.
    *   Batch insert into Zustand/Yjs stores.
*   **Cleanup:** (Optional) Delete old `user_*` IDB stores after verification.

### Step 4: Dismantling DBService Write Logic
*   **Keep:** `addBook` (blob processing), `deleteBook` (blob cleanup).
*   **Remove:** `updateBookMetadata`, `saveProgress`, `addAnnotation`, `saveContentAnalysis`.
*   **Update:** `addBook` returns metadata to the store; it does *not* write to `user_inventory`.

## 4. Key Challenges & Solutions

### Large Datasets (`user_journey`)
*   **Problem:** Infinite growth of history logs.
*   **Solution:** Use `Y.Array`. If performance degrades (>100k items), implement lazy loading or archiving to a separate IDB store.

### Referencing Static Assets
*   **Flow:**
    1.  `useLibraryStore` (Yjs) has Book ID `123`.
    2.  User opens book.
    3.  `useReaderUIStore` sets `currentBookId = 123`.
    4.  Component calls `dbService.getBookFile('123')` (Legacy IDB) for the blob.

### Conflict Resolution
*   **Strategy:** Last-Write-Wins (LWW) for scalar values (progress).
*   **Strategy:** Map keys (UUIDs) for distinct items (annotations) to prevent collisions.
