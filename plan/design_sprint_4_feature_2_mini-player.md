# Design Document: Persistent Floating Media Control Interface (Mini Player)

## 1. Introduction
This document outlines the technical design for the "Persistent Floating Media Control Interface" (Mini Player) proposed in Design Sprint 4. The goal is to provide continuous access to audio controls.

## 2. Requirements Analysis (UPDATED)
*   **Context Awareness**: It must display the currently loaded book's cover, title (or chapter), and playback status.
*   **Controls**: Play/Pause, and a "Close" button to terminate the session.
*   **Expansion**: Tapping the player (outside buttons) should expand it into the `UnifiedAudioPanel`.
*   **Visibility Logic**:
    *   **Reader View**: The Mini Player **SHOULD** be visible as a floating bar within the Reader View.
    *   **Library View**: The Mini Player **SHOULD NOT** be visible in the Library View (per user feedback).
    *   **Audio Persistence**: Audio playback continues globally, even if controls are hidden in the Library View.

## 3. Architecture & Data Model

### 3.1. Layout Restructuring (`src/Layout.tsx`)
Currently, `App.tsx` renders `Routes` directly. To support a persistent global element that sits *outside* the page content but interacts with it (e.g., adjusting padding), we need a Layout component.

*   **New Component**: `MainLayout`
*   **Responsibilities**:
    *   Render the `Outlet` (for current route).
    *   Render the `MiniPlayer` at the bottom if `useTTSStore` indicates an active session AND we are in the correct view.
    *   Adjust the bottom padding of the `Outlet` container to prevent the Mini Player from obscuring content (specifically in Reader View).

### 3.2. Data Persistence (`useTTSStore` Updates)
The `MiniPlayer` needs metadata about the *currently playing book*.

*   **Decision**: `MiniPlayer` will use a `useBookMetadata(bookId)` hook to retrieve display info from IDB.

### 3.3. Navigation & Interaction
*   **Expansion**: The design doc states expansion to `UnifiedAudioPanel`. Since `UnifiedAudioPanel` is currently a specific component inside `ReaderView`, we should extract it or wrap it in a global `Sheet`.
*   **Global Audio Sheet**: We will move the `Sheet` that hosts `UnifiedAudioPanel` to `MainLayout`.
*   **Reader Integration**: When in `ReaderView`, the global Mini Player is visible.

## 4. Implementation Steps

1.  **Store Updates**:
    *   Add `isAudioPanelOpen` to `useUIStore` (replacing local state in `ReaderView` and `MiniPlayer`).

2.  **Component: `MiniPlayer`**:
    *   Subscribes to `useTTSStore` (status, isPlaying, bookId).
    *   Fetches book metadata (Title, Cover) using `bookId`.
    *   Renders: Progress bar (top edge), Cover thumb, Title/Chapter marquee, Play/Pause, Close (Stop), Seek Controls.
    *   On Click: Sets `isAudioPanelOpen(true)`.
    *   **Constraint**: Returns `null` if location path is NOT `/read/:id`.

3.  **Refactor `App.tsx` & Layout**:
    *   Move `ThemeSynchronizer`, `GlobalSettingsDialog`, `ToastContainer` here.
    *   Render `Outlet` and `MiniPlayer`.
    *   Use `useLocation` to determine if we are on `/read/:id`. If so, show `MiniPlayer`.

4.  **Refactor `ReaderView`**:
    *   Remove local `audioPanelOpen` state.
    *   Use global `isAudioPanelOpen`.

## 5. Verification Plan

### 5.2. User Journey Verification (`verification/test_journey_mini_player.py`)
1.  **Setup**: Open a book, start TTS playback.
2.  **Action**: Verify `MiniPlayer` appears at the bottom of Reader View.
3.  **Action**: Click "Back" to return to Library.
4.  **Assertion**: Verify `MiniPlayer` **DISAPPEARS** (but audio continues? Verification limited to UI).
5.  **Action**: Open book again.
6.  **Assertion**: Verify `MiniPlayer` reappears.
