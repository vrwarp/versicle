## 2025-05-23 - [Virtualization & Prop Stability]
**Learning:** When implementing virtualization with `react-window`, if the item renderer (e.g., `GridRow`) is defined inline within the component, it is re-created on every render. This causes the virtualized list to re-render unnecessarily because the `children` prop changes.
**Action:** Always wrap the item renderer in `useCallback` or move it outside the component if possible. If it depends on state (like `filteredAndSortedBooks`), `useCallback` is the correct approach.
