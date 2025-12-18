## 2024-05-23 - [Memoizing Virtualized List Props]
**Learning:** `react-window` components are highly optimized (PureComponent/memo), but passing a new object reference as `itemData` (or custom props like `cellProps` in this codebase) defeats this optimization, causing the ENTIRE grid to re-render on every parent render.
**Action:** Always memoize object props passed to `react-window` components (e.g. `itemData`, `data`, or custom props) using `useMemo` to ensure referential equality when the underlying data hasn't changed.

## 2024-05-24 - [Zustand Selectors & Hidden Components]
**Learning:** React components using `useStore()` without selectors will re-render on ANY state change, even if they return `null` (hidden) or don't use the changed data. This is critical for components like `GestureOverlay` that are often hidden but subscribed to high-frequency stores.
**Action:** Always use granular selectors (e.g., `useStore(useShallow(state => ({ ... })))`) to prevent unnecessary re-renders, especially in components that subscribe to stores with frequent updates like `useReaderStore` (scroll position) or `useTTSStore` (playback progress).
