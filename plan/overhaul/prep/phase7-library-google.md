# Phase 7 design — library/ingestion, search, Google/GenAI, egress

**Read at HEAD:** `fb3dcd3f` (branch `claude/amazing-davinci-d7336e`).
**HEAD moved during prep** (Phase 2 is actively committing): by the time this doc was finished
HEAD was `da2f3a58` — `b265b2c3` (SYNC_MIGRATION_FAILED code), `f6e82769` (CRDT migration
coordinator + v6 step), `c116e957` (migration fixture/quarantine tests), `da2f3a58`
(whenHydrated on fork hydration handles) landed underneath. All file:line cites below were
re-verified against the moved tree where Phase 2 touched them.
**Geography warning for the implementing agent:** Phase 2 continues to commit to `src/store/**`
(registry, v6 follow-ups) and `packages/` already exists (`packages/zustand-middleware-yjs`,
commit `4dfd078b`). Re-run the greps in §Reality check before trusting any line number here.

Inputs: `plan/overhaul/README.md` (master plan), `proposals/strangler-incremental.md` §Phase 7
+ seam catalog §D/§E, `proposals/contract-first.md` rows C6/C8/C9/C10, analyses
`ingestion-library.md`, `google-genai.md`, `search.md`, `gap-privacy-posture-data-egress-ma.md`
(all dated 2026-06-10 but written against `3b0cfcff`, i.e. pre-P0/P1/P2).

---

> **P7 sub-track status (2026-06-12): T4 net/egress + T3 google/genai DONE** — executed on an
> isolated worktree branched from the 5a merge (`97851137`) while the 5b/5c chain runs on the
> main tree (merge later). Landed (4 commits): **PR-N1+N2** `src/kernel/net/` (destination
> registry, NetworkGateway with consent/timeout/offline/counters, NET_* codes,
> kernel-imports-nothing depcruise rule at error, raw-fetch lint ban at error, CSP generated
> from the registry into nginx.conf + vite preview + BUILD-time index.html meta — Android gets
> a CSP for the first time; registry==CSP test permanent; strict flip still P8); **PR-A1+A2**
> `domains/google/` GoogleAuthClient (per-service credential map, interactive/silent split,
> revocation-only disconnect) + DriveClient/DriveLibrarySync (typed DRIVE_API_ERROR, 401+403
> retry, q-escaping, silent boot policy), strategies/manager/lib-google DELETED, 6 call sites
> migrated, lib/drive façades deprecated (deletion: phase exit); **PR-A3+A4** `domains/google/
> genai/` (GenAIClient/GeminiClient over the gateway — @google/generative-ai SDK REMOVED —,
> four `features/*` zod modules with clamps/membership, MockGenAIClient behind
> `__versicleTest.genai.setMock`, all GenAIService localStorage mock seams deleted, smart-toc
> journey migrated and green, GenAIService kept as a working façade for the frozen lib/tts/
> app/tts consumers); **PR-A5+N3(consent)** useGenAIStore partialize allowlist + in-memory
> redacted ring buffer + persist v0→v1 strip with captured-blob test + synced per-book
> `aiConsent` + gateway consent resolver (observe-mode default).
>
> **Sub-track follow-ups (owned by the 5b/5c chain merge / later PRs):**
> 1. The TTS provider fetch sites (`GoogleTTSProvider`, `PiperProvider`, `PiperRuntime`,
>    `BaseCloudProvider`) still raw-fetch — frozen for the parallel chain; their registry
>    entries exist and the lint ban carries the documented `src/lib/tts/engine|providers`
>    exemption to burn down at merge.
> 2. The two `mockGenAIResponse` reads in `AudioContentPipeline.ts` /
>    `TableAdaptationProcessor.ts` are inert (nothing sets the key) — delete with
>    `ensureGenAIReady()` unification when the chain merges.
> 3. Per-book consent is observe-mode: explicit `aiConsent[bookId] === false` denies at the
>    gateway, but the "ask on first TTS play" prompt + bookId threading through the
>    EngineContext GenAI port are P5c/TTS-UI work; until then non-interactive calls without a
>    bookId are legacy-allowed (documented in app/google/aiConsent.ts).
> 4. `aiConsent` lives in the device-scoped preferences map (the doc's "synced preferences");
>    consent therefore syncs per device — grandfathering via synced contentAnalysis records
>    covers cross-device continuity. Revisit if a user-global home appears.
> 5. GenAIService façade + lib/drive façades carry deletion deadlines (phase exit) once
>    consumers adopt the domain clients directly.
> 6. Android device check (PR-A1): @capgo repeated-login-with-different-scopes remains
>    unverified-on-device (not testable in this environment).
> 7. T1 library and T2 search tracks of this doc are NOT part of this sub-track.

---

## Reality check

The four analyses describe a tree two phases old. Every contradiction found between their
claims and HEAD:

### Geography / naming (P1 motion)

1. **`types/db.ts` is a deprecated re-export shim** (deletion deadline P9). `ReadingListEntry`
   lives at `src/types/user-data.ts:297`; `CacheTtsPreparation` at `src/types/cache.ts:92`.
   Analyses cite `types/db.ts:694`, `:33`, `:483` etc. — all stale addresses (shim still
   re-exports, so old imports compile; do not add new ones).
2. **`src/lib/tts.ts` no longer exists** — renamed to `src/lib/tts/sentence-extraction.ts`
   (commit `929b1884`). The C8 row's "extractor relocated to `src/lib/ingestion/`" did NOT
   happen; the rename killed the name collision only. Relocation to `lib/ingestion/` is P5c
   scope (`strangler-incremental.md` §5c), not done.
3. **`BookRepository`/`ContentAnalysisRepository` are at `src/app/repositories/`**
   (`26ccceb6`), not `src/db/`. `bookRepository.getBookIdByFilename` is
   `src/app/repositories/BookRepository.ts:70`.
4. **Path aliases everywhere** (`~types/*`, `@lib/*`, `@store/*`, `@app/*`) — analyses show
   relative imports.
5. **Boot is sequenced** (`src/app/bootstrap.ts`, `BOOT_PHASES` at :21-35;
   `src/app/boot/registerBootTasks.ts`). Consequences the analyses don't know:
   - Drive auto-scan policy left `App.tsx:225-245` → `src/app/boot/backgroundTasks.ts:28-49`
     (`driveAutoScanTask`). The `error.message.includes('is not connected')` sniff cited at
     `App.tsx:234` no longer exists in App.tsx (the scanner-internal sniffs at
     `DriveScannerService.ts:27,51,99,163` remain).
   - SocialLogin init left `main.tsx` module scope → `src/app/boot/socialLogin.ts` boot task
     (`75cdddc2`). google-genai.md's "main.tsx:114-131" is stale.
   - Static-metadata hydration is now ALSO a boot task (`src/app/boot/whenHydrated.ts:66`
     `hydrateStaticMetadataTask`) — ingestion-library D16 ("hydration lives in a view
     component") is half-paid; the `prevBookCountRef` heuristic still also exists at
     `LibraryView.tsx:128-142`. P7 finishes D16 (inventory-delta subscription, both
     copies die).
   - As of `da2f3a58`, `whenHydrated` composes the fork's real hydration handles — the
     `App.tsx:269-273` boot poll the C6 row mentions is dead.

### P0 hotfixes the analyses predate

6. **Batch import is partially fixed** (`2d68511d`). ingestion-library D1's "silently drops
   failures / bypasses duplicate detection" is half-stale: at HEAD
   `processBatchImport(files, ttsOptions, onProgress, onUploadProgress, checks)`
   (`src/lib/batch-ingestion.ts:120-126`) returns `{successful, skipped, failed}`
   (`BatchImportResult`, :93-99) and takes injected `BatchImportChecks.isDuplicate`
   (:101-105); `useLibraryStore.addBooks` wires the **shared
   `findExistingBookIdByFilename` helper** (`src/store/useLibraryStore.ts:265-279`, used by
   both `addBook` :313 and `addBooks` :630) and surfaces `batchImportSummary` in
   `ImportProgressUI` (`src/components/library/ImportProgressUI.tsx:15-30`, tested in
   `ImportProgressUI.test.tsx`). **Still true at HEAD:** batch bypasses ghost matching (the
   commit message explicitly defers it: "Ghost detection stays with the Phase 7
   orchestrator"), creates no `ReadingListEntry` (compare `addBook` :386-405 with `addBooks`
   :642-661), and progress remains global single-flight (`isImporting/importProgress`,
   :286-293). P7 builds ON the P0 result shape and helper — do not reinvent them.
7. **NFKD fix-forward + `extractionVersion=2` landed** (`4197dcab`).
   `TTS_EXTRACTION_VERSION = 2` at `src/lib/tts/sentence-extraction.ts:35`; stamped at
   `src/lib/ingestion.ts:25`; row field documented at `src/types/cache.ts:104-110`.
   **The P0 agent's detection heuristic** (commit message + both doc comments): *candidates
   are rows missing `extractionVersion` (implicit v1) — those were segmented against
   NFKD-normalized text and "may carry drifted CFIs wherever decomposable characters (é, ﬁ,
   …) precede a sentence start."* Design from this version-stamp heuristic, NOT the stale
   "non-ASCII content heuristic" in the strangler risk register R8 (§Risks #2 below refines
   it into a restamp fast path).
8. **C10 `AppError` taxonomy exists** (`src/types/errors.ts`, `3d5956ae`): append-only
   `APP_ERROR_CODES` (:61-83), namespaces `APP/DB/SYNC/TTS/GENAI/DRIVE/INGEST/NET` (:40-50),
   `toJSON/fromJSON`, the `handleDbError` mapping-helper convention documented in the module
   header. `DuplicateBookError` is already typed (`:256`) and thrown at
   `useLibraryStore.ts:411`. Analyses' "create typed errors" becomes "append codes to the
   existing union".
9. **No Google-auth hotfix landed.** The strangler offered "the force-disconnect guard is
   small enough to hotfix earlier if Drive users hurt" — it was not taken.
   `GoogleIntegrationManager.getValidToken` still force-disconnects on ANY error
   (`src/lib/google/GoogleIntegrationManager.ts:35-44`) and still imports `useSyncStore` for
   the login hint (:5, :36). GG-1/GG-2/GG-6/GG-12/GG-13 are intact at HEAD; P7 carries the
   full fix.

### P1 deletions/audit the analyses predate

10. **The search worker XML-offload path is already deleted** (`bab07d89`). search.md Debt #1
    is fully paid: no `supportsXmlParsing`, no `xml` field on `SearchSection`
    (`src/types/search.ts:24-31`), no worker-side DOMParser; `search-engine.ts` is 114 lines
    (was 147), `search.ts` 204 (was 213). The xml test file is gone (7 search test files
    remain, not 8). **Also deleted: the dead `SearchResult.cfi` field** — search.md says
    "declared but never produced"; at HEAD it does not exist at all
    (`src/types/search.ts:13-18`), so the CFI design below ADDS the field fresh rather than
    populating a dead one. **Still true:** stale docstrings ("simple RegExp scan"
    `search-engine.ts:4`, "linear RegExp scan" :60), excerpt case-fold misalignment
    (:78-95 lowercases then slices the original), 50-cap silent truncation, module singleton
    `export const searchClient = new SearchClient()` (`search.ts:204`), `scrollToText` +
    500ms timer (`ReaderView.tsx:913-974`, :1358) — the P1 audit re-verified scrollToText as
    ALIVE and vetoed deletion (`prep/phase1-deletions.md` §"ALIVE"); P7 deletes it by
    replacing its only consumer.
11. **`mockGenAIResponse` seams are still in production** — the P1 audit vetoed the
    proposal's early removal (`prep/phase1-deletions.md:138-141`; routing table :202 deferred
    to a "coordinated PR", which the P1 `installTestApi` work did not do). At HEAD:
    `GenAIService.ts:82,169,176`, `AudioContentPipeline.ts:473`,
    `TableAdaptationProcessor.ts:77`, documented in `db/wipe.ts:47`; live consumer
    `verification/test_journey_smart_toc.spec.ts:31,126`. The replacement seam P7 needs
    already exists to extend: typed `window.__versicleTest` via `installTestApi()`
    (`src/test-api.ts`, installed at `main.tsx:36`, DEV/VITE_E2E-gated) and boot-time
    injected flags via `src/test-flags.ts` (`90e27de5`).
