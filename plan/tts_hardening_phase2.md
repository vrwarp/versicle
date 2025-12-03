# Phase 2: Data Persistence & Session Snapshots

## Objective
Decouple playback from the `epub.js` rendering lifecycle to enable "Instant Resume" and protect against data loss on page reloads.

## Implementation Details

### 1. Persistent Queue Store
Currently, `queue` is memory-only. We will move it to IndexedDB.
*   **Action:** Add a `tts_queue` object store (or use existing `books` metadata if size permits).
*   **Schema:**
    *   `bookId` (Key)
    *   `items`: `TTSQueueItem[]`
    *   `currentIndex`: number
    *   `updatedAt`: timestamp
*   **Logic:**
    *   Whenever `setQueue` or `next/prev` updates the index, write to IDB (debounced).

### 2. Hydration Strategy
*   **Action:** Modify `AudioPlayerService.play()` (restoration logic).
*   **Current Flow:** Check `lastPlayedCfi` -> Wait for `useTTS` to extract -> Find CFI in new Queue -> Play.
*   **New Flow:**
    1.  `AudioPlayerService.init()` loads persisted queue for `currentBookId`.
    2.  If persisted queue exists, populate memory immediately.
    3.  `useTTS` hook connects. It generates sentences.
    4.  **Reconciliation:** Compare generated sentences with persisted queue.
        *   If match: Do nothing (keep playing).
        *   If mismatch (content changed): Update queue and notify user/handle gracefully.

### 3. "Snapshot" Recovery
This allows us to save the *exact* state of the engine.
*   **Structure:**
    ```json
    {
      "bookId": "uuid",
      "queue": [...],
      "index": 42,
      "audioState": { "currentTime": 12.5, "rate": 1.5 },
      "timestamp": 123456789
    }
    ```
*   **Usage:**
    *   On app launch, check for a "Hot Snapshot".
    *   If found (and recent < 15 mins), restore completely without waiting for user action.

### 4. Implementation Plan
1.  **DB Schema Update:** Add `queue` field to `BookMetadata` or a separate store.
2.  **Service Update:**
    *   `saveState()`: Writes queue + index to DB.
    *   `restoreState(bookId)`: Loads queue + index.
3.  **Hook Update (`useTTS`):**
    *   On mount, check if `player.hasQueue(bookId)`. If yes, don't overwrite empty queue immediately.
    *   Only overwrite if `extractedSentences` differ significantly or user navigates to a new chapter.

## Risks
*   **Stale Data:** If the book content changes (e.g., editing/re-importing), the persisted queue is invalid. We need a hash check (content checksum) to invalidate the queue.
*   **Storage Size:** Large chapters could bloat IDB. We might limit queue to "Current Chapter +/- 1".

## Verification
*   **Automated:** Test `restoreState` populates queue correctly.
*   **Manual:**
    1.  Start playing a book.
    2.  Hard refresh the page.
    3.  Verify playback is ready *immediately* (before book renders).
