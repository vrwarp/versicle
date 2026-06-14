# Versicle Comprehensive Overhaul — Master Plan

This is the synthesized plan to pay off all of Versicle's technical debt and put the
application on an extensible, easy-to-modify, hard-to-break footing. It is the product of a
multi-agent deep analysis (21 subsystem analysts, adversarial verification of every
critical/high claim, three competing architecture proposals, a three-persona judge panel) run
against the working tree at `3b0cfcff`.

**The synthesis in one sentence:** follow the *strangler-incremental* sequence (the app stays
shippable and user data is never half-migrated), land each rebuilt subsystem in the
*modular-monolith* destination geography (vertical domain modules with enforced, compile-time
boundaries), and govern the whole program with the *contract-first* registry (every boundary
versioned, runtime-validated, and pinned by a contract test suite).

> ## **PROGRAM COMPLETE (2026-06-12)**
>
> All ten phases (0–9) are landed on this branch; Phase 9 closed with the deletion/ratchet audit (`prep/phase9-close.md`), CRDT v9 (the LAST format change), the registry-generated docs (`architecture.md`, `AGENTS.md`, the kernel/data/store/domains READMEs — drift-gated in `npm test` via `src/app/docs/docs.test.ts`; regenerate with `npm run docs:generate`), and the agent-loop verification gate (rule 10): the documented PR-gate sequence was executed end-to-end in a fresh shell from the regenerated docs alone.
>
> **The scoreboard** (analysis tree `3b0cfcff` → close):
>
> | Metric | Start | Close |
> |---|---|---|
> | Phases landed | — | 10/10 (P0–P9) |
> | Program commits | — | 182 |
> | Verified criticals retired | 0/26 | **26/26** |
> | Vitest | 1,805 tests | **3,103 tests / 307 files** (reconciliation vs the ~110-file sketch: `prep/phase9-close.md` §4) |
> | dependency-cruiser violations | 207 | **35** (`lib-not-to-store` 19 + `worker-no-state-typegraph` 16; every other rule at **error/0**) |
> | Import cycles (full graph / runtime) | 117 / 33 | **0 / 0** (both rules at error) |
> | Production `as any`/`: any` | 138 | **20** (justified per file in `lint-debt-allowlist.json`) |
> | eslint-disable directives | 245 | **25** (same allowlist) |
> | Coverage (lines/stmts/funcs/branches) | 65.30 / 64.04 / 58.65 / 56.08 | **75.49 / 74.29 / 69.89 / 65.50** (floor re-pinned) |
> | Playwright journeys | — | 78 spec files (typechecked in `tsc -b`; Docker-lane execution is hand-off item 1) |
>
> **God files deleted** (size at decomposition): `types/db.ts` (the god type hub, P1) · `DBService` façade + all of `src/db/**` (P3) · `FirestoreSyncManager.ts` 1,046 (P4) · `AudioPlayerService.ts` 1,218 (P5b) · `AudioContentPipeline.ts` (P5c) · `bible-lexicon.ts` 2,899-line TS module → lazy JSON (P5c) · `ReaderView.tsx` 1,402 → `ReaderShell` 177 (P6) · `GlobalSettingsDialog.tsx` 742 (P8) · `CompassPill.tsx` 830 (P8) · `lib/search.ts` module singleton (P7/P6 close). Decomposed in place: `useEpubReader.ts` 1,006 → 479 over named modules.
>
> **Format-change chain, fully landed** (rule 4 — never more than one in flight): backup manifest v3 (P0) → CRDT v6 (P2) → IDB v25 (P3) → `tts-storage` v3 → `tts-settings` v1 (P5b) → CRDT v7 vocabulary canonicalization (P6) → CRDT v8 reading-list FK + IDB v26 search-text store (P7) → **CRDT v9 husk-clear + dual-write retirement (P9, the program's terminal bump)**. P8 shipped zero format changes (its slot was released — the font rename is read-time normalization).
>
> **The honest not-done list — the operator's hand-off checklist:**
>
> 1. **Docker E2E lane**: the 78-journey Playwright suite was never executed in the agent environments (no Docker). Run `./run_verification.sh` (desktop+mobile), then `--project=webkit`, then `--grep @a11y`; the P6 chinese/pinyin characterization specs, kill-mid-switch, six-overlay, and deep-link journeys are the priority list (P6 §Follow-ups).
> 2. **On-device QA pass** (P5 exit checklist): Android + iOS Safari — lock screen, background keep-alive, cloud→local fallback, dragnet gesture, gapless Capacitor handoff.
> 3. **BYO-Firebase manual checks**: deploy the rewritten `firestore.rules`/`storage.rules` to a real project and verify the version-gated rules-lockout prompt. (The emulator-gated suites themselves WERE re-verified live at this close — 37 passed + 1 todo incl. the purge cases and the y-cinder realtime provider; what remains manual is the real-project deploy + lockout-prompt journey.)
> 4. **Release-engineering windows (rule 4 aftercare)**: verify CRDT v9's straggler path in the wild; decide `app_metadata['legacy-recovery-v25']` retention (size-capped); retire the legacy `tts-storage` localStorage key + the accepted `'local'` provider alias once fleet telemetry is silent; `sync_log` (dead store, schema frozen ▲16) and the SW legacy-`books` cover fallback ride the NEXT IDB bump (v27) — deliberately not folded into v9.
> 5. **Known flakes**: the fork-contract "two-doc concurrent merges" scopedDiff-tripwire microtask flush (pre-existing, spun-off task owns root cause); `SettingsShell` replace-navigation can exceed findByText's default timeout under heavy parallel load (passes in isolation; observed once at this close).
> 6. **Residual ratchets** (floors, only decrease): `lib-not-to-store` 19, `worker-no-state-typegraph` 16, lint-debt 20/25, jsx-a11y at error only for the P8 directories (rest warn). Rule 4 (domain-ui writes) stays process-enforced; rule 10 per-layer TS references is a documented exception (depcruise enforces direction).
> 7. **Never built** (from §7's end-state sketch): visual goldens (~10); sanitization-ON remains per-spec opt-in in E2E. Open absorption candidate: `App_SW_Wait.test.tsx` → `App_Boot` fold-in.
> 8. **Unowned stretch items**: VocabularyVault surface (CH-10), ChineseReadingSettings extraction, zh locale-aware sentence-snap flip (recorder passes 'en' until the Docker chinese journeys run), MaintenanceService all-store orphan coverage, `TableAdaptationProcessor`'s inline TOC lookup → `findTocItem`, audio-domain relocation to `domains/audio/` (pure motion, documented in `src/domains/README.md`).
>
> **Phase 9 status (2026-06-12): DONE** — knip sweep (CI gate, tree clean), lint-debt ratchet to the justified floor, boundary end-state audit (ten rules; cycles to 0/0, four flips to error), CRDT v9, the P1/P3/P5 shim deletions at their named deadlines, deferred-work sweep across every prep-doc §Follow-ups, test-landscape reconciliation + coverage re-pin, registry-generated docs + the agent-loop gate, and this close-out. Per-item records: `prep/phase9-close.md`.

> **Phase 0 status (2026-06-10): DONE** — all eleven hotfix PRs and the trustworthy-harness work (single vitest config, typechecked tests, CI gate, depcruise + coverage ratchets, worker-chunk check, emulator suites, typed harness + test API, a11y baselines, license gate, `TESTING.md`/`AGENTS.md` rewrite, i18n ADR `docs/adr/0001-i18n-strategy.md`) are landed on this branch.
>
> **Phase 1 status (2026-06-10): DONE** — verified dead-code deletion (~2,350 LOC + assets; 4 of the proposal's items vetoed by the audit in `prep/phase1-deletions.md`), `types/db.ts` dissolved into six acyclic domain modules (shim deadline P9), C10 `AppError` taxonomy, `src/app/` composition layer (engine host-adapters, repositories), C11 bootstrap sequencer with entry-gate boot tests (`App.tsx` 375→90 lines; Yjs persistence out of module scope), path aliases codemodded repo-wide (1,069 imports; lint-enforced). Ratchets: lib→store 54→36, db→store 4→1 (named residual: `db/wipe.ts`, P3), types-imports-nothing 0, full-graph cycles 117→66. Runtime cycles (33, honest measure) are deliberately untouched — pure motion preserves cycles; they fall with the P2/P4/P5 stranglers.
>
> **Phase 2 status (2026-06-10): DONE** — the state backbone: fork vendored as an npm workspace (contract suite = its acceptance gate), four additive surgeries (`syncedKeys`, `hydration: 'merge-defaults'`, `scopedDiff`, `api.yjs` handle + `scope`), migration coordinator replacing the 9×-per-boot `onLoaded` runner (pre-migration checkpoints, atomic transform+bump, loud failure), CRDT v6 (popover deletion, `meta` dual-write N+1-staged, preferences fold copy-without-clear), captured v1/v2/v4/v5 fixtures + two-client quarantine tests, boot `whenHydrated()` replacing the App.tsx poll, three-tier store registry (`src/store/registry.ts`, generated README) with `defineSyncedStore` as the only `yjs()` call site, and all nine stores flipped to merge-defaults + scopedDiff in the §2.6 order with their defensive-fallback canaries deleted (zero top-level `|| {}` hydration fallbacks remain; the five per-book progress guards stay per census ▲5). v7 follow-ups (husk-clearing, dual-write retirement) deferred — see `prep/phase2-fork-surgery.md` §Follow-ups.
>
> **Phase 3 status (2026-06-10): DONE** — the storage gateway: `src/data/` is the only IndexedDB subsystem. navigator.locks write-gate spanning tabs + the TTS worker (closes the live worker/main readwrite-overlap hazard), hardened connection (blocked/blocking/terminated, retry-with-reset, `storage.persist()`), zod `rows/` absorbing the validators, five repos carved from the now-deleted `DBService` façade (`src/db/**` and the `idb-write-lock` shim are gone), y-idb vendored to `packages/y-idb` with `flush()`/`writeSnapshot()`/durable-`synced` surgery behind contract tests, `YjsSnapshotService` unifying the three snapshot mechanisms (raw `indexedDB.open('versicle-yjs')` + 1000 ms sleep + temp-provider dance deleted), audio-cache LRU eviction, shared `coverUrl()`, wipe inverted behind a hook registry, and **IDB v25** as the phase's one format change (versioned migration registry, straggler snapshot-before-delete into `app_metadata['legacy-recovery-v25']`, `schemaHistory`, `by_lastAccessed` index + idle size backfill; v18/v24 fixture upgrades + multi-tab upgrade pinned in `src/data/migrations.test.ts`). Readwrite/`idb`-import bans at error with zero exceptions; `db-not-to-store` retired at 0. Deferred work — see `prep/phase3-storage-gateway.md` §Follow-ups.
>
> **Phase 4 status (2026-06-11): DONE** — strangler #3, the sync domain: FirestoreSyncManager (1046 lines) decomposed into `src/domains/sync/` (AuthSession / ProviderConnection / WorkspaceService / SyncOrchestrator over injected ports; the manager is deleted), the C3 `SyncBackend` seam (FirestoreBackend / MockBackend — mock code out of the prod bundle, chunk-content-checked), the typed `SyncEvent` bus with `app/sync/wireSyncEvents.ts` as the single presentation subscriber (toast-import ban at error), three-layer doc-level quarantine on the v6 `meta` map (pre-attach probe, pre-apply scratch check, live observer + heartbeat stop + metadata stamp), the **crash-resumable staged workspace swap** (download → verify → durable `versicle-yjs-staging` → STAGED → idempotent boot-time apply under the cross-tab swap lock; kill-mid-switch pinned at every pause point in vitest + a permanent Playwright journey; boot-time rollback hard-path fix + `previousWorkspaceId` revert), and the **honest `deleteWorkspace`** (tombstone-first → full purge of updates/history/maintenance/metadata + Cloud Storage blobs, conditional sever, "Purge deleted workspaces" maintenance action, contract-suite purge cases on mock + rules emulator). Deferred work (y-cinder vendoring + `saved` fork delta, redirect-flow deletion, DataRecoveryView retarget, android-backup ADR) — see `prep/phase4-sync-strangler.md` §Follow-ups.
>
> **Phase 8 status (2026-06-12): DONE** — shell, settings, a11y/i18n choke points, PWA/build finishers: routes (`/`, `/notes`, lazy `/read/:id`, `/settings/:tab?`) with first-use dynamic imports (firebase/genai/epubjs out of the entry chunk; check 4 content assertion + gzip ratchet in `bundle-baseline.json`), settings registry + `SettingsShell` over Radix Tabs (`GlobalSettingsDialog`, 742 lines, DELETED), CompassPill (830 lines) dissolved into `PillShell` + feature pills, queue-based toast store + `ToastHost`/`ConfirmHost`/`SWUpdatePrompt` ABOVE the router gate, `LiveAnnouncer` + `useConfirm` (native confirm/alert/prompt banned at ERROR), `KeyboardShortcutService` (both window keydown registries + the P0 interim predicate deleted; keydown lint ban), `kernel/locale/` (typed MessageKey catalog, cached-Intl formatters, `documentElement.lang`, `toLocale*` ban, `lang` attribution on book-text surfaces), reduced-motion policy (global CSS override + `useReducedMotion`), **PWA finishers** (single manifest verified + installability fields + check 5 in the build gate; prompt-style SW update replacing the fielded skipWaiting flow — SKIP_WAITING handshake, persistent Reload toast, one-way-safe handoff; CacheFirst runtime caching for `/fonts` `/dict` `/piper`; honest soft SW boot gate — the dead Critical Error screen deleted, one-shot degraded notice), the **CSP strict flip** (the legacy `https:` wildcard gone from connect-src AND img-src — the egress registry is now ENFORCED; the sanitizer strips remote EPUB resources, killing tracking pixels), and the **font rename off the OFL Reserved Names** (`Versicle Sans Narrow` via the committed `scripts/build-pinyin-font.py`; read-time `fontFamily` normalization — NO persisted migration, the rule-4 P8 slot was RELEASED: P8 ships zero user-data format changes; v9 husk-clears stay P9). jsx-a11y recommended at ERROR for `ui/`, `app/settings/`, `app/shortcuts/` and the pill feature dirs. Deferred work — see `prep/phase8-shell-pwa.md` §Follow-ups.
>
> **Phase 7 status (2026-06-12): DONE** — strangler #6, library/search/google/egress, landed across two tracks (recorded in `prep/phase7-library-google.md` §Follow-ups): `domains/library/` (one `extractBook()` — the triplication died, ImportOrchestrator job queue, SHA-256 contentHash identity, LibraryService cutover with per-book keyed mutex, `libraryViewStore`), `domains/search/` (SearchSession + persisted searchText repo + per-occurrence CFIs; the `lib/search.ts` module singleton died), `domains/google/` (GoogleAuthClient with per-service tokens, GenAIClient with per-feature zod modules + redacted ring-buffer logs + per-book AI consent), `kernel/net/` (egress destination registry + NetworkGateway, raw-fetch lint ban, generated CSP + the registry==CSP test), and **CRDT v8** = the one-time reading-list `bookId` FK linker (the rule-4 post-merge step).
>
> **Phase 6 status (2026-06-12): DONE** — strangler #5, reader + Chinese: the C7 ReaderEngine port (`src/domains/reader/engine/`, `EpubJsEngine` = sole runtime epubjs importer at lint ERROR with named P7-deadlined exceptions; `FakeReaderEngine` + conformance suite prove renderer-agnosticism), `epubSecurity` (ONE sanitize/sandbox module, prod bypass closed), `HighlightLayerManager` + ONE styles registry + `ReaderOverlay` (six overlay systems consolidated; orphan-sweep implemented once), epubjs.d.ts ambient shadow retired, `cfi-utils.ts` shim deleted (kernel/cfi adopted), serialized `ReadingSessionRecorder` (D6 out-of-order writes die), `ReaderCommands` context + registry (CustomEvents + callbacks-in-store die), ReaderView (1,402 lines) → `ReaderShell` at 174 lines over named modules, and **`domains/chinese/` as a self-contained feature module**: code-point-safe `PinyinGeometryEngine` (CH-1 dies; astral fixture green), section-keyed `ChineseContentProcessor` on the engine's content seam with per-section cancellation (CH-2/CH-7), app-layer registration via `getBookBaseLanguage` (CH-8 exact-match bug dies), IDB `DictionaryService` on the separate `versicle-dict` DB with import status surface + SW CacheFirst `/dict/*` (the 80 MB in-memory map + any-CJK-selection fetch die, CH-5/CH-13), cedict.json OUT of git (pinned + checksum-verified CI build, provenance sidecar, mock fallback deleted — licensing gap D5 closed), and **CRDT v7** = vocabulary simplified-key canonicalization (committed trad→simp table inverting the display mapping; min-timestamp merge; v6-vs-v7 two-client quarantine pinned; program queue: v8 = reading-list FK, v9 = husk clearing). Deferred work — see `prep/phase6-reader-engine.md` §Follow-ups.
>
> **Phase 5 status (2026-06-11): DONE** — strangler #4, TTS, all three sub-phases behind the 23-scenario × 2-transport parity gate (zero `it.fails` riders; green at every commit). **5a providers**: ProviderDescriptor registry + derived unions, narrowed `ITTSProvider` (reject-only `play`, `dispose`/unsubscribe), single failure path (manager rethrows typed `ProviderPlaybackError`, ONE sequenced engine recovery — the double-fire died, P21 flipped), `describeProviderContract` ×6, piper vendored into `third-party/piper/` with `PROVENANCE.md` + `PiperRuntime` (postinstall string-patching deleted). **5b engine**: `AudioPlayerService` (1,218 lines) decomposed and DELETED — `PlaybackController`/immutable `QueueModel` (P14 flipped)/`AnalysisApplier`/`MediaMetadataPublisher`/`DragnetGesture` over `SessionStore`/`BookContentPort` ports (engine-dir `vi.mock` allowlist ∅); single `PlaybackSnapshot{seq}` channel; sequencer epochs + the only-sequenced-tasks-mutate dev-assert; `tts-storage` v3 → `tts-settings` v1 split behind captured-blob fixtures; replication echo dead by construction; flight-recorder ring core at `src/kernel/diagnostics/`. **5c content**: canonical CFI kernel at `src/kernel/cfi/` (parsed-component oracle, `cfiContains`/`stripCfiWrapper` with THE separator set — the ACP `['/','!',':']` mis-grouping bug died; seeded property-equivalence suites >10k cases; epubcfi import quarantined to one shim; `kernel-imports-nothing` born at error; locale-aware sentence snapping); `AudioContentPipeline` deleted — pure `SectionQueueBuilder` ({queue,title}, HOST writes readerUI), `ReferenceSectionDetector` strategy (deterministic | GenAI via the existing service surface, injected telemetry), `{sentences, citationMarkers}` travel together (D4); `LexiconEngine` (`CompiledLexicon` keyed by (bookId, language, store version), store-subscription invalidation incl. a worker `lexicon` replication ping, mid-playback edits live) with the 2,899-line Bible TS file dying into lazy JSON (entry-chunk effect asserted in the build check); extractor relocated to `lib/ingestion/` with raw-at-rest extraction v3 (CFI-comparison fixtures gate the bump; old rows retained). Absorption ledger FULLY closed (rows 1–19 ✅, row 20 keeper). Deferred: on-device QA pass + per-phase items — see `prep/phase5-tts-strangler.md` §Follow-ups.

## Artifact index

| Artifact | What it is |
|---|---|
| `analysis/*.md` | 21 detailed subsystem reports (file inventory, data flow, every debt with file:line evidence, target design, migration notes) |
| `digest.json` | Machine-readable verified debt inventory: 285 findings with severity, category, fix, and adversarial-verification verdict |
| `proposals/strangler-incremental.md` | **The winning journey** — full seam catalog, phase-by-phase scope/exit criteria/reversibility, risk register, test strategy |
| `proposals/modular-monolith.md` | **The adopted destination** — full module map, boundary ruleset R1–R10, enforcement design |
| `proposals/contract-first.md` | **The adopted governance** — the C1–C12 contract inventory, validation/versioning policy per boundary |
| `judging.md` | Judge scores, verdicts, and the graft list folded into this plan |

When executing, the per-phase detail lives in `proposals/strangler-incremental.md`; this
document is the authoritative synthesis where the three differ.

---

## 1. Diagnosis

Versicle is ~46k lines of non-test TypeScript built almost entirely by AI coding agents over
3,600+ commits. The analysis verdict is consistent across all 21 reports: **quality is highest
exactly where explicit boundaries already exist** (the EngineContext/PlaybackBackend/AudioSink
ports, `replicationSpec`, the three-domain IndexedDB taxonomy) **and debt sediment accumulated
wherever boundaries were missing** — 97 `getState()` calls inside `lib/`, 65 madge cycles,
`types/db.ts` importing the TTS engine, six god files over 700 lines, 246 test files of which
dozens are single-bug regression shims, and dead zod validators while remote payloads are
trusted blindly.

286 debt findings were filed; adversarial verification confirmed or partially confirmed 285
(26 critical, 110 high). The criticals cluster into five classes:

1. **Data loss / destructive-before-validate:** "Clear All Data" never clears the Yjs IndexedDB
   (`versicle-yjs` survives a "full wipe"); backup restore wipes local data *before* validating
   the replacement; workspace switching has a data-loss window with a rollback that can
   silently fail; batch import silently drops failures and bypasses duplicate/ghost detection.
2. **Cloud security:** `firestore.rules` contains invalid syntax and a catch-all that neuters
   tombstone protection; Cloud Storage holds workspace snapshots with no rules or deploy story;
   `deleteWorkspace` leaves remote data behind.
3. **Schema-evolution hazard:** inbound Yjs hydration deletes state keys absent from the Y.Map,
   so *no field can be safely added to any synced store* — the single most blocking finding;
   the migration runner races its own version bumps behind nested dynamic imports with
   swallowed errors; ephemeral popover UI state is synced through the CRDT to other devices.
4. **Concurrency without ownership:** TTS provider-event and gesture paths bypass the
   TaskSequencer that exists precisely to serialize them; cloud-provider fallback double-fires;
   playback speed is applied at both synthesis and playback; library import/restore/offload are
   race-prone multi-store sagas (five separate race-regression test files are the fossil
   record); NFKD normalization after offset bookkeeping corrupts CFIs for every non-ASCII book.
5. **Unsequenced boot and unenforceable boundaries:** importing modules boots Yjs persistence,
   Google auth, and window globals (229 of 266 modules execute eagerly); App.tsx boot depends on
   implicit cross-effect ordering; there is no network egress boundary, and the CSP is
   decorative; two overlapping global keyboard registries cause destructive conflicts.

The meta-cause is structural: agents (and humans) write good code against contracts they
cannot violate without a red CI, and this codebase has almost none. The overhaul therefore
spends its budget making boundaries **explicit, runtime-validated, versioned, and CI-enforced**
— so the same development process that produced the debt cannot reproduce it.

What is explicitly preserved (the keeper list, confirmed by multiple analysts): the
EngineContext/PlaybackBackend/AudioSink hexagonal ports and parity-scenario pattern, the
three-domain IDB taxonomy, per-device progress modeling, the WebKit IDB-hang engineering,
sanitize-at-serialize XSS boundary, checkpoint-before-danger discipline, `handleDbError`
boundary mapping, geometry-overlay portals, the hermetic Dockerized E2E runner, seeded fuzz
infrastructure, and the GPL-3.0-or-later licensing posture.

---

## 2. Target architecture (the destination)

The end state is the modular-monolith geography. Full detail, including the dependency
diagram and per-module contents, is in `proposals/modular-monolith.md`; the strangler's seam
catalog maps 1:1 onto these homes.

```
packages/                  # vendored forks as npm workspaces (zustand-middleware-yjs, y-idb, y-cinder)
src/
  kernel/                  # L0 — types (db.ts dissolved by domain), AppError taxonomy, logger,
                           #      namespaced flight recorder, canonical CFI algebra, NetworkGateway +
                           #      destination registry, locale/formatters, progress resolution, utils
  data/                    # L1 — the ONLY IndexedDB subsystem: connection, versioned migration
                           #      registry, navigator.locks write-gate, zod rows/, repos/,
                           #      YjsSnapshotService, wipeAllData(), sw-contract
  state/                   # L2 — Y.Doc provider (no module-scope boot; whenHydrated()), store
                           #      registry declaring every store synced | local | ephemeral
  domains/                 # L3 — vertical modules, each: model/ service/ ports.ts ui/ index.ts
    audio/                 #      engine (PlaybackController/QueueModel/PlaybackSnapshot), pipeline,
                           #      provider registry, audio UI (pills, panel, queue)
    reader/                #      ReaderEngine port (EpubJsEngine = sole epubjs importer), extraction,
                           #      HighlightLayerManager, session recorder, ReaderShell + panels
    library/               #      ImportOrchestrator, LibraryService (keyed mutex), library UI
    search/                #      SearchEngine, reader-scoped SearchSession, search UI
    chinese/               #      pinyin/dictionary/vocabulary as a self-contained feature module
    sync/                  #      SyncBackend port (Firestore|Mock), SyncOrchestrator, workspaces,
                           #      checkpoints, device mesh, typed SyncEvent bus
    google/                #      GoogleAuthClient (per-service tokens), DriveClient, GenAIClient
  ui/                      # design system; imports kernel only (+ Radix/Tailwind)
  app/                     # L4 — composition root: bootstrap (boot-task registry), container,
                           #      migrations coordinator, port adapters, controllers, repositories,
                           #      routes, settings registry, installTestApi()
  workers/ + sw.ts + main.tsx   # thin entries with asserted import closures
```

**Boundary rules** (dependency-cruiser + ESLint + TS project references, all CI-blocking by the
final phase; each rule flips warn→error in the phase that establishes it):

1. `kernel/` imports nothing internal; admission requires zero internal deps and ≥2 consuming
   domains (anti-junk-drawer rule).
2. All IndexedDB access through `data/` repos; `'readwrite'` transactions and `idb` imports
   banned elsewhere; the write-gate's synchronous-callback API structurally bans
   intra-transaction awaits (preserves the WebKit-hang discipline).
3. Domain services import kernel + data + their own module + other domains' `index.ts` only —
   never `state/`; they declare `ports.ts`, and `app/` injects store-backed adapters
   (the EngineContext pattern generalized).
4. Domain `ui/` may *read* state through its domain's published hooks/selectors; every write
   goes through the domain service or an app controller. (This resolves the read/write
   asymmetry the judges flagged as "litigated forever" — the rule is one line and lintable.)
5. `getState()` outside `state/` + `app/` is a lint error.
6. Worker import closures asserted by a build-time chunk-content test (no zustand/yjs/state in
   the TTS worker chunk) + `consistent-type-imports` + `import/no-cycle`.
7. All network egress via `kernel/net/NetworkGateway.egress(destinationId, req)`; raw fetch/XHR
   banned outside it; CSP is *generated* from the destination registry and unit-tested against it.
8. Only `domains/reader/engine/` imports epubjs; only `domains/audio/providers/` touches
   synthesis SDKs; only `app/` constructs singletons; no module-scope side effects outside
   `app/bootstrap.ts`.
9. Mock/test seams (MockBackend, MockGenAIClient, `window.__versicleTest`) selected only at the
   composition root behind `import.meta.env.DEV || VITE_E2E` — never reachable from a prod
   import graph.
10. TypeScript project references per layer (kernel → data → state → domains → app), plus
    `tsconfig.test.json`/`tsconfig.e2e.json` in `tsc -b`: dependency direction is a
    compile-time property and all ~42k LOC of test code is typechecked as a build invariant.

**Geography migration rule:** replacement code lands directly at its final address
(`domains/audio/`, not `lib/tts/v2/`); legacy stays at its old address until its strangler
phase deletes it. Nothing moves twice, and the expensive dedicated codemod waves of the
pure modular-monolith plan are avoided — vertical geography emerges as a by-product of
rewrites that touch every file in a subsystem anyway.

---

## 3. Governance: the contract registry

The contract-first proposal's C1–C12 inventory is adopted as the program's governing artifact
(`proposals/contract-first.md` has the full table: home module, runtime validation, versioning
policy, pinning suite per contract):

C1 IndexedDB storage schema · C2 CRDT document schema · C3 sync transport · C4 TTS engine RPC ·
C5 TTS provider plugin interface · C6 store/selector public API · C7 reader engine port ·
C8 ingestion artifact contract · C9 external egress contract · C10 error contract ·
C11 boot contract · C12 layering & worker-purity contract.

Operating rules:

- **Just-in-time authoring, not a freeze phase.** Each contract row is authored at the *start
  of the phase that carves its seam* — interface, zod schema, and contract-suite skeleton land
  while consumers are still on old code, so adapter-writing feedback arrives before the shape
  hardens. One designated revision window at each phase exit; additive evolution (append-only
  error codes, optional capability fields) is always legal.
- **A contract version bump requires a matching contract-suite change in the same PR** (CI
  rule). Everything not in the registry is an internal and may be rewritten at will.
- **Observe-then-enforce:** any new runtime validation on a live sync path (inbound Firestore,
  post-merge Yjs entity validation) ships in observe mode with a telemetry-review gate before
  rejection is enabled — real-world doc variance gets measured before enforcement can strand a
  user.
- **Captured-artifact fixtures** for every persisted-format change: real v1/v2/v4/v5 Y.Doc
  snapshots gate the migration coordinator; a captured real tts-storage v3 localStorage blob
  pins voice-profile/API-key survival across the store split; v18 and v24 IDB fixtures gate the
  v25 upgrade. This pattern is the standard for all future format changes.

---

## 4. Program rules (the constitution)

These hold for every phase; a phase is not done while any of them is red.

1. **Shippable after every phase** — full unit + E2E suite green, app usable with existing
   libraries.
2. **A strangler completes by deleting its legacy path.** Exit criteria name the artifact
   (façade, shim, old file) that must be gone. Every temporary shim carries a named deletion
   deadline (a phase number). The final phase is a dedicated deletion/ratchet audit.
3. **Per-phase warn→error boundary flips.** Each boundary rule becomes CI-blocking in the phase
   that establishes it (readwrite ban with `data/`, side-effect ban with bootstrap, epubjs ban
   with ReaderEngine, …). Ratchet counters never regress: dependency-cruiser violations,
   production `as any` (138 → 0), eslint-disable (245 → ~0), `vi.mock` in engine/provider/data
   dirs (→ 0), vitest file count (246 → ~110).
4. **At most one in-flight user-data format change at any time.** Sequence: backup manifest v3
   (P0) → CRDT v6 (P2) → IDB v25 (P3) → tts-storage settings/playback split (P5b) →
   vocabulary canonicalization (CRDT v7, P6) → reading-list bookId linking (CRDT v8, P7) →
   preferences/activeContext husk-clear (CRDT v9, P9). The slot originally provisioned for the
   P8 font-preference rename was RELEASED: the rename shipped as read-time normalization with
   no format change (`prep/phase8-shell-pwa.md` RC-16) — P8 ships zero user-data format
   changes. A format change lands only when the previous one's straggler path is verified.
5. **N+1 release staging for schema relocation:** a new schema surface (e.g. the `meta` Y.Map)
   ships its *write* one full release before any client logic depends on *reading* it; v5
   clients keep quarantining via the dual-written `library.__schemaVersion` until retired (v7).
6. **Two-client upgrade E2E before every schema phase ships** — old-version doc snapshot vs new
   client, quarantine asserted — as a standing rule for every future bump, not a one-time v6
   test.
7. **Characterization before change.** A subsystem's behavior-pinning suite (parity scenarios,
   overlay E2E, service invariants) must be green *before* its internals are touched.
8. **Test-absorption ledger.** A per-bug test file is deleted only in the same PR that lands its
   assertions as a named `describe('regression: …')` block in the owning suite; reviewers check
   the ledger; the Phase 0 coverage baseline never decreases. New regression tests go into
   owning suites (path-convention lint), never new one-off files.
9. **Boot tasks register into the bootstrap registry** — subsystems register their boot phase;
   `app/bootstrap.ts` owns ordering, not imports-of-everything.
10. **Agent-loop verification.** AGENTS.md is generated from one canonical TESTING.md and the
    registries (stores, providers, destinations, settings); before a phase closes, a live agent
    is run through the documented workflow to prove the docs match reality — closing the loop
    that generated most of this debt.

---

## 5. Roadmap

Phases, scopes, exit criteria, and reversibility notes are specified in full in
`proposals/strangler-incremental.md` §Migration roadmap; the deltas below are the synthesis
(grafts + geography). Dependency structure:

```
P0 ──► P1 ──► P2 (state backbone) ──► P3 (data/) ──► P4 (sync)
                                                       │
                              ┌────────────────────────┼──────────────────────┐
                              ▼                        ▼                      ▼
                    Track A: P5 audio          Track B: P7 library/    (P6 reader+chinese
                    (5a providers → 5b engine   search/google/egress    gated on 5c's CFI
                     → 5c content+CFI kernel)                           kernel)
                              └──────────────► P6 reader + chinese ◄───┘
                                                        │
                                              P8 shell/settings/PWA ──► P9 deletion audit,
                                                                        ratchets, generated docs
```

Tracks A and B are independent after P4 (modular-monolith's parallelization map); P6 requires
P5c's canonical CFI kernel. Run serially if staffing is one stream; the order is then
P5 → P6 → P7 as in the strangler document.

- **P0 — Trustworthy harness + stop-the-bleeding hotfixes.** As specified (single vitest
  config, typechecked tests, CI with npm ci + pinned Node, dependency-cruiser ruleset in warn
  mode with frozen baselines, worker-chunk assertion, emulator suite skeleton, typed test
  doubles, flushPersistence test API, a11y lint/axe baseline, licensing inventory + CI gate,
  i18n ADR, AGENTS.md rewritten) **plus all eleven hotfix PRs**: `wipeAllData()`,
  firestore.rules + storage.rules rewrite, backup validate-before-destroy + manifest v3 +
  pre-restore checkpoint + cover repair, popover out of the CRDT, migration-checkpoint
  pinning, TTS speed policy (synthesize at 1.0, rate at sink, cache-key fix), NFKD fix-forward,
  `preprocessTableRoots` deletion, batch-import per-file surfacing, keyboard-arrow gating on
  TTS status, alignmentData unification. Graft: the BYO-Firebase rules-lockout mitigation
  (in-app permission-denied detection + "redeploy your rules" guide + version-gated prompt)
  ships with the rules rewrite.
- **P1 — Carve the seams.** Split honestly into **1a: pure code motion** (types/db.ts dissolved
  by domain behind a re-export shim; host adapters/repositories relocate to `app/`; dead code
  knip-deleted; path aliases) and **1b: boot sequencing** — behavior-affecting by design: Yjs
  persistence construction leaves module scope for `app/bootstrap.ts` (boot-task registry per
  C11), one `installTestApi()`, App.tsx ≤100 lines — gated by boot integration tests
  (post-wipe boot, migration-interrupt boot).
- **P2 — Strangler #1: the state backbone.** Fork surgery on the vendored
  zustand-middleware-yjs (syncedKeys whitelist, merge-over-declared-defaults hydration,
  per-key diff, `whenHydrated()`); `state/registry.ts` three-tier declaration; migration
  coordinator (static imports, sequential await, atomic transactional bump, loud-fail to safe
  mode, automatic pre-migration checkpoint); **v6 migration** (popover key deleted, `meta` map
  with dual-write, preferences folded to one keyed map). Grafts: merge-over-defaults flips
  **store-by-store** behind a per-store option with the `|| {}` fallback-removal tests as
  canaries; inbound validation lands observe-then-enforce; fixtures cover v1/v2/v4/v5 real
  docs; `meta` readers wait one release (rule 5).
- **P3 — Strangler #2: the storage gateway (`data/`).** navigator.locks write-gate (drop-in
  behind the existing signature first), repos carved from DBService behind a deprecated façade,
  zod rows absorbing both validator modules, YjsSnapshotService unifying the three snapshot
  mechanisms, IDB v25 with versioned migration registry + blocked/blocking handlers +
  `navigator.storage.persist()`, audio-cache LRU, shared `coverUrl()`. Readwrite/idb-import
  bans flip to error at exit.
- **P4 — Strangler #3: sync.** SyncBackend injection (MockFireProvider leaves the prod
  bundle), FirestoreSyncManager decomposed into AuthSession/ProviderConnection/WorkspaceService/
  SyncOrchestrator over a typed SyncEvent bus, synchronous quarantine enforcement on the `meta`
  map, staged-swap workspace switch (download → staging → verify → atomic swap) with the
  kill-mid-switch E2E as a permanent CI journey, honest `deleteWorkspace` + remote purge
  action, forks vendored as npm workspaces gated by the P0 licensing checklist. Lands as
  `domains/sync/`.
- **P5 — Strangler #4: TTS** (entry gate: expanded `engineParityScenarios` green on both
  transports before any engine internals change). 5a providers (ProviderDescriptor registry,
  single failure path, PiperRuntime, vendored onnxruntime/worker — postinstall string-patching
  deleted), 5b engine (settings/playback store split with the captured v3-blob regression test;
  single monotonic PlaybackSnapshot; sequencer cancellation + dev-assert that only sequenced
  tasks mutate state; AudioPlayerService decomposed then deleted; flight-recorder ring-buffer
  core extracted to `kernel/` with namespaced buffers adopted per later phase), 5c content
  (pure SectionQueueBuilder, detector strategy, LexiconEngine with lazy Bible JSON, canonical
  CFI kernel with property-based equivalence tests). Graft: NFKD re-ingestion retains old
  `cache_tts_preparation` rows until a CFI-alignment self-check passes; CI compares old-vs-new
  sentence CFIs on composed-accent/CJK fixtures before `extractionVersion` bumps. Lands as
  `domains/audio/`.
