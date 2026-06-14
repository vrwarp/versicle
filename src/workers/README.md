# Web Workers

This directory contains the entry point scripts for Web Workers. These scripts run in background threads, allowing computationally intensive tasks to be performed without blocking the main UI thread.

## Files

*   **`search.worker.ts`**: The dedicated worker for full-text search. It Comlink-exposes the `SearchEngine` (an escaped-literal linear scan — no index library); `SearchSession` (`src/domains/search/`) owns the worker lifecycle and feeds it sections from the persisted `cache_search_text` corpus.
