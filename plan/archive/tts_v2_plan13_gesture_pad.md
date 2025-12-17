# Plan: Gesture Pad Overlay

## Status: Completed

## Priority: Low (Delight)

A full-screen gesture layer for controlling playback without looking.

## Goals
- Detect taps and swipes.
- Single Tap: Play/Pause.
- Double Tap: Skip/Rewind.
- Swipe: Volume/Speed.

## Proposed Files
- `src/components/reader/GestureOverlay.tsx`.

## Feasibility Analysis
Similar to Car Mode, this is a UI overlay.
- **Conflict:** Gestures might conflict with standard browser gestures (back/forward) or OS gestures.
- **Library:** `use-gesture` or similar React hook library is recommended over raw touch events for robustness.
- **Accessibility:** Ensure screen readers can still define what's happening.

## Implementation Plan

1. **Component**
   - `<GestureOverlay />` covering the screen.
   - Use `react-use-gesture` (if added) or standard `onTouchStart` tracking.

2. **Logic Map**
   - Tap Center: Toggle Play/Pause.
   - Tap Left/Right (25% width): Rewind/Forward.
   - Swipe Up/Down: Volume +/-.
   - Swipe Left/Right: Next/Prev Chapter (requires confirmation?).

3. **Visuals**
   - Show transient icons on action (e.g., big Play icon fades in and out).

4. **Integration**
   - "Gesture Mode" toggle in Audio Deck (UnifiedAudioPanel).

5. **Pre-commit Steps**
   - Ensure proper testing, verification, review, and reflection are done.
