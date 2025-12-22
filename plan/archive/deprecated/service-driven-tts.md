Service-Driven TTS Architecture
===============================

1\. Problem Statement
---------------------

The current TTS architecture relies on `ReaderView.tsx` and the `useTTS` hook to orchestrate chapter transitions. This creates a dependency on the browser's main thread and the visual rendering loop (`requestAnimationFrame`).

When the application tab is backgrounded (mobile or desktop), modern browsers aggressively throttle or suspend the visual rendering loop. Consequently, the "end of chapter" event triggers a state update in React that may never process, causing playback to halt indefinitely after the current chapter finishes.

2\. Objective
-------------

**Decouple the audio playback logic from the visual presentation layer.** The `AudioPlayerService` must evolve from a dumb sample player into a "Playback Controller" that possesses sufficient context (the book's spine/playlist) to autonomously load and play subsequent chapters without UI intervention.

3\. Architecture Overview
-------------------------

### Current (Fragile)

`UI (ReaderView)` ➔ `Wait for Render` ➔ `useTTS` ➔ `DB Fetch` ➔ `AudioPlayerService.setQueue`

### Proposed (Robust)

`AudioPlayerService` ➔ `DB Fetch (Spine)` ➔ `Internal Queue Management` ➔ `Event Emission` ➔ `UI (Subscriber)`

In this model, the **Audio Service is the Source of Truth**. The UI becomes a reactive observer that syncs its visual state to the audio state when visible, but is not required for playback to proceed.

4\. Component Design
--------------------

### 4.1. Data Layer (`DBService`)

The database already contains `SectionMetadata` (stored in the `sections` store during ingestion). We must expose this to the audio service to form a "Playlist."

**New Capability:**

-   `getSections(bookId)`: Returns the ordered list of chapters (spine items) for a given book.

### 4.2. Service Layer (`AudioPlayerService`)

The service needs to manage the "Macro Queue" (Chapters) in addition to the "Micro Queue" (Sentences).

**State Enhancements:**

-   `playlist`: An ordered array of `SectionMetadata` representing the entire book.

-   `currentSectionIndex`: The index of the currently playing chapter in the playlist.

**Logic Changes:**

1.  **Initialization (`setBookId`)**:

    -   Instead of just clearing state, the service immediately fetches the `playlist` from `DBService`.

    -   It attempts to restore the last playback position (Index/CFI) from the persistent `books` store.

2.  **Auto-Advance (`playNext`)**:

    -   **Condition**: When the current sentence queue is exhausted.

    -   **Action**: The service identifies the next section from its internal `playlist`.

    -   **Fetch**: It calls `DBService.getTTSContent` directly for that section ID.

    -   **Sanity Check**: If the section is empty (no text), it recursively attempts the next section.

    -   **Execution**: It populates its own micro-queue and continues playback immediately.

    -   **Notification**: It emits a state change event.

### 4.3. Interface Layer (`ReaderView` / `useTTS`)

The React components must surrender control of the queue.

-   **`useTTS` Hook**:

    -   **Old Role**: Load data from DB, set Service Queue.

    -   **New Role**: Pure subscriber. It listens to `AudioPlayerService` state changes to expose the current sentence/queue for *visualization* (highlighting) only. It **never** writes to the queue during auto-advance.

-   **`ReaderView`**:

    -   Removes all `useEffect` hooks related to `autoPlayNext` or `status === 'completed'`.

    -   Relies on `ReaderTTSController` to listen for CFI changes. If the audio service jumps to a new CFI that is outside the current visual chapter, the `ReaderTTSController` triggers the visual navigation (`rendition.display()`).

5\. Detailed Workflows
----------------------

### A. Initialization

1.  User opens book.

2.  `ReaderView` mounts.

3.  `ReaderView` calls `AudioPlayerService.setBookId(id)`.

4.  Service loads `playlist` (spine) and restores the last active queue from DB.

5.  Service is ready to play.

### B. Background Auto-Advance (The Fix)

1.  User starts playback and minimizes the app.

2.  Audio Service plays the last sentence of Chapter 1.

3.  Service detects `queue_end`.

4.  Service checks `playlist[currentSectionIndex + 1]`.

5.  Service fetches `tts_content` for Chapter 2 from IndexedDB.

6.  Service replaces internal queue with Chapter 2 content.

7.  Service begins playing Chapter 2 sentence 1.

8.  **Result**: Seamless audio transition. The React UI is paused/frozen, but it doesn't matter.

### C. Re-entry Synchronization

1.  User maximizes the app (Chapter 2 is now playing).

2.  `ReaderTTSController` (which subscribes to Service events) receives the current CFI of the active sentence in Chapter 2.

3.  `ReaderTTSController` detects that the visual renderer is still on Chapter 1.

4.  It executes `rendition.display(newCfi)`.

5.  Epub.js renders Chapter 2.

6.  The UI is now in sync.

6\. Implementation Strategy
---------------------------

### Phase 1: Service Independence

Modify `AudioPlayerService` to hold the `playlist`. Implement the `advanceToNextChapter()` method internally. Ensure it can fetch data without any arguments passed from the UI.

### Phase 2: React Decoupling

Strip the data loading logic from `useTTS.ts`. It should no longer import `dbService.getTTSContent`. It should only ask `AudioPlayerService.getQueue()`.

### Phase 3: Preroll Migration

Move the logic for generating "Chapter X - 5 minutes remaining" (Preroll) from the React hook into the `AudioPlayerService`. This ensures prerolls happen even during background transitions.

7\. Risk Assessment
-------------------

-   **Race Conditions**: If the user manually navigates (visually) to Chapter 5 while the Audio Service is auto-advancing to Chapter 2.

    -   *Mitigation*: The Service is the master. If Audio is playing, it dictates location. If the user explicitly clicks a "Play from here" button in the UI, that is an explicit override command that resets the Service's pointer.

-   **Empty Chapters**: Some EPUBs have empty wrapper chapters (e.g., "Part 1").

    -   *Mitigation*: The `advanceToNextChapter` method must be recursive or loop-based to skip empty sections until content is found or the book ends.
