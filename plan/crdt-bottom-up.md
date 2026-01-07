Versicle CRDT Migration: Bottom-Up Feature-First Plan
=====================================================

**Goal:** Transition Versicle from a static IndexedDB/JSON-manifest architecture to a mathematically convergent Yjs CRDT architecture. This plan works from the "Feature Edge" downwards to the "Database Core" to minimize disruption and complexity.

1\. Architectural Strategy: The "Model Wrapper"
-----------------------------------------------

Instead of performing an invasive database swap, we will create **Model Classes** that wrap Yjs shared types. These models provide a stable, standard TypeScript API (e.g., `add`, `delete`, `update`) to the features while managing the Yjs transactions and logical clocks internally.

### 1.1 The Moral Layer vs. Heavy Layer

-   **Moral Layer (CRDT):** Metadata, annotations, history, settings, and session states. These are small, high-frequency, and must sync.

-   **Heavy Layer (IDB Only):** EPUB binaries (`files`), table images (`table_images`), and generated audio (`tts_cache`). These remain in standard IndexedDB and do not sync via Yjs.

2\. Comprehensive Model Registry
--------------------------------

Based on an exhaustive audit of the repository (including `EpubLibraryDB` schema, Zustand stores, and `SyncManifest`), the following Model Classes must be implemented to cover the entire "Moral Layer."

### SettingsModel

-   **Target Store(s):** `localStorage` (via `useReaderStore`, `useTTSStore`, `useLibraryStore`), `app_metadata`

-   **Key Data Structures:** Visual preferences (Theme, Font, Font Size, Line Height, Force Font), TTS Configuration (Rate, Pitch, Provider ID, API Keys, Preroll, Sanitization, Background Audio), and Library View settings.

-   **Yjs Type Mapping:** `Y.Map<string, any>`

### LexiconModel

-   **Target Store(s):** `lexicon`

-   **Key Data Structures:** Pronunciation rules, replacement text, regex flags, and rule order logic (`applyBeforeGlobal`).

-   **Yjs Type Mapping:** `Y.Array<LexiconRule>`

### AnnotationModel

-   **Target Store(s):** `annotations`

-   **Key Data Structures:** Book-specific highlights and notes, colors, and CFI ranges.

-   **Yjs Type Mapping:** `Y.Map<UUID, Annotation>`

### ReadingListModel

-   **Target Store(s):** `reading_list`

-   **Key Data Structures:** Portable progress metadata, reading status ('read', 'to-read'), and user ratings.

-   **Yjs Type Mapping:** `Y.Map<BookId, ReadingListEntry>` (Migrating from filename to BookId keys)

### SessionModel

-   **Target Store(s):** `tts_queue`, `tts_position`

-   **Key Data Structures:** Complete playback queue (serialized `TTSQueueItem[]`), current queue index, section index, and pause timestamps for smart resume.

-   **Yjs Type Mapping:** `Y.Map<BookId, Y.Map<string, any>>`

### HistoryModel

-   **Target Store(s):** `reading_history`

-   **Key Data Structures:** Merged CFI read-ranges and the chronological array of `ReadingSession` audit events.

-   **Yjs Type Mapping:** `Y.Map<BookId, Y.Array<string>>`

### AnalysisModel

-   **Target Store(s):** `content_analysis`

-   **Key Data Structures:** AI-generated section summaries, detected content types, structure metadata (footnotes), and table-to-text adaptations.

-   **Yjs Type Mapping:** `Y.Map<CompositeId, ContentAnalysis>`

### LibraryModel

-   **Target Store(s):** `books`

-   **Key Data Structures:** Foundational metadata (ID, Title, Author, Date Added), synthetic Table of Contents, AI analysis status, and ingestion pipeline version.

-   **Yjs Type Mapping:** `Y.Map<BookId, Y.Map<string, any>>`

### RegistryModel

-   **Target Store(s):** `deviceRegistry` (Inferred from legacy sync logic)

-   **Key Data Structures:** Unique Device IDs, user-assigned names, and `lastSeen` UTC timestamps.

-   **Yjs Type Mapping:** `Y.Map<DeviceId, DeviceInfo>`

3\. Phased Implementation Roadmap
---------------------------------

### Phase 1: Feature Decoupling (The Wrapper Phase)

**Objective:** Replace direct `dbService` calls in UI components and stores with calls to new Model classes.

-   Create `src/models/` and implement the classes listed in Section 2.

-   **Initial Implementation:** These models will initially use a "Storage Shunt" that simply redirects to the existing `DBService`.

-   **Logic Encapsulation:** Move complex logic (like `mergeCfiRanges` for History or Rule Ordering for Lexicon) into the Model classes.

### Phase 2: Reactive Store Integration

**Objective:** Refactor Zustand stores to observe the Models instead of commanding the database.

-   Refactor `useAnnotationStore`, `useTTSStore`, and `useUIStore`.

-   **Observer Pattern:** The Zustand store subscribes to the Model class. When the Model's internal state changes, the Zustand store calls `set()` to trigger React re-renders.

-   **Result:** The UI becomes reactive to the storage layer, preparing it for remote sync updates.

### Phase 3: The Yjs Shadow Switch

**Objective:** Replace the storage shunt with real Yjs shared types.

-   Initialize a local `Y.Doc` in the `CRDTService`.

-   **Shadow Mode:** Models now write to both the legacy IndexedDB and the new Yjs log.

-   **Validation:** Use `src/db/validators.ts` to ensure data entering the Yjs log is clean.

### Phase 4: Persistence Cutover (The Downward Shift)

**Objective:** Make Yjs the primary Source of Truth.

-   Utilize `y-indexeddb` to persist the unified root `Y.Doc`.

-   **Hydration:** Implement a one-time migration that reads all data from legacy IndexedDB stores and populates the Yjs structures.

-   **Atomic Swap:** Flip the logic so `DBService` Moral-layer methods either read from the Yjs Models or are decommissioned entirely.

### Phase 5: Cloud Binary Sync

**Objective:** Enable cross-device consistency via Google Drive.

-   Refactor `SyncOrchestrator` to exchange `Y.encodeStateAsUpdate` binary blocks.

-   **Compaction Janitor:** Implement a background service that periodically squashes the operation log to keep the binary size < 1MB.

4\. Specific Complexity Mitigations
-----------------------------------

### 4.1 History Bloat (HistoryModel)

To prevent the Yjs log from exploding during scroll-heavy sessions:

-   The `HistoryModel` must perform **Internal Buffering**.

-   It only pushes a new CFI range to the `Y.Array` when the user stops scrolling for > 10 seconds or switches chapters.

### 4.2 Key Harmonization (ReadingListModel)

Legacy `reading_list` uses `filename` as a primary key.

-   During migration to the Model, we will switch the primary key to `bookId`.

-   This eliminates collisions caused by renaming files and aligns the Reading List with the Library Metadata.

### 4.3 Playback Handoff (SessionModel)

-   To achieve "Instant Resume" on a Tesla Model 3 after reading on a phone, the `SessionModel` must sync both the `currentIndex` and the serialized `queue`.

-   This ensures the car's browser doesn't have to re-calculate the queue from the EPUB file on every boot.

5\. Success Metrics
-------------------

-   **Consistency:** Two tabs open on the same device converge metadata within 100ms.

-   **Performance:** App boot time on a Tesla browser remains < 3 seconds.

-   **Reliability:** Zero data loss during the transition from legacy IDB to CRDT log.
