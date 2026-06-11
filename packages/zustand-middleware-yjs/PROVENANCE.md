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
