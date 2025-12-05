# Design Document: Persistent Floating Media Control Interface (Mini Player)

## 1. Introduction
This document outlines the technical design for the "Persistent Floating Media Control Interface" (Mini Player) proposed in Design Sprint 4. The goal is to provide continuous access to audio controls while navigating the application outside the active Reader View.

## 2. Requirements Analysis
*   **Global Persistence**: The player must remain visible when navigating between Library, Settings, and other non-Reader views if audio is active or paused (session active).
*   **Context Awareness**: It must display the currently loaded book's cover, title (or chapter), and playback status.
*   **Controls**: Play/Pause, and a "Close" button to terminate the session.
*   **Expansion**: Tapping the player (outside buttons) should expand it into the `UnifiedAudioPanel` or navigate back to the `ReaderView`.
*   **Hiding**: It must be hidden when the user is in the full `ReaderView` to avoid redundancy.

## 3. Architecture & Data Model

### 3.1. Layout Restructuring (`src/Layout.tsx`)
Currently, `App.tsx` renders `Routes` directly. To support a persistent global element that sits *outside* the page content but interacts with it (e.g., adjusting padding), we need a Layout component.

*   **New Component**: `MainLayout`
*   **Responsibilities**:
    *   Render the `Outlet` (for current route).
    *   Render the `MiniPlayer` at the bottom if `useTTSStore` indicates an active session.
    *   Adjust the bottom padding of the `Outlet` container to prevent the Mini Player from obscuring content.

### 3.2. Data Persistence (`useTTSStore` Updates)
The `MiniPlayer` needs metadata about the *currently playing book*, even if the user is browsing the library (where `useReaderStore` might be reset or irrelevant).

*   **Problem**: `AudioPlayerService` has `bookId`, but fetching metadata (Title, Cover) requires an async DB call.
*   **Solution**:
    *   Update `useTTSStore` to cache minimal `BookInfo` (`id`, `title`, `coverUrl` or `coverBlob`?) for the active session.
    *   Or, have `MiniPlayer` fetch metadata using `AudioPlayerService.bookId` on mount. Given the potential size of covers, fetching from IDB on mount is safer than keeping Blobs in Zustand/LocalStorage.
    *   **Decision**: `MiniPlayer` will use a `useBookMetadata(bookId)` hook to retrieve display info from IDB.

### 3.3. Navigation & Interaction
*   **Expansion**: The design doc states expansion to `UnifiedAudioPanel`. Since `UnifiedAudioPanel` is currently a specific component inside `ReaderView`, we should extract it or wrap it in a global `Sheet`.
*   **Global Audio Sheet**: We will move the `Sheet` that hosts `UnifiedAudioPanel` to `MainLayout`.
*   **Reader Integration**: When in `ReaderView`, the global Mini Player is hidden. The `ReaderView` can trigger the *same* global `UnifiedAudioPanel` or use its own trigger. To avoid state duplication, having one global `AudioSheet` controlled by `useUIStore` or `useTTSStore` is preferred.
    *   *Plan*: Lift `audioPanelOpen` state to `useUIStore` (or `useTTSStore`).
    *   `ReaderView` toggle button opens this global state.
    *   `MiniPlayer` click opens this global state.

## 4. Implementation Steps

1.  **Store Updates**:
    *   Add `isAudioPanelOpen` to `useUIStore` (replacing local state in `ReaderView` and `MiniPlayer`).
    *   Ensure `useTTSStore` persists `bookId` (it does via `AudioPlayerService`, but `useTTSStore` might need to reflect it for reactivity). Actually `useTTSStore` does NOT seem to store `bookId`. `AudioPlayerService` has it. We should expose `bookId` in `useTTSStore` state via the sync mechanism.

2.  **Component: `MiniPlayer`**:
    *   Create `src/components/MiniPlayer.tsx`.
    *   Subscribes to `useTTSStore` (status, isPlaying, bookId).
    *   Fetches book metadata (Title, Cover) using `bookId`.
    *   Renders: Progress bar (top edge), Cover thumb, Title/Chapter marquee, Play/Pause, Close (Stop).
    *   On Click: Sets `isAudioPanelOpen(true)`.

3.  **Refactor `App.tsx` & Layout**:
    *   Create `src/components/layout/MainLayout.tsx`.
    *   Move `ThemeSynchronizer`, `GlobalSettingsDialog`, `ToastContainer` here.
    *   Render `Outlet` and `MiniPlayer`.
    *   Use `useLocation` to determine if we are on `/read/:id`. If so, hide `MiniPlayer` (or render `null`).

4.  **Refactor `ReaderView`**:
    *   Remove local `audioPanelOpen` state.
    *   Use global `isAudioPanelOpen`.
    *   Ensure `UnifiedAudioPanel` is rendered globally in `MainLayout` (as a Sheet), OR render it in `MainLayout` but only show when open.
    *   *Correction*: `UnifiedAudioPanel` relies on `useReaderStore` for "Gesture Mode" and current book context. If opened from Library, `useReaderStore` might be empty.
    *   *Refinement*: `UnifiedAudioPanel` needs to be robust against missing `ReaderStore` context. It should use `useTTSStore` data primarily. Gesture Mode is reader-specific; if opened from Library, Gesture Mode toggle might be disabled or hidden.

## 5. Verification Plan

### 5.1. Automated Tests
*   **Unit Test**: `MiniPlayer.test.tsx` verifying it renders when `bookId` is present and status is not `stopped`.
*   **Integration Test**: Verify `MainLayout` correctly hides `MiniPlayer` on `/read` route.

### 5.2. User Journey Verification (`verification/test_journey_mini_player.py`)
1.  **Setup**: Open a book, start TTS playback.
2.  **Action**: Click "Back" to return to Library.
3.  **Assertion**: Verify `MiniPlayer` appears at the bottom.
4.  **Assertion**: Verify Play/Pause works from Library.
5.  **Action**: Click `MiniPlayer` body.
6.  **Assertion**: Verify `UnifiedAudioPanel` opens (Sheet).
7.  **Action**: Close Sheet, click "Close/Stop" on Mini Player.
8.  **Assertion**: Verify `MiniPlayer` disappears.
9.  **Scenario**: Navigate to Settings, verify Mini Player persists.
