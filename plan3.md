Wait, if `FileUploader` uses `isImporting` to hide the dropzone, it does need `isImporting`. But by using `useShallow`, it will only re-render when `isImporting` changes, not when the progress values change!

Wait, let's see if there are other fast moving states.
What about `GeneralSettingsTab.tsx`?
```tsx
  const {
    isImporting,
    importProgress,
    importStatus,
    uploadProgress,
    uploadStatus
  } = useLibraryStore();
```
It does the EXACT same thing! We should fix `GeneralSettingsTab.tsx` too!
