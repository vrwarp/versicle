# Phase 1: Storage & Identity

**Objective**: Remove cryptographic hashing from the import path.

## 1. Component Design: Ingestion Pipeline (Content Fingerprinting)

**Current State:** The `ingestion.ts` module performs a full cryptographic SHA-256 hash of every imported EPUB. To prevent crashing the browser with large files (e.g., 500MB+ audiobooks or graphic novels), it utilizes a complex chunked reading strategy via `CryptoJS`.

-   **Cost**: This approach results in high CPU usage and significant main-thread blocking, leading to sluggish performance during import operations.
-   **Purpose**: The primary use case is validating that a "restored" file matches the original "offloaded" metadata bit-for-bit.

**Problem:** Cryptographic certainty is overkill for personal library management. The threat model we are defending against---a user manually selecting a *different* file that happens to have the exact same filename and byte size---is vanishingly small. The current solution optimizes for a negligible edge case at the expense of everyday performance.

**Proposed Design: "The 3-Point Fingerprint"**
Instead of reading and hashing the entire file content, we will generate a unique identifier based on a composite of file metadata and a small, fixed-size data sample.

```typescript
async function generateFileFingerprint(file: File): Promise<string> {
  // 1. Metadata: This acts as the primary filter.
  // It is extremely rare for two different files to share name, size, and modification time.
  const metaString = `${file.name}-${file.size}-${file.lastModified}`;

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

-   **Performance**: The hashing time becomes O(1), constant regardless of file size. An 800MB graphic novel will import as instantly as a 2MB text novel.
-   **Code**: We can remove the `crypto-js` dependency entirely, along with the complex asynchronous chunking loops that are hard to debug.
-   **Robustness**: This method remains robust against common data integrity issues. It still catches corrupted files (size mismatch), truncated downloads (tail hash mismatch), and wrong file selection (header/name mismatch).

## 2. Implementation Plan

### Steps

1.  **Refactor `ingestion.ts`**:
    *   Implement the `generateFileFingerprint` function.
    *   Remove `crypto-js` imports and the chunked hashing logic.
    *   Replace calls to the old hashing function with `generateFileFingerprint`.

2.  **Update `DBService`**:
    *   Modify `restoreBook` (and any other relevant methods) to use the new fingerprint for verification.
    *   Ensure the `fileHash` field in the database can accommodate the new fingerprint format (likely a string).

3.  **Migration Strategy**:
    *   The database schema should support the new fingerprint format.
    *   For existing books with SHA-256 hashes, treat them as "legacy verified."
    *   When restoring a legacy book, we can either:
        *   Re-hash the incoming file (slow, one-time cost) if we want strict backward compatibility.
        *   Or, simply accept the file based on metadata matching only, effectively migrating it to the new system upon restore. (Preferred for simplicity).

### Validation

*   **Performance Test**: Import a large file (200MB+) and verify it is instantaneous compared to the previous implementation.
*   **Functional Test**: Verify the "Offload/Restore" cycle still functions correctly with the new fingerprinting.
*   **Edge Case Test**: Ensure small files (< 8KB) are handled correctly by the head/tail sampling logic (i.e., don't read past EOF).
