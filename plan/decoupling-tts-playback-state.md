Technical Design Doc: Decoupling TTS Playback State
===================================================

**Status:** Draft **Author:** Gemini **Date:** January 3, 2026

1\. Problem Statement
---------------------

The `AudioPlayerService` (APS) currently treats `PlaybackStateManager` (PSM) as a passive data store. This results in:

-   **Leaky Abstractions:** Direct access to `stateManager.queue` allows external mutation of active state.

-   **Logic Fragmentation:** Navigation math (calculating indices, "jump to end" logic) is performed in the Service layer.

-   **Side-Effect Brittleness:** The Service must manually trigger DB persistence (`persistQueue`) and metadata updates after every state change. Forgetting a call leads to UI/Persistence desync.

-   **Violated Invariants:** PSM cannot guarantee internal consistency (e.g., keeping `prefixSums` in sync with `queue`) if the array is modified externally.

2\. Proposed Goals
------------------

1.  **Strict Encapsulation:** Make PSM state internal. Access should be through immutable snapshots or specific getters.

2.  **State Machine Ownership:** Move all pointer arithmetic and queue comparison logic into PSM.

3.  **Automatic Side Effects:** PSM should handle its own persistence to IndexedDB.

4.  **Reactive Decoupling:** Implement an observer pattern so APS reacts to state changes rather than driving them manually.

3\. Detailed Design
-------------------

### 3.1. PlaybackStateManager Refactoring

We will transform `PlaybackStateManager` from a property-bag into a private state machine.

#### Data Encapsulation

-   `queue`, `currentIndex`, and `currentSectionIndex` will be marked `private`.

-   Replace `getQueue()` with a method returning `ReadonlyArray<TTSQueueItem>`.

#### Navigation Command API

Move manual pointer logic from APS to PSM:

-   `seekToTime(time: number, speed: number): void`: Internalizes the `prefixSum` lookup.

-   `jumpToEnd(): void`: Replaces manual `queue.length - 1` logic.

-   `isIdenticalTo(items: TTSQueueItem[]): boolean`: Internalizes equality checks.

#### Automated Persistence

Every method that modifies the pointer or queue (`next`, `prev`, `seekToTime`, `setQueue`) will automatically call `this.persistQueue()`. This removes the burden from the Service.

### 3.2. Reactive Orchestration (Observer Pattern)

To keep the UI and Media Session updated, PSM will emit events.

```
type PlaybackStateSnapshot = {
    status: TTSStatus;
    queue: ReadonlyArray<TTSQueueItem>;
    currentIndex: number;
    currentItem: TTSQueueItem | null;
    currentSectionIndex: number;
};

type StateChangeListener = (state: PlaybackStateSnapshot) => void;

```

`AudioPlayerService` will subscribe to these changes in its constructor:

1.  **Metadata Sync:** When the pointer moves, APS updates `PlatformIntegration` (MediaSession).

2.  **Listener Dispatch:** APS notifies its own high-level subscribers.

### 3.3. AudioPlayerService Simplification

With PSM handling the "What" (state), APS focuses purely on the "How" (hardware/providers).

**Example: `seekTo` Refactor**

-   **Before:** Calculates index -> manually assigns `currentIndex` -> manually calls `stop()` -> manually calls `persistQueue()` -> manually updates metadata.

-   **After:** Calls `stateManager.seekToTime(t)` -> PSM persists and emits event -> APS reacts to event by stopping provider and restarting `playInternal`.

4\. Implementation Plan
-----------------------

### Phase 1: Logic Migration

1.  Move `isQueueEqual` from APS to PSM.

2.  Implement `seekToTime`, `jumpToEnd`, and `peekNext` in PSM.

3.  Update APS to use these methods without modifying PSM properties directly.

### Phase 2: Encapsulation & Persistence

1.  Change PSM properties to `private`.

2.  Move the `persistQueue` trigger inside PSM navigation methods.

3.  Add `getStateSnapshot()` to PSM.

### Phase 3: Observer Integration

1.  Implement `addListener` in PSM.

2.  Refactor APS `setStatus` and navigation handlers to respond to PSM events.

3.  Clean up redundant `updateMediaSessionMetadata` calls in APS.

5\. Security & Performance
--------------------------

-   **Performance:** Immutability will be handled via shallow copies to avoid heavy overhead on large queues.

-   **Consistency:** By centralizing DB writes in PSM, we ensure that the "last read" position is always accurate even if the app crashes during a provider switch.

6\. Alternatives Considered
---------------------------

-   **Redux/Zustand:** While these would provide state management, the existing architecture is class-based and tightly integrated with background service lifetimes. A native observer pattern inside the existing classes is lower risk and maintains the "Service" mental model.
