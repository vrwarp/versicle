## 2024-04-10 - Replace getAllKeys with Targeted Lookups
**Learning:** Calling `getAllKeys` on IndexedDB object stores inside frequently called functions triggers a full table scan and loads every key into memory, severely impacting performance for large datasets.
**Action:** Replaced `getAllKeys` in `DBService.getOffloadedStatus` with concurrent `.getKey` lookups executed via `Promise.all` within a single `readonly` transaction when processing specific IDs. Preserved the original logic for the empty fallback to prevent regressions.
