# Implementation Design: The Chapter Compass Interface

## **1. Overview**

This document details the technical implementation of the "Chapter Compass" interface defined in `plan/design_sprint_5.md`. The goal is to create a persistent, "Head-Up Display" (HUD) for audio navigation that remains visible and functional even when the user navigates away from the active `ReaderView` (the "Headless" state).

## **2. Architectural Changes**

### **2.1 State Management (`useTTSStore`)**

To support "Headless" navigation, critical metadata must persist outside the `ReaderView` lifecycle. The `useReaderStore` resets on unmount, so we will migrate the "Now Playing" metadata to `useTTSStore`, which is globally persisted.

**New State Properties:**
```typescript
interface TTSState {
  // ... existing state
  currentChapterTitle: string | null;
  currentChapterIndex: number; // For "Chapter X" derivation
  chapterProgress: number;     // 0.0 - 1.0 (for ambient progress bar)
  timeRemaining: number | null; // Calculated or estimated
}
```

**New Actions:**
- `setChapterInfo(title: string, index: number, progress: number)`

### **2.2 Data Synchronization (`ReaderView`)**

The `ReaderView` component will act as the data producer. Within its `relocated` event handler (where it currently updates `useReaderStore`), it will also dispatch updates to `useTTSStore` if the TTS engine is active or if the user is simply reading (to prime the player).

### **2.3 Component Mounting (`App.tsx`)**

To ensure the interface persists across routes (e.g., Library View), the `FloatingControlsContainer` will be mounted at the root level in `App.tsx`, adjacent to `ToastContainer` and `GlobalSettingsDialog`.

## **3. Component Specification**

### **3.1 `FloatingControlsContainer.tsx`**

*   **Role:** Layout wrapper and visibility manager.
*   **Props:** None.
*   **Logic:**
    *   Subscribes to `useTTSStore.status`.
    *   Renders `null` if status is `stopped` (or based on a new `isMiniPlayerVisible` flag if we want it to persist after pause).
    *   Applies `pointer-events-none` to ensuring clicks pass through to the app below.
    *   Manages Z-index layering.

### **3.2 `CompassPill.tsx`**

*   **Role:** Information display and scrubbing.
*   **Visuals:** Glassmorphism (Backdrop blur, translucent background).
*   **Layout:** Flex row with three sections (Prev, Info, Next).
*   **Interactions:**
    *   **Tap Center:** Opens `UnifiedAudioPanel` (expands the sheet).
    *   **Tap Left/Right:** Calls `audioService.prev()` / `next()`.
    *   **Drag:** Implements a gesture responder for seeking (modifying `chapterProgress`).

### **3.3 `SatellitePlayButton.tsx`**

*   **Role:** Primary Play/Pause toggle.
*   **Visuals:** Solid Primary Color, Floating Action Button (FAB).
*   **Layout:** Absolute positioned "in orbit" (above and to the right of the pill).
*   **Interactions:**
    *   **Tap:** Toggles `isPlaying`.
    *   **Long Press:** Stops playback (kills session).

## **4. Implementation Steps**

1.  **Store Refactoring:**
    *   Update `src/store/useTTSStore.ts` with new fields.
    *   Update `src/components/reader/ReaderView.tsx` to sync data.

2.  **Component Creation:**
    *   `src/components/reader/CompassPill.tsx`
    *   `src/components/reader/SatellitePlayButton.tsx`
    *   `src/components/reader/FloatingControlsContainer.tsx`

3.  **Integration:**
    *   Import and render `FloatingControlsContainer` in `src/App.tsx`.
    *   Verify Z-indexing against `GlobalSettingsDialog` (z-50) and `UnifiedAudioPanel` (Sheet z-50). The FAB should be z-50, potentially conflicting with Modals. We will set FAB to `z-[45]` and Modals to `z-[50]` to be safe, or follow the spec strictly (`z-50` for FAB, `z-100` for Modals).

4.  **Styling Strategy (Tailwind):**
    *   **Pill:** `backdrop-blur-md bg-background/80 border border-white/10 shadow-lg rounded-full`
    *   **FAB:** `bg-primary text-primary-foreground shadow-xl rounded-full`

## **5. Edge Cases & Validation**

*   **Empty State:** If `currentChapterTitle` is null, display "Unknown Chapter".
*   **Navigation:** Ensure clicking "Next" in the Pill actually advances the book *and* the audio.
*   **Conflict:** If `UnifiedAudioPanel` is open, should the Compass Pill remain?
    *   *Decision:* The Pill is a *minimized* state. Opening the Panel should likely hide the Pill or merge with it. For simplicity in Phase 1, they can coexist, or the Panel covers the Pill (since Panel is a Sheet).

## **6. File Structure**

```
src/
  components/
    reader/
      CompassPill.tsx
      SatellitePlayButton.tsx
      FloatingControlsContainer.tsx
```
