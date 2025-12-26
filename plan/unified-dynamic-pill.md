Unified Dynamic Pill Architecture
=================================

1\. Executive Summary
---------------------

This document outlines the architectural refactoring of the application's primary interaction layer. The goal is to consolidate all bottom-screen controls (Audio playback and Text Annotation) into a single, always-visible **Dynamic Action Bar** (currently `CompassPill`).

This change resolves Android native UI conflicts (selection handles overlapping popovers) and simplifies the React component tree by removing the floating `AnnotationPopover` in favor of a global state-driven UI managed by a centralized controller.

2\. Problem Statement
---------------------

-   **Android Obfuscation**: Native text selection handles ("teardrops") on mobile devices have an infinite z-index, frequently obscuring floating menus placed near the text.

-   **Component Conflict**: Currently, `ReaderControlBar` (formerly `AudioReaderHUD`) and `AnnotationPopover` (local to Reader) compete for user attention and screen space.

-   **Ergonomics**: Reaching for floating menus near the top of the screen is difficult on modern large phones.

-   **Architecture**: The `CompassPill` is currently tightly coupled to the `audio/` directory despite being the ideal UI candidate for general app interactions.

3\. Solution: The "Always Visible" Dynamic Island
-------------------------------------------------

We will implement a **Single Source of Truth** for the bottom UI. The `ReaderControlBar` (acting as the Global UI Controller) will determine what to display in the `CompassPill` based on a strict priority stack.

### 3.1. State Priority Truth Table

The UI Controller (`ReaderControlBar`) determines the visual state based on the following logic cascade:

1.  **Annotation Mode (High Priority)**

    -   **Condition**: `useAnnotationStore.popover.visible === true`

    -   **Description**: Glassmorphism bar with color swatches (left) and action icons (right). Overrides all audio controls.

2.  **Active Audio Mode**

    -   **Condition**: `useTTSStore.queue.length > 0`

    -   **Description**: Standard Audio Player (Play/Pause, Title, Progress Bar).

3.  **Summary Mode**

    -   **Condition**: `useLibraryStore` has `lastRead` (on Home)

    -   **Description**: "Continue Reading" card showing book progress.

4.  **Idle / Null Mode (Lowest Priority)**

    -   **Condition**: None of the above

    -   **Description**: Component renders nothing (or hidden).

4\. Detailed Component Design
-----------------------------

### 4.1. `CompassPill` (Visual Component)

**Target Location**: `src/components/ui/CompassPill.tsx` **Current Location**: `src/components/audio/CompassPill.tsx` (To be moved)

This component becomes a "dumb" visual container that morphs based on the `variant` prop. It handles its own internal layout transitions (e.g., expanding for note entry) but delegates all logic.

**Detailed Props Interface:**

```
type ActionType =
  | 'color'      // Payload: 'yellow' | 'green' | 'blue' | 'red'
  | 'note'       // Payload: string (the note text)
  | 'copy'       // Payload: null
  | 'pronounce'  // Payload: null
  | 'play'       // Payload: null
  | 'dismiss';   // Payload: null

interface CompassPillProps {
  // The visual mode of the pill
  variant: 'active' | 'summary' | 'compact' | 'annotation';

  // Audio Mode Data (Optional)
  title?: string;
  subtitle?: string;
  progress?: number;

  // Interaction Callbacks
  onClick?: () => void; // General click (e.g. expand summary)

  // Annotation Mode Delegates
  // The component triggers this with specific actions, decoupling it from stores
  onAnnotationAction?: (action: ActionType, payload?: string) => void;

  // Feature Flags (for context-aware buttons)
  availableActions?: {
      play?: boolean;      // Show "Play from here" icon
      pronounce?: boolean; // Show "Fix Pronunciation" icon
  };
}

```

**Visual Specifications (Tailwind):**

-   **Container**: `relative z-50 flex items-center justify-between w-full max-w-md mx-auto transition-all duration-300`

-   **Glass Effect**: `bg-background/90 backdrop-blur-md border border-border shadow-2xl`

-   **Shape**:

    -   Default: `h-14 rounded-full`

    -   Editing Note: `min-h-[140px] rounded-2xl p-3` (Animates height)

-   **Color Swatches**: `w-6 h-6 rounded-full border hover:scale-125 transition-transform`

### 4.2. `ReaderControlBar` (Controller Component)

**Location**: `src/components/reader/ReaderControlBar.tsx`

This component acts as the **Orchestrator**. It subscribes to multiple Zustand stores and "computes" the correct props for the `CompassPill`.

**Store Subscriptions:**

-   `useAnnotationStore`: `{ popover, addAnnotation, hidePopover }`

-   `useTTSStore`: `{ queue, isPlaying, play, pause, jumpTo }`

-   `useReaderStore`: `{ immersiveMode, bookId }`

-   `useLibraryStore`: `{ books }` (For "Continue Reading" logic)

**Action Handling Strategy:** The `ReaderControlBar` implements the `handleAnnotationAction` function.

-   **Color**: Calls `addAnnotation({ type: 'highlight', color: payload })` -> `hidePopover()`.

-   **Note**: Calls `addAnnotation({ type: 'note', note: payload })` -> `showToast()` -> `hidePopover()`.

