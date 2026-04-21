Wait, if `FileUploader` uses `useLibraryStore()`, it subscribes to the ENTIRE state.
`const { addBook, addBooks, isImporting, importProgress, importStatus, uploadProgress, uploadStatus } = useLibraryStore();`
This means `FileUploader` re-renders every time ANY of those values change.
`importProgress` updates 100 times during an import.
`FileUploader` returns a large DOM.
Can we optimize `FileUploader`?
Actually, what about `LibraryView`?
It does this:
```
const books = useAllBooks();
```
Does `books` change on search keystrokes? No, `useAllBooks` is a hook that calls `useReadingStateStore`, etc. Wait, does it cause `LibraryView` to re-render?
In `LibraryView.tsx`:
```tsx
const searchQuery = useState(''); // debouncedSearchQuery
```
When `searchQuery` updates, `LibraryView` re-renders!
`LibraryView` contains:
```tsx
  const renderedGridItems = useMemo(() => { ... }, [filteredAndSortedBooks, ...]);
```
This memoizes the items, but the parent `LibraryView` still re-renders.

What about `LibraryView` and `importProgress`?
```tsx
  // OPTIMIZATION: Use useShallow to prevent re-renders when importProgress/uploadProgress changes
  const books = useAllBooks();
  const {
    isLoading,
    error,
    addBook,
    restoreBook,
    isImporting,
    sortOrder,
    setSortOrder,
    hydrateStaticMetadata
  } = useLibraryStore(useShallow(state => ({
```
Yes, `LibraryView` was already optimized for `importProgress`.

But wait, `FileUploader` STILL uses `useLibraryStore()` without `useShallow`!
And `FileUploader` renders:
```tsx
export const FileUploader: React.FC = () => {
  const {
    addBook,
    addBooks,
    isImporting,
    importProgress,
    importStatus,
    uploadProgress,
    uploadStatus
  } = useLibraryStore();
```
Is this the bottleneck? Yes, it is one. But it's only active during import.

Let's look at search keystrokes again:
"I believe mapping the entire library array on every search keystroke blocks the main thread."
But `LibraryView` does:
```tsx
  const debouncedSearchQuery = useDebounce(searchQuery, 300);
```
So it's already debounced.

Let's check "Probe React Render Granularity":
"Are rapid state changes (like a playing TTS timestamp or a download progress bar) causing massive parent containers to re-render? The Fix: Isolate the fast-moving state into tiny, self-subscribing components (e.g., a <ProgressBar /> that selects its own Zustand state), leaving the parent tree completely static."

Wait, `ReaderTTSController`! Let's check `ReaderTTSController.tsx`!