12. **`MockDriveService` moved to `src/test/harness/`** (`3a5bbf0d`) — GG-9's "ships in prod
    tree" is stale.
13. **`CostEstimator`/`useCostStore` are deleted** (`2e975a3f`) — privacy D8's "wire it or
    delete it" was resolved by deletion. The NetworkGateway's per-destination byte/char
    counters (§Design I) are the planned replacement, not a refactor of existing code.
14. **`useLibraryStore` grew: 798 → 841 lines** (P0 batch fix). `selectors.ts` is 416 lines,
    `batch-ingestion.ts` 223, `LibraryView.tsx` 679, `FileUploader.tsx` 299 (still rendered
    only inside `EmptyLibrary.tsx:56` — D8 unreachable-batch-UI is current).
    `useLibraryStore` already has a typed DI seam: `IDBService` (:112-125) + `injectedDB`
    wiring (:129-137), exported for the P0 harness — LibraryService cutover can reuse it.
15. **`zod` v4 is a prod dependency** (`package.json:82`, used by `BackupService` since the
    P0 manifest-v3 hotfix) — the per-feature GenAI schemas need no new dependency.
16. **CSP copies at HEAD:** `nginx.conf:12`, `:28`, `:41` (three identical `add_header`
    lines) + `vite.config.ts:64` (moved from the cited :35) + **`index.html` has no meta CSP**
    (verified — the Capacitor Android WebView still runs with no CSP at all). Four copies,
    none enforced (`connect-src … https: …` wildcard), exactly as the privacy report says —
    only the line numbers moved.

### Phase 2 (landed mid-prep)

17. **The CRDT migration coordinator + v6 are committed** (`f6e82769`):
    `src/app/migrations.ts` with the ordered registry `CRDT_MIGRATIONS` (:241-247, currently
    `…{ from: 5, to: 6, migrate: migrateV5toV6 }`), atomic in-transaction dual-write bumps,
    pre-migration protected checkpoint, loud-fail. **Collision:** its comments (:209-216 and
    the v5→v6 docblock) earmark **v7** for the preference-husk clear + dual-write retirement
    (a P9 act per README §5/P9) — but the reading-list `bookId` linking (this phase) is also
    a CRDT change that needs the next version number. §Design D proposes the renumbering.
18. **Fork hydration is merge-over-defaults capable** (`a39dda5c`, `5ba15c31`): adding
    optional fields (`bookId` on entries, the per-book `aiConsent` map) no longer risks the
    "no field can be safely added" hazard — the single most blocking pre-P2 finding is paid,
    which is what makes this phase's two additive synced-schema changes safe at all.

### Net-new observations (not in any analysis)

19. The SW cover route is still string-built in three places
    (`selectors.ts:145,345`, `BookCover.tsx:28`) against `src/sw.ts:15`
    (`COVERS_ENDPOINT_PREFIX`) — the shared `coverUrl()` is P3 scope; `libraryViewStore`
    must consume it, not re-inline the string.
20. `useReadingListStore` entry writes rebuild whole entry objects
    (`useReadingListStore.ts:22-24`, `:45-47`): an old client editing an entry would drop an
    unknown `bookId` field. This decides versioned-vs-unversioned for the linking migration
    (§Design D).

---

## Design

Phase 7 lands at the modular-monolith final addresses (README §2 geography rule: nothing
moves twice): `src/domains/library/`, `src/domains/search/`, `src/domains/google/`, and
`src/kernel/net/`. Note a proposals-vs-README naming conflict: the strangler seam catalog
says "`lib/net/`", the README target architecture homes the NetworkGateway in `kernel/`.
README wins per its own precedence clause ("this document is the authoritative synthesis
where the three differ"). `kernel/net` satisfies the C12 admission rule (zero internal
imports beyond `~types/errors`; ≥2 consuming domains: google, library, search, audio).
Boundary lints for the new roots flip warn→error at phase exit (program rule 3).

### A. `extractBook` — one pipeline (kills the triplication)

The three copies at HEAD, to be cited in the deletion PR:

| Copy | Where | What it duplicates |
|---|---|---|
| `extractBookData` | `src/lib/ingestion.ts:245-465` | the canonical full pipeline |
| `extractBookMetadata` | `src/lib/ingestion.ts:468-559` | ~80 lines of the same open/cover/compress/palette/fingerprint preamble, verbatim; its only caller reads `title`/`author` and discards covers+palettes (`useLibraryStore.ts:417-430`) |
| `reprocessBook` | `src/lib/ingestion.ts:65-243` | the chapter→toc/sections/tts/tables mapping loop + its own palette re-extraction; sole owner of the WebKit table-blob hoist (:155-168 region) |

New module `src/domains/library/import/extract.ts`:

