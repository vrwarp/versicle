# Phase 3: Search Refactor

**Objective**: Modernize the Worker communication layer.

## 1. Component Design: Search IPC (Comlink)

**Current State:** The `SearchClient` manually manages the communication with `SearchWorker` using `postMessage`, UUIDs, and a `Map` of pending promises.

**Problem:** Custom RPC layers are boilerplate-heavy, error-prone, and difficult to maintain type safety across the worker boundary.

**Proposed Design: Comlink**
Adopt a standard library like `comlink` (or a lightweight wrapper) to expose the Worker API as if it were a local class instance.

```typescript
// search.worker.ts
import * as Comlink from 'comlink';

class SearchEngine {
  indexBook(id: string, content: string) { ... }
  search(query: string) { ... }
}

const searchEngine = new SearchEngine();
Comlink.expose(searchEngine);

// search.ts
import * as Comlink from 'comlink';
const worker = new Worker(new URL('./workers/search.worker.ts', import.meta.url));
// The type wrapper ensures strict type safety for all method calls
const searchEngine = Comlink.wrap<SearchEngine>(worker);

// Usage becomes trivial:
await searchEngine.indexBook(bookId, content);
```

**Impact:**

-   **Type Safety**: Automatic TypeScript support across the worker boundary.
-   **Code Reduction**: Removes 50+ lines of custom message handling.
-   **Robustness**: Relies on a battle-tested library for message passing.

## 2. Implementation Plan

### Steps

1.  **Install Dependency**:
    *   Add `comlink` to the project (it is very small, < 1kb compressed).

2.  **Rewrite `search.worker.ts`**:
    *   Remove the `onmessage` switch statement.
    *   Expose the `SearchEngine` class (or relevant functions) using `Comlink.expose`.

3.  **Rewrite `search.ts`**:
    *   Remove the custom `postMessage` wrapping logic, UUID generation, and promise map.
    *   Initialize the worker and wrap it using `Comlink.wrap`.
    *   Update method calls to use the proxied object.

### Validation

*   **Functional Test**: Verify search results are returned correctly.
*   **Type Check**: Ensure TypeScript types properly infer method signatures across the boundary (try changing a method signature in the worker and see if the client code flags an error).
