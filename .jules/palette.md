[Output truncated for brevity]

## 2026-04-30 - Added ARIA labels to Diagnostics icon buttons
**Learning:** Found instances where icon-only buttons relied solely on `title` attributes (e.g. `Share2` and `Trash2` in `DiagnosticsTab.tsx`). While `title` provides a tooltip on hover, it's not a reliable substitute for `aria-label` for screen reader accessibility, particularly on mobile or touch interfaces.
**Action:** Always ensure `size="icon"` buttons with Radix/Lucide icons explicitly receive an `aria-label` detailing the action, complementing the `title` attribute for comprehensive accessibility.

## 2026-05-01 - Replaced native confirm() with UI Dialogs
**Learning:** Found that deleting annotations used the native browser `confirm()` popup. This blocks the main UI thread, looks jarring against the dark/light design system, and provides an inconsistent user experience compared to the rest of the app's modals.
**Action:** Replace native `confirm()` and `window.confirm()` calls with the app's standard `Dialog` component (using local state to trigger it). This provides a seamless, non-blocking, and accessible confirmation experience that perfectly matches the app's visual language.