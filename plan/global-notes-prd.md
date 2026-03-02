# Global Notes & Annotations — Product Requirements Document

## 1. Executive Summary

**Objective:** Transform Versicle from a transient consumption tool into a persistent knowledge management system by exposing user-generated annotations (highlights and notes) in a globally accessible, searchable, and exportable view.

**Rationale:** Power readers extract knowledge — forcing users to open individual books to recall a specific highlight introduces unnecessary friction. A centralized knowledge base maximizes the value of the existing Yjs-synchronized `useAnnotationStore`.

**Scope:** Client-side only. No new backend, database schemas, or sync protocols. All data already lives in the Yjs-synced annotation store.

---

## 2. User Stories

| # | As a... | I want to... | So that... |
|---|---------|-------------|-----------|
| 1 | Power reader | View all my highlights and notes across all books in one place | I can review my extracted knowledge without hunting through individual books |
| 2 | Student | Search across all my annotations by keyword | I can quickly find that one highlight I remember vaguely |
| 3 | Researcher | Export all notes from a specific book as Markdown | I can import them into my PKM tool (Obsidian, Notion, etc.) |
| 4 | Casual reader | Click on a highlight and be teleported to that exact location in the book | I have zero-friction context recovery |
| 5 | Multi-device user | See annotations from all my devices in the global view | Cross-device sync "just works" for notes too |

---

## 3. Functional Requirements

### 3.1 Context Switcher (Navigation)

| Req ID | Requirement | Priority |
|--------|------------|----------|
| NAV-1 | Replace the static "My Library" header with an interactive context switcher dropdown: `Library ▼` | P0 |
| NAV-2 | Dropdown options: **Library** (default), **Notes** | P0 |
| NAV-3 | Selecting "Notes" swaps `<LibraryView />` for `<GlobalNotesView />` | P0 |
| NAV-4 | Library-specific header actions (Import Book, Grid/List toggle, Sort, Filter) hide when in Notes context | P0 |
| NAV-5 | The context switcher must preserve its state across browser back/forward | P1 |

### 3.2 Global Notes View

| Req ID | Requirement | Priority |
|--------|------------|----------|
| GNV-1 | Full-width search bar, sticky below the header, filtering against `text` and `note` fields | P0 |
| GNV-2 | Annotations grouped by `bookId` into "Book Blocks" (not a flat feed) | P0 |
| GNV-3 | Book Blocks sorted by most recently created annotation (descending) | P0 |
| GNV-4 | Within each Book Block: annotations sorted by `created` timestamp ascending | P0 |
| GNV-5 | Each Book Block header: mini cover (from `coverBlob` or gradient from `coverPalette`), title, author | P0 |
| GNV-6 | Each Book Block header: "Export" action button for Markdown export | P1 |
| GNV-7 | Each Annotation Card: highlighted text (italic, left-border matching `color`), optional note, date | P0 |

### 3.3 Annotation Interactions

| Req ID | Requirement | Priority |
|--------|------------|----------|
| INT-1 | Primary click on an annotation deep-links to the book at the exact CFI location | P0 |
| INT-2 | Secondary actions: "Copy (Markdown)", "Edit Note", "Delete" via ellipsis menu (mobile) or hover buttons (desktop) | P1 |
| INT-3 | Edit Note: inline editing with save/cancel, updates `useAnnotationStore` | P1 |
| INT-4 | Delete: confirmation prompt, then removes via `useAnnotationStore.remove()` | P1 |

### 3.4 Export

| Req ID | Requirement | Priority |
|--------|------------|----------|
| EXP-1 | Per-book Markdown export: generates a `.md` file with blockquoted highlights and notes | P1 |
| EXP-2 | File auto-downloads with sanitized filename: `{title}_notes.md` | P1 |

### 3.5 Deep Linking

| Req ID | Requirement | Priority |
|--------|------------|----------|
| DL-1 | Clicking an annotation navigates to `/read/{bookId}?cfi={encodedCfiRange}` | P0 |
| DL-2 | `ReaderView` reads `?cfi=` param and uses it as `initialLocation`, overriding saved progress | P0 |
| DL-3 | Deep-linking must work even if the book requires reprocessing (redirect to reprocessing flow first) | P2 |

---

## 4. Edge Cases & Error States

| Scenario | Expected Behavior |
|----------|-------------------|
| **Zero annotations** | Centered empty state: "No annotations yet. Read a book and select text to create highlights and notes." |
| **Ghost Books** (deleted book, annotations remain) | Book Block falls back to title/author from `UserInventoryItem` if available, else "Unknown Book". Data is never hidden. |
| **Offloaded Books** | Annotation card click triggers the ContentMissingDialog restore flow before opening reader |
| **Stale CFI** (book reprocessed, CFI may have shifted) | Best-effort navigation; if `rendition.display(cfi)` fails, show toast: "Could not find the exact location." |
| **Large corpus** (thousands of annotations) | Pipeline is `useMemo`-memoized; search input is debounced (300ms) |

---

## 5. Success Metrics

| Metric | Target |
|--------|--------|
| Notes View load time (≤500 annotations) | < 100ms |
| Search-to-result latency | < 50ms (debounce excluded) |
| Annotation click → reader display | Same as current book-open latency |
| User engagement: % of readers with >5 annotations who visit Notes View within 7 days | > 40% |

---

## 6. Out of Scope (Phase 1)

- Tag/folder organization for annotations
- Cross-book annotation merge or deduplication
- AI-powered annotation summaries
- Annotation sharing/collaboration
- CFI-sequential sorting (requires epub.js engine, too expensive without the book loaded)
