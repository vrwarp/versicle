# Design Document: Versicle "Store-First" Architecture (Yjs)

**Status:** Draft / Detailed Design
**Target Architecture:** Local-First / Store-First using Yjs & Zustand

## 1. The Core Architectural Shift

Currently, Versicle uses a **"Database-First"** architecture:
*   **State Source:** IndexedDB (`idb`) is the source of truth (`user_*` stores in `EpubLibraryDB`).
*   **Read:** Zustand stores (`useLibraryStore`, etc.) fetch data via `DBService` to populate their state.
*   **Write:** Actions call `DBService` to write to IDB, then manually update local state.

The Migration moves to a **"Store-First" (Local-First)** architecture:
*   **State Source:** The `Y.Doc` (held in memory and persisted via `y-indexeddb` to a *separate* IDB database named `versicle-yjs`) becomes the source of truth for user data.
*   **Read/Write:** Zustand stores read/write directly to the Yjs structure via `zustand-middleware-yjs`.
    *   *Note:* We will use the fork located at [https://github.com/vrwarp/zustand-middleware-yjs](https://github.com/vrwarp/zustand-middleware-yjs) which supports modern Zustand versions.
*   **Persistence:** The middleware and `y-indexeddb` provider handle the saving to disk and syncing to peers automatically.

## 2. Data Segmentation Strategy

We separate data into two distinct domains to optimize performance. Yjs is excellent for JSON-serializable metadata but poor for large binary blobs.

### A. Remains in Legacy IDB (DBService / `EpubLibraryDB`)
These stores contain large files or reconstitutable cache. They are **not** migrated to Yjs and remain managed by `src/db/DBService.ts`.
*   `static_manifests`: Immutable book metadata (Title, Author, Hash).
*   `static_resources`: The `.epub` binary blobs.
*   `static_structure`: TOC and Spine data (large arrays).
*   `cache_*`: Generated assets (`cache_render_metrics`, `cache_audio_blobs`, `cache_table_images`).

### B. Migrates to Yjs (User Data)
These will be removed from `DBService` *write logic* and handled strictly by Zustand+Yjs.

| Yjs Shared Type (Key) | Type | Corresponds to Legacy Store | Description |
| :--- | :--- | :--- | :--- |
| `inventory` | `Y.Map<string, UserInventoryItem>` | `user_inventory` | User metadata (rating, tags, status, addedAt). Key: `bookId`. |
| `reading_list` | `Y.Map<string, ReadingListEntry>` | `user_reading_list` | Persistent history of all books ever interacted with. Key: `filename`. |
| `progress` | `Y.Map<string, UserProgress>` | `user_progress` | Reading position (CFI, percentage). Key: `bookId`. |
| `annotations` | `Y.Map<string, UserAnnotation>` | `user_annotations` | Highlights and notes. Key: `annotationId` (UUID). |
| `overrides` | `Y.Map<string, UserOverrides>` | `user_overrides` | Lexicon rules and per-book settings. Key: `bookId` (or 'global'). |
| `journey` | `Y.Array<UserJourneyStep>` | `user_journey` | Reading history log. **Risk:** Potential unbound growth. |
| `settings` | `Y.Map<string, any>` | `app_metadata` | Global app settings (theme, font preference). |

## 3. Schema Definitions & Integrity

To ensure type safety, we will strictly type the Yjs maps using the existing interfaces from `src/types/db.ts`.

**Validation Strategy:**
Before writing to the `Y.Doc` (especially during sync/merge or migration), data must be validated against `Zod` schemas (to be created in `src/lib/sync/validators.ts`) or strictly typed interfaces.

### Shared Type Interfaces (Reference)

```typescript
// See src/types/db.ts for full definitions

type YjsSchema = {
  inventory: Y.Map<UserInventoryItem>;
  reading_list: Y.Map<ReadingListEntry>;
  progress: Y.Map<UserProgress>;
  annotations: Y.Map<UserAnnotation>;
  overrides: Y.Map<UserOverrides>;
  journey: Y.Array<UserJourneyStep>; // Append-only
  settings: Y.Map<any>;
}
```

## 4. High-Level Migration Plan

### Step 1: Initialize the Yjs Runtime
*   Create `src/store/yjs-provider.ts` singleton.
*   Initialize `Y.Doc`.
*   Connect `y-indexeddb` (Database: `versicle-yjs`).

### Step 2: Store Refactoring (Split & Bind)
*   **`useReaderStore`:** Split into `useReaderUIStore` (Transient) and `useReaderSyncStore` (Synced).
*   **`useLibraryStore`:** Bind `inventory` map. Remove `fetchBooks`.
*   **`useAnnotationStore`:** Bind `annotations` map.

### Step 3: The "Great Migration" Script
*   **Service:** `src/lib/migration/MigrationService.ts`.
*   **Logic:**
    1.  Check `app_metadata` (Legacy IDB) or `settings` (Yjs) for `migration_v2_status`.
    2.  If pending:
        *   Read all data from `user_*` stores in `EpubLibraryDB`.
        *   Batch write to `Y.Doc`.
        *   Set flag `migration_v2_status = 'complete'`.
    3.  (Future) Delete `user_*` stores from `EpubLibraryDB`.

### Step 4: Dismantling DBService Write Logic
*   **Modify `addBook`:** Returns `BookMetadata` instead of writing `user_inventory`.
*   **Remove:** `updateBookMetadata`, `saveProgress`, `addAnnotation`, `deleteAnnotation`.

## 5. Key Challenges & Solutions

### Large Datasets (`user_journey`)
*   **Problem:** `Y.Array` history grows indefinitely.
*   **Solution:** For Phase 1-3, we will migrate it as is. In Phase 4 (Optimization), we can implement a "Rolling Window" where items older than X months are archived to a local-only IDB store and removed from the Yjs array.

### Referencing Static Assets
*   **Flow:**
    1.  `useLibraryStore` (Yjs) provides `BookId`.
    2.  `useReaderUIStore` sets `currentBookId`.
    3.  Component calls `dbService.getBookFile(id)` (Legacy IDB) to get the Blob.
    *   *Constraint:* If `static_manifests` is missing the book (deleted from device but present in cloud sync), the UI must show a "Download" state.

### Conflict Resolution
*   **Inventory/Progress:** `Y.Map` uses Last-Write-Wins (LWW) based on Lamport timestamps.
*   **Annotations:** Keyed by UUID. No merge conflicts, only add/remove races (handled by CRDT set semantics).

## Execution Log

### Phase 1: Foundation & Dependencies (Completed)
*   **Installed Dependencies:** `yjs`, `y-indexeddb`, and `zustand-middleware-yjs` (fork).
*   **Implemented Provider:** Created `src/store/yjs-provider.ts` exporting the singleton `yDoc` and `persistence`.
*   **Validation:** Added unit tests (`src/store/yjs-provider.test.ts`) to verify singleton export and sync waiting logic.
*   **Status:** The Yjs runtime is initialized and persisting to a separate IndexedDB database (`versicle-yjs`).
