Technical Design: AudioPlayerService Decomposition
==================================================

1\. Problem Statement
---------------------

The original `AudioPlayerService.ts` was a monolithic service (~1,000 lines) managing multiple complex responsibilities, leading to:

-   **Low Testability**: Hard to test logic without triggering real audio or DB writes.

-   **Brittleness**: High risk of side effects when changing small pieces of logic.

-   **Maintenance Overhead**: Difficult to navigate and understand the control flow.

2\. Refactoring Goals (Completed)
---------------------

1.  **High Testability**: >90% of business logic is now tested with pure unit tests.

2.  **Single Responsibility**: Each file handles exactly one domain.

3.  **Atomic Files**: All new sub-modules are small and focused.

4.  **Deterministic Concurrency**: Implemented `TaskSequencer` for robust async locking.

3\. Implemented Architecture
-----------------------------------

### 3.1 Component Overview

```
[ AudioPlayerService (Coordinator) ]
          |
          +--> [ AudioContentPipeline ] (Data Transformation)
          |    - Pure segment refining logic
          |    - AI Content filtering
          |    - Preroll generation
          |
          +--> [ PlaybackStateManager ] (State & Logic)
          |    - Current index/section tracking
          |    - Position estimation (Prefix sums)
          |    - Queue persistence
          |
          +--> [ TTSProviderManager ]   (Hardware Wrapper)
          |    - Local/Cloud switching logic
          |    - Event normalization
          |    - Fallback handling
          |
          +--> [ PlatformIntegration ]  (OS Side Effects)
          |    - MediaSession & Background Audio
          |    - Battery optimization checks
          |
          +--> [ TaskSequencer ]        (Utility)
               - Generic async locking

```

4\. Sub-Module Details
-------------------------------------------

### 4.1 TaskSequencer (Utility)

-   **File**: `src/lib/tts/TaskSequencer.ts`
-   **Status**: Implemented & Tested.
-   **Role**: Serializes async tasks to prevent race conditions.

### 4.2 AudioContentPipeline

-   **File**: `src/lib/tts/AudioContentPipeline.ts`
-   **Status**: Implemented & Tested.
-   **Role**: Transforms book sections into `TTSQueueItem[]`. Handles GenAI content filtering and text refinement.

### 4.3 PlaybackStateManager

-   **File**: `src/lib/tts/PlaybackStateManager.ts`
-   **Status**: Implemented & Tested.
-   **Role**: Manages the "What" and "Where" of playback (Queue, Index, Persistence).

### 4.4 TTSProviderManager

-   **File**: `src/lib/tts/TTSProviderManager.ts`
-   **Status**: Implemented & Tested.
-   **Role**: Manages `ITTSProvider` instances (WebSpeech, Capacitor, Piper) and handles fallback logic on error.

### 4.5 PlatformIntegration

-   **File**: `src/lib/tts/PlatformIntegration.ts`
-   **Status**: Implemented & Tested.
-   **Role**: Updates MediaSession API and manages Background Audio tracks.

5\. Verification Results
---------------------------

-   **Unit Tests**: All new components have dedicated test files with 100% pass rate.
-   **Regression Tests**: Existing `AudioPlayerService` tests were updated and passed, ensuring no regressions in core functionality.
-   **Concurrency**: `TaskSequencer` proven to handle rapid calls correctly (verified via `AudioPlayerService_Concurrency.test.ts`).

6\. Conclusion
------------

The decomposition was successful. `AudioPlayerService.ts` now acts as a coordinator, delegating specific tasks to specialized components. This makes the codebase significantly more maintainable and testable.
