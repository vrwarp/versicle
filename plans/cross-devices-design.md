# User Interface Design: Cross-Device Syncing (Expanded)

**Role:** Lead UX Designer
**Focus:** Transparency, Control, and unobtrusive Intelligence.
**Design Philosophy:** "Inform, Don't Interrupt."

---

## 1. Global Sync Indicators

Users need confidence that their data is safe. However, sync should mostly be invisible. We must balance "Peace of Mind" with "Visual Clutter".

### A. The "Pulse" Indicator (Library Header)
*   **Location:** Top-right corner of the Library/Home view, replacing the static avatar or alongside it. This is the "Heartbeat" of the app.
*   **States & Animations:**
    *   **Idle (Synced):** Cloud icon with a checkmark (green dot or subtle opacity).
        *   _Tooltip/Long Press:_ "Last synced: Just now".
    *   **Syncing:** Cloud icon with a rotating refresh badge.
        *   _Animation:_ Smooth 360-degree spin, ease-in-out.
        *   _Tooltip:_ "Syncing changes..."
    *   **Offline:** Cloud icon with a slash/strike-through.
        *   _Color:_ Neutral Gray (slate-400).
        *   _Tooltip:_ "Offline. Changes saved locally. Will sync when online."
    *   **Error:** Cloud icon with a warning exclamation.
        *   _Color:_ Warning Amber/Red.
        *   _Action:_ Tap to open the "Sync Log" (debug view).
    *   **Partial Sync:** Cloud icon with a generic "download" arrow (not rotating).
        *   _Use Case:_ Metadata is synced, but heavy assets (EPUBs) are pending.

### B. The "Toast" Notification Ecosystem
*   **Philosophy:** Only notify for *significant* remote events that the user might miss.
*   **Trigger:** When a sync completes after being offline for > 1 hour, or when a new book is added from another device.
*   **Design:**
    *   Small, non-blocking toast at the bottom.
    *   *Entrance Animation:* Slide up from bottom, fade in.
    *   *Duration:* 4 seconds.
    *   *Action:* "Undo" (if applicable) or "View".
*   **Copy Examples:**
    *   "Library updated from 'Desktop'."
    *   "Added 'Dune' from Phone."
    *   "Sync failed. Tap to retry."

## 2. Library View: Ghost Books & Resume Badges

This is the primary interface for managing content across devices without downloading everything.

### A. The Book Card (Ghost State)
*   **Visuals:**
    *   **Cover:** Displays the gradient cover (derived from `coverPalette`) or the thumbnail if available in the snapshot.
    *   **Opacity:** 80% opacity to visually distinguish from "Local" books.
    *   **Overlay Icon:** A distinct "Cloud Download" icon centered on the cover.
        *   *Size:* 48x48dp.
        *   *Color:* White with drop shadow for contrast.
*   **Interactions:**
    *   **Tap:** Triggers the `importBookWithId` flow.
    *   **Loading State:** The overlay icon transforms into a circular progress ring (determinate if size known, indeterminate if not).
    *   **Long Press:** Opens context menu: "Download", "Remove from Library", "Properties".

### B. The "Resume" Badge
*   **Condition:** Displayed when `remoteDevice.progress > localDevice.progress`.
*   **Visuals:**
    *   Small rounded pill in the bottom-right corner of the book card.
    *   *Icon:* Device Type (Phone/Tablet/Desktop).
    *   *Text:* "Ch 5".
    *   *Color:* Accent color (e.g., Indigo-600) to grab attention.
*   **Action:** Tapping the *Badge specifically* shortcuts directly to the remote location. Tapping the *Book* opens it normally (and might trigger the Toast).

### C. Filter / Sort
*   **New Filter Toggle:** "On this device" vs "All Books" (Cloud + Local).
    *   *Default:* "All Books" (to show the full library).
    *   *Empty State (Filtered):* "No downloaded books. Switch to 'All Books' to see your cloud library."

## 3. The "Smart Resume" Experience

The most critical interaction for cross-device reading. This must be resilient to accidental dismissal.

### A. The "Jump" Toast (Transient)
*   **Context:** User opens a book that was recently read on another device.
*   **Logic:** `if (remote.lastRead > local.lastRead && remote.progress != local.progress)`
*   **UI Component:** A floating pill at the bottom center (similar to "Scroll to bottom").
*   **Content:**
    *   *Icon:* Device icon (Phone/Tablet).
    *   *Text:* "Pick up where you left off on **Pixel 7**?"
    *   *Subtext:* "Chapter 5 • 42%"
    *   *Actions:* "Jump" (Primary), "Dismiss" (X).
*   **Behavior:**
    *   *Tap "Jump":* Smooth-scrolls or re-renders to the new CFI. Shows a brief "highlight flash" to orient the user.
    *   *Tap "Dismiss":* Ignores that specific remote session ID for this local session.

