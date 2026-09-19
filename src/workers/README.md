# Web Workers

This directory contains the entry point scripts for Web Workers. These scripts run in background threads, allowing computationally intensive tasks to be performed without blocking the main UI thread.

## Files

*   **`search.worker.ts`**: The dedicated worker for full-text search. It Comlink-exposes the `SearchEngine` (an escaped-literal linear scan — no index library); `SearchSession` (`src/domains/search/`) owns the worker lifecycle and feeds it sections from the persisted `cache_search_text` corpus.
*   **`dictionaryImport.worker.ts`**: The one-shot worker for the CC-CEDICT import. It Comlink-exposes `runDictionaryImport` (`src/domains/chinese/dictionary/importDictionary.ts`), which fetches `/dict/cedict.json` (≈15 MB, ~198 000 headwords), parses it and writes it into the `versicle-dict` database in chunked transactions — the `JSON.parse` alone measured 183 ms / ~104 MB of transient heap on the main thread. `DictionaryService` (`src/domains/chinese/dictionary/`) owns the lifecycle through its `runImport` port and terminates the worker as soon as the import settles.
