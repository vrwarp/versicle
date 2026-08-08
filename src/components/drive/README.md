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

## Importing a file the library already holds

A filename the library already holds is a *question*, not an error. The import
pipeline gates on `sourceFilename` (`ImportOrchestrator.findExistingBookIdByFilename`)
and answers a hit with `DuplicateBookError`; the shelf turns that into the same
`ReplaceBookDialog` the library's own upload flows use, and confirming re-imports
with `{ overwrite: true }` — the Replace path, which keeps the existing book's
progress, notes and tags.

The shelf asks *before* downloading whenever its own inventory-backed filename
set already knows the name (the "In library" badge's source, and the same
inventory the gate reads), so a cancelled prompt costs no bandwidth. The
`DuplicateBookError` catch remains as the backstop for the gate's other half,
the DB filename index, which the projection can lag behind.

`DrivePreviewSheet` distinguishes the two dedup signals for the same reason: a
**filename** match predicts the Replace prompt, while a **title-only** match
really does import as a separate entry.

## Back navigation

Both shelf sheets register a `useNavigationGuard` at `BackButtonPriority.MODAL`,
matching what `LibraryView` does for its own dialogs — the shelf renders inside
it, so without them a back press left `/drive` with a sheet open on top of it.
The replace prompt's guard is inert while the replace is in flight: the dialog
refuses its own close there, and back must not undercut that (nor, by
registering nothing, fall through to leaving the route).

## Folder linking

*   **`DriveFolderPicker.tsx`** / **`useDriveBrowser.ts`**: the folder browser
    used from Drive settings to pick the folder the shelf indexes.
