# Performance Optimization: ReaderView Re-renders

**Date:** 2024-05-24
**Status:** Completed

## Problem
The `ReaderView` component was re-rendering on every Text-to-Speech (TTS) sentence update.
This was caused by `ReaderView` subscribing to `activeCfi` and `currentIndex` from `useTTSStore`.
Since TTS updates `activeCfi` every few seconds (or faster), the entire `ReaderView` tree (including Header, Sidebars, GestureOverlay, and the `epub.js` container wrapper) was reconciling frequently.

## Solution
We isolated the high-frequency updates into a new child component: `ReaderTTSController`.

### Architecture Change
1.  **`ReaderTTSController`**: A new component that handles:
    *   Highlighting the current sentence in the `epub.js` rendition.
    *   Handling keyboard navigation (Arrow keys) which depends on the current TTS queue index.
    *   Subscribes directly to `activeCfi`, `currentIndex`, `status`, and `queue`.
    *   Uses `useRef` to maintain access to the latest state in event listeners without re-binding them.

2.  **`ReaderView` Refactoring**:
    *   Removed subscription to `activeCfi` and `currentIndex`.
    *   Removed `useEffect` hooks responsible for highlighting and keydown handling.
    *   `ReaderView` now only subscribes to `isPlaying`, `status`, `queue` (for auto-play logic), and `lastError`.
    *   Passes stable `onPrev` and `onNext` callbacks to `ReaderTTSController`.

## Impact
*   **Performance**: `ReaderView` no longer re-renders during normal TTS playback. Re-renders are confined to the lightweight `ReaderTTSController` (which returns `null` and only runs effects).
*   **Maintenance**: TTS-specific logic is now encapsulated in `ReaderTTSController`.

## Verification
*   Manual verification confirmed UI is stable during playback.
*   Regression tests (`test_journey_reading.py`) pass.
