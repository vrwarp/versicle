# Plan: Gesture Pad Overlay

## Priority: Low (Delight)

A full-screen gesture layer for controlling playback without looking.

## Goals
- Detect taps and swipes.
- Single Tap: Play/Pause.
- Double Tap: Skip/Rewind.
- Swipe: Volume/Speed.

## Proposed Files
- `src/components/reader/GestureOverlay.tsx`.

## Implementation Steps

1. **Create Overlay Component**
   - Transparent `div` covering the viewport (z-index high).
   - Use a gesture library or `touchstart`/`touchend` logic.

2. **Logic**
   - Tap: `togglePlay()`.
   - Double Tap Left (0-50% width): `rewind()`.
   - Double Tap Right (50-100% width): `forward()`.

3. **Integration**
   - Toggle in Reader menu: "Gesture Mode".
   - When active, render the overlay.

4. **Feedback**
   - Visual ripple effect on tap.
   - Haptic feedback (vibration) if supported.

5. **Pre-commit Steps**
   - Ensure proper testing, verification, review, and reflection are done.