-   **Copy**: Uses `navigator.clipboard.writeText()` -> `showToast()` -> `hidePopover()`.

-   **Play**: Triggers TTS playback from the selection CFI.

-   **Pronounce**: Opens the Pronunciation Dialog (future integration).

5\. Implementation Roadmap
--------------------------

### Phase 1: Component Enhancement (In-Place)

-   [x] **Refactor `CompassPill.tsx`**:

    -   Modify `CompassPillProps` to include `variant` ('annotation'), `onAnnotationAction`, and `availableActions`.

    -   Add internal state: `const [isEditingNote, setIsEditingNote] = useState(false)`.

    -   Implement conditional rendering block for `variant === 'annotation'`:

        -   **Left**: Render color swatches (Yellow, Green, Blue, Red).

        -   **Right**: Render action buttons (`StickyNote`, `Mic`, `Play`, `Copy`, `X`).

    -   Implement "Edit Note" mode within `CompassPill`:

        -   Render `textarea` and `Save`/`Cancel` buttons when `isEditingNote` is true.

        -   Expand container styles (remove `h-14`, add `p-3`, `rounded-2xl`).

    -   Add `useEffect` to reset `isEditingNote` to `false` when `variant` changes (e.g., when dismissed).

-   [x] **Create `ReaderControlBar.tsx`**:

    -   Create file in `src/components/reader/`.

    -   Import `useTTSStore`, `useReaderStore`, `useLibraryStore`, `useAnnotationStore`.

    -   Implement state priority logic (Annotation > Audio > Summary).

    -   Implement `handleAnnotationAction` to dispatch store updates.

    -   Render `<CompassPill>` with derived props.
    -   *Implementation Note*: Included memoization for `lastReadBook` and correct title resolution for non-TTS active reading.

### Phase 2: Logic Migration

-   [ ] **Update `App.tsx`**:

    -   Import `ReaderControlBar` from `src/components/reader/ReaderControlBar`.

    -   Replace `<AudioReaderHUD />` with `<ReaderControlBar />`.

-   [ ] **Deprecate `AnnotationPopover`**:

    -   Modify `src/components/reader/AnnotationPopover.tsx` to return `null`.

    -   Add `@deprecated` JSDoc comment explaining functionality moved to `ReaderControlBar`.

-   [ ] **Clean up `ReaderView.tsx`**:

    -   Remove import and usage of `<AnnotationPopover />`.

    -   Verify `handleSelection` still calls `useAnnotationStore.showPopover(...)`.

### Phase 3: Refactor & Relocate (The "Move")

-   [ ] **Move `CompassPill`**:

    -   Move `src/components/audio/CompassPill.tsx` -> `src/components/ui/CompassPill.tsx`.

-   [ ] **Update Imports**:

    -   Update `src/components/reader/ReaderControlBar.tsx`.

    -   Update `src/components/audio/SatelliteFAB.tsx` (if it imports CompassPill).

    -   Update `src/components/audio/CompassPill.test.tsx` imports.

-   [ ] **Move Tests**:

    -   Move `src/components/audio/CompassPill.test.tsx` -> `src/components/ui/CompassPill.test.tsx`.

-   [ ] **Update Test IDs**:

    -   Ensure data-testids in `CompassPill` (`compass-pill-active`, `compass-pill-annotation`) match integration tests.

6\. Verification Checklist
--------------------------

1.  **Android Handle Check**:

    -   Select text on a mobile device (or simulated mobile viewport).

    -   Verify Android handles (teardrops) do not overlap the bottom bar.

    -   Verify the pill is reachable and interaction works.

2.  **State Precedence**:

    -   Start Audio Playback -> Pill shows Audio.

    -   Select Text -> Pill *must* switch to Annotation (hiding Audio controls).

    -   Dismiss Selection -> Pill *must* return to Audio controls.

3.  **Keyboard Handling**:

    -   Click "Note" icon.

    -   Verify virtual keyboard opens.

    -   Verify Pill expands to text area.

    -   Verify "Save" closes keyboard and toasts success.

4.  **Immersive Mode**:

    -   Toggle Immersive Mode.

    -   Verify Pill respects `compact` variant or hides appropriately based on `ReaderControlBar` logic.

### Progress Update (Phase 1)
- **CompassPill Refactor**:
  - Implemented `annotation` variant with color swatches and action buttons.
  - Implemented "Edit Note" mode with proper state management and UI transitions.
  - Added new props: `onAnnotationAction`, `availableActions`.
  - Verified backward compatibility with existing usages.
- **ReaderControlBar Creation**:
  - Created controller component managing state subscriptions.
  - Implemented priority logic: Annotation > Active (Audio/Reader) > Summary > Idle.
  - Implemented action handlers for annotation (color, note, copy, dismiss).
  - Note: "Play from here" and "Pronounce" actions are currently stubs (toasts).
- **Verification**:
  - Added unit tests for `ReaderControlBar` covering all state variants and actions.
  - Ran `src/components/audio/CompassPill.test.tsx` and `src/components/reader/ReaderControlBar.test.tsx` successfully.
  - Ran Docker verification suite (`test_journey_reading.py`, `test_compass_pill.py`) to ensure no regressions in existing flows.
