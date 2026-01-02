Technical Design: AudioPlayerService Decomposition
==================================================

1\. Problem Statement
---------------------

The current `AudioPlayerService.ts` is a monolithic service (~1,000 lines) managing multiple complex responsibilities. This leads to:

-   **Low Testability**: Hard to test logic without triggering real audio or DB writes.

-   **Brittleness**: High risk of side effects when changing small pieces of logic.

-   **Maintenance Overhead**: Difficult to navigate and understand the control flow.

2\. Refactoring Goals
---------------------

1.  **High Testability**: Ensure >90% of business logic can be tested with pure unit tests (no hardware/globals).

2.  **Single Responsibility**: Each file should handle exactly one domain (e.g., state, transformation, or OS interaction).

3.  **Atomic Files**: Target file sizes of <250 lines for sub-modules.

4.  **Deterministic Concurrency**: Replace custom promise chains with a robust `TaskSequencer`.

3\. Proposed Architecture (Modular)
-----------------------------------

### 3.1 Component Overview

```
[ AudioPlayerService (Coordinator) ]
          |
          +--> [ AudioContentPipeline ] (Data Transformation)
          |    - Pure segment refining logic
          |    - AI Content filtering
          |
          +--> [ PlaybackStateManager ] (State & Logic)
          |    - Current index/section tracking
          |    - Position estimation (Prefix sums)
          |
          +--> [ TTSProviderManager ]   (Hardware Wrapper)
          |    - Local/Cloud switching logic
          |    - Event normalization
          |
          +--> [ PlatformIntegration ]  (OS Side Effects)
          |    - MediaSession & Background Audio
          |
          +--> [ TaskSequencer ]        (Utility)
               - Generic async locking

```

4\. Sub-Module Specifications & Testability
-------------------------------------------

### 4.1 TaskSequencer (Utility)

-   **File**: `TaskSequencer.ts`

-   **Responsibility**: Serialize async tasks to prevent race conditions.

-   **Testability**: Highly testable using `vi.useFakeTimers()` to verify task ordering.

### 4.2 AudioContentPipeline

-   **File**: `AudioContentPipeline.ts`

-   **Responsibility**: Transforms book sections into `TTSQueueItem[]`.

-   **Testability Strategy**:

    -   Move `TextSegmenter.refineSegments` and `detectAndFilterContent` here.

    -   **Pure Tests**: Pass in mock database results and AI configs; expect specific queue structures. No side effects.

### 4.3 PlaybackStateManager

-   **File**: `PlaybackStateManager.ts`

-   **Responsibility**: Manages the "What" and "Where" of playback.

-   **State**: `currentIndex`, `currentSectionIndex`, `prefixSums`.

-   **Testability Strategy**:

    -   Decouple from `AudioPlayerService` by taking an `EventEmitter` or callback for state changes.

    -   **Unit Test**: "Given queue length X and speed Y, verify estimated position at character Z is exactly N."

### 4.4 TTSProviderManager

-   **File**: `TTSProviderManager.ts`

-   **Responsibility**: Interface with `ITTSProvider`. Handles the "Cloud -> Local" fallback logic.

-   **Testability Strategy**:

    -   Inject mock `ITTSProvider` objects.

    -   **Unit Test**: "If cloud provider emits ERROR, verify that local provider's `init()` is called immediately."

### 4.5 PlatformIntegration

-   **File**: `PlatformIntegration.ts`

-   **Responsibility**: Updates MediaSession API and manages Background Audio tracks.

-   **Testability Strategy**:

    -   Mock the global `navigator.mediaSession` and `HTMLAudioElement`.

    -   Verify that state transitions (`playing` -> `paused`) trigger correct OS commands.

5\. Implementation Strategy
---------------------------

### Phase 1: Dependency Injection (DI) Setup

-   Modify `AudioPlayerService` to accept sub-modules in its constructor (facilitating easier mocking in integration tests).

### Phase 2: Logic Extraction

1.  **Extract `TaskSequencer`**: Remove manual `pendingPromise` logic.

2.  **Extract `AudioContentPipeline`**: Move Chapter-to-Queue transformation. This is the "heavy lifting" logic.

3.  **Extract `PlaybackStateManager`**: Move the prefix sum math and index bounds checking.

### Phase 3: Hardware Isolation

-   Create `PlatformIntegration` to swallow all `@capacitor` and `navigator` calls. This allows the main logic to run in standard Node/Vitest environments without polyfills.

6\. Benefits
------------

-   **Unit Testing**: You can test the "Estimated Time" logic or "Content Filtering" logic in milliseconds without loading a single audio file.

-   **Parallel Development**: Developers can work on the AI filtering pipeline independently from the Audio Element player.

-   **Error Boundaries**: A failure in `MediaSession` metadata update will no longer crash the main playback sequence.

7\. Implementation Summary & Deviations
---------------------------------------

### Completed Work
The decomposition of `AudioPlayerService` into the five proposed components has been successfully completed.
- `TaskSequencer`: Implemented for robust async locking.
- `AudioContentPipeline`: Handles section loading, AI filtering, and text refinement.
- `PlaybackStateManager`: Manages the queue, indices, and position calculations.
- `TTSProviderManager`: Wraps providers and handles error events.
- `PlatformIntegration`: Manages `MediaSession` and `BackgroundAudio`.

`AudioPlayerService` now acts as a facade, coordinating these components.

### Discoveries & Deviations

1.  **Circular Dependencies**:
    - **Issue**: Importing `TTSQueueItem` and `TTSStatus` from `AudioPlayerService` into sub-modules created circular dependencies during the build.
    - **Resolution**: These type definitions remain exported from `AudioPlayerService.ts`, but sub-modules avoid importing them where possible or local interfaces were adjusted. In the final build, `TTSQueueItem`, `TTSStatus`, and `DownloadInfo` are defined in `AudioPlayerService.ts` and exported for consumers.

2.  **Error Handling & Fallback**:
    - **Original Plan**: Handle fallback logic inside `AudioPlayerService` catch blocks or `TTSProviderManager`.
    - **Implementation**: The fallback mechanism relies on the `TTSProviderManager` emitting an `onError` event with a specific type (`'fallback'`). `AudioPlayerService` listens for this event to trigger a retry (`playInternal`), rather than solely relying on catching promise rejections from `play()`. This required careful mocking in tests (manually triggering the error listener).

3.  **Queue Optimization**:
    - **Implementation**: `setQueue` includes an optimization to check if the new queue is identical to the current one. If so, it updates the state manager's indices and persists state without stopping playback or resetting the media session, improving continuity.

4.  **Testing Strategy**:
    - **Private Property Access**: Some existing tests relied on accessing private properties of `AudioPlayerService` (e.g., `currentIndex`). These were updated to access the state via the new sub-components (e.g., `service['stateManager'].currentIndex`) or through public methods where available.
    - **Mocking**: `AudioContentPipeline` testing required extensive mocking of `DBService` and `GenAIService` to verify content filtering and structure detection.

5.  **Platform Integration Access**:
    - **Issue**: `AudioPlayerService` needed to read the current background audio mode to pass it back during certain transitions.
    - **Resolution**: Added `getBackgroundAudioMode()` to `PlatformIntegration` to avoid unsafe private property access.
