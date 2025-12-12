## 2025-12-12 - Custom Progress Indicators
**Learning:** Custom div-based progress bars were missing semantic roles, making them invisible to screen readers despite being a key part of the book card UI.
**Action:** Always wrap visual progress bars with `role="progressbar"` and include `aria-valuenow`, `aria-valuemin`, `aria-valuemax`, and `aria-label`.
