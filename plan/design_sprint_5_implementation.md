# Implementation Design: Chapter Compass Interface (Sprint 5)

## 1. Overview
The **Chapter Compass Interface** acts as a "Audio Reader HUD," providing a persistent, minimized audio player overlaid on the application. It consists of two primary elements:
1.  **Compass Pill:** A floating capsule displaying playback status, chapter title, progress bar, and time remaining.
2.  **Satellite FAB:** A floating action button for the primary Play/Pause toggle.

This design decouples audio control from the heavy `ReaderView` chrome, allowing for a cleaner reading experience and potential persistence across views (e.g., Library).

## 2. Architecture & Integration

### 2.1 Component Hierarchy
The Compass Interface is a global overlay. It should be mounted high in the component tree to ensure persistence and correct z-indexing over other UI elements.

**File:** `src/App.tsx`
```tsx
<Router>
  <ThemeSynchronizer />
  <GlobalSettingsDialog />
  <ToastContainer />

  {/* NEW: Compass Interface Container */}
  <AudioReaderHUD />

  <div className="min-h-screen...">
    <Routes>...</Routes>
  </div>
</Router>
```

**New Components:**
*   `src/components/audio/AudioReaderHUD.tsx`: Container handling visibility logic (only show when book is active/audio queued).
*   `src/components/audio/CompassPill.tsx`: The main status capsule.
*   `src/components/audio/SatelliteFAB.tsx`: The Play/Pause button.

### 2.2 State Management
We rely on `useTTSStore` for playback state and `useReaderStore` for book context.

**Data Reconciliation:**
| UI Element | Source of Truth | Logic |
| :--- | :--- | :--- |
| **Visibility** | `useTTSStore.queue` | Show if `queue.length > 0`. |
| **Chapter Title** | `useTTSStore.queue[idx].title` | Fallback to `useReaderStore.currentChapterTitle` or "Chapter [N]". |
| **Playback Status** | `useTTSStore.status` | 'playing' \| 'loading' -> Pause Icon; 'paused' \| 'stopped' -> Play Icon. |
| **Progress Bar** | `currentIndex` / `queue.length` | `(currentIndex / (queue.length || 1)) * 100`. |
| **Time Remaining** | Derived | `(RemainingChars / (BaseWPM * Rate))`. BaseWPM ≈ 180 (English). |
| **Nav Actions** | `useTTSStore.jumpTo` | Prev/Next Chevrons jump +/- 1 index (or sentence). |

## 3. Component Specifications

### 3.1 AudioReaderHUD (Container)
*   **Role:** Positioning context and visibility manager.
*   **Logic:**
    *   Subscribes to `useTTSStore` (queue, status).
    *   Conditional Rendering: `if (queue.length === 0) return null;`
    *   Layout: Fixed position, bottom-centered (mobile) or responsive placement.
*   **Z-Index:** Must be high but below overlays like `GlobalSettingsDialog`.
    *   Spec: `z-40` (Pill), `z-50` (FAB).

### 3.2 Compass Pill
*   **Visuals:**
    *   Glassmorphism: `backdrop-blur-md`, `bg-background/80`, `border-white/10`.
    *   Shape: `rounded-full`.
    *   Shadow: `shadow-lg`.
*   **Layout (Grid/Flex):**
    *   **Left:** Chevron Left (Prev).
    *   **Center:** Vertical Stack.
        *   Row 1: Chapter Title (`text-xs font-medium truncate`).
        *   Row 2: Progress Bar + Time Remaining (`text-[10px] text-muted-foreground`).
    *   **Right:** Chevron Right (Next).
*   **Interactions:**
    *   Click `Prev`: `player.prev()` (or `jumpTo(index - 1)`).
    *   Click `Next`: `player.next()` (or `jumpTo(index + 1)`).
    *   Tap Body: Open `UnifiedAudioPanel` (Sheet) - *Future integration*.

### 3.3 Satellite FAB
*   **Visuals:**
    *   Circular, Primary Color (`bg-primary text-primary-foreground`).
    *   Floating independently of the Pill (visual "Satellite").
*   **Position:** Bottom-Right or anchored near Pill.
    *   *Spec:* "Floating to the right" (or overlapping edge).
*   **Interactions:**
    *   Tap: Toggle Play/Pause (`useTTSStore.play()` / `pause()`).

## 4. Implementation Steps

### Step 1: Utility Hooks
Create `src/hooks/useChapterDuration.ts` to calculate time remaining.
```typescript
export function useChapterDuration() {
  const queue = useTTSStore(state => state.queue);
  const index = useTTSStore(state => state.currentIndex);
  const rate = useTTSStore(state => state.rate);

  // Memoized calculation
  // Sum length of queue[index...end]
  // Divide by (180 * rate) * 5 (approx chars per word) -> minutes
}
```

### Step 2: Component Skeleton
Create the files in `src/components/audio/`.
*   Use `lucide-react` for icons (`ChevronLeft`, `ChevronRight`, `Play`, `Pause`).
*   Implement basic structure without complex animations first.

### Step 3: Styling & Theming
*   Apply Tailwind classes for Glassmorphism.
*   Ensure Dark/Sepia mode compatibility using CSS variables (`bg-background`, `text-foreground`).
*   **Z-Index Enforcement:**
    *   Pill: `z-40`
    *   FAB: `z-50`

### Step 4: Integration
*   Mount in `App.tsx`.
*   Verify behavior with `verification/test_journey_audio_deck.py` (needs update to check for new elements).

## 5. Technical Constraints & Decisions
*   **Mobile First:** The design is optimized for mobile (thumbs). On Desktop, it can center-float or align bottom-right.
*   **Progress Granularity:** `queue` items are sentences. Progress bar will step per sentence. This is acceptable performance-wise compared to char-level updates.
*   **Touch Targets:** Ensure Chevrons and FAB have `min-h-[44px]` touch areas even if icons are small.
