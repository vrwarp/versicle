# Design Sprint 1: UI Modernization

## Objective
Modernize the Versicle application UI to align with Material Design principles, utilizing the existing `shadcn/ui` component library (located in `src/components/ui`) to create a polished, responsive, and accessible experience.

## 1. Design System & Global Styles
- **Typography**: Adhere to a strict type scale. Use system sans-serif for UI elements and offer Serif/Sans/Monospace options for the Reader.
- **Color Palette**:
  - Primary: Blue-600 (Actionable elements)
  - Surface: White / Gray-900 (Dark mode)
  - Background: Gray-50 / Gray-950
- **Components**: Leverage `src/components/ui` for consistent look and feel (Buttons, Cards, Sheets, Sliders).

## 2. Library View Improvements (`src/components/library/LibraryView.tsx`)

### Current Issues (from Analysis)
- "My Library" header is plain.
- Drop zone takes up excessive vertical space.
- Grid layout is rigid and lacks visual polish.
- Empty state is minimal.

### Improvement Plan
1.  **Top App Bar**:
    - Implement a fixed top bar with a shadow.
    - Title: "Versicle" or "Library".
    - Actions: "Add Book" button (Primary variant) or a Profile/Settings icon.

2.  **Book Grid**:
    - Use a responsive grid (CSS Grid or improved `react-window` setup).
    - **Book Cards**:
        - Use the `Card` component.
        - **Cover**: Maintain aspect ratio (1:1.6). Add a subtle shadow.
        - **Info**: Truncate Title/Author properly.
        - **Actions**: Add a "Context Menu" (three dots) for actions like "Delete" or "View Details".

3.  **Ingestion/Upload**:
    - Move away from the always-visible massive drop zone.
    - **Option A**: A Floating Action Button (FAB) in the bottom right for "Add Book".
    - **Option B**: An "Add Book" button in the Top App Bar.
    - **Drag & Drop**: Implement a full-screen overlay that only appears when a file is dragged over the window.

4.  **Empty State**:
    - Center-aligned, illustrated (using an icon), with a clear call-to-action button "Import your first book".

## 3. Reader View Improvements (`src/components/reader/ReaderView.tsx`)

### Current Issues
- Header/Footer are always visible and take up space.
- TOC pushes content or overlays awkwardly.
- Settings menu is a small, unstyled absolute div.
- Typography is generic.

### Improvement Plan
1.  **Immersive Layout**:
    - **Header**: Minimalist. Back button, Chapter Title (centered, truncated), Menu actions.
    - **Visibility**: Tapping the center of the screen toggles the visibility of Header and Footer (Immersive Mode).

2.  **Navigation (Table of Contents)**:
    - Use the `Sheet` component (`src/components/ui/sheet.tsx`) for the Table of Contents.
    - This provides a standard "Side Drawer" experience with accessible focus management and animations.
    - Position: Left side.

3.  **Settings Panel**:
    - Replace the absolute div with a `Popover` or a bottom `Sheet` (especially for mobile).
    - **Controls**:
        - **Theme**: Large, clear swatches for Light/Dark/Sepia.
        - **Font Size**: Use the `Slider` component (`src/components/ui/slider.tsx`) for smooth adjustment.
        - **Font Family**: Dropdown or toggle group.

4.  **Footer / Progress**:
    - Slim design.
    - **Progress Bar**: Use `Slider` or a styled `Progress` component.
    - **Page Turns**: Retain chevron buttons but consider tap zones (left/right edge of screen) for easier navigation.

5.  **Search & TTS**:
    - Move Search and TTS into the Header actions.
    - TTS controls can appear as a floating panel or a bottom sheet when active.

## 4. Implementation Strategy

### Phase 1: Library Overhaul
- Refactor `LibraryView` structure.
- Implement Drag & Drop Overlay.
- Style `BookCard`.

### Phase 2: Reader Layout
- Implement `Sheet` for TOC.
- Refactor Header/Footer visibility logic.

### Phase 3: Reader Settings
- Implement Settings `Sheet` or Panel using `Slider` and `Button` variants.
- Polish Theme transitions.

## 5. Verification
- Verify responsiveness on Mobile vs Desktop sizes.
- Ensure `epub.js` rendering adapts to layout changes (resize events).
- Test Keyboard navigation (Tab index, Arrow keys).
