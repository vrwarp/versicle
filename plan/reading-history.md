# Reading History Feature Plan

## User Journey
1.  **Reading**: The user opens a book and begins reading or listening via TTS.
2.  **Tracking**: As the user progresses, the application automatically tracks the specific portions of the text that have been displayed (in the viewport) or spoken (by TTS).
3.  **Jumping Around**: The user skips to a different chapter, reads a bit, then goes back. The system records these disjointed segments.
4.  **Visualization**: The user can see a list of reading sessions/segments in a dedicated panel.
    *   **History Panel**: A sidebar or popup listing reading history segments sorted by time.
    *   **Navigation**: Clicking an entry allows the user to jump to the **end point** of that segment (to resume reading).
    *   **Visual highlights** in the text view are also maintained as a secondary cue.

## UX Design
*   **Passive Tracking**: The feature works in the background without user intervention.
*   **History Panel**:
    *   Accessible via a clock/history icon in the reader header.
    *   Lists entries with:
        *   Relative time (e.g., "Just now", "2 hours ago").
        *   Context (e.g., Chapter title or text snippet, if available).
        *   "Resume" action (jump to the end of the range).
*   **Granularity**: Tracking is done at the CFI range level.

## Technical Design

### Data Model
New interface `ReadingSession` (or `ReadingHistory`) in `src/types/db.ts`:
```typescript
export interface ReadingHistoryEntry {
  bookId: string;
  /**
   * A list of combined CFI ranges representing read content.
   * e.g., ["epubcfi(/6/2!/4/1:0,/4/1:100)", "epubcfi(/6/6!/4/1:0,/4/1:50)"]
   */
  readRanges: string[];
  lastUpdated: number;
}
```

### Storage (`src/db/DBService.ts`)
*   New object store `reading_history` in IndexedDB.
*   Methods:
    *   `getReadingHistory(bookId: string): Promise<string[]>`
    *   `updateReadingHistory(bookId: string, newRange: string): Promise<void>`
        *   This method will need to fetch existing ranges, merge the new range with overlapping/adjacent existing ranges, and save the result.

### Logic (`src/lib/history-manager.ts` or similar)
*   **Range Merging**: A utility function is needed to merge CFI ranges. `epub.js` provides `EpubCFI` class which can help compare positions, but merging disjoint ranges might need custom logic.
    *   Logic:
        1.  Parse all ranges.
        2.  Sort ranges by start position.
        3.  Iterate and merge overlapping or adjacent ranges.
*   **Tracking Source**:
    *   **Visual Reading**: Use `useEpubReader` or `ReaderView` to track what is currently in the viewport. This is tricky because "in viewport" doesn't mean "read". A better proxy might be "scrolled past" or "spent time on".
    *   **TTS**: Use `AudioPlayerService` to track spoken sentences. This is more precise.
    *   **Initial Scope**: Focus on tracking **TTS progress** and **manual page turns/scrolls** (marking the page/screen as read when navigated away or after a delay).

### Integration
1.  **Database**: Update `DBService` to handle `ReadingHistoryEntry`.
2.  **Store**: Create `useHistoryStore` or extend `useReaderStore` to manage current session history.
3.  **Components**:
    *   Update `ReaderView` to report progress.
    *   Update `AudioPlayerService` to report progress.

## Implementation Steps
1.  **Define Types**: Add `ReadingHistoryEntry` to `src/types/db.ts`.
2.  **Update DBService**: Add `reading_history` store and methods to `DBService.ts`.
3.  **Implement Merging Logic**: Create `src/lib/cfi-utils.ts` to handle CFI range merging.
4.  **Hook up Tracking**:
    *   In `AudioPlayerService`: When a sentence completes, add its range to history.
    *   In `ReaderView`: When the user navigates (page turn or scroll), add the *previous* visible range to history.
5.  **Verify**: Create a test to verify ranges are merged correctly.

## Pre-commit Steps
*   Run linting.
*   Run build.
*   Run verification tests.
