# Subsystem analysis: Book ingestion & library management

Analyzed: 2026-06-10. All paths relative to repo root.

## What it is

The pipeline that turns an EPUB file (from disk, drag-drop, ZIP archive, or Google Drive) into a fully indexed library entry: parsed metadata, compressed cover + color palettes, per-chapter sentence/CFI extraction for TTS, table screenshots, synthetic TOC, and the IndexedDB + Yjs records that the library UI renders. Also covers the library management surface (LibraryView grid/list, delete/offload/restore/replace/reprocess dialogs) and the reading-list feature (a filename-keyed, Goodreads-CSV-portable shadow of the library).

## File inventory

| File | Role |
|---|---|
| `src/lib/ingestion.ts` (559) | Core extraction: `extractBookData` (full pipeline), `extractBookMetadata` (lightweight dup/ghost probe), `reprocessBook` (schema upgrade), `generateFileFingerprint`, `validateZipSignature` |
| `src/lib/offscreen-renderer.ts` (377) | Renders each spine item in a hidden epubjs iframe; extracts sentences+CFIs, chapter titles, dominant font metrics, snapdom table screenshots |
| `src/lib/BookImportService.ts` (117) | Thin facade: `addBook` (extract→ingest), `importBookWithId` (ID-remapped re-import for ghost/synced books), `restoreBook` (fingerprint-verified binary restore) |
| `src/lib/batch-ingestion.ts` (170) | `extractEpubsFromZip` (JSZip), `processBatchImport` (loop over EPUBs calling `bookImportService.addBook`) |
| `src/lib/cover-palette.ts` (508) | Two K-means palette extractors (16×16 region palette packed as 5×16-bit ints; 50×50 CIELAB perceptual palette), color-space math, `getOptimizedTextColor`, `isPaletteBright` |
| `src/lib/entity-resolution.ts` (94) | `normalizeMetadata`/`generateMatchKey` fuzzy title+author key, used to join reading-list entries to books when filenames diverge |
| `src/lib/language-utils.ts` (41) | ISO 639-2→639-1 normalization map |
| `src/lib/csv.ts` (176) | Goodreads-compatible reading-list CSV export/import (papaparse) |
| `src/lib/cancellable-task-runner.ts` (191) | Generator-based cancellable async runner (`runCancellable`); used only by `useEpubReader` |
| `src/store/useLibraryStore.ts` (798) | The de-facto import orchestrator: dup detection, ghost matching, overwrite merge, batch import, offload/restore, static-metadata hydration cache |
| `src/store/useReadingListStore.ts` (51) | Yjs-synced `Record<filename, ReadingListEntry>` |
| `src/store/selectors.ts` (417) | `useAllBooks`/`useBook`: 5-store merge (inventory + static metadata + offload set + progress + reading list) with module-level mutable caches |
| `src/db/DBService.ts` `ingestBook` (184-250) | Transactional write of manifest/resource/structure + TTS prep + table image caches; Blob→ArrayBuffer for WebKit |
| `src/components/library/LibraryView.tsx` (679) | Main view: filtering/sort/search, drag-drop import, all dialog coordination, hydration trigger, reprocess routing |
| `src/components/library/FileUploader.tsx` (296) | Second, parallel import entry point (multi-file + ZIP + Drive buttons); rendered only inside `EmptyLibrary` |
| `src/components/library/ImportProgressUI.tsx` (50) | Dual progress bars bound to store's global import/upload progress |
| `src/components/library/ImportSourceDialog.tsx` (71) | Device-vs-Drive chooser |
| `src/components/library/BookCard.tsx` (206) / `BookListItem.tsx` (237) / `BookCover.tsx` (173) / `BookActionMenu.tsx` (111) | Book item rendering (grid/list), gradient covers from palette, action menus |
| `src/components/library/DeleteBookDialog.tsx` / `OffloadBookDialog.tsx` / `ReplaceBookDialog.tsx` / `ContentMissingDialog.tsx` | Confirm dialogs; ContentMissing also offers cloud restore via DriveScannerService |
| `src/components/library/ReprocessingInterstitial.tsx` (77) | Blocking overlay that runs `reprocessBook` when `book.version < CURRENT_BOOK_VERSION` (=11) |
| `src/components/library/ResumeBadge.tsx` / `RemoteSessionsSubMenu.tsx` | Cross-device resume affordances driven by `allProgress` smuggled through BookMetadata |
| `src/components/library/EmptyLibrary.tsx` (101) | Zero state; hosts FileUploader + demo book loader |
| `src/components/ReadingListDialog.tsx` (372) + `EditReadingListEntryDialog.tsx` (166) | Reading-list table CRUD, batch delete, its own (incompatible) CSV export |
| `src/lib/drive/DriveScannerService.ts` (172) | Drive folder scan/index; `importFile` downloads then calls `useLibraryStore.getState().addBook` |

