## 2025-05-20 - Standardizing Touch Targets with UI Components

**Context:** The Reader View toolbar used raw HTML `<button>` elements with inconsistent styling and small touch targets (often effectively 36px or dependent on padding).

**Learning:**
- Replacing raw buttons with the design system's `Button` component (`size="icon"`) standardizes the touch target to 40px, which is closer to the 44px mobile target recommendation.
- It automatically provides accessible focus rings and keyboard interaction states.
- Visual consistency (e.g., `rounded-full`) can be maintained via `className` overrides on the standard component, allowing us to keep the design intent while improving UX and accessibility.

## 2025-02-14 - Active Mode Playback Indicators
**Learning:** In minimal UI states like "Active Mode" where actions are merged with information display, users often miss the interactivity. Text-only targets (like "Chapter 1") are ambiguous.
**Action:** When merging status and action, always provide a persistent icon (like Play/Pause) alongside the text label to signify both state and interactivity, even if space is tight.

## 2026-01-07 - Async Loading States in Dialogs

**Learning:** Users lack confidence in "destructive" but reversible actions like "Offload" when there's no immediate visual feedback. The `DeleteBookDialog` implemented a loading state pattern that `OffloadBookDialog` was missing, creating an inconsistent experience where "Offload" felt instantaneous (suspicious) or broken if it took time.

**Action:** When implementing dialog actions that involve async database or network operations, always replicate the `isSubmitting` / `Loader2` pattern. Ensure the primary action button shows a spinner and both action and cancel buttons are disabled to prevent double-submission or state conflict.

## 2025-05-21 - Accessible Status Indicators on Cards

**Learning:** Book cards use visual overlays (e.g., Cloud icon for offloaded) that lack accessible text, leaving screen reader users unaware of the status.
**Action:** Always pair status icons/overlays with `title` attributes for tooltips and `sr-only` text or `aria-label` for screen readers to ensure the status is communicable to all users.

## 2025-05-23 - Form Labels in Dialogs
**Learning:** Many form inputs in the Global Settings dialog were using raw `<label>` tags without `htmlFor` association, making them inaccessible to screen readers and harder to target with mouse clicks.
**Action:** When building settings forms, always use the `Label` component with `htmlFor` and a matching `id` on the `Input`. This ensures proper accessibility semantics and improves click-target usability.

## 2025-05-24 - Custom Confirmation Dialogs
**Learning:** Using `window.confirm` breaks the visual flow of the application and is not accessible/keyboard-friendly in the same way as our design system components. It also blocks the main thread.
**Action:** Replace `window.confirm` with custom `Dialog` components (e.g., `ReplaceBookDialog`). Manage the "pending confirmation" state (e.g., `pendingDuplicateFile`) in the parent component to conditionally render the dialog, ensuring a non-blocking and accessible experience.

## 2025-05-25 - Labeling Custom ARIA Controls
**Learning:** Standard `<Label htmlFor="...">` works for native inputs but fails for `div`/`span` based controls like Radix `Slider`.
**Action:** For custom controls, give the label text an `id` and use `aria-labelledby="label-id"` on the control component to ensure proper accessible name association.

## 2025-05-26 - Responsive Labels and Accessible Names
**Learning:** Using `hidden sm:inline` to visually hide a label on mobile also removes it from the accessibility tree, breaking `aria-labelledby` references and leaving controls nameless on small screens.
**Action:** When hiding visible labels responsively, always provide a robust fallback like `aria-label` on the control itself to ensure an accessible name exists at all breakpoints.

## 2025-05-27 - Status Indicators and Accessibility
**Learning:** Visual-only status indicators (like colored dots) that rely solely on `title` attributes are invisible to screen readers unless the user explores them with a mouse emulator or specific commands. `title` is not a reliable accessible name source for non-interactive elements.
**Action:** Always wrap status indicators in a container with `role="status"` (for live updates) or use `aria-label`/`sr-only` text to explicitly describe the state (e.g., "Synced", "Syncing") so it is programmatically determinable.

## 2025-05-28 - Destructive Action Feedback & Hidden Inputs
**Learning:** Destructive actions like "Clear All Data" that eventually reload the page can feel broken or unresponsive if they lack immediate loading feedback during the async operation.
**Action:** Always wrap destructive async operations in a loading state and show a spinner on the button immediately, even if the final step is a page reload.

**Learning:** Hidden file inputs triggered by other buttons are often missed by accessibility tools and lack names.
**Action:** Always add `aria-label` to hidden `<input type="file">` elements to ensure they have an accessible name in the DOM.
