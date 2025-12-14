# Reading History Feature Plan

## User Journey
1.  **Reading**: The user opens a book and begins reading or listening via TTS.
2.  **Tracking**: As the user progresses (turns pages or scrolls), the application automatically records the segments of the text they have just read.
3.  **Visualization**:
    *   **Highlights**: Previously read sections are subtly highlighted in red within the text view to indicate coverage.
    *   **History Panel**: The user clicks the "History" (clock icon) button in the header to open a sidebar panel.
4.  **Navigation**: The panel lists reading sessions sorted by time. Clicking on an entry automatically navigates the reader to the **end point** of that segment, allowing the user to resume reading from where they left off.

## UX Design
*   **Passive Tracking**:
    *   Works in the background without user intervention.
    *   Triggered on navigation (e.g., clicking "Next Page"), saving the *previous* location range.
*   **Visual Cues**:
    *   **Red Highlights**: Rendered over text that has historically been read.
*   **History Panel**:
    *   **Access**: Toggle button with a Clock icon in the main reader header.
    *   **Layout**: Sidebar (right-aligned or overlay depending on screen size).
    *   **Content**: List of history entries. Each entry shows:
        *   **Timestamp**: Formatted date and time.
        *   **Context**: The Chapter title (resolved dynamically from the CFI).
    *   **Interaction**: The entire entry card is clickable. Clicking it jumps the reader to the end of the recorded range.

## Technical Implementation

### Data Model
New interface `ReadingHistoryEntry` in `src/types/db.ts`:
```typescript
export interface ReadingHistoryEntry {
    /** Unique ID for the history entry (UUID). */
    id: string;
    /** The ID of the book. */
    bookId: string;
    /** The CFI range of the read segment (e.g., "epubcfi(...)"). */
    cfi_range: string;
    /** Timestamp when this segment was recorded. */
    timestamp: number;
    /** Duration spent reading this segment (optional). */
    duration?: number;
}
```

### Storage (`src/db/`)
*   **Schema**: Upgraded IndexedDB to version 8. Added `reading_history` object store.
*   **DBService**:
    *   `addReadRange(bookId, cfiRange, duration)`: Saves a new entry.
    *   `getReadingHistory(bookId)`: Retrieves all entries for a book.
    *   `deleteBook(id)`: Updated to cascade delete associated reading history.

### Frontend Logic
*   **Hook**: `useReadingHistory(bookId)` in `src/hooks/useReadingHistory.ts`.
    *   Fetches and exposes `history` state.
    *   Provides `refreshHistory()` to update state after writes.
*   **Components**:
    *   `ReadingHistoryPanel.tsx`:
        *   Renders the list of entries.
        *   Accepts `getChapterTitle` prop to resolve spine/TOC labels from CFIs.
    *   `ReaderView.tsx`:
        *   **Tracking**: In `onLocationChange`, constructs the previous page's range and calls `dbService.addReadRange`.
        *   **Visualization**: Uses `rendition.annotations.add('highlight', ...)` to render red overlays for all history entries.
        *   **Integration**: Renders the `ReadingHistoryPanel` and manages its visibility state.
        *   **Helper**: Implements `getChapterTitle(cfi)` using `rendition.book.spine` and the Table of Contents to provide context for history entries.

### Verification
*   **Automated Test**: `verification/test_journey_reading_history.py` (integrated into test suite).
    *   Opens a book.
    *   Navigates pages to generate history.
    *   Opens the History Panel.
    *   Verifies entries are present.
