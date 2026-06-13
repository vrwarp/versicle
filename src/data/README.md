<!-- GENERATED FILE — do not edit by hand. -->
<!-- Rendered by src/app/docs/registryDocs.ts from the live registries. -->
<!-- Drift-gated by src/app/docs/docs.test.ts: a plain `npm test` fails when -->
<!-- this file disagrees with the registries. Regenerate: npm run docs:generate -->

# Data (L1) — the only IndexedDB subsystem

Rule 2 of the master plan §2, enforced at **error** with zero exceptions:
all IndexedDB access goes through this directory's repos; `'readwrite'`
transaction literals and `idb` imports are lint-banned everywhere else
(production AND tests). Writes additionally pass the navigator.locks
**write gate** (`write-gate.ts`), whose synchronous-callback API makes an
`await` inside a transaction unrepresentable — the WebKit-hang discipline
is structural.

The database is `EpubLibraryDB` at **v26** (`schema.ts`). Migration
steps are append-only registry entries; the steps past the v24 baseline:

| Step | Transform |
| --- | --- |
| v25 | `migrateToV25` |
| v26 | `migrateToV26` |

Captured-fixture upgrades (v18, v24 → current) are pinned in
`migrations.test.ts`; multi-tab upgrade behavior in `connection.test.ts`.

## Contents

| Entry | What it is |
| --- | --- |
| `__fixtures__/` | captured v18/v24 schema fixtures + builders for the migration suite |
| `repos/` | the repository surface (below) — the only place transactions are opened |
| `rows/` | zod row schemas per domain (app, backup, cache, static) — drift-guard anchors |
| `snapshot/` | YjsSnapshotService — THE one snapshot/export/import mechanism for the Y.Doc |
| `connection.ts` | hardened open: blocked/blocking/terminated handlers, retry-with-reset, storage.persist() |
| `covers.ts` | shared coverUrl() for the SW-served cover endpoint |
| `errors.ts` | handleDbError boundary mapping onto the C10 taxonomy |
| `schema.ts` | store map + DB_VERSION + the append-only versioned migration registry (C1) |
| `sw-contract.ts` | the service-worker read contract (cover serving; legacy pre-v18 fallback) |
| `wipe.ts` | wipeAllData() behind a writer-stop hook registry (sync + Yjs register at boot) |
| `write-gate.ts` | navigator.locks write gate spanning tabs + the TTS worker; synchronous-callback API |

## Repos

| Repo | Owns |
| --- | --- |
| `audioCache.ts` | TTS audio cache rows + LRU eviction (by_lastAccessed index) |
| `bookContent.ts` | static book content + derived content replacement (ingest path) |
| `checkpoints.ts` | pre-danger Y.Doc checkpoints (used by backup/restore/migrations) |
| `diagnostics.ts` | flight-recorder persistence |
| `dictionary.ts` | the separate versicle-dict database (Chinese dictionary) |
| `playbackCache.ts` | session/playback cache (WebKit-safe write pattern preserved verbatim) |
| `searchText.ts` | persisted search corpus (cache_search_text) |

The Yjs document itself is persisted by `packages/y-idb` (vendored fork)
into the separate `versicle-yjs` database; `snapshot/YjsSnapshotService`
is the one read/write/export surface over it.
