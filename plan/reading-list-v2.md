# Reading List v2 Plan

## Context
The Reading List feature is intended to be a lightweight, portable record of reading history (Title, Author, ISBN, Progress) that persists even if the book files are deleted.

The v18+ architecture removed the dedicated `reading_list` store, migrating data to `user_inventory`. However, this broke the ability to import reading history for books that are not physically present in the library ("Ghost Books"). A previous attempt using "Shell Books" (placeholder inventory items) was rejected as it cluttered the main library view.

## Goal
Restore the original design where the **Reading List** is a distinct, persistent store separate from the **Library Inventory**.

## Architecture: Dedicated Store

### 1. New Store: `user_reading_list`
We will re-introduce a store to the `EpubLibraryDB` schema (v21).
- **Store Name**: `user_reading_list`
- **Key**: `filename` (matches `user_inventory.sourceFilename`)
- **Value**: `ReadingListEntry`
  ```typescript
  interface ReadingListEntry {
      filename: string;
      title: string;
      author: string;
      isbn?: string;
      percentage: number;
      lastUpdated: number;
      status?: 'read' | 'currently-reading' | 'to-read';
      rating?: number;
  }
  ```

### 2. Synchronization Strategy

The `ReadingListDialog` views `user_reading_list`. The `LibraryView` views `user_inventory`. They are kept in sync via the following rules:

#### A. Live Sync (Read -> List)
When the user reads a book (`saveProgress`):
1.  Update `user_progress` (as usual).
2.  **Upsert** the entry to `user_reading_list`.
    -   This ensures that any book read in the library is automatically backed up to the history list.

#### B. Restore Sync (List -> Read / Import)
When the user imports a CSV or manually updates a reading list entry (`upsertReadingListEntry`):
1.  **Upsert** to `user_reading_list` (always).
2.  **Check** `user_inventory` for a matching `sourceFilename`.
3.  **If Found** (Book exists in Library):
    -   Update `user_inventory` (Status, Rating).
    -   Update `user_progress` *if* the imported percentage is higher than the current local percentage ("Highest Wins").
4.  **If Not Found** (Ghost Book):
    -   **Stop.** Do *not* create a "Shell Book" in `user_inventory`.
    -   The entry remains in `user_reading_list` and is visible in the `ReadingListDialog`, but does not clutter the Library.

#### C. Persistence
-   **`deleteBook` (Library)**: Deleting a book from the Library (Inventory) must **NOT** delete the corresponding entry from `user_reading_list`. This preserves history.
-   **`deleteReadingListEntry` (List)**: Deleting an entry from the Reading List Dialog must **only** delete from `user_reading_list`. It should *not* delete the book from the Library. (This is a change from previous behavior which nuked the book; separation means separation).

## Implementation Details

### Migration (v21)
On upgrade to v21, we must populate `user_reading_list` to prevent data loss (or rather, "history loss") for existing users.
-   Iterate all `user_inventory`.
-   Join with `user_progress` and `static_manifests`.
-   Create corresponding `ReadingListEntry` in `user_reading_list`.

### DBService Updates
-   `getReadingList`: Query `user_reading_list` directly.
-   `upsertReadingListEntry`: Implement the "Restore Sync" logic.
-   `saveProgress`: Add the "Live Sync" side-effect.
-   `deleteBook`: Remove the logic that touches reading list.
-   `deleteReadingListEntry`: Only delete from reading list.

## Risks
-   **Filename Collisions**: Using `filename` as a primary key works for restoring *file-based* history, but if a user has two different books with the same filename (rare but possible), they might overwrite each other's history. This is an acceptable trade-off for the "Restore" capability which relies on filename matching.
-   **Stale Data**: If a user updates metadata (Title/Author) in the Library, it might not immediately reflect in `user_reading_list` unless we hook into `updateBookMetadata` as well.
    -   *Mitigation*: We should add a hook in `updateBookMetadata` to sync changes to `user_reading_list` if the entry exists.
