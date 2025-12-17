# Plan: EPUB Smart Delete (Offloading)

## Goal
Implement functionality to "offload" EPUB files (delete the large binary content) while retaining metadata (cover, title, author, progress, annotations). This allows users to save space. Users can restore the book by re-uploading the original file, which is verified using a checksum.

## Design

### 1. Data Model Changes
We need to track two new pieces of information in the `BookMetadata` interface:
- `fileHash` (string): A SHA-256 hash of the original EPUB file. This is essential for verifying that the file being restored is identical to the one that was offloaded.
- `isOffloaded` (boolean): A flag indicating whether the binary content in the `files` store has been deleted.

### 2. Ingestion Updates (`src/lib/ingestion.ts`)
- During `processEpub`, calculate the SHA-256 hash of the `ArrayBuffer` before storing.
- Save this `fileHash` in the `BookMetadata`.

### 3. Store Updates (`src/store/useLibraryStore.ts`)
- **`offloadBook(id: string)`**:
  - Retrieve the book metadata.
  - If `fileHash` is missing (legacy books), calculate it from the stored file and update metadata.
  - Delete the entry from the `files` object store.
  - Update the book metadata to set `isOffloaded = true`.
  - Refresh the library state.

- **`restoreBook(id: string, file: File)`**:
  - Calculate SHA-256 hash of the provided file.
  - Compare with the stored `fileHash`.
  - If they match:
    - Save the file content to the `files` object store.
    - Update book metadata: `isOffloaded = false`.
    - Refresh library.
  - If they don't match:
    - Throw an error or return failure status to UI.

### 4. UI Updates
- **`BookCard.tsx`**:
  - Add a context menu or button to trigger "Offload" (Delete File).
  - If `isOffloaded` is true:
    - Visual indicator (e.g., "Cloud" icon or "Archived" badge).
    - Clicking the book (or the "Read" button) should trigger the Restore flow instead of opening the reader.
- **Restore Flow**:
  - A dialog prompting the user to select the file again.
  - Handling the file selection and calling `restoreBook`.
  - Success/Error feedback via Toast.

### 5. Migration Strategy
- For existing books without a hash, the hash will be generated lazily when the user attempts to `offloadBook`.
- If a user tries to restore a legacy book that was offloaded (if we allowed offloading without hash - which we shouldn't), it would be problematic. So we enforce hash generation at the moment of offloading.

## Detailed Steps

1.  **Modify `BookMetadata`**: Add `fileHash` and `isOffloaded` in `src/types/db.ts`.
2.  **Update `processEpub`**: Implement hashing using `crypto.subtle.digest`.
3.  **Update `useLibraryStore`**: Implement `offloadBook` and `restoreBook`.
    - Note: `offloadBook` logic needs to handle the "calculate hash if missing" case.
4.  **UI Implementation**:
    - Add "Delete File" action to `BookCard`.
    - Add "Restore" handling to `BookCard`.
    - Use a hidden file input or a Dialog for restoration.
5.  **Verification**:
    - Create `verification/test_journey_smart_delete.py` to verify the full flow.

## Technical Details

- **Hashing**: Use `crypto.subtle.digest('SHA-256', arrayBuffer)`. Convert the result to a hex string.
- **IndexedDB**: The `files` store uses `bookId` as the key. `offloadBook` will `delete` this key. `restoreBook` will `add` or `put` it back.
