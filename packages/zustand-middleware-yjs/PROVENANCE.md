# Provenance — vendored `zustand-middleware-yjs`

This package is a **vendored fork**, imported into the Versicle repo as an npm
workspace at the start of Phase 2 (plan/overhaul/prep/phase2-fork-surgery.md §6)
so the CRDT fork surgery is a first-party, CI-tested change instead of a remote
branch bump.

## Lineage

| | |
|---|---|
| Upstream | https://github.com/joebobmiles/zustand-middleware-yjs (MIT, © 2021 Joseph R Miles) |
| Fork | https://github.com/vrwarp/zustand-middleware-yjs |
| Vendored from | fork commit `f2842963ecbd5b2bc80fc1898267c0e41b5a1834` (v1.3.1) — the exact SHA the app was pinned to as a git dependency before vendoring |
| Verified | the fork repo's committed `dist/` at that SHA is byte-identical to the artifact previously installed from the git dependency (`diff -r` clean), so source == previously-shipped behavior |
| License | MIT, retained verbatim in `LICENSE`. The repo-level license record lives in `third-party/inventory.json`; the package is `private: true`, which keeps it out of the npm license scan by design. |

## Fork deltas already present at the vendored SHA (relative to upstream)

- `schemaVersion` / `onObsolete` poison-pill quarantine (per-map `__schemaVersion` check)
- `disableYText` / `yTextKeys` options (plain-string storage instead of Y.Text)
- outbound + inbound microtask batching (one Yjs transaction / one `patchStore` per tick)
- `previousState` delete-protection on outbound flush (concurrent remote inserts survive)
- `undefined` value handling (stored as-is; round-trip pinned by the contract suite)

## Changes made while vendoring (no behavior changes)

- `package.json` rewritten: bogus self-dependency (`original-package-name: file:.`)
  deleted; unused `use-sync-external-store` dependency dropped (not imported by
  `src/` or `dist/`); **`yjs` and `zustand` moved from regular dependencies to
  peerDependencies** (`yjs ^13.6.0`, `zustand ^5.0.0`) so a single resolved copy
  of each is structural, not dedupe-by-luck; `exports`/`main`/`types` now point
  at `src/index.ts` (Vite/vitest consume the TS source directly — tested code
  path == shipped code path).
- Build/release apparatus deleted (rollup, semantic-release, husky, commitlint,
  jest config, GitHub workflows): this package never publishes again. The
  committed upstream `dist/` is NOT vendored; the source is the artifact.
- Jest specs ported to vitest (`jest.fn`/`jest.spyOn` → `vi.fn`/`vi.spyOn`;
  globals come from the root vitest config). The "Yjs middleware with network
  provider" describe block (a y-websocket demo-server integration test spawning
  a child process) was dropped as non-hermetic; its load-bearing behavior —
  late join does not reset remote state because the middleware never eagerly
  writes initial state into the doc — is re-pinned hermetically in
  `test/contract/characterization.test.ts` (two docs + `Y.applyUpdate`).
- `tsconfig.json` / `tsconfig.test.json` are new composite projects referenced
  from the root `tsc -b` solution (declaration-only emit to `dist-types*/`,
  gitignored).

## Phase 2 modification log (append entries here; design doc §6.3)

- **Surgery 1 — `syncedKeys` whitelist** (phase2-fork-surgery.md §2.1):
  additive `YjsOptions.syncedKeys` filtering replication in BOTH directions
  at the top level (`__schemaVersion` implicitly synced when `schemaVersion`
  is set; resurrection guard for keys dropped from the whitelist; loud
  dev-mode misconfiguration errors at store creation). Default (`undefined`)
  is byte-for-byte legacy behavior. Internals: `patchSharedType`'s change
  application extracted to `applyChangesToSharedType` (verbatim, incl. the
  `previousState` delete-protection); inbound application factored into
  `computeInboundState` (legacy path = `patchState` exactly). Contract cases
  B.1–B.6 in `test/contract/synced-keys.test.ts`.