- **P6 — Strangler #5: reader + Chinese** (entry gate: six-overlay + session-recording
  characterization E2E). ReaderEngine port with EpubJsEngine as sole epubjs importer (the
  acceptance test: swapping to foliate-js is a one-module change), HighlightLayerManager,
  ReaderShell <200 lines, ReaderCommands context (window CustomEvents + callbacks-in-store
  die), serialized session recording, `domains/chinese/` as a self-contained feature module
  (code-point-safe pinyin, IDB DictionaryService, cedict out of git). Lands as
  `domains/reader/` + `domains/chinese/`.
- **P7 — Strangler #6: library, search, Google/GenAI, egress.** ImportOrchestrator +
  LibraryService with per-book keyed mutex (the five race tests ported to service invariants
  *before* cutover), one `extractBook()` (triplication deleted), SHA-256 identity + reading-list
  linking, SearchSession + persisted searchText repo + navigate-to-match, GoogleAuthClient with
  per-service tokens (force-disconnect only on definitive revocation), GenAIClient with
  per-feature zod modules + redacted ring-buffer logs + per-book AI consent, NetworkGateway +
  destination registry + fetch ban + generated CSP. Lands as `domains/library|search|google/`
  + `kernel/net/`.
- **P8 — Shell, settings, a11y/i18n choke points, PWA/build finishers.** Routes with
  React.lazy + first-use dynamic imports (safe only now that side effects are gone) + CI bundle
  budget, settings registry with lazy panels, CompassPill dissolution completed, queue-based
  Toast + LiveAnnouncer + useConfirm accepting message keys per the i18n ADR,
  KeyboardShortcutService, locale formatters, single PWA manifest + runtime caching +
  prompt-style SW update, font rename off OFL reserved names with preference migration,
  `ui/` design system finalized (kernel-only imports).
