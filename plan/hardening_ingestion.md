# Ingestion & Persistence Hardening Design

## 1. Current Architecture & Weaknesses

### Current Implementation
- **Loading:** `src/lib/ingestion.ts` uses `processEpub(file)` which immediately calls `file.arrayBuffer()`, loading the entire file into memory.
- **Parsing:** It then passes this buffer to `ePub(arrayBuffer)`.
- **Hashing:** It uses `crypto.subtle.digest` on the same `arrayBuffer` to generate a SHA-256 hash.
- **Storage:** It stores the `arrayBuffer` in IndexedDB (`files` store) and metadata in `books` store.
- **Restoration:** `restoreBook` in `DBService` also reads the full file into memory to verify the hash before restoring.

### Vulnerabilities
- **Memory Exhaustion (OOM):** Loading a 100MB+ EPUB creates multiple large allocations (File object, ArrayBuffer, epub.js internal copy). This crashes mobile browser tabs.
- **Parsing Fragility:** `ePub(buffer)` is synchronous-like in setup and can throw unhandled errors if the zip is corrupt, causing the promise to reject without specific context.
- **DB Quota:** Storing large ArrayBuffers can hit IDB quotas rapidly.

## 2. Hardening Strategy

### 2.1. Memory Optimization (Streaming & Blobs)
Instead of eager `ArrayBuffer` conversion, we leverage the browser's native `Blob` and `File` handling which is often backed by disk/tmp storage rather than heap.

- **Action (Implemented):** Modified `processEpub` to accept `File` and pass it directly to `ePub()`.
  ```typescript
  // NEW
  const book = ePub(file); // epub.js supports File/Blob directly
  ```
- **Action (Implemented):** Stored `Blob` in IndexedDB instead of `ArrayBuffer`.
  - `src/db/db.ts`: Updated `files` store schema to allow `Blob`.
  - `src/lib/ingestion.ts`: Modified to store the `File` object directly.
  - `src/db/DBService.ts`: Updated retrieval and restore logic to handle Blobs.

### 2.2. Optimized Hashing
Calculating SHA-256 on a large file still requires reading it. To avoid holding the full result in RAM:
- **Action (Partially Implemented):** We currently compute hash via `file.arrayBuffer()` for verification.
- **Future Work:** Implement chunked hashing using `FileReader` and a streaming SHA-256 implementation if `SubtleCrypto` memory usage becomes a bottleneck.

### 2.3. Robust Error Handling
- **Action (Implemented):** The `processEpub` function wraps `ePub` instantiation and `ready` promise handling.
- **Action (Implemented):** Cover extraction uses `fetch` for Blob URLs to handle potential failures gracefully.

### 2.4. Data Integrity Checks
- **Action (Planned):** Enhance `DBService.getLibrary` to perform a "lazy" integrity check.

## 3. Implementation Plan (Status: Complete)

1.  **Refactor `processEpub`**:
    - Removed eager `await file.arrayBuffer()` for parsing (kept for hashing for now).
    - Passed `file` to `ePub`.
2.  **Update `DBService`**:
    - Changed `addBook` (via ingestion) to store the `file` (Blob) directly.
    - Updated `getBook` return type to `Promise<{ metadata: ..., file: ArrayBuffer | Blob }>`.
    - Updated `offloadBook` and `restoreBook` to handle Blobs.
3.  **Tests**:
    - Updated unit and integration tests to verify Blob storage logic.
    - **Note on Testing:** Due to limitations with `fake-indexeddb` and JSDOM's `structuredClone` regarding Blob preservation, unit tests for ingestion mock the database layer to verify that the `File` object is passed correctly to the store, rather than asserting on retrieved values from the fake DB.