## How it works (data & control flow)

### Single-file import (happy path)

1. **Entry**: `LibraryView` hidden `<input accept=".epub">` or drop handler (`LibraryView.tsx:226-299`), or `FileUploader` (`FileUploader.tsx:45-110`), or Drive (`DriveScannerService.importFile:41-58`). All converge on `useLibraryStore.addBook` (`useLibraryStore.ts:262`).
2. **Duplicate check** by `sourceFilename` against the Yjs inventory, falling back to `bookRepository.getBookIdByFilename` (`useLibraryStore.ts:274-292`). Match without `overwrite` ⇒ `DuplicateBookError` ⇒ UI queues `ReplaceBookDialog`.
3. **Ghost matching**: `extractBookMetadata(file)` (`ingestion.ts:467`) — a *full epubjs open + cover fetch + browser-image-compression + both K-means palette extractions* — only to get sanitized title/author for an exact-trim match against inventory entries lacking local static metadata (`useLibraryStore.ts:396-471`). On match, `importBookWithId` re-imports under the existing UUID.
4. **Extraction**: `BookImportService.addBook` → `extractBookData` (`ingestion.ts:244`): ZIP signature check; epubjs open (again); metadata, cover fetch, compression, palettes (again); then `extractContentOffscreen` (`offscreen-renderer.ts:165`) renders every spine item in a hidden iframe (sanitizer hook registered on spine serialize), extracting sentences+CFIs via `extractSentencesFromNode`, chapter titles, dominant font size/line height, and snapdom WebP screenshots of every `<table>`. Output mapped to manifest/structure/sections/TTS-prep/table batches; `bookId = uuidv4()`.
5. **Persist**: `dbService.ingestBook` (`DBService.ts:184`) — one readwrite transaction over `static_manifests`, `static_resources`, `static_structure`, `cache_tts_preparation`, `cache_table_images`, with Blob→ArrayBuffer conversion hoisted before the tx (WebKit).
6. **Register**: back in the store, a `UserInventoryItem` is hand-built (`useLibraryStore.ts:486-497`) and pushed into the Yjs `useBookStore`; local `staticMetadata` cache updated with zombie guard; a `ReadingListEntry` upserted keyed by filename (`useLibraryStore.ts:539-559`).
7. **Render**: `useAllBooks` (`selectors.ts:60`) merges inventory + staticMetadata + offload set + per-device progress + reading-list fallback into `BookMetadata`-ish objects (typed `any`); covers served via the SW route `/__versicle__/covers/{id}`.

### Batch / ZIP import

`useLibraryStore.addBooks` → `processBatchImport` (`batch-ingestion.ts:95`): expands ZIPs in memory, then serially calls `bookImportService.addBook` per EPUB — **bypassing steps 2-3 entirely** — then bulk-adds inventory items and re-hydrates. No reading-list entries are created on this path.

### Restore / offload / reprocess

- Offload deletes the `static_resources` row only (`DBService.ts:334`); inventory and progress persist in Yjs; UI derives `isOffloaded` from a hydrated id-set.
- Restore: if a local manifest exists, fingerprint-verify then write binary back (`BookImportService.restoreBook:93`); else full `importBookWithId` (synced-book first download). `ContentMissingDialog` can instead pull the file from Drive.
- Reprocess: opening a book with `version < 11` routes through `ReprocessingInterstitial` → `reprocessBook` (`ingestion.ts:64`), which re-runs the offscreen extraction and rewrites structure/TTS/table caches in one WebKit-safe transaction, then patches the Yjs inventory palette via a dynamic store import.

## Technical debt