- **P9 — Deletion audit, ratchet completion, generated docs.** knip sweep; any boundary rule
  not yet at error flips with zero exceptions; P1 type shims deleted; dual-write retired (v7);
  `as any`/eslint-disable counters driven to target; `architecture.md`, module READMEs, and
  AGENTS.md regenerated from the registries; TS project references complete across all layers;
  test count verified ≤ ~120 with the absorption ledger closed.

---

## 6. Risk register

The strangler proposal's 12-row register (§Risk register) is adopted as-is — v6 fleet safety,
fork-surgery hydration semantics, staged-swap integrity, IDB v25 stragglers, TTS decomposition
regressions, worker-bundle drift, rules lockout, re-ingestion load, test-consolidation loss,
localStorage splits, premature route-splitting, strangler fatigue — with these strengthened
mitigations from the grafts:

- Observe-then-enforce + telemetry review before any inbound sync validation rejects (R:
  validation strands legitimate legacy data).
- Merge-over-defaults per-store flip with fallback-removal canaries (R: masking legitimate
  deletions); the fork keeps `previousState` delete-protection.
- Fixture coverage widened to v1/v2 real-doc snapshots, not just v4/v5.
- Rules lockout gets the in-app version-gated prompt, not just docs.
- The captured tts-storage v3 blob test pins the highest-value localStorage migration.
- One-in-flight-format-change sequencing (program rule 4) bounds the blast radius of any
  migration failure to a single recoverable format.

