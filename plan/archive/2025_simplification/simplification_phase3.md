# Phase 3: Search Refactor

**Status**: ✅ Completed

**Objective**: Modernize the Worker communication layer.

## 1. Component Design: Search IPC (Comlink)

**Previous State:**
-   `src/lib/search.ts` (`SearchClient`): Manually managed `postMessage`, `UUID` generation, and a `pendingRequests` Map.
-   `src/workers/search.worker.ts`: Used a large `switch` statement in `onmessage` to route commands.

**Problem:** Boilerplate-heavy, error-prone, and lacks type safety across the boundary.

**Implemented Design: Comlink**
Used `comlink` to expose the `SearchEngine` class directly and wrapped it in `src/lib/search.ts`.

```typescript
// search.worker.ts
import * as Comlink from 'comlink';
import { SearchEngine } from '../lib/search-engine';

const engine = new SearchEngine();
Comlink.expose(engine);
```

```typescript
// search.ts (simplified)
import * as Comlink from 'comlink';
import type { SearchEngine } from './search-engine';

// Worker instantiation and wrapping
const worker = new Worker(new URL('../workers/search.worker.ts', import.meta.url), { type: 'module' });
const engine = Comlink.wrap<SearchEngine>(worker);

// SearchClient delegates to engine methods
async indexBook(bookId, sections) {
    await engine.initIndex(bookId);
    // ... extraction logic ...
    await engine.addDocuments(bookId, sections);
}
```

## 2. Implementation Plan

### Steps

1.  **Dependencies**: Added `comlink` to `package.json`. ✅

2.  **Refactor `src/workers/search.worker.ts`**: ✅
    *   Deleted the `self.onmessage` switch block.
    *   Exposed `engine` using `Comlink.expose(engine)`.

3.  **Refactor `src/lib/search.ts`**: ✅
    *   Deleted `SearchClient` complexity (pending map, send method, manual `postMessage`).
    *   Instantiated worker and wrapped with `Comlink.wrap`.
    *   Updated `indexBook` and `search` to use the wrapped proxy.
    *   Preserved text extraction and batching logic in `indexBook` to maintain performance and responsibility separation.

### Validation

*   **Functional Test**: Verified search queries return expected results using `src/lib/search.test.ts` and `src/lib/search.repro.test.ts` (updated to mock Comlink). ✅
*   **Playwright Verification**: Ran `verification/test_journey_search.py` successfully. ✅
*   **Type Safety**: TypeScript correctly infers arguments for `searchEngine.search` and `searchEngine.addDocuments`. ✅
