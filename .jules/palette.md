## 2024-05-24 - Clear Buttons on Search Inputs
**Learning:** Added clear buttons (X) to search inputs in DriveImportDialog, ReassignBookDialog, and SearchPanel to improve usability and follow existing design patterns (like LibraryView). The `pr-9` class is needed on the `Input` when a clear button is present to prevent text from overlapping the absolute-positioned button.
**Action:** When adding search inputs in the future, always include a clear button using the `Button` with `size="icon"` and `variant="ghost"`, and ensure the input has proper right-padding when the button is visible.
