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
*   **Read/Write:** Zustand stores are **wrapped** with `zustand-middleware-yjs` middleware. The middleware automatically:
    *   Creates and manages `Y.Map` instances under a namespace
    *   Syncs Zustand state ↔ Yjs bidirectionally
    *   Handles conflict resolution (LWW for objects, CRDT merging for arrays)
    *   Filters out functions (actions remain local-only)
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

| Middleware Namespace | Zustand Store State Shape | Corresponds to Legacy Store | Description |
| :--- | :--- | :--- | :--- |
| `library` | `{ books: Record<string, UserInventoryItem> }` | `user_inventory` | User metadata (rating, tags, status). **Must snapshot** `title` and `author` for Ghost Book display. Middleware creates `yDoc.getMap('library')` automatically. |
| `reading-list` | `{ entries: Record<string, ReadingListEntry> }` | `user_reading_list` | Persistent history of all books ever interacted with. Key: `filename`. |
| `progress` | `{ progress: Record<string, UserProgress> }` | `user_progress` | Reading position (CFI, percentage). Key: `bookId`. |
| `annotations` | `{ annotations: Record<string, UserAnnotation> }` | `user_annotations` | Highlights and notes. Key: `annotationId` (UUID). |
| `overrides` | `{ overrides: Record<string, UserOverrides> }` | `user_overrides` | Lexicon rules and per-book settings. Key: `bookId` (or 'global'). |
| `journey` | `{ steps: UserJourneyStep[] }` | `user_journey` | Reading history log. Array synced as `Y.Array`. **Risk:** Unbound growth. |
| `preferences` | `{ theme: string, fontSize: number, ... }` | `app_metadata` + `useReaderStore` | Global app settings (theme, font preference). |

### C. Garbage Collection & Consistency (Static vs Inventory)
Since `static_resources` (Blobs) and `inventory` (Metadata) live in separate stores (IDB vs Yjs), desynchronization is possible (e.g., Book deleted on Device A -> Syncs deletion to Device B's Inventory -> Device B still has Blob).

**Strategy:**
*   **Routine:** A "Garbage Collector" runs on app startup or after Yjs sync events.
*   **Logic:**
    1.  Get all keys from `static_resources` (IDB).
    2.  Get all keys from `inventory` (Yjs).
    3.  **Diff:** If `IDB_Key` exists but `Yjs_Key` is missing (and not in `static_manifests` whitelist if applicable), **DELETE** the blob from IDB.
*   **Safety:** Ensure the GC only runs when Yjs is fully synced to avoid accidental deletion during initial sync download.

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

### Step 2: Store Refactoring (Wrap with Middleware)
*   **`useLibraryStore`:** Wrap with `yjs()` middleware (namespace: `'library'`). Keep `books: Record<string, UserInventoryItem>`.
*   **`useAnnotationStore`:** Wrap with `yjs()` middleware (namespace: `'annotations'`).
*   **`usePreferencesStore`:** Wrap with `yjs()` middleware (namespace: `'preferences'`). Contains theme, font settings.
*   **`useReadingStateStore`:** Keep progress tied to `bookId`. Wrap with middleware (namespace: `'progress'`).
*   **Note:** Phase 0 already split stores correctly. Phase 2 adds middleware wrapping.

### Step 3: Simplified Migration
*   **Service:** `src/lib/migration/YjsMigration.ts`.
*   **Logic:**
    1.  Check if `yDoc.getMap('preferences').get('migration_complete')` is true.
    2.  If false AND Yjs maps are empty (first device):
        *   Read all data from `user_*` stores in `EpubLibraryDB`.
        *   Use **store actions** to populate data (e.g., `useLibraryStore.setState()`).
        *   Middleware automatically syncs to Yjs.
        *   Set `migration_complete = true`.
    3.  If Yjs already has data (synced from another device), skip migration.

### Step 4: Dismantling DBService Write Logic
*   **Modify `addBook`:** Returns `BookMetadata` instead of writing `user_inventory`.
*   **Remove:** `updateBookMetadata`, `saveProgress`, `addAnnotation`, `deleteAnnotation`.

## 5. Key Challenges & Solutions

### Large Datasets (`user_journey`)
*   **Problem:** `Y.Array` history grows indefinitely.
*   **Solution:** For Phase 1-3, we will migrate it as is. In Phase 4 (Optimization), we can implement a "Rolling Window" where items older than X months are archived to a local-only IDB store and removed from the Yjs array.

### Referencing Static Assets (The "Ghost Book" Problem)
*   **Problem:** Yjs syncs the `inventory` (Book ID), but the `static_manifests` (Title, Cover) and `static_resources` (EPUB Blob) live in IDB and do not sync automatically.
*   **Result:** A new device sees a Book ID but has no title or cover to display.
*   **Solution:** 
    1.  **Mirror Metadata:** `inventory` map in Yjs MUST include `title`, `author`, and potentially a `coverHash` (or tiny thumbnail base64 if essential, but avoid bloat).
    2.  **UI Handling:** If `static_resource` is missing, the UI renders the book using the Yjs mirrored metadata with a "Cloud / Download" icon.
    3.  **Blob Re-acquisition:** The user must manually re-import or (in future) peer-to-peer transfer the blob to restore read functionality.

### Conflict Resolution
*   **Inventory/Progress:** `Y.Map` uses Last-Write-Wins (LWW) based on Lamport timestamps.
*   **Annotations:** Keyed by UUID. No merge conflicts, only add/remove races (handled by CRDT set semantics).
