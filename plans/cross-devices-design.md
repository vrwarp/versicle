# User Interface Design: Cross-Device Syncing

**Role:** Lead UX Designer
**Focus:** Transparency, Control, and unobtrusive Intelligence.

---

## 1. Global Sync Indicators

Users need confidence that their data is safe. However, sync should mostly be invisible.

### A. The "Pulse" Indicator (Library Header)
*   **Location:** Top-right corner of the Library/Home view, replacing the static avatar or alongside it.
*   **States:**
    *   **Idle (Synced):** Cloud icon with a checkmark (green dot or subtle opacity). _Tooltip: "Last synced just now"._
    *   **Syncing:** Cloud icon with a rotating refresh badge.
    *   **Offline:** Cloud icon with a slash/strike-through. _Tooltip: "Offline. Changes saved locally."_
    *   **Error:** Cloud icon with a warning exclamation. Tap to see "Sync Log" (debug view).

### B. The "toast" Notification
*   **Trigger:** When a sync completes after being offline for > 1 hour, or when a new book is added from another device.
*   **Design:** Small, non-blocking toast at the bottom. *"Library updated from 'Desktop'"*.

## 2. Library View: Ghost Books

When a book is synced from another device but the content (EPUB) hasn't been downloaded yet.

### A. The Book Card
*   **Cover:** Displays the gradient cover (derived from `coverPalette`) or the thumbnail if available in the snapshot.
*   **Overlay Icon:** A distinct "Cloud Download" icon centered on the cover or in the corner.
*   **Opacity:** Slight transparency (e.g., 80% opacity) to denote it's not locally fully available.
*   **Action:** Tapping the book triggers the `importBookWithId` flow (fetching static resources).
    *   _Loading State:_ A circular progress ring overlays the cover during download.

### B. Filter / Sort
*   **Filter Option:** Add "On this device" vs "All Books" toggle in the library filter menu.

## 3. The "Smart Resume" Experience

The most critical interaction for cross-device reading.

### A. The "Jump" Toast
*   **Context:** User opens a book that was recently read on another device.
*   **Logic:** If `currentDevice.progress` < `remoteDevice.progress` AND `remoteDevice.lastRead` > `currentDevice.lastRead`.
*   **UI Component:** A floating pill at the bottom center (similar to "Scroll to bottom").
*   **Content:**
    *   *Icon:* Device icon (Phone/Tablet).
    *   *Text:* "Pick up where you left off on **Pixel 7**?"
    *   *Subtext:* "Chapter 5 • 42%"
    *   *Actions:* "Jump" (Primary), "Dismiss" (X).
*   **Behavior:**
    *   Tapping "Jump" smooth-scrolls or re-renders to the new CFI.
    *   Dismissing it ignores that specific remote session for this session.

### B. Progress Visualization
*   **TOC View:** Show "User's Avatar" or device icon next to the chapter where other devices are currently at.

## 4. Settings & Device Management

Give users control over their "Device Graph".

### A. "Sync & Backup" Section
*   **Toggle:** "Sync Library & Progress" (Master switch).
*   **Toggle:** "Sync over Wi-Fi only" (for heavy EPUB downloads).
*   **Status:** "Last Sync: 2 mins ago".
*   **Action:** "Sync Now" button.

### B. Manage Devices
*   **List:** Shows all devices contributing to the `SyncManifest`.
    *   *Current Device:* "This Device (Pixel 6)" - Active.
    *   *Other Devices:* "iPad Pro" - Last seen 2 hours ago.
*   **Actions per Device:**
    *   *Rename:* "Give this device a friendly name".
    *   *Remove:* "Remove from sync". This stops syncing FROM this device, but does not wipe the device remotely (unless we implement remote wipe, which is out of scope).

## 5. Conflict Resolution (The "Manual Merge")

Since we use `Yjs`, conflicts are automatically resolved. However, semantic conflicts might occur (e.g., Book title changed on both devices while offline).

*   **Strategy:** "Last Write Wins" (LWW) is the default UX. We do **not** burden the user with diff merging for metadata.
*   **Exception:** If a file (EPUB) is replaced with a different hash but same ID.
    *   *UI:* Show a "Version Conflict" badge on the book.
    *   *Action:* Ask user: "Keep Local Version" or "Download Remote Version"?

## 6. Accessibility Considerations

*   **Announcements:** Screen readers must announce "Sync started" and "Sync complete".
*   **Focus Management:** The "Smart Resume" toast must be focusable (Cmd/Ctrl+F6 or Tab order) but not steal focus immediately on load.
