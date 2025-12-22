# TTS System Hardening & Robustness Plan

## Executive Summary

The current Text-to-Speech (TTS) architecture in Versicle uses a hybrid approach with a React hook (`useTTS`) for content extraction and a singleton service (`AudioPlayerService`) for playback management. While functional, the system exhibits several fragility points related to state synchronization, concurrency, and data persistence that risk user experience during rapid interactions or network instability.

This document outlines a comprehensive plan to harden the TTS system, ensuring it is resilient to errors, handles rapid user inputs gracefully, and supports reliable session restoration ("snapshots").

## Current Architecture & Fragility Analysis

### 1. State Synchronization & Duplication
*   **Issue:** The playback state (queue, index, status) exists in two places: the `AudioPlayerService` (singleton source of truth) and `useTTSStore` (Zustand proxy for UI).
*   **Risk:** Asynchronous updates can lead to "split-brain" scenarios where the UI shows "Playing" while the service is "Stopped", or vice versa. The `setTimeout` in `AudioPlayerService.subscribe` is a workaround that masks potential race conditions during initialization.
*   **Fragility:** Rapid mounting/unmounting of components (e.g., toggling the Audio Panel) can cause listener leaks or missed state updates.

### 2. Concurrency & Race Conditions
*   **Issue:** The `play()` method in `AudioPlayerService` is asynchronous (awaiting synthesis) but lacks a locking mechanism.
*   **Risk:** Rapidly clicking "Next" or "Play" triggers multiple parallel execution contexts. This can result in:
    *   Multiple audio streams playing simultaneously (if `stop()` doesn't catch the previous pending promise).
    *   Queue index corruption (incrementing twice).
    *   Cost estimation double-counting.

### 3. Queue Volatility & Dependency on Layout
*   **Issue:** The TTS queue is derived purely from the `epub.js` rendered view via the `useTTS` hook. It is stored only in memory.
*   **Risk:** On a page reload or browser crash, the queue is lost.
    *   **Restoration Delay:** The system must wait for the book to parse, render, and layout before text can be re-extracted. This prevents "Instant Resume."
    *   **Sync Mismatch:** If the user resumes at a CFI that `epub.js` hasn't fully rendered yet, the extracted text might be empty or partial, leading to playback failures.

### 4. WebSpeech API Instability
*   **Issue:** The local `WebSpeechProvider` relies on browser events (`end`, `error`) which are notoriously unreliable in mobile browsers (iOS Safari, Android Chrome) when the screen is locked or the tab is backgrounded.
*   **Risk:** Playback may hang indefinitely at the end of a sentence if the `end` event never fires. The current fallback/retry logic is minimal.

### 5. Error Recovery
*   **Issue:** Fallback from Cloud to Local TTS involves a hard failure and a delayed retry.
*   **Risk:** Frequent network blips could cause a jarring experience (voice switching back and forth) or "death spirals" of error notifications.

---

## Roadmap: Hardening & Snapshots

We will address these issues in three distinct phases.

### Phase 1: Concurrency Safety & State Machine
**Goal:** Prevent invalid states and race conditions.
*   **[COMPLETED]** Implement a robust **Mutex/Lock** pattern for the `play()` action.
*   **[COMPLETED]** Implement **AbortController** for cancelling in-flight operations ("Last Writer Wins").
*   **[COMPLETED]** Formalize the `status` transitions into a strict State Machine.
*   Centralize state ownership to reduce sync overhead.

### Phase 2: Session Snapshots & Persistence
**Goal:** Enable "Instant Resume" and crash recovery.
*   **[COMPLETED]** **Queue Snapshotting:** Persist the current `queue` (text + CFIs) to IndexedDB whenever it changes.
*   **[COMPLETED]** **Context Restoration:** On load, hydrate the `AudioPlayerService` from IDB immediately, allowing playback to start *before* `epub.js` finishes rendering.
*   **[COMPLETED]** **Decoupling:** Reduce `useTTS` dependency on live DOM nodes for playback; use DOM only for *generation* of the queue.

### Phase 3: Resilience & Observability
**Goal:** Handle external failures gracefully.
*   **Watchdog Timer:** Detect hung `WebSpeech` processes and auto-restart.
*   **Circuit Breaker:** Smarter logic for Cloud -> Local fallback (e.g., "cool-down" periods).
*   **Debug Snapshots:** Ability to export the current internal state (Queue + Logs + Config) to a JSON file for user support.

---

## Next Steps

We will proceed by implementing **Phase 2** (Snapshots), followed by **Phase 3**.
