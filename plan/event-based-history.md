Design Doc: Semantic Reading History & Event Tracking
=====================================================

1\. Problem Statement
---------------------

Currently, the application tracks reading history by saving the raw CFI range of the visible viewport whenever the user stops reading. This leads to two major issues:

1.  **Visual Fragmentation:** Because the viewport often cuts off text mid-sentence, the generated "read" highlights (grey outlines) appear jagged and end abruptly in the middle of lines.

2.  **Contextless History:** The history list is a flat collection of ranges without context. It does not distinguish between listening to TTS, scrolling through a chapter, or deliberately turning a page.

2\. Goals
---------

-   **Sentence Alignment:** All history entries and highlights must snap to the nearest semantic boundary (sentence start/end) to ensure clean visual indicators.

-   **Rich Event Context:** Track the *mode* of reading (TTS, Scroll, Page Turn) to provide a meaningful timeline of the user's journey.

-   **Noise Reduction:** Implement intelligent coalescing for scroll events to prevent history spam while maintaining precision for TTS and Page turns.

3\. Core Concepts
-----------------

### 3.1. The "Semantic Snap"

The fundamental rule of this refactor is that **no raw CFI from the renderer is ever saved directly**. All coordinates must pass through a "Snapper" that expands the selection to the nearest sentence boundary.

-   **Input:** `epubcfi(.../4/2[chapter1]!/4/1:453)` (Mid-sentence)

-   **Output:** `epubcfi(.../4/2[chapter1]!/4/1:420)` (Start of "It was the best of times...")

### 3.2. Timeline vs. Coverage

We separate the concept of "Where I was" (Timeline) from "What I read" (Coverage).

-   **Timeline (Events):** A chronological list of specific points in time. Used for the History Panel allowing users to jump back to previous states.

-   **Coverage (Highlights):** A merged set of ranges representing consumed content. Used to render the grey "read" outlines on the page.

4\. Data Model Changes
----------------------

We will enhance the `ReadingSession` interface in `src/types/db.ts` to support typed events.

```
export type ReadingEventType = 'tts' | 'scroll' | 'page';

export interface ReadingSession {
  /** The snapped CFI range associated with this event. */
  cfiRange: string;

  /** Timestamp of the event. */
  timestamp: number;

  /** The source of the reading event. */
  type: ReadingEventType;

  /** * Contextual label for the event.
   * - TTS: The text of the sentence (e.g., "Call me Ishmael.")
   * - Page/Scroll: The chapter title or progress (e.g., "Chapter 1 - 15%")
   */
  label?: string;
}

// The ReadingHistoryEntry structure remains largely the same,
// but 'readRanges' will now exclusively store "Coverage" data.
export interface ReadingHistoryEntry {
  bookId: string;
  readRanges: string[]; // Merged coverage (for highlights)
  sessions: ReadingSession[]; // Rich timeline (for UI)
  lastUpdated: number;
}

```

5\. Architectural Logic
-----------------------

### 5.1. Capture Strategies

Different reading modes require different triggers and capture logic.

-   **TTS Mode:** Triggered by a state change to `Paused` or `Stopped`. The capture target is the `activeCfi` (the current sentence). No snapping rule is needed because TTS is already sentence-aligned.

-   **Page Mode:** Triggered by the `relocated` event from Epub.js. The capture target is `currentView.start`, which must be snapped to the start of the first visible sentence.

-   **Scroll Mode:** Triggered by a Dwell Timer that fires after remaining static for more than 2 seconds. The capture target is `currentView.start`, which also must be snapped to the start of the first visible sentence.

### 5.2. The Coalescing Strategy (Anti-Spam)

To keep the history useful, we must avoid creating a new entry for every minor scroll adjustment.

**Logic:** When a new event `E_new` arrives:

1.  Get the last recorded session `E_last`.

2.  **IF** `E_last.type` == `E_new.type` (e.g., both are 'scroll')

3.  **AND** `E_new.timestamp - E_last.timestamp < 5 minutes`

4.  **THEN**: **Update** `E_last` with `E_new`'s location and timestamp.

5.  **ELSE**: **Push** `E_new` as a new session.

*Exception:* **TTS events are never coalesced** if the user manually pauses/stops, as these represent deliberate "bookmarks". Page turns might be coalesced if they happen rapidly (skimming), but usually warrant distinct entries.

### 5.3. Coverage Merging

While the *Timeline* tracks distinct points, the *Coverage* tracks the ground covered.

-   **Visual Reading:** When saving a session (Start A -> End B), we snap *both* A and B to sentence boundaries, generate a range, and merge it into `readRanges`.

-   **TTS:** As TTS completes sentences, we accumulate them. When the session ends, we merge the total range covered into `readRanges`.

6\. Component Updates
---------------------

### 6.1. `src/lib/cfi-utils.ts`

-   **New Function:** `snapCfiToSentence(book, cfi): Promise<string>`

    -   Uses `book.getRange(cfi)` to get DOM nodes.

    -   Uses `Intl.Segmenter` (or robust regex fallback) to identify sentence boundaries within the text node.

    -   Returns the CFI pointing to the start of the sentence.

