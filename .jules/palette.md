## 2025-04-18 - Search Clear Button ARIA Label Standardization
**Learning:** Found multiple instances where the "clear" button for search inputs used `aria-label="Clear query"`. "Query" is a technical term that can be confusing for non-technical users relying on screen readers. "Search" is the universally understood terminology.
**Action:** Standardized all search clear buttons to use `aria-label="Clear search"`. Will proactively look for jargon in ARIA labels in the future.
