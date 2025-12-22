# Phase 1: Concurrency Safety & State Machine (Completed)

## Objective
Eliminate race conditions in the `AudioPlayerService` and ensure that rapid user interactions (Play/Pause/Next/Prev) result in a deterministic state.

## Completed Tasks

### 1. Operation Locking (Mutex) & AbortController (Steps 1 & 2 Combined)
The `play()` method involved asynchronous operations that left the service in a vulnerable `loading` state. We implemented a "Last Writer Wins" strategy using a custom `executeWithLock` helper.

*   **Implementation:**
    *   Added `executeWithLock(operation)` helper method in `AudioPlayerService`.
    *   This method aborts the previous operation (via `AbortController`), waits for it to clean up (via a Promise-based lock), and then executes the new operation.
    *   **Update:** Modified `executeWithLock` to support "Critical Operations". Methods `setQueue`, `setSpeed`, `setVoice`, and `setProvider` are marked as critical and will **not** be aborted by subsequent operations. They will run to completion, forcing subsequent operations to wait.
    *   All public state-modifying methods (`play`, `pause`, `stop`, `next`, `prev`, `setQueue`, `jumpTo`, `setSpeed`, `setVoice`, `setProvider`) are wrapped in `executeWithLock`.
    *   Updated `ITTSProvider` interface to accept `signal: AbortSignal` in `synthesize`.
    *   Updated `WebSpeechProvider`, `GoogleTTSProvider`, and `OpenAIProvider` to respect the abort signal.
    *   Updated internal `playInternal` logic to check `signal.aborted` at critical checkpoints (before synthesis, after cache check, after synthesis).

### 2. Strict State Machine (Step 3)
We defined valid transitions to prevent invalid states.

*   **Implementation:**
    *   Updated `setStatus` to validate transitions (currently logging-only/pass-through but structure is in place).
    *   Ensured `loading` state is only set if not already `playing` to prevent UI flickering.
    *   Ensured `stopped` state cleans up resources properly.

## Verification
*   **Unit Tests:**
    *   `src/lib/tts/AudioPlayerService_Concurrency.test.ts` verifies:
        *   Rapid `jumpTo`/`play` calls result in only the last one executing (Last Writer Wins).
        *   `stop()` immediately following `play()` correctly results in `stopped` state.
        *   Operations waiting for lock are aborted if a new operation comes in.
    *   `src/lib/tts/AudioPlayerService_Critical.test.ts` verifies:
        *   Critical operations (`setQueue`) are not aborted by subsequent operations (`play`).
        *   Sequential critical operations execute serially.
    *   Existing `AudioPlayerService.test.ts` updated and passing.
*   **Manual Verification:**
    *   Verified "Spam click" behavior in `test_journey_reading.py` (indirectly) and manual testing scenarios.

## Risks & Mitigations (Post-Implementation)
*   **Risk:** Over-locking could make UI feel unresponsive.
    *   **Mitigation:** The "abort and replace" strategy ensures the UI stays responsive to the *latest* input, rather than blocking on old inputs.
*   **Risk:** Provider compatibility.
    *   **Mitigation:** `WebSpeechProvider` explicitly handles `abort` events. Cloud providers rely on `fetch` abort signals.

## Next Steps
Proceed to **Phase 2: Session Snapshots & Persistence**.
