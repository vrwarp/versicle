## 2025-12-12 - Custom Progress Indicators
**Learning:** Custom div-based progress bars were missing semantic roles, making them invisible to screen readers despite being a key part of the book card UI.
**Action:** Always wrap visual progress bars with `role="progressbar"` and include `aria-valuenow`, `aria-valuemin`, `aria-valuemax`, and `aria-label`.

## 2025-12-12 - Destructive Action Confirmation
**Learning:** Native `window.confirm` is jarring and non-customizable. Radix UI `Dialog` can be easily integrated into list items (like `BookCard`) to provide a consistent, accessible confirmation flow without disrupting the user's context.
**Action:** Replace `window.confirm` with custom `Dialog` components for destructive actions, ensuring `stopPropagation` is handled correctly to prevent navigation.

## 2025-12-16 - Standardizing Buttons for Theme Consistency
**Learning:** Hardcoded utility classes (e.g., `bg-blue-600`) in empty states break theme support (Dark/Sepia modes). Using semantic components (like `<Button>`) and tokens (like `bg-primary`) ensures instant adaptation to all themes.
**Action:** Refactor raw HTML elements to design system components whenever possible to inherit accessibility and theming for free.

## 2025-12-18 - Integrated Drop Zones & Toast Feedback
**Learning:** Native `alert()` interrupts the user flow and feels outdated. Also, hiding key actions (like file upload) behind a button click in empty states adds friction.
**Action:** Replaced `alert()` with non-blocking Toast notifications. Integrated the `FileUploader` directly into the `EmptyLibrary` view to make the primary action (importing) immediately accessible via drag-and-drop.
