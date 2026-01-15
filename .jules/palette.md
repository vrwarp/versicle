## 2024-05-23 - Accessibility of Library Search & Sort
**Learning:** Even with "semantic" components like Radix UI, explicit linkage via `aria-labelledby` or `htmlFor` is critical when composed in non-standard ways (like "Sort by:" text next to a Select trigger).
**Action:** When placing labels next to custom triggers, always ensure an `id` linkage exists, don't assume proximity is enough.
