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

(none yet — the contract suite in `test/contract/` pins the unmodified
vendored semantics first; the §D6 surgery lands behind Y.8–Y.10.)
