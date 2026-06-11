# Provenance — vendored `y-idb`

This package is a **vendored fork**, imported into the Versicle repo as an npm
workspace at the start of Phase 3 (plan/overhaul/prep/phase3-storage-gateway.md
§D6, PR P3-2) so the snapshot/durability fork surgery is a first-party,
CI-tested change instead of a remote branch bump — the same treatment the
Phase 2 `zustand-middleware-yjs` vendoring established.

## Lineage

| | |
|---|---|
| Upstream | https://github.com/yjs/y-indexeddb (MIT, © 2014 Kevin Jahns / RWTH Aachen) |
| Fork | https://github.com/vrwarp/y-idb |
| Vendored from | fork commit `e2a21f45b55190e22d165817e9bc2a2ca1aa40cf` (v9.0.12) — the exact SHA the app was pinned to as a git dependency before vendoring |
| Verified | `src/y-idb.js` is byte-identical (`diff` clean) to the artifact npm installed from that git pin (`node_modules/y-idb/src/y-idb.js`); the app consumed the fork's ES source (`module`/`import` conditions) before vendoring, so source == previously-shipped behavior. `src/y-idb.d.ts` is the tsc-emitted declaration from the same install (`dist/src/y-idb.d.ts`), now hand-maintained alongside the source. |
| License | MIT, retained verbatim in `LICENSE`. The repo-level license record lives in `third-party/inventory.json`; the package is `private: true`, which keeps it out of the npm license scan by design. |

## Fork deltas already present at the vendored SHA (relative to upstream y-indexeddb)

- `writeDebounceMs` option: debounced, batched update flush (one IDB
  transaction per batch) instead of one transaction per Y.Doc update
- flush retry with exponential backoff on transaction error/abort
  (`_maxRetries` = 5; `error` and `retry-exhausted` events)
- `durability` option passed through to `IDBDatabase.transaction`
- `transactionRunner` injection: every write path (initial hydration write,
  debounced flush, trim/`storeState`, `set`/`del`) runs through an injected
  exclusive-write gate when provided
- best-effort synchronous flush on `pagehide` / `visibilitychange: hidden`
- `destroy()` flushes pending updates before closing (idempotent via
  `_destroyPromise`); `_destroyed` short-circuits throughout

## Changes made while vendoring (no behavior changes)

- `package.json` rewritten: `private: true` (never published);
  `exports`/`main`/`types` point at `src/` directly (Vite/vitest consume the
  ES source — tested code path == shipped code path; this is also the path the
  app consumed before vendoring); **`lib0` moved from dependencies to
  peerDependencies** next to the existing `yjs` peer, so a single resolved
  copy of each is structural, not dedupe-by-luck (the root app depends on
  both; `scripts/assert-single-instance.cjs` makes it CI-checkable).
- Build/release apparatus dropped (rollup, c8, standard, markdownlint,
  jsdoc, http-server): this package never publishes again. The committed
  upstream `dist/` is NOT vendored; the source is the artifact.
- The fork repo's node test runner suite was not shipped in the installed
  artifact (`files` covered only `dist/*` + `src/*`), so there were no tests
  to port. The first-party contract suite in `test/contract/` (Y.1–Y.7,
  written against the UNMODIFIED vendored source) is the behavior pin that
  replaces them.
- `src/y-idb.d.ts` added (see Lineage): the consumer-facing declarations the
  app already typechecked against, minus the stale sourcemap pointer.

## Phase 3 modification log (append entries here; design doc §D6)

- **Surgery 1 — public `flush(): Promise<void>`** (phase3-storage-gateway.md
  §D6 cut 1): explicit drain of the debounced update queue — runs `_flush()`
  immediately (bypassing the `writeDebounceMs` timer), awaits the in-flight
  transaction commit via the existing `_flushPromise`, and loops until
  `_pendingUpdates` is empty with no flush in flight. Resolves immediately
  when idle; while the error-retry path is active it waits for the scheduled
  backoff instead of hot-spinning a failing transaction. Replaces the
  `_flush()`/`_flushPromise` internals-poking in `src/test-api.ts` and the
  1000 ms "wait for flush" sleep in `BackupService`. `destroy()` deliberately
  keeps its own final-batch drain: it must run with `_destroyed` already set
  (mid-hydration destroys short-circuit `_fetchUpdates`), where `flush()`'s
  drain loop exits early by design. Contract: Y.8a–c in
  `test/contract/surgery.test.ts`.
- **Surgery 2 — `writeSnapshot(name, update, { transactionRunner })` module
  export** (§D6 cut 2): the snapshot-write primitive `BackupService`
  re-implemented raw (`indexedDB.open('versicle-yjs')` + a hand-built copy
  of this module's store layout). Opens/creates the database with the fork's
  own layout, clears `updates`, writes the single snapshot row, awaits the
  transaction COMMIT, closes — layout knowledge now lives in exactly one
  module: this fork. Optional `transactionRunner` wraps the whole
  open→commit→close unit (the app passes its cross-context IDB write gate).
  Precondition documented: no live binding on `name`. Contract: Y.9a–c.
- **Surgery 3 — `'synced'` durability** (§D6 cut 3): the constructor's
  initial-state write used to be issued without awaiting, and `'synced'` was
  emitted mid-transaction — `whenSynced` could resolve before the write
  committed, so the temp-provider dance in `CheckpointService` was durable
  only via `IDBDatabase.close()` waiting for in-flight transactions. The
  emit now fires from the hydration transaction's `complete` event:
  `whenSynced` ⇒ the initial-state write (and the hydration read) have
  committed. Update→`'synced'` ordering relative to the doc is unchanged
  (stored updates still applied before the emit — Y.7 and Y.10b pin it); on
  abort/error the emit still happens (legacy behavior, consumers must not
  wedge). Contract: Y.10/Y.10b.
