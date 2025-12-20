# Phase 3: Search Refactor

**Objective**: Modernize the Worker communication layer.

## 1. Component Design: Search IPC (Comlink)

**Current State:**
-   `src/lib/search.ts` (`SearchClient`): Manually manages `postMessage`, `UUID` generation, and a `pendingRequests` Map.
-   `src/workers/search.worker.ts`: Uses a large `switch` statement in `onmessage` to route commands.

**Problem:** Boilerplate-heavy, error-prone, and lacks type safety across the boundary.

**Proposed Design: Comlink**
Use `comlink` to expose the `SearchEngine` class directly.

```typescript
// search.worker.ts
import * as Comlink from 'comlink';
import { SearchEngine } from '../lib/search-engine';

const engine = new SearchEngine();
Comlink.expose(engine);
```

```typescript
// search.ts
import * as Comlink from 'comlink';
// Define the type or interface of the exposed object
import type { SearchEngine } from './search-engine';

const worker = new Worker(new URL('../workers/search.worker.ts', import.meta.url), { type: 'module' });
const searchEngine = Comlink.wrap<SearchEngine>(worker);

// Usage:
await searchEngine.indexBook(bookId, sections);
```

## 2. Implementation Plan

### Steps

1.  **Dependencies**: Add `comlink` to `package.json`.

2.  **Refactor `src/workers/search.worker.ts`**:
    *   Delete the `self.onmessage` switch block.
    *   Expose `engine` using `Comlink.expose(engine)`.

3.  **Refactor `src/lib/search.ts`**:
    *   Delete `SearchClient` class complexity (pending map, send method).
    *   Instantiate worker and wrap with `Comlink.wrap`.
    *   Export the wrapped proxy.

### Validation

*   **Functional Test**: Verify search queries return expected results.
*   **Type Safety**: Ensure TypeScript correctly infers arguments for `searchEngine.search` and `searchEngine.indexBook`.
