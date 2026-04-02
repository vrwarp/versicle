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

## 2025-10-26 - Accessible Theme & Visual Settings
**Learning:** `aria-pressed` is the correct attribute for toggle-like buttons in a group (like theme selection) when they aren't implemented as radio buttons. For `Radix UI` primitives like `Select` and `Tabs`, adding `aria-label` to the Trigger or List component ensures screen readers announce the control's purpose, especially when visual labels are absent or purely presentational.
**Action:** Always verify custom selection components (like button groups) expose their selected state to assistive technology. Use `aria-pressed` for button groups and `aria-label` for unlabelled dropdowns/tabs.

## 2025-05-30 - Enhanced Select Items with Icons
**Learning:** Using plain text for options like "Rating" (e.g., "4 Stars") is functional but lacks visual scannability and delight. Enhancing `Select` items with icons (like stars or status indicators) significantly improves recognition speed and aesthetic appeal without compromising accessibility if implemented correctly.
**Action:** When options have strong visual metaphors (ratings, statuses), use the `Select` component's ability to render complex children. Ensure icons are purely decorative (if text is present) or have appropriate labels, and maintain text labels for screen readers.

## 2025-05-31 - Password Visibility Toggle
**Learning:** Standard `<input type="password">` fields create friction for complex inputs like API keys, leading to user error and frustration. Users expect to be able to verify their input.
**Action:** Replace `Input type="password"` with a specialized `PasswordInput` component that includes a toggle button. Ensure the toggle is keyboard accessible and has appropriate ARIA labels (`Show password`/`Hide password`) to communicate state changes to assistive technology.

## 2025-06-01 - Accessible Search Feedback
**Learning:** Client-side filtering in lists often updates the DOM silently, leaving screen reader users unaware of the results (e.g., "5 items found").
**Action:** When implementing real-time search, always include a `sr-only` live region (`role="status"`) that announces the result count or "No results" message to provide immediate feedback.

## 2025-06-02 - Standardizing Checkboxes for Selection
**Learning:** Using ad-hoc `div`s with `role="checkbox"` for selection (like in the Reading List dialog) creates maintenance overhead and potential accessibility gaps (missing focus rings, keyboard support).
**Action:** Always use the shared `Checkbox` component (wrapping Radix UI) for selection interfaces. It handles keyboard navigation (Space/Enter), focus management, and accessibility attributes (`aria-checked`) automatically, ensuring a consistent experience across the app.

## 2026-03-03 - Replaced native button with Button component in GlobalNotesView
**Learning:** Found a missing `Button` component usage in `GlobalNotesView.tsx` where a native HTML `<button>` was used for the "Clear search" action. The native button also lacked an `aria-label`. Replacing it with the design system's `Button` component ensures consistent styling, while adding an `aria-label` improves keyboard navigation and screen reader support for a generic action text like "Clear search".
**Action:** Always verify if a native `<button>` element can be replaced by the shared `<Button>` component (`src/components/ui/Button.tsx`) to adhere to the existing UI patterns, and check that an explicit `aria-label` is provided if the button's visible text is ambiguous or absent.

## 2026-03-03 - Replacing Native Buttons Embedded in Lists and Dialogs
**Learning:** Found several instances of native HTML `<button>` elements embedded deeply in list components (`SearchPanel`, `TOCPanel`) and dialog interstitials (`ReprocessingInterstitial`) acting as primary triggers. While they look okay visually with custom classes, they break consistency with the design system, lack standard hover/focus/active states from our `<Button>`, and bypass any potential accessibility enhancements built into the shared component.
**Action:** Always replace native `<button>` tags with the design system's `<Button>` component (`src/components/ui/Button.tsx`). For list items that need to look like plain text or span the full width, use `<Button variant="ghost" className="w-full h-auto font-normal justify-start" />`. This preserves the custom layout while ensuring consistent keyboard accessibility and standardized focus states across the app.

