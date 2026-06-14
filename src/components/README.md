# Components

This directory contains the React components that make up the user interface.

## Directories

*   **`library/`**: Components specific to the "Library" view (book list, upload).
*   **`reader/`**: Components specific to the "Reader" view (EPUB rendering, controls, sidebars).
*   **`ui/`**: Reusable, generic UI components (buttons, dialogs, inputs), providing a consistent design system.

## Shared Components

*   Settings moved to `src/app/settings/` in Phase 8: `SettingsShell.tsx` (the `/settings/:tab` route overlay) renders lazy, self-contained panels from `registry.ts`; the presentational tabs stay in `settings/` here.
*   **`ThemeSynchronizer.tsx`**: A utility component that renders nothing visually. It subscribes to the reader store and dynamically updates the `<html>` element's class list to enforce the active theme (Light, Dark, Sepia) globally.