### B. Persistent Entry Points (Manual Recovery)
*   **Library Context Menu:**
    *   Long-press on a book -> **"Resume from..."**
    *   *Sub-menu:* Shows list of devices with their progress and timestamps.
*   **Reader "Sync Status" Menu:**
    *   Inside the reader, the "Three Dots" menu contains a **"Sync Status"** item.
    *   *Panel:* A modal or bottom sheet displaying the "Device Graph".
    *   *List Items:*
        *   **This Device:** Page 10 (Now)
        *   **iPad Pro:** Page 45 (2 hours ago)
        *   **Desktop:** Page 2 (Yesterday)
    *   *Action:* Tapping an entry immediately jumps to that location.
*   **Table of Contents (TOC):**
    *   Chapters where other devices are currently located are marked with a small avatar/device icon.
    *   _Tooltip/Label:_ "iPad Pro is here".
    *   _Interaction:_ Clicking the chapter navigates to the chapter start, but *clicking the icon* navigates to the specific CFI.

## 4. Settings & Device Management

Give users control over their "Device Graph" and bandwidth usage.

### A. "Sync & Backup" Section
*   **Master Toggle:** "Sync Library & Progress".
    *   *Warning:* Disabling this prompts: "This device will stop backing up data. Are you sure?"
*   **Bandwidth Control:**
    *   **Toggle:** "Sync over Wi-Fi only" (Applies to heavy assets like EPUBs/Images).
    *   **Toggle:** "Download Covers on Mobile Data" (Low data usage, usually acceptable).
*   **Status Panel:**
    *   "Last Sync: 2 mins ago" (Green).
    *   "Storage Used: 45MB / 2GB" (if quota exists).
*   **Manual Actions:**
    *   **"Sync Now"**: Forces a full push/pull.
    *   **"Force Upload"**: Re-uploads the local state (useful for conflict debugging).

### B. Manage Devices
*   **List:** Shows all devices contributing to the `SyncManifest`.
    *   *Current Device:* "This Device (Pixel 6)" - Active - Green Dot.
    *   *Other Devices:* "iPad Pro" - Last seen 2 hours ago - Gray Dot.
*   **Actions per Device:**
    *   *Rename:* "Give this device a friendly name".
    *   *Remove:* "Remove from sync".
        *   *Confirmation:* "This will stop syncing progress FROM 'iPad Pro'. Data already synced will remain."

## 5. Conflict Resolution (The "Manual Merge")

Since we use `Yjs`, conflicts are automatically resolved at the data layer. However, *semantic* conflicts might occur.

*   **Strategy:** "Last Write Wins" (LWW) is the default UX. We assume the latest edit is the intended one.
*   **The "File Conflict" Exception:**
    *   *Scenario:* User replaces the EPUB file on Desktop (e.g., fixes typos) but has an older version on Mobile.
    *   *Detection:* Same Book ID, different File Hash.
    *   *UI:* "Version Conflict" badge on the book card (Orange).
    *   *Modal:*
        *   **Header:** "File Mismatch Detected"
        *   **Body:** "The version of 'Dune' on the cloud is different from the one on this device."
        *   **Comparison:**
            *   *Cloud:* 2.4MB • Updated Today
            *   *Local:* 2.3MB • Updated Yesterday
        *   **Actions:**
            *   "Update to Cloud Version" (Recommended)
            *   "Keep Local Version" (Marks local as authoritative, uploads it).
            *   "Keep Both" (Renames local to "Dune (Copy)").

## 6. Accessibility & Haptics

*   **Announcements:**
    *   Screen readers must announce "Sync started" and "Sync complete" via `aria-live` regions.
    *   When the "Resume" toast appears, it should be announced: "Resume option available. Press Shift+J to jump."
*   **Focus Management:**
    *   The "Smart Resume" toast must be focusable (Cmd/Ctrl+F6 or Tab order) but **not** steal focus immediately on load (to prevent typing interruption).
*   **Haptics:**
    *   *Success:* Light vibration when sync completes.
    *   *Pull-to-Refresh:* Standard resistance and snap haptics in the library view.
*   **Color Contrast:**
    *   Ensure the "Ghost Book" opacity (80%) still maintains contrast for text overlays.
    *   Use high-contrast icons for the Sync Status indicators.

## 7. Error Handling & Empty States

*   **Sync Error:**
    *   *UI:* Red warning icon in header.
    *   *Tap:* Opens "Sync Log".
    *   *Log Details:* "Error 503: Service Unavailable. Retrying in 5s..."
*   **Empty Library (New Device):**
    *   *Visual:* Illustration of a cloud connected to a book.
    *   *Text:* "No books found locally."
    *   *Action:* "Check for Backups" (Primary Button) or "Import Book" (Secondary).
