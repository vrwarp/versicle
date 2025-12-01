# UI Components

This directory contains reusable UI components, serving as the design system for the application. Many are built using Radix UI primitives and styled with Tailwind CSS to ensure consistency and accessibility.

## Files

*   **`Badge.tsx`**: A small status indicator or tag. Supports variants like `default`, `secondary`, `destructive`, and `outline`.
*   **`Button.tsx`**: The primary interactive element. Supports multiple variants (`default`, `secondary`, `destructive`, `outline`, `ghost`, `link`) and sizes.
*   **`Dialog.tsx`**: A standard modal dialog component built on Radix UI's Dialog primitive.
    *   `Dialog.test.tsx`: Unit tests for the `Dialog` component.
*   **`Input.tsx`**: A styled HTML input element for text entry.
*   **`Label.tsx`**: A semantic label component for form controls.
*   **`Modal.tsx`**: A higher-level wrapper around `Dialog`, providing a standardized layout with Title, Description, Content, and Footer.
*   **`Popover.tsx`**: A floating content popover triggered by a button or element, used for menus and settings.
*   **`Select.tsx`**: A dropdown selection component for choosing one value from a list.
*   **`Sheet.tsx`**: A side drawer component that slides in from the edge of the screen, used for the Audio Panel and TOC.
*   **`Slider.tsx`**: A range slider input, used for settings like font size or playback speed.
*   **`Switch.tsx`**: A toggle switch component for boolean settings.
*   **`Tabs.tsx`**: A tabbed interface component for organizing content into multiple views (e.g., in Global Settings).
*   **`Toast.tsx`**: A notification toast component for displaying temporary messages (success, error, info).
