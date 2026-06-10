# Type Definitions

This directory is the L0 types layer: global TypeScript type definitions and
interfaces used throughout the application.

**Layering rule (enforced by the `types-imports-nothing` dependency-cruiser
rule, baseline 0):** modules in `src/types/` import nothing internal except
other `src/types/` modules, and that import graph stays acyclic.

## Files

The former god type hub `db.ts` was dissolved by domain in the Phase 1a type
split (plan/overhaul/README.md §Roadmap P1):

*   **`book.ts`**: Static (immutable, file-derived) book rows —
    `StaticBookManifest`, `StaticResource`, `StaticStructure`,
    `NavigationItem`, `PerceptualPalette` — plus the legacy v17 rows
    (`Book`, `BookSource`, `BookState`, the `BookMetadata` composite),
    `SectionMetadata`, and section-level AI analysis (`ContentAnalysis`,
    `TableAdaptation`).
*   **`user-data.ts`**: Mutable user-authored rows (synced via Yjs) —
    `UserInventoryItem`, `UserProgress`, `UserAnnotation`, `UserOverrides`,
    `UserJourneyStep`, `UserAiInference` — plus `Annotation`, `LexiconRule`,
    reading history/sessions, and `ReadingListEntry`.
*   **`tts.ts`**: Canonical home of `TTSQueueItem` and `Timepoint`
    (re-exported by `lib/tts/AudioPlayerService.ts` and
    `lib/tts/providers/types.ts` for their existing consumers), plus the
    persisted `TTSState`/`TTSPosition`/`TTSContent` rows.
*   **`cache.ts`**: Transient, disposable cache rows — `CacheRenderMetrics`,
    `CacheAudioBlob`, `CacheSessionState`, `CacheTtsPreparation`,
    `CitationMarker`, `TableImage`, `BookLocations`.
*   **`flight-recorder.ts`**: TTS diagnostics — `FlightEvent`,
    `FlightEventSource`, `FlightSnapshot`.
*   **`sync.ts`**: Sync wire/recovery shapes — `SyncManifest`,
    `SyncCheckpoint`, `SyncLogEntry`.
*   **`db.ts`**: **Deprecated** re-export shim over the six modules above so
    existing importers compile unchanged. Do not add new imports of it;
    it is deleted in Phase 9.
*   **`content-analysis.ts`**: Content-analysis status/result primitives
    (`AnalysisStatus`, `ContentTypeResult`).
*   **`errors.ts`**: The application error taxonomy.
*   **`device.ts`**, **`search.ts`**, **`workspace.ts`**: Device identity,
    search, and sync-workspace types.
*   **`epubjs.d.ts`**: A custom type declaration file for the `epubjs`
    library. It augments and corrects the official types to expose missing
    properties and methods required by the advanced reader implementation
    (e.g., `Rendition` hooks, `Book` properties).
