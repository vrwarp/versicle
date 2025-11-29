# Plan: Car Mode UI

## Priority: Medium (Safety)

A simplified, high-contrast UI with large touch targets for safe operation while driving.

## Goals
- Create a dedicated "Car Mode" view.
- Maximize button size (Play/Pause, Skip).
- Disable distracting features (Library, scrolling text).
- Prevent screen sleep.

## Proposed Files
- `src/components/reader/CarModeView.tsx`: The UI component.
- Route update in `App.tsx` (or overlay in `ReaderView`).

## Feasibility Analysis
This is a purely frontend task. No complex backend logic.
- **Wake Lock:** API is widely supported in Chrome/Android, less so in older iOS (but `NoSleep.js` video loop trick works if native API fails).
- **Navigation:** It should probably be a full-screen overlay within `ReaderView` so we don't lose the `epub.js` context (even if hidden). Unmounting `ReaderView` would stop playback if logic is tied to the component (which it partially is via hooks).

## Implementation Plan

1. **`CarModeView` Component**
   - Fixed position overlay `z-50`.
   - Black background.
   - Large SVG icons (Lucide).
   - Layout:
     - Top 20%: Current Chapter Title (Truncated, Large Text).
     - Middle 40%: Play/Pause (Huge).
     - Bottom 40%: Split Left/Right for Rewind/Forward.

2. **Integration**
   - Add state `isCarMode` to `useReaderStore` (transient).
   - In `ReaderView.tsx`, conditionally render `<CarModeView />`.

3. **Wake Lock**
   - Use `navigator.wakeLock.request('screen')` on mount.
   - Release on unmount.
   - Handle visibility change (re-request if tab comes back to focus).

4. **Gestures**
   - The large buttons are easy. Maybe add swipe gestures too (Plan 13 overlap).

5. **Pre-commit Steps**
   - Ensure proper testing, verification, review, and reflection are done.
