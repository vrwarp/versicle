/**
 * @deprecated Phase 3 (P3-3): the cross-context exclusive IDB write gate
 * lives in src/data/write-gate.ts, implemented on the Web Locks API with
 * this module's old promise chain as the jsdom/Safari<15.4 fallback. This
 * re-export shim only keeps stale import paths compiling.
 * DELETION DEADLINE: Phase 3 exit (P3-12) — plan/overhaul/README.md §4
 * rule 2 (every shim carries a named deletion deadline).
 */
export { runExclusiveIdbWrite, idbWriteLockIdle } from '@data/write-gate';
