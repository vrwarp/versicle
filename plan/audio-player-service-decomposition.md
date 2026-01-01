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
