## 2024-04-10 - Replace getAllKeys with Targeted Lookups
**Learning:** Calling `getAllKeys` on IndexedDB object stores inside frequently called functions triggers a full table scan and loads every key into memory, severely impacting performance for large datasets.
**Action:** Replaced `getAllKeys` in `DBService.getOffloadedStatus` with concurrent `.getKey` lookups executed via `Promise.all` within a single `readonly` transaction when processing specific IDs. Preserved the original logic for the empty fallback to prevent regressions.

## 2026-04-12 - Replace multiple getKey with getAllKeys in getOffloadedStatus
**Learning:** Checking existence of multiple independent keys using `Promise.all` over `store.getKey(id)` creates a large overhead and dispatches numerous unnecessary microtasks to the database transaction, especially when checking large arrays of book IDs.
**Action:** Changed to fetch all keys directly using `await store.getAllKeys()` within the transaction and instantiated a `Set` for fast O(1) membership checks via `keySet.has(id)`, avoiding the waterfall of parallel DB requests.
