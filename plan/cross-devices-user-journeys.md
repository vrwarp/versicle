# User Journeys: Cross-Device Syncing (Expanded & Revised)

**Role:** Senior Product Manager
**Product:** Versicle (E-Reader)
**Goal:** Define the user experience for seamless cross-device synchronization to support a "Local-First, Cloud-Enhanced" strategy without relying on proprietary third-party storage APIs like Google Drive.

---

## Overview

Versicle aims to provide a reading experience that is robust, privacy-focused, and seamlessly available across all user devices. Our "Dual Sync" architecture ensures that reading progress, library organization, and preferences follow the user. We prioritize "User Agency" and "Platform Independence" — synchronization is handled via our real-time engine (Firestore), while long-term archival is handled via device-native backups (Android) or standard manual exports (Web/Desktop).

## Core User Journeys

### 1. The Seamless Handoff (The "Commuter" Scenario)
**Persona:** Sarah, a dedicated fiction reader with a busy commute.
**Context:** Reads on her phone during the subway ride (intermittent connectivity), switches to her tablet at home (stable Wi-Fi).

*   **Step 1: The Commute.** Sarah opens Versicle on her **Android Phone** while on the subway. She reads *Moby Dick*, progressing from Chapter 5 to Chapter 7. She highlights a particularly poignant quote in Chapter 6 regarding the "whiteness of the whale" and adds a note: *"Is this about fear or divinity?"*. The app is working in "Local Mode" due to spotty signal.
*   **Step 2: The Upload.** As she arrives home, she closes the app on her phone. The phone (detecting network re-connection) silently wakes a background worker. It pushes the latest `Y.Doc` state (containing the progress update and the new note) to the Firestore Realtime Database. This "Hot Path" ensures her session state is immediately available to other devices.
*   **Step 3: The Transition.** Sarah settles on her couch and picks up her **iPad**. She opens Versicle. The "Pulse" indicator in the top right spins for 1.2 seconds, then turns into a green checkmark as it connects to the Sync Engine.
*   **Step 4: The Recognition.** Sarah sees a **Persistent Badge** on the *Moby Dick* cover in the library: a small phone icon with the text *"Continue from Phone"*. This badge is powered by the metadata synced via the realtime channel.
*   **Step 5: The Notification.** A subtle, non-intrusive toast appears at the bottom: *"Resumed from Android Phone at Chapter 7"*. Sarah misses the toast as she adjusts her brightness, but the persistent badge remains, offering a reliable fallback.
*   **Step 6: The Action.** Sarah taps the **Badge** on the book cover (or the book itself).
*   **Step 7: The Result.** The book opens instantly to the exact sentence she left off on her phone (Chapter 7, Paragraph 3). The view scrolls smoothly to center the text.
*   **Step 8: The Verification.** She navigates back to Chapter 6 to check her note. The highlight is yellow, and her note *"Is this about fear or divinity?"* is present. She smiles, satisfied that her thought wasn't lost.

**Success Criteria:**
*   Sync latency < 2 seconds on good network.
*   Progress is accurate to the exact CFI (sentence/word).
*   **Redundancy:** The resume action is available via both transient (toast) and persistent (badge/menu) UI elements.
*   **Metadata Fidelity:** Notes and highlights preserve their exact context and color.

### 2. The Offline Progression (The "Airplane" Scenario)
**Persona:** David, a tech-savvy frequent flyer.
**Context:** Reading on a long-haul flight with absolutely no internet connection.

*   **Step 1: Preparation.** David boards a plane and puts his **Tablet** in Airplane Mode. He ensures his library is downloaded.
*   **Step 2: Deep Reading.** He reads *The Martian* for 4 hours, finishing 30% of the book. During this time, he realizes the font size is too small for the dim cabin lighting, so he increases it to 120% and switches the theme to "Sepia" to reduce eye strain.
*   **Step 3: The Divergence.** Meanwhile, at home, his **Desktop** app is open but inactive. It still thinks he is at Chapter 1 with "Light" theme.
*   **Step 4: Reconnection.** David lands and reconnects to airport Wi-Fi.
*   **Step 5: The Flush.** Versicle on the Tablet detects the connection. It batches the 4 hours of progress updates and preference changes into a single compressed payload and flushes it to Firestore. The "Pulse" indicator shows a "Syncing..." state for 3 seconds.
*   **Step 6: The Reconciliation.** Later, David opens Versicle on his **Desktop** at his hotel.
*   **Step 7: The Magic.** The theme automatically switches to Sepia (reflecting his preference change). He opens *The Martian*, and it jumps immediately to the 30% mark.
*   **Step 8: The "What Happened" Log.** Curious, David checks the "Sync Log" in settings. He sees an entry: *"Synced 452 updates from Tablet (Offline Session)"*.