### D1. Batch import bypasses duplicate/ghost detection and silently drops failures — **critical / correctness**
**Evidence**: `processBatchImport` calls `bookImportService.addBook` directly (`batch-ingestion.ts:154`), which contains zero duplicate checking — that logic lives only in `useLibraryStore.addBook` (`useLibraryStore.ts:274-292, 396-471`). Each call generates a fresh UUID (`ingestion.ts:311`). `useLibraryStore.addBooks` destructures `const { successful } = await processBatchImport(...)` (`useLibraryStore.ts:584`) and never reads `failed` — failed files produce no toast, no error state. The batch path also never upserts `ReadingListEntry` (compare single path `useLibraryStore.ts:539-559` with `addBooks:607-637`).
**Impact**: Re-importing a folder/ZIP duplicates the entire library (each copy with its own UUID, megabytes of duplicated static data, duplicate Yjs inventory rows that sync to all devices). Failed imports vanish silently. Reading list diverges depending on which entry point imported the book.
**Fix**: Single import pipeline with a policy stage (see Target design); batch = `for file of files: importOne(file, policy)`. Surface per-file results (succeeded/duplicate/failed) in the progress UI.

### D2. The extraction pipeline exists three times; every import runs the cover pipeline twice and parses the EPUB twice — **high / duplication (with perf cost)**
**Evidence**: (a) `extractBookMetadata` (`ingestion.ts:467-559`) duplicates ~80 lines of `extractBookData` (`ingestion.ts:249-307`) verbatim: ZIP check, epubjs open, cover fetch, `imageCompression`, both palette extractions, fingerprint, sanitization. (b) `useLibraryStore.addBook` calls `extractBookMetadata` for ghost matching (`useLibraryStore.ts:397`) and then `extractBookData` for the real import — so every non-ghost import opens the EPUB with epubjs twice, compresses the cover twice, and runs both K-means clusterings twice; the probe's coverBlob/palette results are discarded (only `title`/`author` are read at `useLibraryStore.ts:406-407`). (c) `reprocessBook` (`ingestion.ts:121-153`) duplicates the chapter→toc/sections/tts/tables mapping loop of `extractBookData` (`ingestion.ts:318-350`) line-for-line, plus its own copy of cover palette re-extraction (`ingestion.ts:88-108`).
**Impact**: Triple maintenance burden — the WebKit table-blob fix (`ingestion.ts:155-168`) exists only in `reprocessBook`, and field additions (e.g. `baseFontSize`) must be hand-mirrored. Import latency roughly doubles on metadata-heavy phases. Drift between copies is how the `perceptualPalette` loss (D4) happened.
**Fix**: One `extractBook(file, {depth: 'metadata' | 'full'})` returning a shared structure; `reprocessBook` = `extractBook(existing blob, 'full')` + the persist step; chapter-mapping as a single pure function.

### D3. `useLibraryStore.addBook` is a ~300-line god action with copy-pasted race guards; race fixes are accreting as one-off patches — **high / architecture**
**Evidence**: `useLibraryStore.ts:262-569` mixes duplicate detection, overwrite-merge, ghost matching, ingestion orchestration, static-metadata caching, reading-list reconciliation, and error mapping in one closure. The "zombie prevention" functional-set pattern is duplicated four times (`useLibraryStore.ts:334-360, 440-466, 506-536, 751-769`). Five separate regression test files exist solely for races in this store: `useLibraryStore.race.test.ts`, `removeRace`, `restoreRace`, `offloadRevert`, `offloadedRace`. Hydration (`hydrateStaticMetadataFn:126-242`) implements stale-read reconciliation by snapshotting `initialOffloadedBookIds` and diffing — another bespoke race patch.
**Impact**: Any change to import behavior risks reintroducing a race that was fixed elsewhere in the same file; the store cannot be reasoned about as a state machine; concurrent imports interleave the *global* `isImporting/importProgress` flags (last-finisher-wins clearing, no queue).
**Fix**: Extract an `ImportOrchestrator` service with an explicit job queue (one import = one job with its own progress), reducing the store to UI-state projection. Express delete/offload/restore as compare-and-swap operations on a single state owner instead of scattered zombie checks.

