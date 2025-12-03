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
Instead of eager `ArrayBuffer` conversion, we will leverage the browser's native `Blob` and `File` handling which is often backed by disk/tmp storage rather than heap.

- **Action:** Modify `processEpub` to accept `File` and pass it directly to `ePub()`.
  ```typescript
  // OLD
  const buffer = await file.arrayBuffer();
  const book = ePub(buffer);

  // NEW
  const book = ePub(file); // epub.js supports File/Blob directly
  ```
- **Action:** Store `Blob` in IndexedDB instead of `ArrayBuffer`.
  - IDB supports storing `Blob` objects directly. This allows the browser to optimize storage (e.g., just moving the file pointer) rather than serializing a massive buffer.
  - **Migration:** We may need a migration script or just support both types in `DBService`.

### 2.2. Optimized Hashing
Calculating SHA-256 on a large file requires reading it. To avoid holding the full result in RAM:
- **Action:** Implement chunked hashing using `FileReader` and a streaming SHA-256 implementation (if available via `SubtleCrypto` or a lightweight WASM/JS fallback like `hash.js` if native streaming isn't supported).
- **Fallback:** If strictly using `SubtleCrypto` (which is one-shot), we must enforce a hard file size limit (e.g., 150MB) and reject larger files with a clear error message. given the complexity of streaming crypto in browser without deps, a size limit is the pragmatic "hardening" step for V1.

### 2.3. Robust Error Handling
- **Action:** Wrap the `epub.js` instantiation and `ready` promise in a specific `try-catch` block.
- **Action:** Map `epub.js` errors (often generic) to user-friendly messages:
  - "Invalid EPUB structure (missing container.xml)"
  - "File is corrupt or not a zip"
- **Action:** Validate `coverUrl` fetch failures silently (as done) but log them to the new logging service.

### 2.4. Data Integrity Checks
- **Action:** Enhance `DBService.getLibrary` to perform a "lazy" integrity check.
  - If a book record exists but the `files` entry is missing (orphan metadata), flag it in the UI or auto-hide it.
  - If a `files` entry exists with no `books` record (orphan file), add a cleanup routine in `MaintenanceService` (already planned in DB Hardening).

## 3. Implementation Plan

1.  **Refactor `processEpub`**:
    - Remove `await file.arrayBuffer()`.
    - Pass `file` to `ePub`.
    - Handle `crypto.subtle.digest` via a separate helper that respects a size limit (e.g. `MAX_FILE_SIZE = 100 * 1024 * 1024`).
2.  **Update `DBService`**:
    - Change `addBook` to store the `file` (Blob) directly.
    - Update `getBook` return type to `Promise<{ metadata: ..., file: Blob | ArrayBuffer }>`.
3.  **UI Feedback**:
    - Add `Toast` error for "File too large" or "Corrupt EPUB".
