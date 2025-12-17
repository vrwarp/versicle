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
    *   Subscribes to `useTTSStore` (queue, status) and `useLocation` (router).
    *   **Route Detection:**
        *   If `location.pathname === '/'` (Library): Mode = `summary`.
        *   Else: Mode = `active`.
    *   **Library Mode Enforcement:** If entering Library, call `pause()` if playing to stop audio.
    *   Conditional Rendering: `if (queue.length === 0) return null;`
    *   Layout: Fixed position, bottom-centered (mobile) or responsive placement.
*   **Z-Index:** Must be high but below overlays like `GlobalSettingsDialog`.
    *   Spec: `z-40` (Pill), `z-50` (FAB).

### 3.2 Compass Pill
*   **Props:** `variant: 'active' | 'summary'`
*   **Visuals:**
    *   Glassmorphism: `backdrop-blur-md`, `bg-background/80`, `border-white/10`.
    *   Shape: `rounded-full` (active) or `rounded-xl` (summary).
    *   Shadow: `shadow-lg`.
*   **Layout (Grid/Flex):**
    *   **Active Mode:**
        *   **Dynamic Left Button:**
            *   If `playing`: `SkipBack` icon (Prev Sentence).
            *   If `idle`: `ChevronsLeft` icon (Prev Chapter).
        *   **Center:** Vertical Stack (Chapter Title + Time Remaining).
        *   **Dynamic Right Button:**
            *   If `playing`: `SkipForward` icon (Next Sentence).
            *   If `idle`: `ChevronsRight` icon (Next Chapter).
    *   **Summary Mode (Library):**
        *   **Left/Right:** Hidden (No Chevrons).
        *   **Center:** Vertical Stack (3 Rows).
            *   Row 1: Book Title (`text-xs font-bold truncate`).
            *   Row 2: Chapter Title (`text-xs font-medium truncate`).
            *   Row 3: Progress % (`text-[10px] text-muted-foreground`).
*   **Interactions:**
    *   **Active:**
        *   `Skip`: Jump +/- 1 index (sentence).
        *   `Chevron`: Call `prevChapter()` / `nextChapter()`.
    *   **Summary:** Read-only info. No navigation.

### 3.3 Satellite FAB
*   **Visuals:**
    *   Circular, Primary Color (`bg-primary text-primary-foreground`).
    *   Floating independently of the Pill (visual "Satellite").
*   **Position:** Bottom-Right or anchored near Pill.
*   **Visibility:**
    *   **Reader View:** Visible.
    *   **Library View:** Hidden (`display: none` or null).
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

### Step 5: Reader Cleanup
*   **Remove Legacy Footer:**
    *   Locate `src/components/reader/ReaderView.tsx`.
    *   Remove the `<footer>...</footer>` block containing Prev/Next Page buttons and progress bar.
*   **Safe Area Padding:**
    *   Add `pb-32` (or similar) to the `ReaderView` content container to prevent text occlusion by the floating Compass Pill.

### Step 6: Verification Updates
*   **Update `verification/test_journey_reading.py`:**
    *   The test relies on data-testids `#reader-prev-page` and `#reader-next-page` which are being removed with the footer.
    *   **Action:** Update the test to use Keyboard Navigation (`page.keyboard.press("ArrowRight")`) or verify against the new Gesture Overlay zones if explicitly testing touch.
    *   **Validation:** Ensure the test still passes the "Reading Journey" by navigating pages via alternate inputs.
    *   **Compass Check:** Add an assertion to verify the Compass Pill is visible (`expect(page.get_by_test_id("compass-pill")).to_be_visible()`) instead of checking for the footer progress bar.

## 5. Technical Constraints & Decisions
*   **Mobile First:** The design is optimized for mobile (thumbs). On Desktop, it can center-float or align bottom-right.
*   **Progress Granularity:** `queue` items are sentences. Progress bar will step per sentence. This is acceptable performance-wise compared to char-level updates.
*   **Touch Targets:** Ensure Chevrons and FAB have `min-h-[44px]` touch areas even if icons are small.

## 6. Implementation Status
- [x] Step 1: Utility Hooks (`useChapterDuration`)
- [x] Step 2: Component Skeleton (`CompassPill`, `SatelliteFAB`)
- [x] Step 3: Styling & Theming
- [x] Step 4: Integration (`AudioReaderHUD`, `App.tsx`)
- [x] Step 5: Reader Cleanup (Removed footer, added padding)
- [x] Step 6: Verification Updates (`test_journey_reading.py` updated, `test_journey_audio_hud.py` created)
