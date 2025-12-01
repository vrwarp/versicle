# Web Workers

This directory contains the entry point scripts for Web Workers. These scripts run in background threads, allowing computationally intensive tasks to be performed without blocking the main UI thread.

## Files

*   **`search.worker.ts`**: The dedicated worker for full-text search. It initializes the `SearchEngine` (wrapping FlexSearch), indexes book content, and processes search queries sent from the main thread.
