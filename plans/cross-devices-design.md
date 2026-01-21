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

## 2. Library View: Ghost Books & Resume Badges

### A. The Book Card
*   **Cover:** Displays the gradient cover (derived from `coverPalette`) or the thumbnail if available in the snapshot.
*   **Overlay Icon:**
    *   *Not Downloaded:* A distinct "Cloud Download" icon centered on the cover.
    *   *Resume Available:* A small "Device" icon (e.g., Phone) in the bottom-right corner if another device is ahead of the current one.
*   **Action:**
    *   Tapping the book triggers the `importBookWithId` flow if content is missing.
    *   If content exists, it opens the book.

### B. Filter / Sort
*   **Filter Option:** Add "On this device" vs "All Books" toggle in the library filter menu.

## 3. The "Smart Resume" Experience

The most critical interaction for cross-device reading. This must be resilient to accidental dismissal.

### A. The "Jump" Toast (Transient)
*   **Context:** User opens a book that was recently read on another device.
*   **Logic:** If `currentDevice.progress` < `remoteDevice.progress` AND `remoteDevice.lastRead` > `currentDevice.lastRead`.
*   **UI Component:** A floating pill at the bottom center (similar to "Scroll to bottom").
*   **Content:**
    *   *Icon:* Device icon (Phone/Tablet).
    *   *Text:* "Pick up where you left off on **Pixel 7**?"
    *   *Subtext:* "Chapter 5 • 42%"
    *   *Actions:* "Jump" (Primary), "Dismiss" (X).

### B. Persistent Entry Points (Manual Recovery)
*   **Library Context Menu:** Long-press on a book -> "Resume from..." -> Shows list of devices with their progress.
*   **Reader "Sync Status" Menu:**
    *   Inside the reader, the "Three Dots" menu contains a "Sync Status" item.
    *   **Panel:** Displays a list of all devices and their current location in this book.
    *   **Action:** Tapping an entry (e.g., "iPad - Ch 8") immediately jumps to that location.
*   **Table of Contents (TOC):**
    *   Chapters where other devices are currently located are marked with a small avatar/device icon.
    *   _Tooltip/Label:_ "iPad Pro is here".

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
    *   *Remove:* "Remove from sync". This stops syncing FROM this device, but does not wipe the device remotely.

## 5. Conflict Resolution (The "Manual Merge")

Since we use `Yjs`, conflicts are automatically resolved. However, semantic conflicts might occur.

*   **Strategy:** "Last Write Wins" (LWW) is the default UX.
*   **Exception:** If a file (EPUB) is replaced with a different hash but same ID.
    *   *UI:* Show a "Version Conflict" badge on the book.
    *   *Action:* Ask user: "Keep Local Version" or "Download Remote Version"?

## 6. Accessibility Considerations

*   **Announcements:** Screen readers must announce "Sync started" and "Sync complete".
*   **Focus Management:** The "Smart Resume" toast must be focusable.
*   **Redundancy:** Ensure the "Sync Status" menu is keyboard accessible so users can find remote progress without relying on the transient toast.
