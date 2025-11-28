# Design Sprint 1: UI/UX Modernization

## 1. Executive Summary
The current implementation of Versicle provides robust backend functionality (ingestion, rendering, TTS, persistence) but lacks a cohesive visual identity and user experience polish. The verification screenshots reveal a "developer UI" with raw layout elements, inconsistent spacing, and minimal styling.

This sprint focuses on implementing a **Material Design-inspired system** to create a polished, responsive, and accessible interface. The goal is to transition from a functional prototype to a consumer-grade PWA.

## 2. Design System Foundation

### 2.1 Color Palette
We will adopt a semantic color system that supports the three core themes (Light, Dark, Sepia).

| Semantic Token | Light Theme | Dark Theme | Sepia Theme |
| :--- | :--- | :--- | :--- |
| **Primary** | `slate-900` (#0f172a) | `slate-50` (#f8fafc) | `amber-900` (#78350f) |
| **Secondary** | `slate-600` (#475569) | `slate-400` (#94a3b8) | `amber-800` (#92400e) |
| **Background** | `white` (#ffffff) | `slate-950` (#020617) | `amber-50` (#fffbeb) |
| **Surface** | `slate-50` (#f8fafc) | `slate-900` (#0f172a) | `amber-100` (#fef3c7) |
| **Border** | `slate-200` (#e2e8f0) | `slate-800` (#1e293b) | `amber-200` (#fde68a) |
| **Destructive** | `red-600` (#dc2626) | `red-500` (#ef4444) | `red-700` (#b91c1c) |

### 2.2 Typography
Switch to a modern sans-serif stack (Inter or System UI) with a clear hierarchy.

*   **H1 (Library Title)**: 24px/32px, Bold
*   **H2 (Section Headers)**: 20px/28px, Semibold
*   **H3 (Book Titles)**: 16px/24px, Medium
*   **Body**: 14px/20px, Regular
*   **Caption (Author, Dates)**: 12px/16px, Text-Muted

## 3. Component Overhaul

### 3.1 Library View (`/`)
*Current State:* Plain header, dashed drop box, basic cards with no elevation.

** Improvements:**
1.  **App Bar**: Replace the text header with a sticky top `AppBar` containing the logo/title ("Versicle") and a "Settings" or "About" icon.
2.  **Floating Action Button (FAB)**: Replace the large static drop zone with a bottom-right FAB (`+`) for adding books.
    *   *Interaction*: Clicking FAB opens a file picker. Drag-and-drop works globally over the grid with a full-screen overlay indication.
3.  **Book Grid**:
    *   **Card Design**: Use `shadcn/ui` Cards with subtle shadows (`shadow-sm` -> `shadow-md` on hover).
    *   **Cover Art**: Enforce aspect ratio (1:1.5) with `object-cover` and a fallback placeholder for missing covers.
    *   **Actions**: Add a `DropdownMenu` (3 dots) on each card for "Delete" and "View Details".
4.  **Empty State**: If `books.length === 0`, display a centered vector illustration (e.g., an open book or library icon) with a "Drop EPUBs here or click + to start" message, removing the persistent dashed box.

### 3.2 Reader View (`/read/:id`)
*Current State:* Persistent white header/footer even in Sepia/Dark modes, basic slider, standard scrollbars.

**Improvements:**
1.  **Immersive Chrome**:
    *   **Auto-Hide**: The Header and Footer should slide out of view when the user interacts with the book content (clicks/taps center).
    *   **Theming**: The chrome (Header/Footer) must inherit the background color of the active theme (e.g., in Sepia, the header should be `amber-50`, not white) to prevent glare.
2.  **Header Refinement**:
    *   Truncate long chapter titles with an ellipsis.
    *   Group icons (Search, TTS, Settings) with consistent spacing (`gap-2` or `gap-4`).
3.  **Footer Refinement**:
    *   **Slider**: Use a thinner track with a larger touch target for the thumb.
    *   **Layout**: `Prev | Progress Slider | Next`. Consider moving the "0%" text to a tooltip or floating badge above the slider.
4.  **TOC Drawer (Sheet)**:
    *   Highlight the **currently active chapter** in the list.
    *   Ensure the drawer background matches the theme.

### 3.3 Settings & Controls
*Current State:* Functional but basic popovers.

**Improvements:**
1.  **Settings Sheet**:
    *   Organize into sections: "Display" (Theme, Font Size), "Audio" (TTS Voice, Speed).
    *   Use segmented controls (Toggle Group) for Theme selection (Light | Sepia | Dark) instead of a dropdown if space permits.
2.  **Dialogs**:
    *   Standardize confirmation dialogs (e.g., "Delete Book?") using `AlertDialog`.

## 4. Implementation Plan

### Step 1: Foundation & Theming (Completed)
*   [x] Update `tailwind.config.js` with the semantic color palette.
*   [x] Create a global `ThemeContext` or update `useReaderStore` to apply classes to the `<body>` or a top-level wrapper, ensuring the entire app (not just the reader frame) shifts colors.
*   [x] Initial refactor of `LibraryView` and `ReaderView` to use semantic tokens.

### Step 2: Library UI
*   Refactor `LibraryView.tsx`.
*   Implement `AppBar` and `FAB`.
*   Implement `BookCard` component with `DropdownMenu`.
*   Implement `EmptyState` component.

### Step 3: Reader Chrome
*   Refactor `ReaderView.tsx`.
*   Implement "Immersive Mode" state (`showControls: boolean`).
*   Apply theme classes to the `Sheet` (TOC) and `Header`/`Footer` components.

### Step 4: Polish
*   Add transitions (fade/slide) for the controls.
*   Verify accessibility (contrast ratios, aria-labels for the new FAB and buttons).
