# TTS & Audio Resilience Design

## 1. Current Architecture & Weaknesses

### Current Implementation
- **Service:** `AudioPlayerService` is a singleton managing `WebSpeechProvider` (local) and `AudioElementPlayer` (cloud).
- **State:** Manages `playing`, `paused`, `stopped`, `loading`.
- **Synchronization:** `SyncEngine` aligns text with audio time.
- **Queue:** `TTSQueue` is derived from UI state.

### Vulnerabilities
- **Race Conditions:** Rapidly clicking "Play" calls `synthesize` (async). If "Stop" is clicked before `synthesize` returns, the audio might start playing *after* the UI shows "Stopped".
- **WebSpeech Flakiness:** `getVoices` can return empty arrays. Events (`end`) might be missed on mobile.
- **Provider Switching:** Fallback logic is hardcoded and can cause loops.

## 2. Hardening Strategy

### 2.1. Strict State Machine
We will enforce transitions to prevent impossible states.

- **Action:** Define a transition map.
  ```typescript
  const TRANSITIONS = {
    stopped: ['loading', 'playing'],
    loading: ['playing', 'stopped', 'paused'],
    playing: ['paused', 'stopped', 'completed', 'loading'],
    paused: ['playing', 'stopped', 'loading'],
    completed: ['stopped', 'loading'] // restart
  };
  ```
- **Action:** Use a `transition(to: Status)` method that checks validity before updating.
- **Action:** Introduce an `operationId` or `AbortController` for pending async tasks.
  - When `play()` is called, generate `opId`. Pass it to `synthesize`.
  - If `stop()` is called, cancel the `AbortController` or invalidate the `opId`.
  - In `synthesize` callback, check if `opId` is still current.

### 2.2. WebSpeech Stability
- **Action:** Polling with exponential backoff for `getVoices` (up to 5s).
- **Action:** Watchdog timer for `start` -> `end`. If `speaking` is true but no boundary/end event for N seconds, force restart or move next.
- **Action:** Explicitly handle `interrupted` error code (which is normal behavior) vs actual errors.

### 2.3. Audio Context & Autoplay
- **Action:** Ensure `AudioContext` (if used by specific providers) is resumed on user interaction.
- **Action:** Handle `NotAllowedError` (Autoplay policy) by showing a "Tap to Play" UI overlay if playback fails.

### 2.4. SyncEngine Optimization
- **Action:** If chapters are huge, implement binary search in `updateTime`.
- **Action:** Ensure `AlignmentData` is sorted upon load.

## 3. Implementation Plan

1.  **Refactor `AudioPlayerService`**:
    - Add `private pendingOperation: AbortController | null`.
    - Implement `transition()` method.
2.  **Harden `WebSpeechProvider`**:
    - Improve `init()` with robust polling.
    - Add `watchdog` logic in `synthesize`.
3.  **UI Updates**:
    - Update `UnifiedAudioPanel` to respect strict states (disable Play button while `loading`).
