# Phase 1: Storage & Identity

**Objective**: Remove cryptographic hashing from the import path.

## 1. Component Design: Ingestion Pipeline (Content Fingerprinting)

**Current State:**
-   `src/lib/ingestion.ts`: Uses `CryptoJS` to incrementally hash the file in chunks (`computeFileHash` function).
-   `src/db/DBService.ts`: `restoreBook` verifies the incoming file by re-hashing it and comparing it to `book.fileHash`.

**Problem:** Cryptographic certainty is overkill for personal library management. The threat model we are defending against---a user manually selecting a *different* file that happens to have the exact same filename and byte size---is vanishingly small. The current solution optimizes for a negligible edge case at the expense of everyday performance.

**Proposed Design: "The 3-Point Fingerprint"**
Instead of reading and hashing the entire file content, we will generate a unique identifier based on a composite of file metadata (Filename, Title, Author) and a small, fixed-size data sample. Note: We deliberately avoid volatile metadata like `lastModified` or `file.size` to allow for file system variations or re-downloads.

```typescript
async function generateFileFingerprint(file: File | Blob, metadata: { title: string, author: string, filename: string }): Promise<string> {
  // 1. Metadata: This acts as the primary filter.
  const metaString = `${metadata.filename}-${metadata.title}-${metadata.author}`;

  // 2. Head/Tail Sampling: Read the first 4KB and last 4KB of the file.
  // The header usually contains file format signatures (magic bytes) and metadata.
  // The footer often contains EOF markers or central directory records (in ZIP/EPUB).
  const head = await readSlice(file, 0, 4096);
  const tail = await readSlice(file, file.size - 4096, 4096);

  // 3. Fast non-crypto hash: Use a simple algorithm like DJB2 or even a string template.
  // We don't need security against collision attacks; we just need distinctness.
  return `${metaString}-${cheapHash(head)}-${cheapHash(tail)}`;
}
```

**Impact:**
-   **Performance**: The hashing time becomes O(1), constant regardless of file size.
-   **Code**: Remove `crypto-js` dependency.
-   **Robustness**: Still catches corrupted files (size mismatch), truncated downloads (tail hash mismatch), and wrong file selection.

## 2. Implementation Plan

### Steps

1.  **Refactor `src/lib/ingestion.ts`**:
    *   Implement `generateFileFingerprint`.
    *   Delete `computeFileHash` and remove `crypto-js` imports.
    *   Update `processEpub` to use `generateFileFingerprint` instead of `computeFileHash`.

2.  **Update `src/db/DBService.ts`**:
    *   Modify `restoreBook`: Replace the `crypto.subtle.digest` logic with `generateFileFingerprint`.
    *   Modify `offloadBook`: If the book needs a hash calculated (legacy path), use the new fingerprinting method if possible, or support a migration path.

3.  **Migration Strategy**:
    *   The `fileHash` field in `BookMetadata` is a string. The new fingerprint will fit in this field.
    *   **Legacy Compatibility**:
        *   If `restoreBook` receives a file, calculate its new fingerprint.
        *   If the stored `book.fileHash` looks like a SHA-256 hex string (64 chars), we have a mismatch.
        *   **Decision**: For simplicity, if the stored hash is legacy, we can choose to *trust* the filename/size match and update the stored hash to the new fingerprint, or perform a one-time migration. Given the "Let It Crash" philosophy, strict backward compatibility for *offloaded* books might be relaxed: if name and size match, update the hash.

### Validation

*   **Performance Test**: Import a large file (200MB+) and verify it is instantaneous.
*   **Functional Test**: Verify "Offload/Restore" cycle.
*   **Edge Case Test**: Ensure small files (< 8KB) are handled correctly.

## 3. Implementation Status (Completed)

**Date:** 2024-05-23
**Status:** Implemented and Verified.

### Changes Implemented
1.  **Ingestion Refactor**:
    *   Replaced `crypto-js` SHA-256 with `generateFileFingerprint` in `src/lib/ingestion.ts`.
    *   Fingerprint strategy: `${filename}-${title}-${author}` + DJB2-like hash of first/last 4KB.
    *   Removed `computeFileHash` and `crypto-js` dependency.
2.  **Database Updates**:
    *   Updated `src/db/DBService.ts`: `restoreBook` now calculates the fingerprint of the incoming file using provided metadata.
    *   **Removed Legacy Compatibility**: Per review feedback, we removed logic to migrate legacy SHA-256 hashes. Restoring legacy books will fail verification.
    *   Updated `offloadBook`: Now generates fingerprint using `book` metadata (Title/Author) + Blob content. This resolves the missing `lastModified` issue for Blobs.

### Divergences & Discoveries
*   **Metadata Strategy**: Shifted from `size/lastModified` to `Title/Author` to improve robustness across re-downloads and file system changes, and to enable fingerprinting of stored Blobs that lack file system metadata.
*   **Legacy Support**: Explicitly dropped support for verifying/migrating legacy SHA-256 hashes.