### D4. `BookExtractionData`'s user-domain outputs are dead, and the live replacements drop `perceptualPalette` and `language` from the synced inventory — **high / correctness + dead-code**
**Evidence**: `extractBookData` builds `inventory`, `progress`, `overrides`, `readingListEntry` (`ingestion.ts:412-447`) including `perceptualPalette` and `language` (`ingestion.ts:421-423`). `DBService.ingestBook` ignores all four ("User data ... handled by Yjs stores exclusively", `DBService.ts:232`); `importBookWithId` even dutifully remaps their bookIds before they're discarded (`BookImportService.ts:58-60`). The store then rebuilds inventory items by hand in three places (`useLibraryStore.ts:486-497`, `:609-621`, overwrite merge `:320-330`) — none of which copy `perceptualPalette` or `language` (grep: `perceptualPalette` has zero hits in `useLibraryStore.ts`).
**Impact**: The CIELAB perceptual palette — computed at real CPU cost on every import — never reaches the Yjs doc, so ghost books on other devices can't use it; the EPUB language never reaches inventory either, degrading language-dependent features (TTS locale, Chinese handling) for synced-but-not-downloaded books. Dead fields mislead readers about what the pipeline persists.
**Fix**: Make `extractBookData` the single producer of the inventory snapshot; the registration step consumes `data.inventory` (with `addedAt`/`status` policy applied) instead of re-deriving it. Delete the unused `progress`/`overrides`/`readingListEntry` outputs or actually use them.

### D5. Two competing book identities (filename vs UUID) reconciled by fuzzy matching at render time — **high / architecture**
**Evidence**: `ReadingListEntry` is keyed by `filename` (`types/db.ts:694-699`); books by UUID. Joins happen by exact `sourceFilename` then fuzzy `generateMatchKey(title, author)` inside selectors: `selectors.ts:213-225` (with a memoized match-map) and `useBook`'s selector which calls `generateMatchKey` over *every* reading-list entry on store updates (`selectors.ts:305-322`). CSV import fabricates filenames from ISBN or title+author (`csv.ts:137-141`). `entity-resolution.ts` exists purely to paper over this (its header says so), with a 5000-entry string cache (`entity-resolution.ts:57-58`) and a 421-line test file enumerating heuristics.
**Impact**: Progress/rating can attach to the wrong book (fuzzy collisions: same title+author, different editions); renames break the join; every new feature touching both stores must re-solve identity; selector-time fuzzy matching is O(N·M) work held back by fragile caches.
**Fix**: Give `ReadingListEntry` an optional `bookId` foreign key resolved once at import/link time (with the existing SmartLink/fuzzy logic as the *one-time* resolver, not the render-time join); keep filename only as a portability field for CSV round-trips. Data migration: one pass linking entries to inventory by current heuristics.

