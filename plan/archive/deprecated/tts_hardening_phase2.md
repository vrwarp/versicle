# Phase 2: Data Persistence & Session Snapshots (COMPLETED)

## Objective
Decouple playback from the `epub.js` rendering lifecycle to enable "Instant Resume" and protect against data loss on page reloads.

## Implementation Details

### 1. Persistent Queue Store
*   **Action:** Added `tts_queue` object store to IndexedDB.
*   **Schema:**
    *   `bookId` (Key)
    *   `queue`: `TTSQueueItem[]`
    *   `currentIndex`: number
    *   `updatedAt`: timestamp
*   **Logic:**
    *   `AudioPlayerService.persistQueue()` writes to IDB (debounced via `DBService.saveTTSState`) whenever `setQueue` or `currentIndex` changes.

### 2. Hydration Strategy
*   **Action:** Updated `AudioPlayerService.setBookId()`.
*   **Flow:**
    1.  `AudioPlayerService.setBookId(id)` triggers `restoreQueue(id)`.
    2.  `restoreQueue` loads persisted queue from IDB and populates `this.queue` immediately.
    3.  `useTTS` hook connects later when `epub.js` renders. It generates sentences.
    4.  **Reconciliation:** `AudioPlayerService.setQueue()` checks `isQueueEqual()`.
        *   If match (text & CFI): Ignores update, preserving `currentIndex` and playback state.
        *   If mismatch: Overwrites queue and resets index.

### 3. "Snapshot" Recovery
*   **Structure:**
    ```typescript
    interface TTSState {
      bookId: string;
      queue: TTSQueueItem[];
      currentIndex: number;
      updatedAt: number;
    }
    ```
*   **Usage:**
    *   On app launch, `ReaderView` calls `setBookId` which triggers restoration.
    *   Playback can resume instantly even before `useTTS` extracts text.

### 4. Implementation Notes
*   **Concurrency:** All persistence operations (`restoreQueue`, `persistQueue`) are protected by `executeWithLock` or internal logic to prevent race conditions.
*   **Verification:**
    *   `src/lib/tts/AudioPlayerService_SmartResume.test.ts` validates Smart Resume logic.
    *   `verification/test_journey_tts_persistence.py` confirms end-to-end persistence across page reloads.

## Risks & Mitigations
*   **Stale Data:** If content changes, `isQueueEqual` will return false, causing a fresh queue load.
*   **Race Conditions:** `executeWithLock` ensures sequential execution of queue updates and restoration.

## Status
*   **Completed:** Yes.
*   **Verified:** Yes.
