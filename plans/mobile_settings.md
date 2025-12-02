# Mobile Settings Dialog Plan

## Problem
The `GlobalSettingsDialog` uses a fixed layout optimized for desktop:
- Fixed height `h-[600px]`.
- Flex row layout splitting width 25% (sidebar) / 75% (content).
- Fixed widths cause overlapping and squashing on mobile screens (e.g., < 640px).

## Solution
Refactor the dialog to use a responsive layout that adapts to screen size.

### Mobile Layout (< 640px)
- **Container**: `flex-col`, `h-[90vh]` (or fit content up to max).
- **Sidebar**:
  - Placed at the top.
  - `w-full`.
  - Horizontal scrollable list of tabs (`overflow-x-auto`).
  - "Settings" title hidden to save vertical space.
- **Content**:
  - Below sidebar.
  - `w-full`, `flex-1` (takes remaining height).
  - Reduced padding (`p-4`).

### Desktop Layout (>= 640px)
- **Container**: `flex-row`, `h-[600px]`.
- **Sidebar**:
  - Left side.
  - `w-1/4`.
  - Vertical stack of tabs.
  - "Settings" title visible.
- **Content**:
  - Right side.
  - `w-3/4`.
  - `p-8` padding.

## Implementation Details
1.  **ModalContent Class Changes**:
    - `flex` -> `flex flex-col sm:flex-row`
    - `h-[600px]` -> `h-[90vh] sm:h-[600px]`
    - `max-w-3xl` (kept)

2.  **Sidebar Class Changes**:
    - `w-1/4` -> `w-full sm:w-1/4`
    - `border-r` -> `border-b sm:border-r sm:border-b-0`
    - `p-4` -> `p-2 sm:p-4` (tighter on mobile)
    - `space-y-2` -> `gap-2` (works for both flex directions)
    - Add `flex flex-row sm:flex-col overflow-x-auto sm:overflow-visible items-center sm:items-stretch`

3.  **Sidebar Elements**:
    - `<h2>Settings</h2>`: Add `hidden sm:block`.
    - Buttons: Add `whitespace-nowrap flex-shrink-0 w-auto sm:w-full`.

4.  **Content Class Changes**:
    - `w-3/4` -> `w-full sm:w-3/4`
    - `p-8` -> `p-4 sm:p-8`
    - `overflow-y-auto` (kept)

## Verification
- Verify desktop layout remains unchanged.
- Verify mobile layout stacks correctly and tabs are accessible.