**Success Criteria:**
*   No data loss during long offline periods.
*   Seamless reconciliation of offline changes once online.
*   Preference syncing is treated with equal importance to progress.
*   **Transparency:** The user can audit the sync history if they suspect an issue.

### 3. The Library Management (The "Curator" Scenario)
**Persona:** Elena, a graduate student with a large, messy reference library.
**Context:** Organizes books on Desktop (easier with mouse/keyboard), expects structure on Mobile.

*   **Step 1: The Import.** Elena imports 50 EPUBs into Versicle on her **MacBook**. These are heavy academic texts, totaling 500MB.
*   **Step 2: The Organization.** She creates a new Collection named "Thesis Research". She drags all 50 books into it.
*   **Step 3: The Metadata Cleanup.** She notices 10 books have messy filenames (e.g., `_libgen_author_x.epub`). She spends 10 minutes renaming them to proper "Author - Title" formats and adding tags like `#sociology` and `#ref`.
*   **Step 4: The Mobile Check.** She opens Versicle on her **Phone** while walking to class.
*   **Step 5: Ghost Books.** The "Ghost Book" mechanism kicks in via Firestore sync. She sees the "Thesis Research" collection appear immediately. Inside, the 50 books are listed with their *corrected* titles and tags.
*   **Step 6: The Visuals.** The covers are displayed using a generated CSS gradient (derived from the original cover's palette) because the actual cover images haven't downloaded yet. This keeps the initial sync payload under 50KB.
*   **Step 7: The Demand.** She taps one book: *Durkheim's Suicide*.
*   **Step 8: The Fetch.** The app shows a "File Missing" dialog. Since we removed Google Drive support, the app cannot auto-download the EPUB blob from a private cloud.
*   **Step 9: The Manual Bridge.** The dialog asks: *"This book's content isn't on this device. Would you like to import the file?"* Elena realizes she needs to transfer the specific file via AirDrop or USB, or re-download it from her source.
*   **Step 10: The Re-Link.** Elena AirDrops the EPUB from her Mac to her Phone. Versicle detects the import, calculates the hash, matches it to the existing "Ghost Book" metadata, and "hydrates" the entry. The gradient cover is replaced by the real cover, and the book opens.

**Success Criteria:**
*   Metadata sync is near-instant (Ghost Books).
*   **Clear Communication:** The user understands that *metadata* syncs automatically, but *heavy files* require manual management (privacy/cost trade-off).
*   **Smart Matching:** Re-imported files automatically link to existing metadata/progress without creating duplicates.

### 4. The New Device Setup (The "Upgrade" Scenario)
**Persona:** Marcus, upgrading to a new flagship phone.
**Context:** Installing Versicle on a fresh device, expecting a "restore" experience via native backup or cloud sync.

*   **Step 1: The Install.** Marcus installs Versicle on his new **Pixel 9**.
*   **Step 2: The Sign-In.** He opens the app and signs in with his Auth Provider (Google/Email).
*   **Step 3: The Discovery.** The app connects to Firestore. It pulls his `User Inventory` (List of books, tags, ratings) and `User Journey` (Stats).
*   **Step 4: The Hydration.** Within seconds, his library populates with 200 "Ghost Books".
*   **Step 5: The Native Restore (Android).** Since Marcus used Android's built-in migration tool during phone setup, Versicle's `backup_payload.json` (saved via `AndroidBackupService`) was restored to the app's data directory.
*   **Step 6: The Local Check.** Versicle detects this local backup file on first launch. It asks: *"Found a local backup from your old device. Merge with Cloud?"*
*   **Step 7: The Merge.** Marcus taps "Yes". The app merges any local preferences that might have been unique to the old device.
*   **Step 8: The Content.** He taps *Dune*. Again, because we don't host the blobs, he is prompted to re-import the file. He downloads *Dune* from his bookstore and shares it to Versicle. It snaps instantly to Page 342.

**Success Criteria:**
*   **Zero-Friction Metadata Restore:** Library structure is restored purely via Firestore.
*   **Platform Integration:** Leveraging Android's native backup for settings/manifests where possible.
*   **Expectation Management:** Users accept that file content must be re-provided.

### 5. The "Device Conflict" (The Edge Case)
**Persona:** The "Multi-Device" Power User.
**Context:** Reading the same book on two devices simultaneously, creating a potential "split brain" scenario.

*   **Step 1: Tablet State.** User is reading Page 10 on **Tablet** (Online).
*   **Step 2: Phone State.** User picks up **Phone** (Offline, cached at Page 5) and reads to Page 15 on the bus.
*   **Step 3: Connection.** Phone goes Online and syncs.
*   **Step 4: The Conflict.** The Cloud now sees two active sessions: "Tablet at Page 10 (Timestamp: 10:00 AM)" and "Phone at Page 15 (Timestamp: 10:30 AM)".
*   **Step 5: Resolution Logic.** `Yjs` resolves the underlying data structure without error. The `useReadingStateStore` now holds *two* entries for this book's progress: one for Tablet, one for Phone.
*   **Step 6: Tablet Interaction.** User opens **Tablet**. It receives the update. It sees that **Phone** has a later timestamp (10:30 AM vs 10:00 AM) and further progress (Page 15 vs Page 10).
*   **Step 7: The Suggestion.** A "Resume" toast appears: *"Pick up from Phone at Page 15?"*.
*   **Step 8: The Miss.** The user is distracted and accidentally dismisses the toast. They are still at Page 10.
*   **Step 9: The Manual Recovery.** The user thinks, "Wait, didn't I read past this?" They tap the **Book Action Menu** (three dots) -> **Sync Status**.
*   **Step 10: The Menu.** They see a list:
    *   *This Device:* Page 10 (Current)
    *   *Phone:* Page 15 (2 mins ago) - **Highlighted**
*   **Step 11: The Jump.** They tap the "Phone" entry. The Tablet jumps to Page 15.

**Success Criteria:**
*   No "Conflict Resolution" dialogs for the user (handled via CRDT/Per-Device tracking).
*   **Recoverability:** Users can manually trigger the jump if they miss the automated suggestion.

### 6. The "Data Liberation" (The Manual Archive)
**Persona:** The Privacy Advocate / Archivist.
**Context:** User wants to leave the ecosystem or back up their data manually, trusting no cloud provider completely.

*   **Step 1: The Decision.** The user decides to back up their entire reading history and annotations before formatting their computer.
*   **Step 2: The Export.** They go to Settings -> Storage & Data -> **Export Data**.
*   **Step 3: The Wizard.** A dialog appears:
    *   *Option:* "Include Reading History?" (Yes)
    *   *Option:* "Include Annotations?" (Yes)
    *   *Option:* "Include Settings?" (Yes)
    *   *Format:* "JSON (Universal)" or "Versicle Backup Package (Full)".
*   **Step 4: The Generation.** They choose "JSON". The app generates a 500KB JSON file containing the `SyncManifest`.
*   **Step 5: The Save.** The user saves `versicle_export_2023-10-27.json` to their USB drive.
*   **Step 6: The Restore.** Weeks later, on a fresh install, they go to Settings -> Storage & Data -> **Import Data**.
*   **Step 7: The Validation.** They select the file. The app validates the schema version (handling migrations if necessary).
*   **Step 8: The Success.** The library structure is restored. The user is happy knowing they own their metadata.

**Success Criteria:**
*   **Standard Formats:** JSON for metadata ensures the data is human-readable and future-proof.
*   **Granularity:** Users can choose what to export.
*   **Independence:** No server interaction required for Export/Import.
