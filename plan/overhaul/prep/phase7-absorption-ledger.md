# Phase 7 test-absorption ledger — library / ingestion / search sub-track

Program rule 8: a per-bug test file is deleted ONLY in the same PR that lands
its assertions as a named `describe('regression: …')` block in the owning
suite. Reviewers check this ledger. (Pattern: `phase5-absorption-ledger.md`.)

| # | Deleted file | Absorbed into | Named block | Status |
|---|---|---|---|---|
| 1 | `src/lib/search-engine.comprehensive.test.ts` | `src/lib/search-engine.test.ts` | `regression: edge placement and unicode (absorbed from search-engine.comprehensive.test.ts)` | ✅ entry-gate commit |
| 2 | `src/lib/search-engine.perf.test.ts` (assertion-free: logged a duration, asserted nothing) | `src/lib/search-engine.test.ts` | `regression: linear-scan throughput budget` — now carries a real budget (<3s on a 2M-char no-match scan) | ✅ entry-gate commit |
| 3 | `src/lib/search.repro.test.ts` | `src/lib/search.test.ts` | `regression: concurrent searches map to their own results (absorbed from search.repro.test.ts)` | ✅ entry-gate commit |
| 4 | vacuous test deleted, not absorbed: `should prevent infinite loops on zero-width matches` (in `search-engine.test.ts`) — mocked global `RegExp` which the indexOf-scanning engine never touches, asserted `toBeDefined` on an array. Tombstone comment left in the suite. | — | — | ✅ entry-gate commit |
| 5 | `src/store/useLibraryStore.race.test.ts` | `src/domains/library/LibraryService.invariants.test.ts` | `regression: I-1 hydrate is a per-key merge` | ✅ deleted at PR-L4 cutover |
| 6 | `src/store/useLibraryStore.removeRace.test.ts` | same | `regression: I-2 hydration never resurrects` | ✅ deleted at PR-L4 cutover |
| 7 | `src/store/useLibraryStore.restoreRace.test.ts` | same | `regression: I-3 restore re-validates existence` | ✅ deleted at PR-L4 cutover |
| 8 | `src/store/useLibraryStore.offloadRevert.test.ts` | same | `regression: I-4 failure restores captured prior state` | ✅ deleted at PR-L4 cutover |
| 9 | `src/store/useLibraryStore.offloadedRace.test.ts` | same | `regression: I-5 offloaded set is updated per-key` | ✅ deleted at PR-L4 cutover |
| 10 | `src/lib/BookImportService.test.ts` | `src/domains/library/import/persist.test.ts` (id rewrite) + `importFlows.characterization.test.ts` (restore acceptance) | `regression: import-with-id rewrites every bookId-bearing row` / `regression: rejects mismatched content with INGEST_FILE_MISMATCH` | ✅ deleted at PR-L2/L4 |
| 11 | `src/lib/batch-ingestion.test.ts` | `importFlows.characterization.test.ts` (batch accounting + ZIP expansion describe) | `batch import` / `ZIP expansion (real archive)` blocks | ✅ deleted at PR-L2/L4 |
| 12 | `src/store/useLibraryStore.test.ts` (841-line workflow-store suite) | workflow assertions → `importFlows.characterization.test.ts` + invariants suite; projection assertions → the rewritten slim `useLibraryStore.test.ts` (`regression:` blocks for D1 summary shape + reference stability) | several | ✅ rewritten at PR-L4 |

Notes:

- The five race files (rows 5–9) were absorbed at the ENTRY-GATE commit
  (suite written against the current store via the `LibraryWorkflows`
  adapter) and deleted in the SAME PR that swaps the adapter for the real
  `LibraryService` (PR-L4) — the rule-8 window spans the strangler, the
  assertions never went dark.
- `src/lib/ingestion.test.ts` / `ingestion_images.test.ts` are re-pointed
  (not absorbed) at PR-L1: the same assertions now exercise
  `domains/library/import/extract.ts` through the thin `lib/ingestion`
  delegates.
- Net vitest file count for the sub-track: −3 (search) −5 (race)
  −2 (BookImportService, batch-ingestion) +4 (invariants, characterization,
  orchestrator, zip) = −6.
