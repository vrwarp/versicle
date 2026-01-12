# Phase 1: Foundation & Dependencies

**Goal:** Initialize the Yjs runtime, set up the persistence layer, and establish the singleton provider pattern.

## 1. Install Dependencies
*   **Package:** `yjs`
    *   *Version:* Latest stable.
*   **Package:** `zustand-middleware-yjs`
    *   *Source:* **Fork required.** Use `https://github.com/vrwarp/zustand-middleware-yjs`.
    *   *Reason:* Upstream does not support Zustand v4/v5 state updates correctly.
*   **Package:** `y-indexeddb`
    *   *Version:* Latest stable.
*   **Action:** Run `npm install yjs y-indexeddb https://github.com/vrwarp/zustand-middleware-yjs`.

## 2. Create Yjs Provider Singleton

**File:** `src/store/yjs-provider.ts`

**Specifications:**
1.  **Imports:** `Y` from `yjs`, `IndexeddbPersistence` from `y-indexeddb`.
2.  **Singleton Instance:**
    *   Create a global `Y.Doc` instance.
    *   Name the persistence instance `'versicle-yjs'` (distinct from `EpubLibraryDB` / `versicle-db`).
3.  **Exported Members:**
    *   `yDoc`: The shared `Y.Doc`.
    *   `provider`: The `IndexeddbPersistence` instance.
    *   `waitForYjsSync()`: A promise-based helper that resolves when `provider.on('synced')` fires.
4.  **Error Handling:**
    *   Log any persistence errors to the console (or `Logger`).

**Code Skeleton:**
```typescript
import * as Y from 'yjs';
import { IndexeddbPersistence } from 'y-indexeddb';

export const yDoc = new Y.Doc();

// Persist to IndexedDB
export const persistence = new IndexeddbPersistence('versicle-yjs', yDoc);

persistence.on('synced', () => {
  console.log('✅ Yjs content loaded from IndexedDB');
});

export const waitForYjsSync = (): Promise<void> => {
    if (persistence.synced) return Promise.resolve();
    return new Promise(resolve => {
        persistence.once('synced', () => resolve());
    });
};
```

## 3. Test Helper for Yjs

**Goal:** Create a helper to easily instantiate stores with fresh Yjs docs for testing.

**File:** `src/test/yjs-test-utils.ts`

```typescript
import * as Y from 'yjs';

export const createTestDoc = () => {
    return new Y.Doc();
};

export const createTestStore = <T>(factory: (doc: Y.Doc) => T) => {
    const doc = createTestDoc();
    return factory(doc);
};
```

## 4. Validation Script

**Goal:** Verify data persists across reloads without touching existing logic.

1.  **Create Test Component:** `src/components/debug/YjsTest.tsx`.
2.  **Logic:**
    *   Import `yDoc`.
    *   Read/Write to `yDoc.getMap('debug')`.
    *   Display value.
3.  **Manual Test:**
    *   Set value "Hello V2".
    *   Reload Page.
    *   Verify "Hello V2" appears.
    *   Verify `versicle-yjs` database exists in DevTools > Application > IndexedDB.
4.  **Cleanup:** Delete test component after verification.
