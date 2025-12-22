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

9\. Implementation Notes
-----------------------

### Deviations & Discoveries

1.  **TTS History Tracking Location:**
    -   Initially planned to implement tracking in `ReaderTTSController`.
    -   **Deviation:** Moved tracking logic to `AudioPlayerService` (`src/lib/tts/AudioPlayerService.ts`).
    -   **Reason:** `ReaderTTSController` is a UI component and unmounts when navigating away from the reader (e.g., to the library), which stops history tracking during background playback. `AudioPlayerService` is a singleton service that persists, ensuring reliable tracking of background audio sessions.

2.  **TTS Coverage vs. Sessions:**
    -   Implemented a `skipSession` flag in `updateReadingHistory` (`src/db/DBService.ts`).
    -   `AudioPlayerService` updates *coverage* (`readRanges`) continuously as sentences complete (with `skipSession: true`).
    -   It creates a *session* (timeline entry) only when playback is Paused or Stopped.
    -   This prevents history spam (one entry per sentence) while maintaining accurate coverage data.

3.  **Coalescing Logic:**
    -   Implemented coalescing for `scroll` and `page` events within 5 minutes in `DBService`.
    -   Explicitly excluded `tts` events from coalescing in `DBService` (when `skipSession` is false), as they are now discrete "Pause/Stop" events.

4.  **Database Migration:**
    -   Bumped Database version to 11 in `src/db/db.ts`.
    -   Added logic to clear `reading_history` store on upgrade to ensure clean state and enforce semantic boundaries.

5.  **Snap Logic:**
    -   `snapCfiToSentence` (`src/lib/cfi-utils.ts`) uses `Intl.Segmenter` for robust sentence boundary detection, falling back to original CFI if unavailable.
    -   Added `getRange` to `epubjs` type definition (`src/types/epubjs.d.ts`).

6.  **Verification:**
    -   Created `verification/verify_event_history.py` to end-to-end test the history generation, icon rendering, and label correctness using Playwright.