```ts
export type ExtractDepth = 'metadata' | 'full';

export interface BookExtraction {
  // shared (both depths)
  title: string; author: string; language?: string;
  coverBlob?: Blob; coverPalette?: number[]; perceptualPalette?: PerceptualPalette;
  contentHash: string;            // SHA-256, content-only (see identity.ts)
  legacyFingerprint: string;      // for acceptance of pre-P7 manifests
  // depth: 'full' only
  manifest?: StaticBookManifest; resources?: StaticResource[];
  structure?: SectionMetadata[]; ttsPrep?: CacheTtsPreparation[];   // stamped extractionVersion
  tableImages?: TableImage[];
  inventory?: UserInventoryItem;  // the ONE producer — registration consumes this
  searchText?: SearchTextRow;     // plain text per section, for the search repo (§F)
}

export async function extractBook(
  file: File,
  opts: { depth: ExtractDepth; extraction: ExtractionOptions; signal?: AbortSignal },
): Promise<BookExtraction>;
```

Semantics: `depth:'metadata'` short-circuits after the metadata/cover/palette preamble (one
epubjs open — the ghost probe no longer pays the full preamble twice per import);
`depth:'full'` continues into `extractContentOffscreen`. Pure module: no store imports;
`ExtractionOptions` (sentenceStarters/sanitizationEnabled) is passed in by the orchestrator,
captured per job — severing the `useTTSStore.getState()` reach-ins at
`useLibraryStore.ts:325,613` (coupling #2 in ingestion-library.md). `signal` is checked
between chapters in the offscreen render loop (the runner pattern from
`cancellable-task-runner.ts` — a keeper, currently used only by `useEpubReader`). The WebKit
invariants (Blob→ArrayBuffer hoisted before tx; reads outside readwrite tx — `ingestion.ts`
:155-168 and `DBService.ts` ingest comments) move verbatim into `persist.ts` and are asserted
by the existing ingestion tests. The `inventory` output restores `perceptualPalette` +
`language` to the synced doc (ingestion-library D4: zero `perceptualPalette` hits in
`useLibraryStore.ts` today); a one-time idempotent backfill task patches existing inventory
items from local manifests.

### B. `ImportOrchestrator` — the job queue

`src/domains/library/import/ImportOrchestrator.ts`. The ONLY entry into the pipeline; all
six entry points (LibraryView input/drop `LibraryView.tsx:226-299`, FileUploader, Drive
`DriveScannerService.importFile` `:41-58`, ContentMissing restore, ReprocessingInterstitial,
reading-list/CSV link) enqueue jobs.

```ts
export type ImportJobKind = 'import' | 'restore' | 'reprocess' | 'reingest';
export interface ImportJob {
  id: string; kind: ImportJobKind; bookId?: string;        // known for restore/reprocess/reingest
  file?: File; policy: ImportPolicy; signal: AbortSignal;
}
export interface ImportPolicy { onDuplicate: 'ask' | 'replace' | 'skip'; adoptGhosts: boolean }
export type ImportJobResult =
  | { status: 'imported'; bookId: string }
  | { status: 'duplicate'; existingBookId: string }        // 'ask' surfaces the Replace dialog
  | { status: 'skipped' } | { status: 'failed'; error: AppError };
```

Pipeline stages per job: **validate** (zip signature, `INGEST_INVALID_FILE`) → **identify**
(`identity.ts`: `computeContentHash` = SHA-256 via `crypto.subtle` over content bytes only,
paying D7 — the current `generateFileFingerprint` at `ingestion.ts:40` embeds the filename;
restore acceptance = `contentHash` match OR legacy-fingerprint-minus-filename match, with
lazy manifest upgrade write-back) → **policy** (filename check via the store-injected
`findExistingBookIdByFilename` port — reuse the P0 helper's logic as the injected
implementation; ghost matching via `extractBook(file, {depth:'metadata'})` against inventory
entries lacking local static metadata, exactly the current `useLibraryStore.ts:415-470` logic
but now ALSO on the batch path) → **extract** (`'full'`, signal) → **persist** (one tx;
`persist.ts` wraps `dbService.ingestBook` until P3's bookContent repo replaces it) →
**register** (inventory from `extraction.inventory` + `ReadingListEntry` upsert WITH `bookId`
+ staticMetadata cache + searchText row, applied under the book's mutex; the three-store
non-atomicity that spawned the zombie guards collapses to one owner).

Batch = N jobs (`addBooks` becomes `files.map(enqueue)`); per-job progress events replace the
global `isImporting/importProgress` flags; the P0 `batchImportSummary` UI evolves into a job
list (`{imported, skipped, failed}` aggregate preserved so `ImportProgressUI.test.tsx`
assertions carry forward). `reprocess` jobs get an in-flight guard by construction (same
bookId ⇒ same mutex ⇒ queued, killing D6's overlapping `ReprocessingInterstitial` runs);
`ContentAnalysisLegend.tsx:272`'s direct `reprocessBook` call routes through the queue too
(coupling #3). **Reversibility (per the strangler):** the orchestrator first ships *behind*
the existing `addBook(file, options)` signature — `useLibraryStore.addBook` delegates to it
— then entry points cut over one at a time.

### C. `LibraryService` + the five invariants

`src/domains/library/LibraryService.ts` owns delete/offload/restore/hydrate workflows and the
**per-book keyed mutex** (one `KeyedMutex` instance shared with the orchestrator: every
mutation of book `X` — import, register, delete, offload, restore, reprocess, hydrate-write —
runs inside `mutex.run(X, fn)`). The store's four copy-pasted zombie-guard blocks
(`useLibraryStore.ts:334-360` region and siblings) become structural.

The five race-regression files, each mapped to its lifted service invariant (these are the
entry-gate suite, `LibraryService.invariants.test.ts`, written FIRST — program rule 7):

| Race file (at HEAD) | Pinned behavior | Service invariant |
|---|---|---|
| `useLibraryStore.race.test.ts:8` ("should not overwrite concurrent additions or updates when hydrating static metadata") | hydration vs concurrent add/update | **I-1** `hydrate()` is a per-key merge: a book written after hydrate's read snapshot is never clobbered (hydrate writes under each book's mutex, compare-and-skip on newer write) |
| `useLibraryStore.removeRace.test.ts:9` ("should not restore concurrently removed books when hydrating") | hydration vs concurrent remove | **I-2** hydration never resurrects: a key absent from inventory at write time is dropped, not written |
| `useLibraryStore.restoreRace.test.ts:9` ("should not resurrect concurrently removed books during restoreBook") | restore vs concurrent remove | **I-3** restore re-validates existence inside the mutexed register step; delete(X) and restore(X) serialize on X |
| `useLibraryStore.offloadRevert.test.ts:9` ("should not remove offloaded state if offload fails but book was already offloaded") | failed offload rollback | **I-4** failure paths restore the *captured prior* state, never an assumed default (offloaded stays offloaded) |
| `useLibraryStore.offloadedRace.test.ts:9` ("should not overwrite concurrent removals from offloadedBookIds during hydration") | hydration vs offload-set removal | **I-5** the offloaded set is updated per-key (add/remove deltas), never replaced wholesale from a stale snapshot |

Plus one new property test: seeded interleavings of
{import, delete, offload, restore, hydrate} on one bookId — terminal state ∈ the set of
sequentially-reachable states (the generalization the five point fixes approximate). The five
files are deleted only in the cutover PR that lands their assertions as
`describe('regression: …')` blocks in the invariant suite (rule 8; absorption ledger).

### D. `useLibraryStore` → projection; `libraryViewStore`; `bookId` FK

**Store shrink.** Re-measured at HEAD: 841 lines. Target ≤ ~150: transient UI projection only
— `staticMetadata` cache, `offloadedBookIds`, job-progress projection (subscribed from the
orchestrator), `error`. All workflow actions become one-line delegations during the cutover
PR, then are removed from the store API as call sites move to the service/controller
(getState() writes from `BackupService.ts:332-334` and `DriveScannerService.ts:49` are
re-pointed to the service in the same wave — coupling #1/#4).

**`libraryViewStore`** (`src/domains/library/state/libraryViewStore.ts`): a derived zustand
store recomputed from subscriptions to useBookStore/useLibraryStore/useReadingStateStore/
useReadingListStore/useLocalHistoryStore — off-render, replacing `selectors.ts`'s
module-level mutable caches (`selectors.ts:14-33` `createModuleCache`, the `any`-typed
12-eslint-disable block) and the render-time fuzzy `generateMatchKey` joins (:213-225,
:305-322 equivalents at HEAD). Declared return type `LibraryBook` (inventory + static +
resolved progress + `allProgress` + readingListEntry) — kills the `(book as unknown as
{allProgress?})` casts in `BookCard.tsx:130,167`. Progress resolution delegates to the single
`resolveProgress` (and, when P2's tier work extracts `lib/progress/resolve.ts`, to that).
Cover URLs via the P3 `coverUrl()` helper (Dependencies). Gate: `selectors.perf.test.ts`
(exists at HEAD) re-pointed and green; `selectors.ts` deleted at exit.

**`bookId` FK + one-time linking migration.** `ReadingListEntry` gains `bookId?: string`
(`src/types/user-data.ts:297`). Resolution happens at write time forever after (import
register stage; CSV import; SmartLink accept). Existing entries: one-time linking pass —
exact `sourceFilename` join, then `generateMatchKey` fuzzy join (`entity-resolution.ts`
demotes from render-time joiner to one-time linker), `bookId` written copy-if-absent,
deterministic (sorted iteration) and idempotent, hence LWW-safe under concurrent migration —
the same discipline as `migrateV5toV6` (`src/app/migrations.ts:227-239`).

**SCHEDULE (program rule 4 — one in-flight format change).** The rule-4 sequence is
`…backup v3 (P0, done) → CRDT v6 (P2, just landed) → IDB v25 (P3) → tts-storage split (P5b)
→ reading-list bookId linking (P7) → font rename (P8)`. Proposed slot:

- The linking lands as **CRDT step `{ from: 6, to: 7 }`** in `CRDT_MIGRATIONS`
  (`src/app/migrations.ts:241-247`), as the **final PR of Phase 7**, gated on: v6 straggler
  path verified (P2 exit), IDB v25 stragglers verified (P3 exit), and the P5b tts-storage
  split verified — if Track A (P5) lags Track B, this one PR waits; everything else in P7 is
  rule-4-free and parallelizes.
- **Renumbering required:** `migrations.ts:209-216` comments and README §5/P9 currently
  earmark v7 for the preference-husk clear + `library.__schemaVersion` dual-write retirement.
  That retirement moves to **v8 (P9)**. This is a documentation/registry renumber only —
  nothing has shipped v7 — but it needs program-owner sign-off; flag it in the P7 kickoff.
- **Why versioned (not a soft backfill):** old clients rebuild whole entry objects on edit
  (`useReadingListStore.ts:22-24,45-47` spread fresh literals) and would silently drop the
  unknown `bookId` field; the version bump quarantines pre-v7 clients (the established
  mechanism: v5 via dual-written `library.__schemaVersion`, v6+ via `meta` once P4's
  synchronous pre-merge check reads it) — the only structural protection for link integrity.
  Costs and mitigations in §Risks #1.
- Rules 5/6 compliance: bookId *writes* (import-time + migration) ship a full release before
  the selector join *depends* on bookId (fuzzy fallback stays behind a flag for one release,
  then dies); a two-client upgrade E2E (captured v6 doc fixture vs v7 client, quarantine
  asserted) ships in the same PR — the P2 capture script (`12d692f5`) generates the fixture.

CSV format unchanged: `filename` remains the portable key; `bookId` is internal and excluded
from export. The dialog's bespoke CSV exporter is deleted for `exportReadingListToCSV` (D9)
in the same UI wave.

### E. NFKD background re-ingestion wave

Detection — **from the P0 stamps at HEAD, not the analysis-era heuristic**:

1. Candidate book ⇔ any `cache_tts_preparation` row for it has
   `extractionVersion === undefined || extractionVersion < TTS_EXTRACTION_VERSION`
   (`src/types/cache.ts:104-110`; constant at `sentence-extraction.ts:35`).
2. Restamp fast path: for a candidate row, if every persisted sentence satisfies
   `s.text === s.text.normalize('NFKD')` the v1 output is byte-identical to v2 (no
   decomposable characters ⇒ no offset drift was possible) — restamp `extractionVersion: 2`
   in place without re-extracting. This is the cheap "skip pure-ASCII books" refinement; it
   operates on persisted rows, not on re-reading the EPUB.
3. Everything else gets a `reingest` job: full `extractBook('full')` honoring the C8/R4
   graft — **old rows retained until a CFI-alignment self-check passes** (new sentence CFIs
   resolve in the rendered section; on failure keep old rows, log, surface a "re-import
   recommended" badge instead of corrupting positions).

Mechanism: a `backgroundTasks`-phase boot task enumerates candidates (idle-priority,
yielding scan) and enqueues `reingest` jobs at the queue's lowest priority; chunked,
resumable (per-book completion is durable — the stamp itself is the resume marker),
user-visible progress with a defer toggle in settings. Offloaded/ghost books are skipped
(no binary) and heal on restore/import, which always writes v2.

### F. Search: `SearchSession` + persisted text + exact-match navigation

**`SearchSession`** (`src/domains/search/SearchSession.ts`) replaces the module singleton
(`search.ts:204`). Created by the reader container, provided via context to `SearchPanel`;
owns the worker lifecycle (`index() / search() / dispose()`); constructor-injected
`engineFactory: () => Comlink.Remote<SearchEngine>` so tests run the real engine over a
`MessageChannel` (the proven `WorkerTtsEngine.test.ts` pattern); `worker.onerror` resets
state and toasts (search.md #6 — dead-worker `isIndexed:true` + never-settling promises);
`dispose()` aborts in-flight indexing via a generation counter and rejects pending promises
(fixing the `terminate()` leak), and clears caches unconditionally. The ReaderView/SearchPanel
split-brain (`ReaderView.tsx:24,527` terminates what `SearchPanel.tsx:36-65` populates) dies
with the singleton.

**Persisted text — the P3 repo dependency, named.** New row + repo following P3's
`src/data/` pattern (zod row in `src/data/rows/`, repo in `src/data/repos/`, writes through
the navigator.locks write-gate, pinned by the repos' real-idb-vs-fake contract suite):

```ts
// src/data/rows/searchText.ts
export interface SearchTextRow {
  bookId: string;                       // keyPath
  extractionVersion: number;            // invalidation: re-extract when stale
  sections: { href: string; title: string; text: string }[];
}
// src/data/repos/searchTextRepo.ts
export interface SearchTextRepo {
  get(bookId: string): Promise<SearchTextRow | undefined>;
  put(row: SearchTextRow): Promise<void>;
  delete(bookId: string): Promise<void>;   // invoked by the book-deletion path
}
```

**Ask of P3 (Dependencies):** create the empty `cache_search_text` object store inside the
IDB **v25** upgrade so P7 adds no second IDB version bump (rule-4 hygiene; the store is
cache-domain, rebuildable — absence simply triggers extraction, so old installs degrade to
current behavior). Fallback if P3 has shipped: additive v26 through P3's versioned migration
registry. Population: at import (the unified `extractBook` already walks every spine item —
`searchText` is a free output) and lazily on first search for pre-existing books.

**Engine changes** (`search-engine.ts`, kept as a plain class + 5-line worker — both
keepers): match against the ORIGINAL string with an escaped-literal Unicode regex (fixes the
Turkish-İ excerpt misalignment of the lowercase-then-slice approach at :78-95; an
escaped-literal regex cannot backtrack — the ReDoS history concerned query-derived patterns);
record per-occurrence `charOffset`; return `{ results, truncated }`. `SearchResult` becomes
`{ href, sectionTitle, excerpt, charOffset, occurrence, cfi? }` (the `cfi` field is NEW at
HEAD — see Reality check #10). CFI resolution: lazily on click via the section's
`cfiFromRange` over the offset (cheap, no index-time cost), falling back to `display(href)`
if resolution fails.

**Navigation:** result click → `rendition.display(cfi)` + temporary highlight annotation
(auto-removed). **`scrollToText` (`ReaderView.tsx:913-974`) and the 500ms `setTimeout`
(:1358) are deleted in the same PR** — this is the artifact named by the P1 veto; its only
consumer is being replaced, so the veto expires here. Stale docs fixed in the same PR:
`search-engine.ts:4,:60`, `src/workers/README.md` (still says FlexSearch), `architecture.md`
search section.

Out of scope (explicit non-goals, per search.md): inverted index, FlexSearch revival,
query-as-regex, library-wide FTS (the persisted text makes it cheap later; not this phase).

### G. `GoogleAuthClient`

`src/domains/google/GoogleAuthClient.ts` — ONE class (the Web/Android strategy pair is ~95%
duplicated with no shared interface and a `disconnect` signature drift; platform differences
are constructor options):

```ts
export interface GoogleCredential {
  accessToken: string; idToken?: string; expiresAt: number; scopes: readonly string[];
}
export class GoogleAuthClient {
  constructor(opts: {
    platform: { style?: 'bottom'; autoSelectEnabled?: boolean };   // Android opts; web passes {}
    getLoginHint: () => string | undefined;                        // injected at app/ composition
  });
  /** Interactive. May open UI. Returns the full credential (idToken for Firebase). */
  connect(serviceId: GoogleServiceId): Promise<GoogleCredential>;
  /** Silent. NEVER opens UI. Throws GoogleAuthRequiredError when interaction is needed. */
  getToken(serviceId: GoogleServiceId): Promise<string>;
  disconnect(serviceId: GoogleServiceId): Promise<void>;
}
```

Semantics, each reversing a verified critical:

- **Per-service token map** `Map<GoogleServiceId, GoogleCredential>` with scope-superset
  validation on cache hits (GG-1: the single `accessToken/tokenExpiration` instance pair at
  `WebGoogleAuthStrategy.ts:5-6` serves all scopes today).
- **Interactive/silent split** (GG-2): `getToken` never calls `SocialLogin.login`; an empty
  or expired cache throws typed `GoogleAuthRequiredError`. Background flows (the
  `driveAutoScanTask` boot task) catch it and show a reconnect affordance instead of popping
  blocked login UI.
- **Force-disconnect only on definitive revocation** (replacing the catch-all at
  `GoogleIntegrationManager.ts:38-44`): disconnect on 401-with-`invalid_grant`/explicit
  revoke responses only; popup-block, offline, and 5xx are `GoogleAuthTransientError` and
  leave persisted state alone. `useGoogleServicesStore.connectedServices` demotes to a
  "has connected before" hint (drives reconnect-vs-first-connect copy), never an
  authorization claim.
- **Login hint injected** via `getLoginHint` wired in `app/` from `useSyncStore` — severing
  the lib→sync-store import (`GoogleIntegrationManager.ts:5,36`, GG-12).
- **`auth-helper` consumes `connect('identity')`** for its idToken instead of its parallel
  direct `SocialLogin.login` path (GG-13); `getScopesForService` throws on unknown ids
  (`config.ts:27-29` returns `[]` today). Coordination note: P4 owns AuthSession — if P4 has
  already decomposed auth-helper when this lands, the consumption point is P4's AuthSession;
  the client API above is what P4 was told to expect (contract-first Theme 8).
- **Errors** extend the C10 union (append-only — Reality check #8): new namespace `GOOGLE`
  appended to `APP_ERROR_NAMESPACES` (`types/errors.ts:40-50`), codes `GOOGLE_AUTH_REQUIRED`,
  `GOOGLE_AUTH_REVOKED`, `GOOGLE_AUTH_TRANSIENT`; plus `DRIVE_API_ERROR` carrying
  `{status, reason}` in `context`. `DriveService` maps at one boundary helper
  (`handleDriveError`, the documented `handleDbError` convention), gains a
  403-insufficient-scope retry (today only 401 retries, `DriveService.ts:36-40`), and the
  four `includes('is not connected')` sniffs (`DriveScannerService.ts:27,51,99,163`) become
  `instanceof` checks.

Migration: `googleIntegrationManager` remains a thin deprecated alias while the call sites
(`FileUploader.tsx:162` area, `LibraryView.tsx:154-169`, `SyncSettingsTab`,
`ContentMissingDialog`, `DriveService`, auth-helper) migrate PR-by-PR; alias deleted at phase
exit (rule 2). Android verification item: @capgo plugin behavior on repeated `login` calls
with different scopes (flagged by the analysis, never verified) — an explicit device-test
task in the first auth PR.

### H. `GenAIClient` + per-feature zod modules + the mock-seam exit

`src/domains/google/genai/`:

```ts
export interface GenAIRequest<T> {
  prompt: string | Part[];
  responseSchema: object;                  // sent to the API (Gemini JSON mode)
  validate: (raw: unknown) => T;           // REQUIRED — zod parse + input-membership checks
  context?: { bookTitle?: string; sectionTitle?: string; correlationId?: string };
  signal?: AbortSignal;
}
export interface GenAIClient {
  generateStructured<T>(req: GenAIRequest<T>): Promise<T>;
  isConfigured(): boolean;
}
```

- **`GeminiClient`**: reads config per call from an injected provider
  (`() => {apiKey, model, rotationEnabled}` backed by `useGenAIStore`) — no mutable singleton
  fields, so the TTS pipeline's hardcoded `configure(apiKey, 'gemini-1.5-flash')` clobber
  (`AudioContentPipeline.ts:505-507`, `TableAdaptationProcessor.ts:81-83`) becomes
  structurally impossible. Rotation keeps the 429 retry but with one MODELS constant and
  Fisher-Yates. All HTTP via `NetworkGateway.egress('gemini', …)` (the SDK does not accept a
  fetch injection; either wrap at the call boundary or take the optional migration to
  `@google/genai` which does — decision deferred to the implementing PR, registry entry is
  identical either way). Validation failures throw `GENAI_INVALID_RESPONSE` (new code) and
  the callers mark `status:'error'` via the existing `markAnalysisError` machinery — bad
  model output stops poisoning the synced `contentAnalysis` map (GG-5).
- **`features/`** — `tocTitles.ts`, `referenceDetection.ts`, `tableAdaptation.ts`,
  `libraryMapping.ts`: each owns prompt + zod schema + validation + mapping, generalizing the
  `SmartLinkDialog.tsx:82-87` input-membership keeper. Specific clamps from the analysis:
  `referenceStartIndex ∈ [-1, n-1]` (any other negative currently flags EVERY group as
  reference, `GenAIService.ts:330-334`); echoed `id`/`cfi` ∈ input set for TOC/table/mapping.
  The prompt-minimization technique (asymmetric truncation, deterministic-hint
  agree/disagree) is preserved verbatim — it is a named keeper.
- **Logging/persistence** (privacy D3/GG-3): `useGenAIStore` `partialize` becomes an explicit
  allowlist (`apiKey`, `model`, flags — today it spreads the whole state including `logs`,
  `useGenAIStore.ts:105-107`); logs become an in-memory ring buffer with `inlineData`
  redaction (log `{byteCount, hash}`); persist-version bump strips `logs` from existing
  `genai-storage` blobs, with a captured-blob regression test pinning apiKey/flag survival
  (the program's captured-artifact-fixture standard). When P5b extracts the kernel
  ring-buffer, this buffer adopts it; until then a local 500-cap array.
- **Per-book AI consent** (privacy D2): `aiConsent: Record<bookId, boolean>` in synced
  preferences (additive — safe post-P2 merge-defaults), enforced inside the
  NetworkGateway consent gate for `dataClass: 'book-content'|'book-derived'` non-interactive
  egress; transient "AI analysis active" indicator in the TTS UI; existing users
  grandfathered by deriving `granted` from existing `contentAnalysis` records (no new prompts
  for already-analyzed books); the zero-egress deterministic detector stays the default.
- **The mock-seam exit (the installTestApi replacement the E2E journey needs).** The P1 audit
  vetoed bare deletion because `verification/test_journey_smart_toc.spec.ts:31,126` is a live
  consumer (Reality check #11). Design: `src/app/genai.ts` composition holder
  (`getGenAIClient()` / DEV-only `setGenAIClient()`); `MockGenAIClient` lives outside the
  prod graph (selected only under `import.meta.env.DEV || VITE_E2E` — boundary rule 9);
  `installTestApi()` (`src/test-api.ts`) gains
  `window.__versicleTest.genai.setMock(fixture: { response?: unknown; error?: string })`
  which swaps the holder to a `MockGenAIClient` primed with the fixture (runtime-settable —
  the spec sets its mock after boot, so no `test-flags.ts` boot-time channel is needed). One
  PR migrates the spec to the typed API AND deletes all three production checks
  (`GenAIService.ts:82,169,176`; `AudioContentPipeline.ts:473`;
  `TableAdaptationProcessor.ts:77`) plus the `db/wipe.ts:47` doc line. The shared
  `ensureGenAIReady()` helper replaces the duplicated `canUseGenAI` expressions so the
  consent gate has exactly one home.
- **EngineContext coordination:** `GenAISettingsSnapshot = ReturnType<typeof
  useGenAIStore.getState>` is still the worker protocol type (`EngineContext.ts:45`) and the
  port still carries `configure`. Narrowing the port to
  `detectContentTypes`/`generateTableAdaptations` is P5c scope; P7's contract is: the port
  adapters (in `src/app/tts/`) call the `features/*` functions against `getGenAIClient()`,
  and `configure` on the port becomes a no-op shim until P5c deletes it. Sequencing-safe in
  either order.

### I. `kernel/net/` — destination registry + NetworkGateway + lint ban + generated CSP

`src/kernel/net/destinations.ts` — the single source of truth (privacy report target design,
adjusted for HEAD):

```ts
export interface EgressDestination {
  id: DestinationId;
  hosts: readonly string[];                 // exact hosts; no scheme wildcards
  via: 'gateway' | 'sdk';                   // sdk = firebase/@capgo/genai-sdk: hosts feed CSP,
                                            // calls can't route through egress()
  purpose: string;
  dataClass: 'book-content' | 'book-derived' | 'metadata' | 'binary-asset' | 'auth' | 'remote-code';
  consent: 'none' | 'per-book' | 'per-action' | 'oauth' | 'provider-selection';
  timeoutMs: number | null;                 // null = abortable but unbounded (downloads)
  offline: 'fail' | 'cache-fallback';
}
```

Registry entries (from the verified egress matrix, rows 1-12; rows 13-15 are not
fetch-mediated and are handled elsewhere): `gemini` (60s, per-book), `google-tts` /
`openai-tts` / `lemonfox-tts` (30s, provider-selection — threading the dead `signal` param of
`BaseCloudProvider.fetchAudio:151-160` from `stop()`, paying privacy D10),
`hf-piper-catalog` (cache-fallback — pairs with P5a's voices.json caching),
`hf-piper-models` (null timeout, abortable), `cdnjs-onnxruntime` (`remote-code` — entry
exists ONLY until P5a vendors onnxruntime, then is deleted and CSP tightens), `drive`,
`google-oauth` (sdk), `firebase` (sdk; hosts = the static googleapis trio + the
user-configured authDomain — see Risks #4). Same-origin fetches (covers via `blob:`,
`/books/alice.epub`, `/dict/cedict.json`) need no registry entry; the lint rule allowlists
same-origin/blob literals or routes them through a trivial `local()` helper —
implementer's choice, test pins whichever.

`src/kernel/net/NetworkGateway.ts`: `egress(destinationId, init): Promise<Response>` applying
consent (throws `NET_CONSENT_REQUIRED`, consumed by UI as the consent prompt), per-destination
`AbortController` timeout (`NET_TIMEOUT`), offline policy (`NET_OFFLINE`), and per-destination
session byte/char counters (the deleted CostEstimator's replacement — Reality check #13 —
surfaced later by P8's settings "Network activity" panel).

**Enforcement:**
- ESLint `no-restricted-globals`/`no-restricted-syntax` bans raw `fetch`/`XMLHttpRequest`/
  `navigator.sendBeacon` outside `src/kernel/net/` — flips to error at phase exit, with
  temporary file-level disables burned down inside the phase. The 11 call sites at HEAD to
  migrate: `PiperProvider.ts:85`, `piper-utils.ts:102`, `GoogleTTSProvider.ts:57,95`,
  `BaseCloudProvider.ts:149`, `DriveService.ts:24`, plus the local-only
  `ingestion.ts:95,273,497` / `EmptyLibrary.tsx:32` / `useChineseDictionary.ts:19`.
  Exemption: `public/piper/piper_worker.js` (unbundled XHR + remote `importScripts`) is
  invisible to lint until P5a moves it into `src/` — the registry documents it; the gate
  completes in 5a (Dependencies).
- **CSP generated from the registry** — `scripts/generate-csp.ts` emits the policy string;
  the four hand-copies at HEAD it replaces: `nginx.conf:12`, `nginx.conf:28`, `nginx.conf:41`,
  `vite.config.ts:64`, plus the missing-by-omission `index.html` meta (no CSP on Android —
  verified at HEAD). **Phase split per the seam catalog ("Phase 7 gateway; Phase 8 CSP
  emission"):** P7 lands the generator, wires `vite preview`, and makes the
  **registry==CSP unit test** a permanent invariant (parse the generated string, assert
  host-set equality with the registry — the P7 exit criterion); the strict flip across
  nginx template + index.html meta waits for P8, after P5a removes `cdnjs` and Piper offline
  works — privacy migration note: "Do CSP last … or Piper/Drive/Firebase will break for
  users mid-rollout."
- **Sanitizer remote-resource blocking** (privacy D5, listed under the P7 gateway seam):
  `sanitizer.ts` rewrites remote `<img src>`/`url()` to blocked placeholders at serialize
  time (per-book "allow remote content" override), removes the no-op
  `FORBID_ATTR: ['on*', …]` entries, and gains a tracking-pixel EPUB regression fixture.
  Reader-adjacent but sanitizer-owned; coordinate with P6 if it has already wrapped the
  sanitize hook.

### Parallel sub-tracks within P7

| Track | Contents | Hard dependencies |
|---|---|---|
| **T1 library** | §A extractBook, §B orchestrator, §C service+invariants, §D store/view, §E NFKD wave | P2 (landed); P3 bookContent repo only for `persist.ts`'s final form (façade until then); §D's linking PR additionally gated by rule 4 |
| **T2 search** | §F | P3 for the searchText repo PR only (session/engine/CFI PRs are independent); P6 not required (works against the live rendition) |
| **T3 google/genai** | §G, §H | T4's gateway for client routing + consent gate; P4 coordination on auth-helper/AuthSession |
| **T4 net/egress** | §I | none (lands first) |

T4 → T3 is the only inter-track edge; T1, T2, (T4→T3) are mutually independent. The single
program-wide serialization point is T1's final linking-migration PR (rule 4).

---

## Execution order

Entry gates (rule 7) precede their tracks; each PR lists exit criteria and the gates that
prove them. "Full gates" = lint (incl. new bans at current level), `tsc -b` (all test code),
vitest, depcruise ratchet (never regresses), worker-chunk assertion, coverage ratchet,
Playwright desktop.

**PR-0a (gate, T1):** `LibraryService.invariants.test.ts` — the five invariants of §C + the
interleaving property test, written against the `LibraryService` interface with a thin
adapter over the CURRENT `useLibraryStore` (reusing its exported `IDBService` seam +
harness doubles). Proves current behavior satisfies I-1..I-5 before anything changes.
*Exit:* suite green on the adapter; zero prod changes. *Gates:* vitest.

**PR-0b (gate, T1/UI):** import journey E2E hardening — extend
`test_journey_advanced_import` / `test_journey_import_error` / `test_journey_drag_drop` to
pin: per-file batch results (P0 summary), duplicate→Replace dialog flow, reprocess
interstitial completion. *Exit:* journeys green against HEAD. *Gates:* Playwright.

**PR-0c (gate, T2):** search characterization consolidation — engine behavior+fuzz suite and
client lifecycle suite pinning CURRENT semantics (including the 50-cap and case-fold quirk as
`it.failing` or documented-current-behavior assertions); delete the vacuous zero-width-RegExp
test, the assertion-free perf file (or give it a budget in a bench lane), and fold the two
repro files in as named regressions (absorption ledger). *Exit:* 7 files → 2 + component
test, all green. *Gates:* vitest, coverage ratchet.

**PR-N1 (T4):** registry + `NetworkGateway` + counters + `generate-csp.ts` + registry==CSP
unit test + vite-preview wiring. No call-site moves. *Exit:* registry==CSP test green
(permanent invariant from here). *Gates:* full.

**PR-N2 (T4):** migrate the 11 fetch sites; lint ban lands in warn with file-disables, flips
to error in this PR's final commit once disables hit zero (piper_worker.js documented
exemption). `NET_*` codes appended. *Exit:* zero raw fetch outside `kernel/net` (lint
error); TTS/Drive/GenAI E2E journeys green. *Gates:* full + Playwright.

**PR-N3 (T4):** sanitizer remote-resource blocking + tracking-pixel fixture; per-book
`aiConsent` map + gateway consent gate + "AI analysis active" indicator + grandfathering
derivation. *Exit:* tracking-pixel journey green (pixel blocked); consent prompt journey;
no Gemini egress without consent (gateway unit test). *Gates:* full + Playwright.

**PR-A1 (T3):** `GoogleAuthClient` + `GOOGLE_*`/`DRIVE_API_ERROR` codes + revocation-only
disconnect + scope-keyed cache; `googleIntegrationManager` becomes a deprecated alias over
it; DriveService 403 retry + `handleDriveError`; the four message-sniffs replaced. *Exit:*
auth contract suite green (token-per-service, silent-vs-interactive, revocation matrix);
Drive scanner tests green with typed errors; Android repeated-login device check recorded.
*Gates:* full.

**PR-A2 (T3):** call sites off the alias (FileUploader, LibraryView, SyncSettingsTab,
ContentMissingDialog, auth-helper→`connect('identity')`); strategies + manager alias
deleted. *Exit:* `lib/google/` strategy files gone; drive E2E green. *Gates:* full +
Playwright.

**PR-A3 (T3, after N2):** `GenAIClient`/`GeminiClient` + four `features/*` zod modules +
per-call config provider + gateway routing; `GENAI_INVALID_RESPONSE`; structured-output fuzz
tests (seeded `fuzz-utils`). *Exit:* GenAI fuzz suite green; clamp tests
(referenceStartIndex range, id/cfi membership) green; `GenAIService` reduced to a deprecated
delegate. *Gates:* full.

**PR-A4 (T3):** mock-seam exit — `MockGenAIClient` + `__versicleTest.genai.setMock` +
`test_journey_smart_toc.spec.ts` migrated + the three prod localStorage checks deleted +
`ensureGenAIReady()` unification + `GenAIService` deleted. *Exit:* repo-wide grep for
`mockGenAIResponse` hits only the spec + wipe doc updated; smart-toc journey green.
*Gates:* full + Playwright.

**PR-A5 (T3):** `useGenAIStore` partialize allowlist + ring-buffer logging with redaction +
persist-version strip migration + captured-blob survival test. Scheduled away from the
PR-L7 window (it is a localStorage format change in spirit even though strip-only —
see Risks #8). *Exit:* captured genai-storage blob test green; no `logs`/no `inlineData` in
localStorage after a table-adaptation E2E run. *Gates:* full + Playwright.

**PR-S1 (T2):** `SearchSession` + DI worker factory + onerror/dispose semantics +
ReaderView/SearchPanel wiring; singleton deleted. *Exit:* `search.ts` module singleton gone;
session lifecycle suite green (incl. dispose-during-index, worker-crash reset). *Gates:* full.

**PR-S2 (T2):** engine occurrence offsets + original-string matching + `{results, truncated}`
+ sectionTitle/occurrence metadata; SearchPanel truncation notice + indexing-failure toast.
*Exit:* İ-excerpt exact-boundary test green; search journeys green. *Gates:* full +
Playwright.

**PR-S3 (T2, after P3):** `SearchTextRepo` + population at import/first-search +
delete-with-book + repo contract suite entry. *Exit:* second open of a book skips
re-extraction (test via extraction-spy); delete removes rows in the same tx (repo test).
*Gates:* full.

**PR-S4 (T2):** lazy CFI resolution + navigate-by-CFI + temporary highlight; **delete
`scrollToText` + the 500ms timer**; fix the three stale doc locations. *Exit:*
search-to-exact-match journey (result #N lands on occurrence N, asserted via highlight
position); `scrollToText` gone. *Gates:* full + Playwright (`test_journey_search`,
`_search_mobile` updated).

**PR-L1 (T1):** `extractBook` unification — `extractBookData`/`extractBookMetadata`/
`reprocessBook` become wrappers over it, then the wrappers inline away; WebKit invariants
ported verbatim; palette/language asserted on the inventory output. *Exit:* the three copies
deleted from `ingestion.ts`; existing ingestion tests green; ghost-probe no longer runs
compression/palettes twice (timing assertion or call-count spy). *Gates:* full.

**PR-L2 (T1):** `ImportOrchestrator` + keyed mutex behind the existing `addBook`/`addBooks`
signatures; entry points cut over one at a time (LibraryView, FileUploader, Drive, restore,
reprocess — interstitial routes a `reprocess` job; `ContentAnalysisLegend` reprocess
re-pointed). Batch gains ghost-matching + reading-list registration (the two P0 leftovers).
*Exit:* PR-0b journeys green unchanged; per-job progress in UI; D6 overlap impossible
(mutex test). *Gates:* full + Playwright.

**PR-L3 (T1):** identity — SHA-256 `contentHash` + legacy-fingerprint acceptance + lazy
manifest upgrade + renamed-file restore; palette/language one-time backfill task. *Exit:*
restore-renamed-file test green (the D7 repro); backfill idempotency test. *Gates:* full.

**PR-L4 (T1):** `LibraryService` cutover — invariant suite's adapter swapped for the real
service; `useLibraryStore` shrinks to the projection (≤ ~150 lines from 841);
`BackupService`/`DriveScannerService` writes re-pointed; the five race files deleted with
their named-regression absorption in the same PR. *Exit:* invariant suite green on the real
service; store ≤150 lines; race files gone, ledger updated; full E2E green. *Gates:* full +
Playwright + coverage ratchet (must not drop).

**PR-L5 (T1):** `libraryViewStore` + typed `LibraryBook`; `selectors.ts` module cache
deleted; `useImportController` consolidating LibraryView/FileUploader (multi-file + ZIP at
every entry point; one duplicate-dialog queue); dialog CSV exporter deleted for
`exportReadingListToCSV`. *Exit:* `selectors.ts` deleted; `selectors.perf.test.ts`
(re-pointed) green; BookCard casts gone; bulk-import-with-existing-library journey green.
*Gates:* full + Playwright.

**PR-L6 (T1):** NFKD re-ingestion wave — `reingest` job kind + boot enumerator (stamp-based
detection per §E) + restamp fast path + CFI-alignment self-check with old-row retention +
settings defer toggle. *Exit:* wave unit tests (detection matrix: unstamped/v1-equivalent/
drifted); composed-accent + CJK fixture comparison old-vs-new CFIs green (the R4 CI gate);
idle-priority verified (no jank assertion in journey). *Gates:* full.

**PR-L7 (T1, LAST — rule-4 gated):** `bookId` FK + `{from: 6, to: 7}` linking migration +
selector bookId-join behind flag (fuzzy fallback retained one release) + captured-v6-doc
fixture test + two-client quarantine E2E + renumbering of the husk-clear/dual-write
retirement to v8 in `migrations.ts` comments and README. **Merge gate: P3's IDB v25 and
P5b's tts-storage split verified shipped** (if Track A lags, this PR waits — everything else
in P7 is already done). *Exit:* migration fixture test green; two-client E2E green
(v6 client quarantines against v7 doc); CSV round-trip unchanged. *Gates:* full +
Playwright + the migration invariant suite from P2 (`c116e957`) extended with the v7 step.

Phase exit criteria (= strangler P7's, mapped): import journey E2E through one queue
(PR-0b+L2), invariant suite covers the five historical races (PR-0a+L4), `useLibraryStore`
≤ ~150 lines (L4), registry==CSP test green (N1), GenAI structured-output fuzz green (A3),
`selectors.ts` deleted with perf test green (L5), plus: zero raw fetch (N2), mock seams gone
(A4), `scrollToText` gone (S4), strategies/manager/GenAIService deleted (A2/A4). Deleted
legacy artifacts named per rule 2: `extractBookMetadata`/`reprocessBook` copies,
`searchClient` singleton, `scrollToText`, `WebGoogleAuthStrategy`/`AndroidGoogleAuthStrategy`/
`googleIntegrationManager`, `GenAIService`, `selectors.ts` module cache, the three
`mockGenAIResponse` prod checks, the five race files, the dialog CSV exporter.

---

## Test plan

**Existing suites that pin behavior (keep green throughout, port assertions, never weaken):**

- Library: `useLibraryStore.test.ts` (incl. P0 batch additions), the five `*race*` files
  (until PR-L4 absorbs them), `batch-ingestion.test.ts` (P0), `ImportProgressUI.test.tsx`,
  `BookRepository.test.ts` (`getBookIdByFilename` :135-145), and the keeper suites:
  `cover-palette`, `entity-resolution` (421-line heuristic suite — becomes the linker's
  spec), `csv`, `cancellable-task-runner`.
- Search: the consolidated pair from PR-0c + `SearchPanel.test.tsx`; `fuzz-utils` seeding
  retained.
- Google/Drive: `DriveService.pagination/recursive.test.ts`, `DriveScannerService.test.ts`,
  `DriveLogic.test.ts`, `useDriveBrowser.test.tsx`, `DriveFolderPicker/DriveImportDialog`
  component tests, `GoogleIntegrationManager.test.ts` + `AndroidGoogleAuthStrategy.test.ts`
  (assertions ported onto `GoogleAuthClient` before the strategy files are deleted),
  `verification/test_drive_sync.test.ts` (now on the harness `MockDriveService`).
- GenAI: `GenAIService.test.ts` (rotation/429 assertions ported to `GeminiClient`),
  `textMatching.test.ts`.
- Store/view: `selectors.test.ts`, `selectors.perf.test.ts` (the L5 perf gate).
- E2E: `test_journey_advanced_import`, `_import_error`, `_drag_drop`, `_library`,
  `_library_view`, `_search`, `_search_mobile`, `_smart_toc`, `test_genai_settings`, plus
  the P0 a11y scans (library surface must stay clean as the UI consolidates).

**New contract/characterization suites that come FIRST (entry gates):**

1. `LibraryService.invariants.test.ts` (PR-0a) — I-1..I-5 + interleaving property test;
   adapter-over-current-store first, real service later. This is the C6 row's pinning suite.
2. Import journey E2E extension (PR-0b).
3. Search consolidated characterization (PR-0c).
4. `GoogleAuthClient.contract.test.ts` (in PR-A1, before call-site migration): per-service
   token isolation, scope-superset cache validation, silent-never-interactive, the
   revocation matrix (revoked ⇒ disconnect; popup-block/offline/5xx ⇒ transient, state
   preserved).
5. GenAI feature-module fuzz suite (PR-A3, before any consumer migrates): seeded malformed/
   out-of-contract responses per feature; clamp + membership assertions; "validation failure
   ⇒ error status, nothing persisted".
6. `registry==CSP` unit test (PR-N1) — permanent invariant.
7. Gateway policy tests (PR-N1/N3): consent gate, timeout abort, offline behavior, counters.
8. Migration: captured v6 Y.Doc fixture (P2's capture script) + v6→v7 linking
   determinism/idempotency/convergence (the F.3 pattern from `c116e957`) + two-client
   quarantine E2E (rule 6).
9. NFKD wave detection matrix + composed-accent/CJK old-vs-new CFI comparison (the R4 gate)
   — runs in CI before `TTS_EXTRACTION_VERSION` may ever bump again.

**Fixture needs:**

- Composed-accent and CJK EPUB fixtures (the P0 NFKD tests use synthetic strings; the wave
  comparison needs real EPUBs — build from the existing test-EPUB generator if present,
  else commit two small fixtures).
- Tracking-pixel EPUB (privacy D5 regression).
- Captured v6 Y.Doc snapshot (extend `scripts/` capture from `12d692f5`).
- Captured `genai-storage` localStorage blob (pre-strip, with logs + key).
- Renamed-EPUB pair (byte-identical, different filename) for the D7 restore test.
- Drive API response fixtures (already exist inside the Drive suites — reuse).
- `MockGenAIClient` fixtures for the smart-toc journey (port the JSON currently inlined in
  the spec at :31).

**Cross-cutting:** every deleted per-bug file's assertions land as
`describe('regression: …')` in the same PR (ledger reviewed); coverage ratchet from P0 never
decreases; vitest file count trends toward the P9 target (this phase nets: −5 race files,
−5 search files, −2 strategy/manager tests folded, +4 contract suites).

---

## Risks

1. **v7 linking migration quarantines mixed fleets** (a CRDT bump for an additive FK is
   heavy). *Mitigations:* transform is additive copy-if-absent (no destructive op),
   deterministic + idempotent + convergent (pinned by the F.3-style tests); protected
   pre-migration checkpoint automatic via the coordinator; scheduled LAST with rule-4 gating;
   quarantine UX already built and tested by P2; fuzzy selector fallback keeps un-upgraded
   readers functional for a release. Renumbering (retirement v7→v8) needs explicit
   program-owner sign-off — flagged in PR-L7's description and the P7 kickoff.
2. **Re-ingestion wave hammers low-end devices** (strangler R8). *Mitigations:* stamp-based
   candidacy (most libraries: zero candidates post-P0 imports); restamp fast path skips
   re-extraction for v1-equivalent (no-decomposable-chars) books at the cost of a row scan;
   idle priority + chunked + resumable + defer toggle; old rows retained until the
   CFI-alignment self-check passes (R4), so a failed re-extract degrades to current behavior,
   never worse.
3. **Force-disconnect policy inversion** — being too sticky now (stale "connected" state
   forever, silent token failures). *Mitigations:* connected-state derived from token
   availability + last success; reconnect affordance driven by `GOOGLE_AUTH_REQUIRED`; the
   revocation matrix contract test enumerates both directions; Android @capgo
   repeated-login-with-different-scopes is an explicit device verification task in PR-A1
   (unverified plugin behavior is the biggest unknown in T3).
4. **CSP generation vs BYO Firebase** — the user-configured `authDomain`/project hosts are
   not statically known, so a strict generated `connect-src` could break BYO setups when P8
   flips it. *Mitigation in this phase's design:* registry marks firebase hosts as
   `*.googleapis.com` + standard auth hosts and documents the custom-authDomain limitation;
   the registry==CSP test asserts host-set equality so the limitation is explicit, not
   silent; the strict flip itself is P8's call with this constraint recorded.
5. **Orchestrator-behind-addBook compatibility drift** (Replace dialog, DuplicateBookError
   semantics, progress UI timing). *Mitigations:* PR-0b pins the journeys first; the
   orchestrator ships behind the unchanged store signature; entry points cut over
   individually with the journey re-run per cutover.
6. **Mock-seam migration breaks the smart-toc E2E** (the exact failure the P1 veto avoided).
   *Mitigations:* single coordinated PR (A4) migrates spec + deletes seams together; the
   spec runs in PR CI (desktop Playwright on PR per P0); `setMock` is runtime-settable so the
   spec's existing post-boot `localStorage.setItem` timing maps 1:1.
7. **`selectors.ts` deletion regresses render perf** (the module cache exists because naive
   recompute thrashed). *Mitigations:* `selectors.perf.test.ts` is the explicit gate;
   the derived store computes off-render on subscription deltas (strictly less work than
   render-time recompute); WeakMap-keyed per-book memoization carried over.
8. **`genai-storage` persist bump collides with rule 4.** It is strip-only (drop `logs`),
   tolerated by old code reading the slimmer blob, and reversible — but it is still a
   persisted-format touch. *Mitigation:* PR-A5 scheduled outside the PR-L7 window and away
   from P5b's split; captured-blob survival test; rehydrate-failure cleanup guard (the
   pre-existing quota-corruption case from GG-3).
9. **Extract unification loses a WebKit invariant** (the table-blob hoist exists only in
   `reprocessBook` today — drift between copies is how D4 happened). *Mitigations:* PR-L1
   ports the hoist into the single `persist.ts` with the bug-history comment preserved;
   existing ingestion tests assert blob conversion; reprocess journey on WebKit runs in the
   nightly mobile lane.
10. **Tree churn under parallel phases** (P3/P4/P5 commit while P7 tracks run). *Mitigations:*
    T1/T2/T3 touch disjoint directories from P3-P5 except the named seams (`persist.ts`
    façade→repo, auth-helper/AuthSession, EngineContext port no-op); each named seam has a
    "whoever lands second adapts" note in Dependencies; depcruise ratchet catches accidental
    cross-imports.

---

## Dependencies

**Needs from earlier phases (status at `da2f3a58`):**

- **P2 (landed mid-prep):** merge-over-defaults hydration + `whenHydrated` — prerequisite for
  the two additive synced fields (`ReadingListEntry.bookId`, `aiConsent`); the migration
  coordinator + step registry (`src/app/migrations.ts`) that PR-L7 extends with
  `{from: 6, to: 7}`; the v6 capture-script for the quarantine fixture. **Open item:** v7
  renumbering sign-off (§Design D).
- **P3 (not started):** `src/data/` repos + rows + write-gate. Named asks: (1) create the
  empty **`cache_search_text`** object store inside the **v25** upgrade (else P7 does an
  additive v26 through P3's migration registry); (2) the **bookContent repo** interface that
  `persist.ts` will consume (façade over `dbService.ingestBook` until then); (3) the shared
  **`coverUrl()`** helper that `libraryViewStore` consumes (else it keeps the
  `COVERS_ENDPOINT_PREFIX` string one more phase); (4) resolution of the `db/wipe.ts`
  residual (the named db→store edge) — P7 only edits its doc comment (mock keys).
- **P4 (not started):** AuthSession/auth-helper decomposition — coordination point for
  `connect('identity')` (§G); whoever lands second adapts. Firebase host set for the
  registry's `firebase` entry comes from P4's config ownership.
- **P5a:** Piper vendoring — deletes the `cdnjs-onnxruntime` registry entry, moves
  `piper_worker.js` into `src/` (completing the fetch ban), and supplies voices.json
  caching for `hf-piper-catalog`'s `cache-fallback`.
- **P5b:** tts-storage split = the rule-4 predecessor of PR-L7; the kernel ring buffer the
  GenAI log buffer adopts.
- **P5c:** EngineContext GenAI-port narrowing (drop `configure`, snapshot type decoupled from
  the store shape) — P7 provides `GenAIClient` + `features/*`; the port shim keeps either
  landing order safe (§H last bullet). Extractor relocation to `lib/ingestion/` (C8) is P5c's;
  P7's `extract.ts` calls the extractor wherever it lives via its stable exports
  (`TTS_EXTRACTION_VERSION`, `extractSentencesFromNode`).

**Provides to later phases:**

- **P8:** the destination registry + `generate-csp.ts` (P8 emits into nginx template +
  `index.html` meta and flips strict CSP); per-destination counters for the settings
  "Network activity" panel; `useImportController` as the settings-registry-era import
  surface.
- **P6:** `SearchSession` via context (ReaderShell provides it); sanitizer remote-blocking
  (P6's hostile-EPUB journey reuses the tracking-pixel fixture); navigate-by-CFI consumes
  whatever `ReaderEngine.display(cfi)` becomes — only the call site adapts.
- **P9:** deletion-audit inputs — everything in the §Execution-order deleted-artifacts list
  should already be gone at P7 exit; the v8 (renumbered) husk-clear + dual-write retirement;
  warn→error flips P7 establishes (fetch ban, kernel-imports-nothing for `kernel/net`,
  domains-never-import-state for the three new domains) are P9's zero-exception audit
  surface.
