# Ingestion & Persistence Hardening Design

## 1. Current Architecture & Weaknesses (Historical)

### Current Implementation
- **Loading:** `src/lib/ingestion.ts` uses `processEpub(file)`. Previously loaded entire file into memory.
- **Parsing:** Uses `epub.js`.
- **Hashing:** Generates a "cheap hash" fingerprint based on metadata and partial file content.
- **Storage:** Stores `Blob` (File) in IndexedDB.

### Vulnerabilities (Addressed)
- **Memory Exhaustion (OOM):** Loading large EPUBs is now optimized.
- **Parsing Fragility:** `ePub(buffer)` is now safer.
- **DB Quota:** Storing `Blob` objects directly helps.

## 2. Hardening Strategy

### 2.1. Memory Optimization (Streaming & Blobs) [COMPLETED]
Instead of eager `ArrayBuffer` conversion, we leverage the browser's native `Blob` and `File` handling.

- **Completed:** Modified `processEpub` to accept `File` and pass it directly to `ePub()`.
- **Completed:** Store `Blob` (File) in IndexedDB instead of `ArrayBuffer`.
  - IDB supports storing `Blob` objects directly.
  - **Migration:** `DBService` now handles retrieving both `Blob` and `ArrayBuffer` from `files` store to support legacy data.
  - **Hashing:** We now use a "cheap hash" (fingerprint) that only reads head/tail of the file, avoiding full file read.

### 2.2. Optimized Hashing [COMPLETED]
- **Completed:** Implemented `generateFileFingerprint` which uses metadata + 4KB head/tail sampling. This avoids reading 100MB+ files into memory for SHA-256.

### 2.3. Robust Error Handling [PARTIAL]
- **Partial:** `epub.js` instantiation is now safer.
- **Todo:** Map `epub.js` errors (often generic) to user-friendly messages.
- **Todo:** Validate `coverUrl` fetch failures silently (logging added).

### 2.4. Data Integrity Checks [PENDING]
- **Todo:** Enhance `DBService.getLibrary` to perform a "lazy" integrity check.

## 3. Implementation Status

1.  **Refactor `processEpub`**: **DONE**
    - Removed eager `await file.arrayBuffer()` for parsing.
    - Passing `file` to `ePub`.
    - Hashing uses fingerprinting.
    - Storing `File` object in DB.
2.  **Update `DBService`**: **DONE**
    - `addBook`, `getBook`, `restoreBook`, `offloadBook` updated to handle `Blob` | `ArrayBuffer`.
3.  **UI Feedback**:
    - Pending: Add `Toast` error for "File too large" or "Corrupt EPUB".
