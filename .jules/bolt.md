## 2024-04-07 - [IndexedDB Parallel Batching & Cursor Avoidance]
**Learning:** Sequential `await` in loops over IndexedDB operations causes severe I/O waterfall latency, and `openCursor` incurs heavy overhead per row.
**Action:** Replaced `for...of` loops and `openCursor` iterations with `Promise.all()` and `getAllKeys()` in `DBService.ts` to execute batches concurrently, drastically reducing ingest and delete durations.
