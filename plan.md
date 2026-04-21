1. **Analyze Re-renders**:
   The `FileUploader` uses `useLibraryStore()` directly without `useShallow` for selecting `importProgress`, `uploadProgress`, etc. Because `importProgress` rapidly changes (0 to 100 on every chunk), it causes `FileUploader` to re-render constantly.
   Similarly, `GlobalSettingsDialog` subscribes to the whole `useLibraryStore()` just to get `importProgress`, `uploadProgress` etc. and passes them to `GeneralSettingsTab`.

   These are exact examples of "Probe React Render Granularity":
   > "Are rapid state changes (like a playing TTS timestamp or a download progress bar) causing massive parent containers to re-render? The Fix: Isolate the fast-moving state into tiny, self-subscribing components (e.g., a <ProgressBar /> that selects its own Zustand state), leaving the parent tree completely static."

2. **The Fix**:
   - Create a new component `<ImportProgressOverlay />` that isolates `useLibraryStore` logic for fast-moving state (`importProgress`, `uploadStatus`, etc.).
   - Replace the explicit progress rendering blocks in `FileUploader.tsx` with `<ImportProgressOverlay />`.
   - Update `FileUploader.tsx` to ONLY subscribe to `isImporting`, `addBook`, `addBooks` via `useShallow`.
   - Replace the explicit progress rendering blocks in `GeneralSettingsTab.tsx` with `<ImportProgressOverlay />`.
   - Update `GlobalSettingsDialog.tsx` to ONLY subscribe to `isImporting`, `addBooks` via `useShallow`. Remove progress props from `GeneralSettingsTab`.

3. **Pre-commit**: Complete pre-commit steps to ensure proper testing, verification, review, and reflection are done.

4. **Submit**: Create PR.
