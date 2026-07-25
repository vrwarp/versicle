# Drive Components

The Google Drive surfaces: the shelf that browses the indexed Drive folder and
the pieces that link a folder or preview a file before importing it.

## The shelf (`/drive`)

`DriveLibraryView` is a full route context, not a dialog — the header dropdown
on the home page switches between My Library, Notes, Search and Google Drive,
and `LibraryView` renders this view (lazily) for the Drive one. It replaced the
old `DriveImportDialog`, which capped its list at 50 entries and had nowhere to
put cover art.

*   **`DriveLibraryView.tsx`**: search / filter / sort over the persisted Drive
    index, infinite scroll (a sentinel pages in `PAGE_SIZE` files at a time),
    and the import + refresh actions. Read-only over the index: only the
    explicit Refresh control triggers a Drive scan.
    *   `DriveLibraryView.test.tsx`: unit tests, including the assertions
        absorbed from the retired `DriveImportDialog` suite.
*   **`DriveBookCard.tsx` / `DriveBookListItem.tsx`**: the grid tile and list
    row, built to the same geometry as the library's `BookCard` /
    `BookListItem` so the shared layout toggle behaves identically in both
    contexts.
*   **`useInView.ts`**: the latching intersection hook both items use to
    hydrate their preview only once on screen.
*   **`useDrivePreview.ts`**: React access to the partial-fetch preview service
    (cover + verified metadata from ranged reads, device-local cache).
*   **`DrivePreviewSheet.tsx`**: the pre-import preview — cover, verified
    metadata, size, and a best-effort "already in your library" hint.

## Folder linking

*   **`DriveFolderPicker.tsx`** / **`useDriveBrowser.ts`**: the folder browser
    used from Drive settings to pick the folder the shelf indexes.
