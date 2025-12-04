# Phase 1: Concurrency Safety & State Machine

## Objective
Eliminate race conditions in the `AudioPlayerService` and ensure that rapid user interactions (Play/Pause/Next/Prev) result in a deterministic state.

## Implementation Details

### 1. Operation Locking (Mutex) - **[COMPLETED]**
The `play()` method involves asynchronous operations (Lexicon processing, API calls, Cache I/O) that leave the service in a vulnerable `loading` state.
*   **Action:** Introduce a `AsyncMutex` or `Lock` mechanism.
*   **Implementation:**
    *   Created `src/lib/utils/AsyncMutex.ts` implementing a queue-based async lock.
    *   Updated `AudioPlayerService` to wrap all public state-modifying methods (`play`, `pause`, `stop`, `next`, `prev`, `setQueue`, `setProvider`, etc.) with `mutex.runExclusive()`.
    *   Refactored internal logic into private `_play`, `_stop`, etc. methods to allow safe internal calls without deadlocks (since the mutex is non-reentrant).
    *   **Outcome:** Operations are now serialized. Rapid calls (spamming "Next") execute sequentially rather than in parallel, preventing state corruption.

### 2. AbortController for Cancellation
To support "Last Writer Wins" (optimization over strict queueing), we need to cancel in-flight operations.
*   **Action:** Pass an `AbortSignal` to the `play()` workflow.
*   **Scope:**
    *   Cancel the `provider.synthesize` call (if the provider supports it, otherwise ignore the result).
    *   Cancel the `cache.get/put` operations if possible.
    *   Cancel any pending `setTimeout` (like the error retry).

### 3. Strict State Machine
Define valid transitions to prevent invalid states.
*   **States:** `STOPPED`, `LOADING`, `PLAYING`, `PAUSED`, `ERROR`.
*   **Transitions:**
    *   `STOPPED` -> `LOADING` (Valid)
    *   `LOADING` -> `PLAYING` (Valid)
    *   `LOADING` -> `STOPPED` (Valid - User cancelled)
    *   `PLAYING` -> `PAUSED` (Valid)
    *   `PAUSED` -> `LOADING` (Valid - e.g. Resume needs to re-buffer)

### 4. Implementation Plan
1.  **Refactor `AudioPlayerService`:**
    *   Add `currentOperation: AbortController | null`.
    *   In `play()`, call `this.currentOperation?.abort()`.
    *   Create new `AbortController`.
    *   Pass `signal` to internal methods.
2.  **Verify Providers:**
    *   Ensure `WebSpeechProvider` handles cancellation (calls `window.speechSynthesis.cancel()`).
    *   Ensure `AudioElementPlayer` stops immediately.
3.  **Unit Tests:**
    *   Test: Call `play()` 10 times in 100ms. Assert only 1 API call is made (or only the last one "completes").
    *   Test: Call `play()` then immediately `stop()`. Assert status remains `STOPPED` and no audio plays.

## Risks
*   Over-locking could make the UI feel unresponsive. (Mitigated by ensuring `WebSpeechProvider.synthesize` returns immediately and does not hold the lock during playback).
*   Complexity of passing `AbortSignal` through the entire chain (Lexicon, Cache, Provider).

## Verification
*   **Automated:** `AudioPlayerService.concurrency.test.ts` verifies that concurrent calls are executed sequentially (Queue behavior).
*   **Manual:** Verified that spamming "Next" correctly advances through the queue without skipping or stalling.
