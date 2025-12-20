# Phase 2: Audio Simplification

**Objective**: Simplify the TTS state machine and worker management.

## 1. Component Design: Concurrency Control (Reactive State vs. Mutex)

**Current State:**
-   `src/lib/tts/AudioPlayerService.ts`: Uses `executeWithLock` (lines 118-148) and `OperationState` to serialize access. This mimics a multi-threaded mutex using `Promise` and `AbortController`.

**Problem:** Mismatched with JavaScript's single-threaded event loop. Complex to debug and prone to "freezing" if a lock isn't released.

**Proposed Design: The Robust Promise Chain**
Replace the mutex with a sequential Promise chain (`pendingPromise`).

```typescript
class AudioPlayerService {
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
}
```

## 2. Component Design: Worker Management (Let It Crash)

**Current State:**
-   `src/lib/tts/providers/PiperProcessSupervisor.ts`: Manages `search.worker.ts` lifecycle, retries, and timeouts.
-   `src/lib/tts/providers/piper-utils.ts`: Instantiates and uses `PiperProcessSupervisor`.

**Problem:** Automatic background retries for worker crashes (often OOM) lead to loops. Complexity is high.

**Proposed Design: Error Boundary Pattern**
Shift to manual recovery.

1.  **Instantiation**: Create the worker directly in `piper-utils.ts` or `PiperProvider`.
2.  **Error Handling**: Attach `onerror` to the worker. If it crashes, terminate it and notify the user.

## 3. Implementation Plan

### Steps

1.  **Refactor `AudioPlayerService.ts`**:
    *   Remove `executeWithLock`, `OperationState`, and `AbortController` usage in methods like `play`, `pause`, `next`, `prev`.
    *   Implement `enqueue`.
    *   Wrap public methods in `enqueue`.

2.  **Remove Supervisor**:
    *   Delete `src/lib/tts/providers/PiperProcessSupervisor.ts`.
    *   Refactor `src/lib/tts/providers/piper-utils.ts`:
        *   Remove `supervisor` import and instantiation.
        *   In `piperGenerate`: Instantiate `new Worker(...)` directly.
        *   Implement the `onerror` handler to reject the current promise.

3.  **Implement Error Boundary**:
    *   If the worker fails during generation, `piperGenerate` should reject.
    *   `PiperProvider` (the caller) catches this error.
    *   `AudioPlayerService` receives the error event and updates status to `stopped` + notifies UI.

### Validation

*   **Stress Test**: Rapidly click Play/Pause/Next.
*   **Crash Test**: Manually terminate the worker in DevTools while playing. Verify the app handles it gracefully (stops, shows error) instead of trying to restart it infinitely.
