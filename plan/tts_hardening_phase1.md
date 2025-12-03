# Phase 1: Concurrency Safety & State Machine (Completed)

## Objective
Eliminate race conditions in the `AudioPlayerService` and ensure that rapid user interactions (Play/Pause/Next/Prev) result in a deterministic state.

## Implementation Details

### 1. Operation Locking (Mutex)
The `play()` method involves asynchronous operations (Lexicon processing, API calls, Cache I/O) that leave the service in a vulnerable `loading` state.
*   **Action:** Introduce a `AsyncMutex` or `Lock` mechanism.
*   **Implementation:** Used `AbortController` to enforce "Last Writer Wins".
*   **Logic:**
    *   Any call to `play()`, `pause()`, `next()`, `prev()` aborts the previous operation via `abortCurrentOperation()`.
    *   The `currentOperation` tracks the active `AbortController`.
    *   Async steps (Lexicon, Cache, Synthesis) check `signal.aborted` or pass the `signal` down to cancel immediately.

### 2. AbortController for Cancellation
To support "Last Writer Wins", we need to cancel in-flight operations.
*   **Action:** Pass an `AbortSignal` to the `play()` workflow.
*   **Scope:**
    *   Updated `ITTSProvider.synthesize` to accept `signal: AbortSignal`.
    *   Updated `WebSpeechProvider`, `OpenAIProvider`, `GoogleTTSProvider`, and `MockCloudProvider`.
    *   `WebSpeechProvider` calls `window.speechSynthesis.cancel()` if aborted.
    *   Cloud providers pass `signal` to `fetch()`.

### 3. Strict State Machine
Define valid transitions to prevent invalid states.
*   **States:** `STOPPED`, `LOADING`, `PLAYING`, `PAUSED`, `ERROR`.
*   **Implementation:**
    *   Status updates are guarded by `!signal.aborted`.
    *   If an operation is cancelled, it silently exits without changing status to `loading` or `playing`.

### 4. Implementation Plan
1.  **Refactor `AudioPlayerService`:** (Done)
    *   Added `currentOperation: AbortController | null`.
    *   In `play()`, call `this.currentOperation?.abort()`.
    *   Create new `AbortController`.
    *   Pass `signal` to internal methods.
2.  **Verify Providers:** (Done)
    *   Ensured `WebSpeechProvider` handles cancellation.
    *   Ensured cloud providers handle `fetch` cancellation.
3.  **Unit Tests:** (Done)
    *   Created `src/lib/tts/AudioPlayerService.concurrency.test.ts`.
    *   Verified: Calling `play()` 3 times rapidly results in only 1 API call (the last one).
    *   Verified: Stopping while loading prevents playback from starting.

## Risks (Mitigated)
*   **Over-locking:** The "Last Writer Wins" approach ensures responsiveness (user's last intent is honored) rather than blocking.
*   **Complexity:** Passing `signal` required updating multiple interfaces, but types are now safer.

## Verification
*   **Automated:** Concurrency tests passed.
*   **Manual:** Verified general functionality via `run_all.py` (all tests passed).
