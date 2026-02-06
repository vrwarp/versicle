Technical Design Doc: Decoupling TTS Playback State
===================================================

**Status:** Implemented **Author:** Gemini **Date:** January 3, 2026

1\. Problem Statement
---------------------

The `AudioPlayerService` (APS) previously treated `PlaybackStateManager` (PSM) as a passive data store. This resulted in:

-   **Leaky Abstractions:** Direct access to `stateManager.queue` allowed external mutation of active state.

-   **Logic Fragmentation:** Navigation math (calculating indices, "jump to end" logic) was performed in the Service layer.

-   **Side-Effect Brittleness:** The Service had to manually trigger DB persistence (`persistQueue`) and metadata updates after every state change. Forgetting a call led to UI/Persistence desync.

-   **Violated Invariants:** PSM could not guarantee internal consistency (e.g., keeping `prefixSums` in sync with `queue`) if the array was modified externally.

2\. Implemented Solution
------------------

We have successfully decoupled the state management from the service logic.

### 2.1. PlaybackStateManager Refactoring

`PlaybackStateManager` has been transformed into a private state machine.

#### Data Encapsulation

-   `queue`, `currentIndex`, and `currentSectionIndex` are now `private`.
-   Public access is provided via getters returning `ReadonlyArray<TTSQueueItem>` (for queue) and primitives.

#### Navigation Command API

Pointer logic has been moved to PSM:

-   `seekToTime(time: number, speed: number): boolean`: Internalizes the `prefixSum` lookup and updates the index if changed. Returns `true` if index changed, allowing APS to decide whether to force-next.
-   `jumpToEnd(): void`: Replaces manual `queue.length - 1` logic.
-   `isIdenticalTo(items: TTSQueueItem[]): boolean`: Internalizes equality checks.
-   `setQueue(items, index, section)`: Updates state and automatically persists it.

#### Automated Persistence

Methods modifying the state (`next`, `prev`, `seekToTime`, `setQueue`, `jumpTo`, `jumpToEnd`) automatically call `persistQueue()`. APS no longer manually calls persistence methods.

### 2.2. Reactive Orchestration (Observer Pattern)

PSM now implements an Observer pattern.

```typescript
export type PlaybackStateSnapshot = {
    queue: ReadonlyArray<TTSQueueItem>;
    currentIndex: number;
    currentItem: TTSQueueItem | null;
    currentSectionIndex: number;
};
```

`AudioPlayerService` subscribes to these changes in its constructor. When state changes:
1.  **Metadata Sync:** APS updates `PlatformIntegration` (MediaSession) metadata.
2.  **Listener Dispatch:** APS notifies its own high-level subscribers with the new active CFI.

### 2.3. AudioPlayerService Simplification

APS now focuses on hardware/provider orchestration.

-   **Navigation:** Calls `stateManager.next()`, `prev()`, `seekToTime()` etc.
-   **Queue Management:** Calls `stateManager.setQueue()`.
-   **Metadata:** Relying on the subscription to update metadata and listeners, reducing redundant calls.

3\. Deviations & Discoveries
----------------------------

-   **Status Management:** `TTSStatus` remains managed by `AudioPlayerService` as it reflects the *provider* state (playing/paused/loading) rather than the *queue* state. `PlaybackStateSnapshot` intentionally excludes `status`. APS combines its local status with the PSM snapshot when notifying listeners.
-   **seekTo Logic:** While `seekToTime` internalizes the index calculation, APS retains a small piece of logic to force a "Next" command if seeking lands on the same index, to improve user experience during scrubbing.
-   **Persistence Optimization:** `persistQueue` in PSM intelligently switches between `saveTTSState` (full queue) and `saveTTSPosition` (index only) by tracking the last persisted queue reference.

4\. Verification
----------------

-   **Unit Tests:** `PlaybackStateManager.test.ts` verified to cover queue setting, time seeking, and persistence logic. `AudioPlayerService.test.ts` verified to ensure no regression in service logic.
-   **Manual verification:** Code structure ensures type safety (read-only queue) and prevents direct modification of indices from outside PSM.
