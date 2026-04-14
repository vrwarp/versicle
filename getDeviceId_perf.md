The `getDeviceId()` function in `src/lib/device-id.ts` currently reads from `localStorage` every time it is called:

```javascript
export const getDeviceId = (): string => {
    // Check if we already have a device ID
    let deviceId = localStorage.getItem(DEVICE_ID_KEY);
    // ...
```

Since it's called in many hot paths (including Zustand selectors that run frequently, like `resolveProgress` in `useAllBooks` and inside `useReadingStateStore`), reading from `localStorage` synchronously on every call is a measurable performance hit.

We can optimize this by caching the device ID in a module-level variable after the first read.
