## 2024-05-23 - [Memoizing Virtualized List Props]
**Learning:** `react-window` components are highly optimized (PureComponent/memo), but passing a new object reference as `itemData` (or custom props like `cellProps` in this codebase) defeats this optimization, causing the ENTIRE grid to re-render on every parent render.
**Action:** Always memoize object props passed to `react-window` components (e.g. `itemData`, `data`, or custom props) using `useMemo` to ensure referential equality when the underlying data hasn't changed.
