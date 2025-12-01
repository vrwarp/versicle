# Components

This directory contains the React components that make up the user interface.

## Directories

*   **`library/`**: Components specific to the "Library" view (book list, upload).
*   **`reader/`**: Components specific to the "Reader" view (EPUB rendering, controls, sidebars).
*   **`ui/`**: Reusable, generic UI components (buttons, dialogs, inputs), providing a consistent design system.

## Shared Components

*   **`GlobalSettingsDialog.tsx`**: The "Engine Room" of the application. A comprehensive modal dialog for managing global application settings, including TTS API keys, Gesture controls, Data management, and Dictionary rules.
*   **`ThemeSynchronizer.tsx`**: A utility component that renders nothing visually. It subscribes to the reader store and dynamically updates the `<html>` element's class list to enforce the active theme (Light, Dark, Sepia) globally.
