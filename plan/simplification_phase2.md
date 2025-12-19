# Phase 2: Audio Simplification

**Objective**: Simplify the TTS state machine and worker management.

## 1. Component Design: Concurrency Control (Reactive State vs. Mutex)

**Current State:** The `AudioPlayerService` utilizes a custom `executeWithLock` method. This implementation uses `AbortController` signals and a promise-based mutex to strictly serialize operations, essentially treating the playback queue as a critical section in a multi-threaded application.

**Problem:** This architecture is fundamentally mismatched with the JavaScript runtime (single-threaded event loop).
-   **Brittleness**: If a bug occurs in the `finally` block of the lock release logic, the entire audio subsystem freezes forever.
-   **Complexity**: The `OperationState` logic makes simple actions hard to follow. Debugging involves tracing `AbortSignal` propagation rather than logical flow.

**Proposed Design: The Robust Promise Chain**
We will replace the mutex lock with a **Sequential Promise Chain**. Instead of locking the door, we simply form a line. Every user action is appended to a persistent promise chain.

**Rules:**
1.  **The Indestructible Chain**: The tail of the queue (`pendingPromise`) must *never* reject. Any task appended to it must internally catch its own errors.
2.  **State-Check at Execution Time**: Every task must re-verify preconditions at the start of execution (e.g., "Am I still playing this book?").
3.  **Debouncing at the Edge**: Rapid inputs should be debounced at the UI component level rather than complex cancellation logic inside the service.

```typescript
class AudioPlayerService {
  // The tail of the promise chain. Initialize as resolved.
  private pendingPromise: Promise<void> = Promise.resolve();
  private isDestroyed = false;

  private async enqueue<T>(task: () => Promise<T>): Promise<T | void> {
    const resultPromise = this.pendingPromise.then(async () => {
      if (this.isDestroyed) return;
      try {
        return await task();
      } catch (err) {
        console.error("Audio task failed safely:", err);
      }
    });

    this.pendingPromise = resultPromise.catch(() => {});
    return resultPromise;
  }

  play() {
    this.enqueue(async () => {
      if (this.status === 'playing') return; // Guard clause
      await this.internalPlayLogic();
    });
  }

  pause() {
    this.enqueue(async () => {
      await this.internalPauseLogic();
    });
  }
}
```

## 2. Component Design: Worker Management (Let It Crash)

**Current State:** The `PiperProcessSupervisor` acts like an OS service manager, tracking heartbeats and automatically restarting the worker.

**Problem:** In a browser, if a Web Worker crashes (often due to OOM), automatic background retries can lead to "death loops."

**Proposed Design: Error Boundary Pattern**
Shift from "automatic recovery" to "manual recovery."

1.  **Instantiation**: Create the worker on demand.
2.  **Error Handling**: Attach a global `onerror` handler to the worker. If it crashes:
    -   Terminate the worker.
    -   Set status to `stopped`.
    -   Show a Toast notification: "TTS Engine crashed. [Retry]"
3.  **Retry**: User clicking "Play" again instantiates a fresh worker.

## 3. Implementation Plan

### Steps

1.  **Refactor `AudioPlayerService.ts`**:
    *   Implement the `enqueue` Promise chain helper.
    *   Remove `executeWithLock` and all `AbortController` logic.
    *   Refactor public methods (`play`, `pause`, etc.) to use `enqueue`.

2.  **Remove Supervisor**:
    *   Delete `PiperProcessSupervisor.ts`.
    *   Update `PiperProvider.ts` to directly instantiate the worker.

3.  **Implement Error Boundary**:
    *   In `PiperProvider`, add the global `onerror` handler.
    *   Ensure the handler updates the `AudioPlayerService` state to `stopped` and triggers a UI notification.

### Validation

*   **Stress Test**: Mash Play/Pause/Next buttons rapidly. Verify state consistency and no "freezing."
*   **Crash Test**: Simulate a worker crash (e.g., manually terminate the worker in DevTools) and verify the UI shows the error and allows the user to restart playback.
