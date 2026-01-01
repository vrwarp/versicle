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

7\. Implementation Status (Update)
----------------------------------

Completed decomposition of `AudioPlayerService` into the planned sub-modules.

### Created Files:

1.  **`src/lib/tts/TaskSequencer.ts`**: Implemented `TaskSequencer` class to manage async task serialization. Replaced `pendingPromise`.
    -   Verified with `src/lib/tts/TaskSequencer.test.ts`.

2.  **`src/lib/tts/AudioContentPipeline.ts`**: Implemented `AudioContentPipeline` class.
    -   Moved logic for:
        -   Fetching section content from DB.
        -   Refining segments via `TextSegmenter`.
        -   Content Type Detection & Filtering via `GenAIService`.
        -   Preroll generation logic remains in `AudioPlayerService` (but pipeline handles structure).
        -   Triggering next chapter analysis.
    -   Verified with `src/lib/tts/AudioContentPipeline.test.ts`.

3.  **`src/lib/tts/PlaybackStateManager.ts`**: Implemented `PlaybackStateManager` class.
    -   Manages `queue`, `currentIndex`, `currentSectionIndex`.
    -   Calculates `prefixSums`, duration, and current position.
    -   Handles persistence logic (delegating DB calls).
    -   Verified with `src/lib/tts/PlaybackStateManager.test.ts`.

4.  **`src/lib/tts/TTSProviderManager.ts`**: Implemented `TTSProviderManager` class.
    -   Manages `ITTSProvider` lifecycle (init, play, pause, stop).
    -   Handles "Cloud -> Local" fallback.
    -   Normalizes events (start, end, error, timeupdate, etc.).
    -   Verified with `src/lib/tts/TTSProviderManager.test.ts`.

5.  **`src/lib/tts/PlatformIntegration.ts`**: Implemented `PlatformIntegration` class.
    -   Wraps `MediaSessionManager` and `BackgroundAudio`.
    -   Provides clean API for `updateMediaSession`, `setPlaybackState`, `setBackgroundAudioMode`.
    -   Verified with `src/lib/tts/PlatformIntegration.test.ts`.

6.  **`src/lib/tts/AudioPlayerService.ts`**: Refactored to act as a coordinator.
    -   Injects sub-modules in constructor (Dependency Injection).
    -   Delegates logic to sub-modules.
    -   Maintains high-level control flow (Play/Pause/Next/Prev/Seek).
    -   Verified with existing `src/lib/tts/AudioPlayerService*.test.ts`.

### Discoveries & Deviations:

-   **Preroll Logic**: The `generatePreroll` method was kept in `AudioPlayerService` (or duplicated/moved partially) because it relies on simple string manipulation, but `AudioContentPipeline` prepares the queue structure. The actual text generation is simple enough.
-   **Cover URL**: `AudioContentPipeline` was updated to accept `coverUrl` as an argument to avoid managing Blob URL lifecycles (which have side effects) within the pure pipeline. `AudioPlayerService` manages the revocation.
-   **Fallback Error Handling**: `TTSProviderManager` was updated to emit a specific error type/message when falling back, allowing `AudioPlayerService` to log it or notify if needed, although the fallback itself is handled internally by the manager.
-   **Concurrency Tests**: `AudioPlayerService_Concurrency.test.ts` required updates because direct access to private properties like `currentIndex` is no longer valid; state is now inside `stateManager`.

### Verification:

-   Run `npm test src/lib/tts/AudioPlayerService.test.ts` -> PASSED
-   Run `npm test src/lib/tts/AudioPlayerService_Concurrency.test.ts` -> PASSED
-   Run `npm test src/lib/tts/AudioPlayerService_MediaSession.test.ts` -> PASSED
-   Run `npm test src/lib/tts/AudioPlayerService_Resume.test.ts` -> PASSED
-   Run `npm test src/lib/tts/AudioPlayerService_Critical.test.ts` -> PASSED
-   Run `npm test src/lib/tts/TaskSequencer.test.ts` -> PASSED
-   Run `npm test src/lib/tts/PlaybackStateManager.test.ts` -> PASSED
-   Run `npm test src/lib/tts/TTSProviderManager.test.ts` -> PASSED
-   Run `npm test src/lib/tts/AudioContentPipeline.test.ts` -> PASSED
-   Run `npm test src/lib/tts/PlatformIntegration.test.ts` -> PASSED