Two synthesis-specific risks, owned here:

| Risk | Mitigation |
|---|---|
| **Kernel becomes the next junk drawer** (Judge 2) | Admission rule: zero internal imports + ≥2 consuming domains + PR-checklist review; dependency-cruiser enforces kernel-imports-nothing; kernel contents are enumerated in the C12 ruleset and additions bump it. |
| **Domain-UI/state access litigated per PR** (Judge 2) | Rule 4 in §2 is mechanical: reads via the domain's published hooks, writes via services/controllers — lintable via no-restricted-imports on store setters outside services. |

---

## 7. Test strategy (end state)

The six-tier pyramid from `proposals/strangler-incremental.md` §Test strategy, with the
contract tier as the spine: pure-logic units + seeded fuzz companions; `describeXContract`
suites for every dual-implementation seam (engine transports, five TTS providers, SyncBackend
on emulator vs mock, data repos on real idb vs fake, vendored forks, zod rows); store/service
integration on real Zustand + real Y.Doc; component tests only where logic lives
(renderWithStores + vitest-axe); ~40 deterministic Playwright journeys (sanitization ON,
hostile-EPUB fixture, post-wipe boot, kill-mid-switch, two-client quarantine); ~10 visual
goldens. Cross-cutting gates: all test code typechecked, `vi.mock` banned in engine/provider/
data directories, coverage ratchet, boundary lints at error, worker-chunk and registry==CSP
assertions as permanent invariants. End state: ~110 vitest files (from 246) + ~40 journeys,
every historical regression preserved as a named `describe('regression: …')` block.

---

## 8. Why this synthesis (and not one proposal verbatim)

- **Strangler-incremental won the judging** (top aggregate score from all three judges; 2 of 3
  named it winner) because it is the only plan whose sequencing never leaves user data
  half-migrated and whose Phase 0 ships the user-safety hotfixes immediately. Its weakness was
  the destination: "today's taxonomy, disciplined" — the same horizontal geometry that let 285
  debts accumulate.
- **Modular-monolith had the best destination** (vertical domain modules, compile-time
  layering) but the worst journey: an everything-moves re-architecture with months of
  merge-conflict tax, and a v6 migration split across two different runners.
- **Contract-first had the best governance** (the C1–C12 registry and its CI rules are, per the
  judges, "exactly the right immune system for a repo that will keep being written by agents")
  but a freeze phase that stalls and criticals that wait too long.

The synthesis takes each at its best: the strangler's order of operations, with replacement
code landing directly at modular-monolith addresses (no double moves), under contract-first
governance authored just-in-time. Full judge record: `judging.md`.
