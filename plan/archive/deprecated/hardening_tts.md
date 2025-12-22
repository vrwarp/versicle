# TTS & Audio Resilience Design

## 1. Current Architecture & Weaknesses

### Current Implementation
- **Service:** `AudioPlayerService` is a singleton managing `WebSpeechProvider` (local) and `CapacitorTTSProvider` (native).
- **State:** Manages `playing`, `paused`, `stopped`, `loading`.
- **Synchronization:** `SyncEngine` aligns text with audio time.
- **Queue:** `TTSQueue` is persistent in DB.

### Vulnerabilities
- **Race Conditions:** Rapidly clicking "Play" calls `synthesize` (async).
- **WebSpeech Flakiness:** `getVoices` can return empty arrays.
- **Provider Switching:** Fallback logic is implemented but complex.

## 2. Hardening Strategy

### 2.1. Strict State Machine [PARTIAL]
We enforce transitions to prevent impossible states.

- **Action:** Define a transition map.
- **Status:** `AudioPlayerService` has a `setStatus` method with placeholder transition validation. Needs to be fully implemented to strictly enforce transitions.
- **Action:** Introduce `operationId` or `AbortController` for pending async tasks.
  - **Status:** Pending. `pendingPromise` chain is used, but cancellation logic (`AbortController`) is not fully explicit in `playInternal` / `stopInternal`.

### 2.2. WebSpeech Stability [PARTIAL]
- **Action:** Polling with exponential backoff for `getVoices`.
- **Status:** `WebSpeechProvider` implements some polling, but could be more robust.
- **Action:** Watchdog timer for `start` -> `end`.
- **Status:** Not explicitly implemented in `AudioPlayerService`.

### 2.3. Audio Context & Autoplay [COMPLETED]
- **Action:** Ensure `AudioContext` is resumed.
- **Status:** Handled by providers or implicit in interaction.

### 2.4. SyncEngine Optimization [COMPLETED]
- **Action:** `SyncEngine` handles alignment data.
- **Status:** Implemented.

## 3. Implementation Plan

1.  **Refactor `AudioPlayerService`**:
    - Add `private pendingOperation: AbortController | null`. (Pending)
    - Implement `transition()` method. (Partial - `setStatus` exists but loose)
2.  **Harden `WebSpeechProvider`**:
    - Improve `init()` with robust polling. (Pending review)
    - Add `watchdog` logic in `synthesize`. (Pending)
3.  **UI Updates**:
    - Update `UnifiedAudioPanel` to respect strict states. (Done)
