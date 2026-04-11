## 2024-05-24 - Replace multiple getKey with getAllKeys in getOffloadedStatus
**Learning:** Checking existence of multiple independent keys using `Promise.all` over `store.getKey(id)` creates a large overhead and dispatches numerous unnecessary microtasks to the database transaction, especially when checking large arrays of book IDs.
**Action:** Changed to fetch all keys directly using `await store.getAllKeys()` within the transaction and instantiated a `Set` for fast O(1) membership checks via `keySet.has(id)`, avoiding the waterfall of parallel DB requests.
