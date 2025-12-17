# Design Document: Linear List Display (Library)

## 1. Introduction
This document outlines the technical design for the "Linear List Display" feature proposed in Design Sprint 4. The goal is to provide an alternative, high-density view for the library to facilitate management of large collections.

## 2. Requirements Analysis
*   **View Toggle**: A persistent toggle between "Grid" and "List" views in the library header.
*   **List Layout**: A vertical list of books displaying:
    *   Small Cover Thumbnail (Fixed aspect ratio)
    *   Title (Bold, truncated if necessary)
    *   Metadata Line: Author • Progress • File Size
    *   Actions: Context menu (same as Grid).
*   **Interaction**: Single tap to open, long press (or menu button) for actions. Swipe gestures on mobile (nice to have, but starting with click/tap parity).
*   **Persistence**: The view preference must be saved across sessions.

## 3. Architecture & Data Model

### 3.1. Database Schema Updates (`src/types/db.ts`)
To fully support the requested metadata display, the `BookMetadata` interface requires expansion. Currently, it lacks `fileSize`.

```typescript
export interface BookMetadata {
  // ... existing fields
  fileSize?: number; // In bytes
}
```
*Note: Populating this new field requires updates to the ingestion logic (`src/lib/ingestion.ts`). For existing books, this field will be undefined, and the UI must handle it gracefully.*

### 3.2. State Management (`src/store/useLibraryStore.ts`)
The view preference should be stored in the library store (or UI store) and persisted.

*   **Store**: `useLibraryStore`
*   **State**: `viewMode: 'grid' | 'list'`
*   **Action**: `setViewMode(mode: 'grid' | 'list')`
*   **Persistence**: Already handled by `persist` middleware in `useLibraryStore`.

### 3.3. Component Structure

#### 3.3.1. `LibraryView` Refactor
The `LibraryView` component will be refactored to conditionally render either the existing `Grid` or the new `List` implementation based on `viewMode`.

*   **Grid Mode**: Retains existing `react-window` `Grid` logic.
*   **List Mode**: Utilizes `react-window` `FixedSizeList` for performance with large collections.

#### 3.3.2. `BookListItem` Component
A new component `BookListItem` will be created to render individual rows.

*   **Props**: `book: BookMetadata`, `style: CSSProperties` (for virtualization).
*   **Layout**: Flexbox row.
    *   **Left**: Thumbnail (`img` or placeholder). ~40-50px width.
    *   **Center**: Column flex.
        *   Title (SemiBold).
        *   Metadata (Text-muted-foreground, smaller). Logic to join `author`, `progress`, `fileSize` with separators.
    *   **Right**: `MoreVertical` menu button (reusing the logic from `BookCard`).

## 4. Implementation Steps

1.  **Update Types**: Modify `BookMetadata` in `src/types/db.ts`.
2.  **Update Ingestion**: Modify `src/lib/ingestion.ts` to extract file size (trivial) during import.
3.  **Update Store**: Add `viewMode` to `useLibraryStore`.
4.  **Create Component**: Implement `BookListItem.tsx`.
5.  **Refactor Library**: Update `LibraryView.tsx` to include the toggle button in the header and switch between `Grid` and `FixedSizeList`.
6.  **Responsive Design**: Ensure the list looks good on mobile (compact) and desktop (maybe wider columns).

## 5. Verification Plan

### 5.1. Automated Tests
*   **Unit Test**: `BookListItem.test.tsx` to verify rendering of metadata and fallback for missing fields.
*   **Integration Test**: `LibraryView.test.tsx` to verify toggling `viewMode` switches the rendered component.

### 5.2. User Journey Verification (`verification/test_journey_list_view.py`)
A new verification script will be added:
1.  **Setup**: Ensure library has at least 5-10 books (including "Alice").
2.  **Action**: Click the "List View" toggle button (needs specific `data-testid`).
3.  **Assertion**: Verify that `BookListItem` elements are visible and `BookCard` elements are hidden (or vice versa).
4.  **Action**: Verify metadata content (Author, Progress) in the list item.
5.  **Action**: Click the context menu on a list item and verify "Offload/Delete" options appear.
6.  **Persistence**: Reload the page and assert that List View is still active.