### 6.2. `src/components/reader/ReaderView.tsx`

-   **Modification:** In `onLocationChange`:

    -   Check `viewMode`. If `scrolled`, apply **Dwell Timer** logic. If `paginated`, act immediately.

    -   Call `snapCfiToSentence` on `location.start`.

    -   Call `dbService.updateReadingHistory` with the *snapped* CFI and appropriate type (`scroll` or `page`).

### 6.3. `src/components/reader/ReaderTTSController.tsx`

-   **Modification:** Add effect listening to `status`.

    -   On transition to `paused` or `stopped`:

    -   Take `activeCfi` (current sentence).

    -   Call `dbService.updateReadingHistory(..., 'tts')`.

### 6.4. `src/components/reader/ReadingHistoryPanel.tsx`

-   **UI Refresh:**

    -   Replace generic list with an icon-driven timeline.

    -   **Icons:** `Headphones` (TTS), `BookOpen` (Page), `ScrollText` (Scroll).

    -   **Labels:** Use the `label` field if available, or generate from CFI (e.g., "Chapter 5").

    -   **Click Action:** Jumps to the start of that semantic segment.

7\. Migration & Compatibility
-----------------------------

-   **Strategy:** **Database Version Bump.**

    -   We will increment the database version in `src/db/db.ts`.

    -   Inside the `upgrade` callback, we will specifically target the `reading_history` object store.

    -   We will execute `transaction.objectStore('reading_history').clear()` to wipe all existing, non-semantic history data.

    -   This guarantees a clean state for all users immediately upon updating, removing all legacy, jagged highlights and ensuring all new history entries are fully sentence-aligned.

8\. Implementation Phases
-------------------------

1.  **Foundation:** Update `ReadingSession` interface and `DBService` to accept types and implement coalescing.

2.  **Logic:** Implement `snapCfiToSentence` in `cfi-utils`.

3.  **Integration (Visual):** Wire up `ReaderView` to use the snapper and report `scroll`/`page` events.

4.  **Integration (TTS):** Wire up `ReaderTTSController` to report `tts` events.

5.  **UI:** Update `ReadingHistoryPanel` to visualize the rich data.

6.  **Migration:** Bump DB version and add the clear logic in `src/db/db.ts`.

## Execution Report

### Implementation Details
The plan was executed successfully across all phases.

1.  **Foundation**:
    - Updated `src/types/db.ts` to include `ReadingEventType` and modified `ReadingSession` (added `type`, `label`) and `ReadingHistoryEntry` (made `sessions` mandatory).
    - Updated `src/db/DBService.ts` to support the new `updateReadingHistory` signature (`type`, `label`) and implemented the coalescing logic (update existing session if same type and < 5 mins).

2.  **Logic**:
    - Implemented `snapCfiToSentence` in `src/lib/cfi-utils.ts` using `Intl.Segmenter` (with fallback) to align CFIs to sentence starts. This ensures clean visual highlights.

3.  **Integration (Visual)**:
    - Modified `src/components/reader/ReaderView.tsx` to use a `useEffect` hook monitoring location changes (`currentCfi`).
    - Implemented Dwell Timer logic: 2s delay for scroll mode, 0.5s debounce for paginated mode (to handle rapid page turns).
    - Removed legacy "save on unmount" logic to strictly enforce dwell times and prevent accidental saves.

4.  **Integration (TTS)**:
    - Updated `src/components/reader/ReaderTTSController.tsx` to capture TTS events.
    - Triggered on transition from `playing`/`buffering` to `paused`/`stopped`.
    - Captures the active sentence and uses the sentence text as the label.

5.  **UI**:
    - Rewrote `src/components/reader/ReadingHistoryPanel.tsx` to display the new event-based history.
    - Added icons (`Headphones`, `BookOpen`, `ScrollText`) and relative timestamps.
    - Improved label resolution logic to gracefully handle missing TOC data.

6.  **Migration**:
    - Bumped database version to 11 in `src/db/db.ts`.
    - Added migration logic to clear the `reading_history` object store, ensuring a clean slate for the new semantic history system.

### Verification
-   **Unit/Integration Tests**: Updated `ReadingHistoryPanel.test.tsx` and `ReadingHistoryIntegration.test.tsx` to align with the new data model and logic. All tests passed.
-   **Frontend Verification**: Performed manual verification using a Playwright script (`verification/verify_history.py`) and screenshots. Confirmed that history entries are created, coalesced correctly (single entry for continuous reading), and displayed with correct metadata in the UI.

### Deviations
-   **Unmount Behavior**: The original plan implied saving on unmount. I chose to clear the timer on unmount instead. This ensures that if a user quickly opens and closes a book (or scrolls and immediately exits), it is not recorded as a reading session, adhering strictly to the "dwell" concept.
-   **Label Fallback**: Enhanced the label generation in `ReadingHistoryPanel` to look up chapter titles via `book.navigation` if `book.spine` metadata is incomplete, providing better context for history entries.