### D6. `ReprocessingInterstitial` can start overlapping reprocess runs of the same book — **high / correctness (race)**
**Evidence**: `ReprocessingInterstitial.tsx:23-41` runs `reprocessBook(bookId)` in a `useEffect` whose deps include `onComplete`; `LibraryView` passes an inline arrow recreated every render (`LibraryView.tsx:455-459`). Any LibraryView re-render while the overlay is open (store updates, sync ticks) re-fires the effect with no in-flight guard or cleanup. `reprocessBook` reads old cache keys before its transaction (`ingestion.ts:171-172`) then deletes/puts them (`ingestion.ts:198-206`) — two overlapping runs interleave delete/put of `cache_tts_preparation`/`cache_table_images` rows.
**Impact**: Duplicate heavy extraction work (minutes of main-thread jank), potential lost/duplicated TTS-prep rows, double `onComplete` navigation.
**Fix**: Guard with a ref/in-flight set keyed by bookId (or move reprocessing into the import orchestrator's queue); drop `onComplete` from the effect deps; have LibraryView memoize the callback.

### D7. The "fileHash" is a head/tail djb2 fingerprint that embeds the filename; restore of a renamed identical file fails — **medium / correctness + docs drift**
**Evidence**: `generateFileFingerprint` (`ingestion.ts:39-48`) = `"{filename}-{title}-{author}-djb2(first4KB)-djb2(last4KB)"`. Types and docs claim SHA-256 (`types/db.ts:33`, `types/db.ts:432`, architecture.md). `BookImportService.restoreBook:100-108` recomputes with the *new* file's name and hard-fails on mismatch — so restoring an offloaded book from `book (1).epub` is rejected even with byte-identical content.
**Impact**: Spurious "File verification failed" for legitimate restores; fingerprint useless for content-level dedupe (D1); misleading documentation.
**Fix**: Compute a real content hash (SHA-256 via `crypto.subtle`, or chunked) excluding filename; keep filename separately. Migration: accept legacy fingerprints on restore (compare content-hash portion only) and lazily upgrade manifests.

### D8. Import UX implemented twice with divergent capabilities per entry point — **medium / duplication**
**Evidence**: LibraryView has its own drag-drop, duplicate queue, and `ReplaceBookDialog` (`LibraryView.tsx:93-104, 226-303, 463-468`); FileUploader has a parallel set (`FileUploader.tsx:39-70, 273-287`). LibraryView's drop handler imports only `files[0]` and rejects ZIPs (`LibraryView.tsx:282-287`); its header import input is single-file `.epub` only (`LibraryView.tsx:420-428`); FileUploader supports multi-select + ZIP — but is rendered only inside `EmptyLibrary` (`EmptyLibrary.tsx:56`), so batch import is unreachable once the library has one book. FileUploader also duplicates the Drive connect/browse logic that LibraryView has (`FileUploader.tsx:159-182` vs `LibraryView.tsx:154-169`).
**Impact**: Users with existing libraries cannot bulk-import without using Drive; dropping 10 files imports 1 silently; two duplicate-queue implementations to maintain.
**Fix**: One `useImportController` hook (file selection, validation, duplicate queue, dialogs) consumed by both surfaces; make every entry point accept multi-file + ZIP.

### D9. Reading-list CSV export exists twice with incompatible schemas — **medium / duplication**
**Evidence**: `lib/csv.ts:34-80` exports Goodreads-compatible headers that `parseReadingListCSV` round-trips (used by `GlobalSettingsDialog.tsx:131, 389`). `ReadingListDialog.handleExportCSV` (`ReadingListDialog.tsx:205-229`) hand-rolls CSV with different headers (`Status`, `Progress` as `"42%"`, `Last Read` as ISO) and manual quote escaping — output that `parseReadingListCSV` cannot re-import.
**Impact**: Users exporting from the reading-list dialog get a file the app's own importer rejects; escaping bugs live in hand-rolled code despite papaparse being a dependency.
**Fix**: Delete the dialog's bespoke exporter; call `exportReadingListToCSV` (optionally filtered to selection).

### D10. lib↔store layering is circular; ingestion logic reaches into UI stores — **medium / architecture (coupling)**
**Evidence**: `lib/ingestion.reprocessBook` dynamically imports `store/useBookStore` to patch palettes (`ingestion.ts:211-220`); `lib/drive/DriveScannerService.importFile` calls `useLibraryStore.getState().addBook` (`DriveScannerService.ts:49`); `lib/BackupService` mutates library store state directly (`BackupService.ts:332-334`); meanwhile stores import lib services (`useLibraryStore.ts:4,9,10`). The only thing keeping the heavy pipeline out of the TTS worker bundle is a docstring convention (`BookImportService.ts:1-8`, `DBService` "lean worker-safe").
**Impact**: No enforceable dependency direction; an innocent import in DBService can silently balloon the worker bundle (it has before — the comment exists because of it); services can't be tested or reused headlessly.
**Fix**: Direction: components → stores → services → db. Services never import stores; results flow back via return values or an event/callback the store subscribes to. Add an ESLint `no-restricted-imports`/dependency-cruiser rule for `src/lib/** → src/store/**` and for worker-bundle hygiene.

### D11. Extraction runs uncancellable on the main thread; global single-flight progress state — **medium / performance**
**Evidence**: `extractContentOffscreen` renders every chapter sequentially in a hidden iframe with snapdom screenshots per table (`offscreen-renderer.ts:259-351`), yielding only via 16ms checks (`:347-350`); for a long book this monopolizes the main thread for the duration. There is no cancellation: `runCancellable` exists (`cancellable-task-runner.ts`) but is wired only into `useEpubReader`. Import progress is global store state (`isImporting`, `importProgress` — `useLibraryStore.ts:36-44`), so concurrent imports (e.g. Drive import while a local import runs; `DriveImportDialog` only guards its own button) interleave progress text and clear each other's flags.
**Impact**: UI jank during import on low-end devices; no way to abort a mistaken 200MB import; confusing progress display under concurrency.
**Fix**: Queue imports (single worker-like lane), thread an `AbortSignal` through extract→persist, report progress per job id. (True worker offload is blocked by epubjs's DOM dependency — acceptable to keep main-thread but queued + abortable; revisit with a DOM-free parser later.)

### D12. ZIP batch expansion loads everything into memory — **medium / performance**
**Evidence**: `extractEpubsFromZip` reads the whole ZIP into an ArrayBuffer when progress is requested (`batch-ingestion.ts:27-44`) and materializes every contained EPUB as a `File` in `allEpubs` before any import starts (`batch-ingestion.ts:101-135`).
**Impact**: A multi-GB calibre-library ZIP OOMs mobile WebViews/Android Capacitor before the first book imports.
**Fix**: Stream entries: iterate the ZIP central directory, extract → import → release one EPUB at a time; progress from entry count.

### D13. `useAllBooks` selector: `any`-typed module-global caches; `allProgress` smuggled via casts — **medium / type-safety**
**Evidence**: `selectors.ts:12-32` — every cache field is `any` with 12 eslint-disables; the hook mutates module state during render guarded only by manual dep comparisons (`selectors.ts:95-165, 200-277`). The result is `any[]`, so `BookMetadata` consumers get no checking; `BookCard.tsx:130` and `:167` cast `(book as unknown as { allProgress?: ... })` to reach a field that exists only because the selector added it untyped. `BookMetadata` itself is `Book & Partial<BookSource> & Partial<BookState>` (`types/db.ts:483`) — a legacy 3-way intersection where nearly everything is optional.
**Impact**: Field renames/drops in the selector break BookCard/ResumeBadge silently; the render-mutation pattern is correct only as long as nobody touches the dep-tracking by hand (the eslint suppressions show the linter already disagrees).
**Fix**: Define `LibraryBook` (inventory + static + derived progress + `allProgress`) as the selector's declared return type; consider moving the merge into a derived zustand store (subscribeWithSelector) instead of render-time module caches, which would also delete the hand-rolled memoization.

### D14. Dead code and dead parameters across the library UI — **low / dead-code**
**Evidence**: `BookActionMenuHandle.triggerRestore` (`BookActionMenu.tsx:25-41`) has zero consumers (repo-wide grep). `components/library/index.ts` is an empty file (one comment). The resume plumbing passes `deviceId, cfi` from `ResumeBadge`/`RemoteSessionsSubMenu` → `BookCard.handleResumeClick` → `LibraryView.handleResumeReading`, which ignores both (`LibraryView.tsx:211-224` — comment says the Reader's Smart Resume toast handles it), so "Resume from device X at CFI" actually performs a plain open. `BookListItem.handleOpen` sets `useReaderUIStore.setCurrentBookId` (`BookListItem.tsx:100`) while `BookCard` doesn't — vestigial asymmetry. `extractBookMetadata` computes covers/palettes that its only caller discards (overlaps D2).
**Impact**: Readers infer features (per-device CFI resume) that don't exist; dead handles invite cargo-cult reuse.
**Fix**: Delete dead exports/params; either implement CFI-targeted resume or reduce `onResume` to `(book) => void`.

### D15. Docs drifted from reality — **low / hygiene**
**Evidence**: `components/library/README.md` claims LibraryView uses "virtualization for performance" — it renders all items via `map` (`LibraryView.tsx:374-408`); claims FileUploader is "often headless" — it's a full visual panel. `types/db.ts:33` "SHA-256" (see D7). architecture.md describes batch ingestion as feeding "standard ingestion processing" — it bypasses it (D1).
**Impact**: Misleads contributors and AI agents (this codebase's primary authors) into wrong assumptions; AI agents trained on these docs repeat the errors.
**Fix**: Regenerate docs from the post-refactor structure; delete per-directory READMEs that restate file names.

### D16. Hydration lifecycle lives in a view component — **medium / architecture**
**Evidence**: `LibraryView.tsx:118-142` triggers `hydrateStaticMetadata` from an effect watching book-count increases; `prevBookCountRef` heuristics decide when to hydrate. If the app boots on `/read/:id` or settings, hydration depends on incidental `useBook` calls; the "count increased" heuristic misses replace-in-place syncs.
**Impact**: Cover/metadata cache freshness depends on which route mounted first; logic untestable outside React.
**Fix**: Move hydration to app bootstrap / a store subscription on the Yjs inventory map (hydrate on key-set delta), independent of any view.

### Minor notes (folded)
- `csv.ts:169` defaults `lastUpdated: Date.now()` for rows without Date Read — imports reorder the list by import time (low).
- `extractEpubsFromZip` pushes into `epubFiles` from concurrent promises — order nondeterministic within chunks (low).
- `ResumeBadge.tsx:72-76` positions via className calc then overrides with inline `bottom: '90px'` (low).
- `LibraryView.tsx:154-164` `handleBrowseDrive` has an if/else where both branches are identical (low).
- `(ePub as any)` in 4+ sites (`ingestion.ts:78,255,482`, `offscreen-renderer.ts:189`) — wrap epubjs in one typed adapter (low/medium, shared with reader subsystem).

## Problematic couplings (other subsystems reaching in / out)

1. **Drive → library store**: `lib/drive/DriveScannerService.ts:49` calls `useLibraryStore.getState().addBook`; `ContentMissingDialog.tsx:81` calls `DriveScannerService.importFile` directly — the import pipeline is invoked from both above and below the store layer.
2. **TTS config → import path**: every import call site pulls `sentenceStarters`/`sanitizationEnabled` from `useTTSStore.getState()` (`useLibraryStore.ts:304, 426, 473, 581, 734`) and threads `ExtractionOptions` through ingestion — TTS settings silently shape persisted TTS-prep caches; changing them doesn't invalidate existing caches.
3. **Reader → ingestion**: `components/reader/ContentAnalysisLegend.tsx:272` calls `reprocessBook` directly, parallel to the library's interstitial path.
4. **Backup → library store internals**: `BackupService.ts:332-334` does `useLibraryStore.setState({ offloadedBookIds })` directly, bypassing actions.
5. **Service worker contract**: cover URLs `/__versicle__/covers/{id}` are string-built in `selectors.ts:145,345` and `BookCover.tsx:28` against a route implemented in `src/sw.ts` — implicit cross-subsystem contract with no shared constant.
6. **Worker-bundle invariant by convention**: `DBService` must stay importable from the TTS worker; only docstrings (`BookImportService.ts:1-8`) prevent ingestion from leaking into it.
7. **`useLibraryStore` ↔ `useBookStore` ↔ `useReadingListStore`** cross-`getState()` writes inside actions (`useLibraryStore.ts:500, 539, 625`) — three stores mutated non-atomically per import; the zombie guards exist because of this.

## What's good (keep)

- **The static/user/cache domain split (v18 schema)**: immutable file-derived data in `static_*`, user data exclusively in Yjs, rebuildable caches in `cache_*`. `ingestBook` writing only static+cache and `deleteBook` deliberately leaving Yjs data for "soft delete"/ghost books is a sound, well-executed model (`DBService.ts:180-329`).
- **Ghost-book design**: inventory snapshots (title/author/palette) synced via Yjs let other devices render a full library without binaries; the packed 5×16-bit palette is an elegantly tiny synced representation (`types/db.ts:102-147`).
- **Offscreen renderer fidelity strategy**: extracting sentences/CFIs from a *real rendered* epubjs iframe guarantees TTS CFIs match playback rendering; the sanitizer hook on spine serialize (`offscreen-renderer.ts:192-200`) and the iframe-sandbox MutationObserver patch are thoughtful.
- **WebKit IndexedDB discipline**: Blob→ArrayBuffer conversion hoisted before transactions, reads hoisted out of readwrite txs, documented inline with the bug history (`ingestion.ts:155-168`, `DBService.ts:186-210`). Preserve these invariants verbatim.
- **`cancellable-task-runner`**: small, well-documented, well-tested generator runner — keep and *use more* (D11).
- **Cover palette math** (`cover-palette.ts`): deterministic K-means, CIELAB conversions, salience scoring — pure functions with a 343-line test file; only its plumbing (D4) is broken.
- **`entity-resolution` normalization** as a *function* is solid and heavily tested; the problem is where it's invoked (D5), not what it does.
- **`BookImportService` as a worker-bundle firewall** — the right idea; needs enforcement (D10) rather than replacement.
- **Dialog components** (Delete/Offload/Replace) are clean, focused, and accessible.

## Target design

```
src/features/library/
  import/
    ImportOrchestrator.ts     // queue of ImportJobs; the ONLY entry point for all
                              // imports (single, batch, zip, drive, restore, reprocess)
    extract.ts                // extractBook(file, depth, signal) — ONE pipeline,
                              // metadata-only short-circuit; pure, no store imports
    persist.ts                // ingest/overwrite/reprocess writes (wraps DBService)
    identity.ts               // content hash (SHA-256), duplicate policy resolution
    types.ts                  // ImportJob, ImportResult, ImportPolicy
  state/
    useLibraryStore.ts        // UI projection only: job progress, staticMetadata
                              // cache, offloaded set; no business logic
    useReadingListStore.ts    // entries gain optional bookId FK
    selectors.ts              // typed LibraryBook; join by bookId, not fuzzy keys
  ui/
    useImportController.ts    // shared hook: file pick, drop, dup dialog queue
    ... existing components, consuming the hook
```

**Import flow**: every entry point enqueues `ImportJob{file, policy}`. Pipeline stages: `validate → identify (content hash + filename) → resolve policy (new | duplicate→ask/replace | ghost→adopt id) → extract(full, signal) → persist (one tx) → register (inventory + reading-list entry built from extraction output, atomically per job)`. Batch = N jobs; per-job progress and per-job results (success/duplicate/failed) surfaced in `ImportProgressUI`. Reprocess and restore are job kinds in the same queue, eliminating the interstitial race.

**Identity**: real content hash stored in manifest; reading-list entries linked by `bookId` once at import/CSV-link time; `generateMatchKey` demoted to the one-time linker (SmartLink + CSV import).

**Boundaries**: services never import stores (lint-enforced); `extract.ts` accepts options as arguments (TTS settings passed in by the orchestrator, captured per job); SW cover route exported as a constant shared with `sw.ts`.

**UI**: one controller hook powers LibraryView header, drop zone, and EmptyLibrary; all entry points accept multi-file + ZIP; cover gradient/duration helpers extracted to `ui/book-display.ts`.

## Migration notes

1. **No user-data migration required for the core refactor** — the static/user/cache stores and Yjs document shapes stay as-is. The refactor is a code-motion + orchestration change.
2. **Backfill `perceptualPalette`/`language` into inventory** (D4): on boot, for each inventory item missing `perceptualPalette` where the local manifest has one, patch the Yjs record (idempotent; safe because manifests are local-truth for these fields). This also heals existing ghost books once any device with the binary runs the backfill.
3. **Fingerprint upgrade** (D7): add `contentHash` (SHA-256) to `StaticBookManifest`; compute lazily on first restore/offload/open of each book. Restore verification: accept match on `contentHash` OR legacy fingerprint-minus-filename; write back the new hash. Never hard-fail solely on filename mismatch.
4. **Reading-list `bookId` linking** (D5): one-time pass at upgrade — exact `sourceFilename` join, then `generateMatchKey` fuzzy join, writing `bookId` into entries. Keep the fuzzy fallback in selectors for one release behind a flag, then remove. CSV format unchanged (filename remains the portable key; `bookId` is internal).
5. **Batch dedupe** (D1): ship the unified pipeline before advertising bulk import more prominently; optionally add a one-time "find duplicate books" maintenance action (group by contentHash, offer merge/delete) to clean up libraries already polluted by the old batch path.
6. **Sequencing**: (a) extract-pipeline unification (D2) — pure refactor, regression-test with existing ingestion tests; (b) orchestrator + store slim-down (D1/D3/D11) — port the five race tests to orchestrator-level tests; (c) identity work (D5/D7) with the backfills; (d) UI consolidation (D8/D9/D14); (e) lint-enforced boundaries (D10) last so violations surface incrementally.
7. **Test consolidation**: replace the per-bug store race tests with a property-style test over the orchestrator queue (interleave add/remove/offload/restore on the same id); keep `cover-palette`, `entity-resolution`, `csv`, `cancellable-task-runner` test suites as-is — they test keepers.