- **Surgery 2 — `hydration: 'merge-defaults'`** (phase2-fork-surgery.md
  §2.2): additive `YjsOptions.hydration` (default `'replace'` = legacy
  replace-with-delete, still pinned by contract A.5). Under
  `'merge-defaults'` the middleware captures the declared defaults (the
  non-function keys of the state creator's initial state, before any
  patching) and suppresses ONLY top-level inbound DELETEs for those keys —
  the top-level change list is filtered in `patchState`; `getRecordChanges`
  is untouched so nested deletes keep propagating. The outbound
  `previousState` delete-protection is kept verbatim (strangler risk row 2,
  pinned by A.3). Fixes finding D2 (new top-level fields wiped on hydration
  from older docs — the v4→v5 fontProfiles class). Contract cases C.1–C.8 in
  `test/contract/merge-defaults.test.ts`.
- **Surgery 3 — `scopedDiff` per-key diffing** (phase2-fork-surgery.md §2.3,
  the D13 fix): additive `YjsOptions.scopedDiff` (default false = legacy
  full-tree diff). Outbound diffs only `Object.is`-changed top-level keys,
  each against its own subtree (`patchSharedTypeScoped`, reusing the legacy
  change application verbatim — DELETE guard and Y.Text repair included);
  inbound re-reads only the top-level keys named by the batch's Yjs events
  (untouched keys keep object identity). Two divergence tripwires per the
  design: a fast-check equivalence property (scoped ≡ full, incl. two-doc
  concurrent merges) and a DEV sampling assert
  (`assertScopedDiffConvergence`, control via `__scopedDiffDevSampling`)
  that fails loudly on mutate-in-place writes. First-flush note: the batch
  capture always provides a `previousState`, so the doc's "no previousState
  → legacy full diff" fallback is defensive-only; the reachable first-flush
  contract is scoped/lazy (consistent with §2.2 lazy backfill), pinned by
  D.6. Contract cases D.1–D.6 in `test/contract/scoped-diff.test.ts`.
- **Surgery 4 — `api.yjs` store handle + `scope: { key }`**
  (phase2-fork-surgery.md §2.4, §2 options table, §5.3): the middleware now
  attaches a `YjsStoreHandle` (`hasHydrated`/`whenHydrated`/`markHydrated`/
  `flush`/`isObsolete`, modeled on zustand/persist's `api.persist`; typed
  accessor `getYjsStoreHandle`). `whenHydrated` resolves strictly after the
  hydrating `setState` — the structural replacement for the provider's
  nested-queueMicrotask hack. `flush()` drains the pending outbound
  microtask synchronously (the scheduled microtask is guarded so it cannot
  double-run). `scope: { key }` binds the store to a nested Y.Map at
  `doc.getMap(name).get(key)` (lazily created on first outbound flush) with
  inbound path filtering — sibling entries never patch the store — while
  the `__schemaVersion` poison pill keeps reading the TOP-LEVEL named map
  (obsolete check unaffected; risk R8's contract cases). Contract cases
  E.1–E.4 in `test/contract/hydration-api.test.ts` (incl. the end-to-end
  scopedDiff tripwire through `flush()`); scope cases in
  `test/contract/scope.test.ts`.
- **`atomicKeys` status note** (design correction ▲3): the option is dead
  code under `disableYText: true` (the app's global configuration since v4)
  but stays in the package — the design's options surface lists it as
  "existing, unchanged semantics", and it is still live for
  `disableYText: false` consumers. The app's vestigial
  `atomicKeys: ['__schemaVersion']` is deleted with `defineSyncedStore`
  (P2-6, app-side). `test/contract/atomic-keys-dead-code.test.ts` pins that
  the deletion is a no-behavior-change: byte-identical doc encodings with
  and without the option under `disableYText: true`.