## 2026-03-03 - Accessibility of Action Buttons in Lists and Cards
**Learning:** When using icon-only buttons for actions like "Copy", "Edit", or "Delete" within repeated UI elements like lists or cards (e.g., `AnnotationList`, `AnnotationCard`), native `<button>` elements often lack accessible names. Furthermore, styling them manually leads to inconsistencies with standard hover/focus states provided by the design system.
**Action:** Always replace native icon-only `<button>` tags with the `<Button variant="ghost" size="icon">` component from the design system, and critically, attach a descriptive `aria-label` attribute (e.g., `aria-label="Edit Note"`) to ensure assistive technologies can correctly interpret the action regardless of the visual icon.

## 2026-03-03 - Focus Visibility for Hover-Revealed Elements
**Learning:** Elements hidden via `opacity-0` and revealed on hover (`group-hover:opacity-100`) often become inaccessible to keyboard users because tabbing to them doesn't trigger the hover state, leaving focused elements invisible.
**Action:** Always pair `opacity-0 group-hover:opacity-100` with focus visibility classes (e.g., `focus-within:opacity-100` for containers or `focus-visible:opacity-100` for the element itself) to ensure they are visible when navigated to via keyboard.

## 2026-03-03 - Keyboard Accessibility for Hover-Revealed Elements
**Learning:** Elements hidden via `opacity-0` and revealed on hover (`group-hover:opacity-100`) often become inaccessible to keyboard users because tabbing to them doesn't trigger the hover state. Furthermore, if the hidden element is inside a wrapper that actually receives focus (like a Radix `DropdownMenuTrigger`), applying `focus-visible:opacity-100` to the hidden element itself is insufficient.
**Action:** Always pair `opacity-0 group-hover:opacity-100` with focus visibility classes. For elements wrapped in focusable containers, use `focus-within:opacity-100` on the hidden element so it becomes visible when the wrapper receives keyboard focus. For directly focusable elements, use `focus-visible:opacity-100 focus-visible:ring-2`.

## 2025-06-03 - Accessible Loading States in Buttons
**Learning:** Using an icon like `Loader2` to indicate a loading state in a button is visually clear, but without `sr-only` text, screen reader users might only hear the original button text (e.g., "Delete") while the action is actually "Deleting...".
**Action:** Always pair a spinning loading icon inside a button with `<span className="sr-only">Loading...</span>` (or context-specific text like "Deleting...") so screen readers announce the state change. Also, hide the original button text using `aria-hidden={isLoading}` if it remains in the DOM.

## 2026-03-21 - Accessible Hidden File Inputs
**Learning:** Hidden `<input type="file">` elements triggered by visible buttons are often missed by accessibility tools and lack names in the accessibility tree.
**Action:** Always add an `aria-label` to hidden file inputs to ensure they have an accessible name, even when they are not visually rendered.
## 2026-03-28 - Hidden Input ARIA Labels
**Learning:** Added `aria-label` attributes to visually hidden `<input type="file">` elements that are triggered by other visible proxy buttons.
**Action:** Always ensure that hidden file inputs have proper ARIA labels so they have an accessible name in the accessibility tree, even if they aren't visually rendered. However, do not add `aria-label` to elements with `display: none` (like Tailwind's `hidden` class) as they are completely removed from the accessibility tree, making the label ineffective.

## 2026-04-01 - Consistent Keyboard Accessibility for Custom Buttons
**Learning:** Custom interactive elements (like tabs or icon buttons) using native `<button>` tags without explicit focus styles can become invisible to keyboard users when navigating via Tab. Relying solely on hover states or generic browser outlines leads to an inconsistent and often inaccessible experience.
**Action:** Always apply the standard design system focus ring pattern (`focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2`) to all custom interactive elements and native buttons to ensure clear, consistent visual feedback for keyboard navigation.

## 2026-04-02 - WCAG 2.5.3 Label in Name & Native Button Consistency
**Learning:** Adding an `aria-label` to a button that differs from its visible text violates WCAG 2.5.3 (Label in Name), breaking the experience for voice control users. Additionally, native HTML `<button>` elements lacking explicit focus classes (like `focus-visible:ring-2`) become invisible to keyboard users.
**Action:** Rely on visible text for accessible names when descriptive, and never use `aria-label`s that conflict with visible text. Always replace native `<button>` tags with the design system's `<Button>` component to guarantee consistent focus rings and styling.
