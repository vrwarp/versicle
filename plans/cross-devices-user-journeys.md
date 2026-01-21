# User Journeys: Cross-Device Syncing

**Role:** Senior Product Manager
**Product:** Versicle (E-Reader)
**Goal:** Define the user experience for seamless cross-device synchronization to support a "Local-First, Cloud-Enhanced" strategy.

---

## Overview

Versicle aims to provide a reading experience that is robust, privacy-focused, and seamlessly available across all user devices. Our "Dual Sync" architecture ensures that reading progress, library organization, and preferences follow the user, not the device.

## Core User Journeys

### 1. The Seamless Handoff (The "Commuter" Scenario)
**Persona:** Sarah, a daily commuter.
**Context:** Reads on her phone during the subway ride, switches to her tablet at home.

*   **Step 1:** Sarah opens Versicle on her **Android Phone** while on the subway. She reads *Moby Dick*, progressing from Chapter 5 to Chapter 7. She highlights a quote in Chapter 6.
*   **Step 2:** As she arrives home, she closes the app on her phone. The phone (detecting network) pushes the latest `Y.Doc` state to Firestore and updates the "Moral Layer" snapshot via Android Backup.
*   **Step 3:** Sarah settles on her couch and picks up her **iPad**. She opens Versicle.
*   **Step 4:** The app background-syncs via Firestore.
*   **Step 5:** A subtle toast appears: *"Resumed from Android Phone at Chapter 7"*.
*   **Step 6:** Sarah taps "Resume". The book opens instantly to the exact sentence she left off.
*   **Step 7:** She checks her highlights; the quote from Chapter 6 is present.

**Success Criteria:**
*   Sync latency < 2 seconds on good network.
*   Progress is accurate to the exact CFI (sentence/word).
*   Annotations appear immediately.

### 2. The Offline Progression (The "Airplane" Scenario)
**Persona:** David, a frequent flyer.
**Context:** Reading on a long-haul flight with no internet.

*   **Step 1:** David boards a plane and puts his **Tablet** in Airplane Mode.
*   **Step 2:** He reads *The Martian* for 4 hours, finishing 30% of the book. He also adjusts his font size and theme preferences (Sepia mode).
*   **Step 3:** Meanwhile, at home, his **Desktop** app is open but inactive.
*   **Step 4:** David lands and reconnects to airport Wi-Fi.
*   **Step 5:** Versicle on the Tablet detects connection and flushes the accumulated `Y.Doc` updates to the cloud.
*   **Step 6:** Later, David opens Versicle on his **Desktop**. The theme automatically switches to Sepia (reflecting his preference change) and *The Martian* shows 30% progress.

**Success Criteria:**
*   No data loss during offline usage.
*   Seamless reconciliation of offline changes once online.
*   Preference syncing is treated with equal importance to progress.

### 3. Library Management (The "Curator" Scenario)
**Persona:** Elena, a student with a large reference library.
**Context:** Organizes books on Desktop, expects structure on Mobile.

*   **Step 1:** Elena imports 50 EPUBs into Versicle on her **MacBook**. She creates a collection tagged "Thesis Research".
*   **Step 2:** She renames several books to correct their metadata (e.g., "Unknown Author" -> "J. Doe").
*   **Step 3:** She opens Versicle on her **Phone**.
*   **Step 4:** The "Ghost Book" mechanism kicks in. She sees the 50 new books appear in her library with the correct titles and tags ("Thesis Research"), but they are marked as "Cloud Only" (cloud icon).
*   **Step 5:** She taps one book. The app downloads the "Static Resources" (EPUB blob) on demand.
*   **Step 6:** The book opens, and she begins reading.

**Success Criteria:**
*   Metadata sync is near-instant (Ghost Books).
*   Heavy resources (EPUBs) are not auto-downloaded to save bandwidth/storage.
*   Renaming/Tagging on one device reflects everywhere.

### 4. The New Device Setup (The "Upgrade" Scenario)
**Persona:** Marcus, upgrading to a new phone.
**Context:** Installing Versicle on a fresh device.

*   **Step 1:** Marcus installs Versicle on his new **Pixel 9**.
*   **Step 2:** He signs in with his Google Account.
*   **Step 3:** The app detects an existing `SyncManifest` in his Google Drive app data (via Android Backup) or pulls the latest state from Firestore.
*   **Step 4:** His library populates immediately with covers and metadata (Ghost Books).
*   **Step 5:** His reading statistics (Total Hours, Books Read) are restored.
*   **Step 6:** He taps his current read. It downloads and jumps to the correct page.

**Success Criteria:**
*   Zero-config restoration (if using Android Backup).
*   Immediate visual feedback (library populated) before heavy downloads.

### 5. The "Device Conflict" (The Edge Case)
**Persona:** The "Multi-Device" Reader.
**Context:** Reading the same book on two devices simultaneously (e.g., testing or forgot to close one).

*   **Step 1:** User is reading Page 10 on **Tablet** (Online).
*   **Step 2:** User picks up **Phone** (Offline, cached at Page 5) and reads to Page 15.
*   **Step 3:** Phone goes Online.
*   **Step 4:** Both devices sync.
*   **Step 5:** `Yjs` resolves the conflict. Since `useReadingStateStore` tracks progress *per device*, no data is overwritten.
*   **Step 6:** User opens **Tablet**. It sees that **Phone** has a later timestamp/progress (Page 15).
*   **Step 7:** A "Resume" toast appears: *"Pick up from Phone at Page 15?"*.
*   **Step 8:** User accepts. Tablet jumps to Page 15.

**Success Criteria:**
*   No "Conflict Resolution" dialogs for the user (handled via CRDT/Per-Device tracking).
*   Smart suggestion based on "Latest Active" logic.

---

## Summary of Key Features Required
1.  **Dual Sync Engine:** Real-time (Firestore) for active sessions, Snapshot (Backup) for recovery.
2.  **Ghost Books:** Decouple Metadata (light) from Content (heavy).
3.  **Per-Device Progress Tracking:** Avoid overwriting progress; aggregate it instead.
4.  **Smart Resume UI:** proactive suggestions.
