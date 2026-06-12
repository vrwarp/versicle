# Provenance — vendored `y-cinder`

This package is a **vendored fork**, imported into the Versicle repo as an npm
workspace in Phase 9 (the deferred P4-1 item:
plan/overhaul/prep/phase4-sync-strangler.md §D6 / §Follow-ups item 1) so the
`saved`-event fork surgery is a first-party, CI-tested change instead of a
remote branch bump — the same treatment the Phase 2 `zustand-middleware-yjs`
and Phase 3 `y-idb` vendorings established.

## Lineage

| | |
|---|---|
| Upstream | https://github.com/podraven/y-fire (MIT, © 2024 Pod Raven) |
| Fork | https://github.com/vrwarp/y-cinder |
| Vendored from | fork commit `9c5c205e6bfef008c5dd8733c67619a5a73d5f62` (v3.0.2603210004) — the exact SHA the app was pinned to as a git dependency before vendoring |
| Verified | The fork's committed `dist/` at that SHA is byte-identical (`diff -rq` clean) to the artifact npm installed from the git pin (`node_modules/y-cinder/dist/`), and that dist was built from `src/` in the same commit (its message is literally `npm run build`) — so vendoring the TS source is vendoring exactly what shipped. `src/generated/merge-worker-blob.ts` is generated (gitignored in the fork; produced by `scripts/bundle-worker.js` from `merge-worker.ts` + yjs via esbuild); it was reconstructed from `dist/generated/merge-worker-blob.js`, whose content for this trivial `export const` module is the generated TS verbatim (tsc preserves the literal and the header comment). |
| License | MIT, retained verbatim in `LICENSE`. The repo-level license record lives in `third-party/inventory.json`; the package is `private: true`, which keeps it out of the npm license scan by design. The fork's `readme.md` (with its fork-of header) is retained. |

## Fork deltas already present at the vendored SHA (relative to upstream y-fire)

The fork is a substantial rework of y-fire (its readme carries the
comparison); the deltas the app depends on:

- tiered storage: debounced `updates` subcollection writes → `history`
  segments → compacted snapshot (Cloud Storage spill for oversized blobs)
- distributed compaction locking (`metadata/lock_compaction`, clock-skew
  measured once per session) and partial/resumable compaction
- failure event surface: `connection-error`, `sync-failure` (circuit breaker
  after 5 sync retries), `save-rejected` (`document-too-large` proactive +
  server-side detection, `max-retries-exceeded`), `corrupted-document`
  (per-session quarantine set)
- off-main-thread update merging via an inline blob Worker
  (`mergeUpdatesAsync`, graceful sync fallback when `Worker` is unavailable)
- best-effort `beforeunload` flush; `destroy()` flushes pending updates

## Changes made while vendoring (no behavior changes)

- `package.json` rewritten: `private: true` (never published);
  `exports`/`main`/`types` point at `src/index.ts` directly (Vite/vitest
  consume the TS source — tested code path == shipped code path);
  **`firebase`/`yjs` peers kept and `lib0` added as a peer** (the source
  imports `lib0/observable`; upstream rode it in via yjs's transitive dep),
  so a single resolved copy of each is structural, not dedupe-by-luck
  (`scripts/assert-single-instance.cjs` now also asserts `firebase`,
  `@firebase/app`, `@firebase/firestore`, `@firebase/storage`).
- Build/test/release apparatus dropped (esbuild worker bundling script,
  firebase-tools, version-bump scripting, the debugger app, emulator
  configs): this package never publishes again. The fork's committed
  `dist/` is NOT vendored; the source is the artifact.
- `src/provider.ts:50` `export { FireProviderConfig }` → `export type { … }`:
  the app consumes this TS source through Vite/esbuild (per-file transpile,
  isolatedModules semantics), where a VALUE re-export of a type-only name
  cannot link; the fork compiled through tsc, which erased it. Type-level
  only; the emitted runtime code is unchanged.
- `tsconfig.json`/`tsconfig.test.json` added (composite projects wired into
  the root `tsc -b` solution; `strict: false` matching the fork's own
  compiler surface so the vendor diff stays zero — new fork-surgery code is
  still written strict-clean).
- The fork's emulator-free **unit suite** (`tests/unit/**`, 8 files) is
  ported verbatim to `test/unit/` (same relative `../../src` imports; plus
  `tests/utils/wait.ts` → `test/utils/wait.ts`). The 27-file
  `tests/integration/**` suite is NOT ported: every file drives the live
  provider against a running firestore+storage emulator pair and pins
  compaction/locking internals this repo's fork surgery does not touch;
  they remain runnable in the fork repo at the pinned SHA, and the in-tree
  pins are the first-party contract suite in `test/contract/` plus the
  app-side C3 emulator contract (`src/lib/sync/syncBackendContract.emulator.test.ts`),
  which drives the REAL vendored provider against the emulator trio. Porting
  the integration suite rides any future surgery into compaction/locking.
- The first-party contract suite in `test/contract/` (F.1–F.6, written
  against the UNMODIFIED vendored source) pins the provider semantics the
  app's sync domain depends on: constructor validation, echo-origin
  filtering + debounced batching, the save failure event surface, and
  `destroy()` teardown.

## Phase 9 modification log (append entries here; design doc §D6)

- **Surgery 1 — `saved` event** (phase4-sync-strangler.md §D6 delta 1): emitted
  with the commit wall-clock time (`Date.now()`) after `saveToFirestore()`'s
  `addDoc` resolves — the success half of the already-complete failure
  surface. Fires for the debounced save path, the threshold-forced path, and
  the `destroy()` final flush alike (they all funnel through
  `saveToFirestore`). Powers the C3 `saved` connection event →
  `SyncEvent{type:'flushed'}` → `lastSyncTime`; its arrival let
  `wireSyncEvents.ts` delete the transitional connected-transition
  `lastSyncTime` floor (the P4 §Follow-ups canary). Contract: F.6 in
  `test/contract/provider.test.ts` (the same cases that pinned the pre-delta
  gap), plus the C3 `savedEvent` capability on the emulator runner.
