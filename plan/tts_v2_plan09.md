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

## Implementation Steps

1. **Create `CarModeView`**
   - Layout: CSS Grid.
   - 2x2 or similar grid.
   - Top-Left: Rewind 30s.
   - Top-Right: Forward 30s.
   - Bottom: Play/Pause (Full width).
   - Colors: pure black background (`#000`), white text. High contrast.

2. **Wake Lock**
   - Use `navigator.wakeLock` API when Car Mode is active to keep screen on.

3. **Navigation**
   - Add a "Car Mode" button in the main reader header.
   - Add an "Exit" (X) button in Car Mode (requires long press or double tap to avoid accidental exit? Or just standard button).

4. **Testing**
   - Verify layout on mobile viewport.
   - Verify controls work.

5. **Pre-commit Steps**
   - Ensure proper testing, verification, review, and reflection are done.
