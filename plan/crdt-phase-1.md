# Phase 1: Foundation & Dependencies

**Goal:** Initialize the Yjs runtime, set up the persistence layer, and establish the singleton provider pattern with robust validation and error handling.

## 1. Install Dependencies
*   **Package:** `yjs`
    *   *Version:* Latest stable.
*   **Package:** `zustand-middleware-yjs`
    *   *Source:* **Fork required.** Use `https://github.com/vrwarp/zustand-middleware-yjs`.
    *   *Reason:* Upstream does not support Zustand v4/v5 state updates correctly.
*   **Package:** `y-indexeddb`
*   **Package:** `zod` (Ensure latest stable is installed/available).
*   **Action:** Run `npm install yjs y-indexeddb zod https://github.com/vrwarp/zustand-middleware-yjs`.

## 2. Pre-flight Checks (Browser Compatibility)

Before initializing Yjs, we must ensure the environment supports IndexedDB.

**File:** `src/lib/sync/support.ts`
```typescript
export const isStorageSupported = (): boolean => {
    try {
        return typeof indexedDB !== 'undefined';
    } catch (e) {
        return false;
    }
};
```

## 3. Create Yjs Provider Singleton

**File:** `src/store/yjs-provider.ts`

**Specifications:**
1.  **Imports:** `Y` from `yjs`, `IndexeddbPersistence` from `y-indexeddb`.
2.  **Singleton Instance:**
    *   Create a global `Y.Doc` instance.
    *   Name the persistence instance `'versicle-yjs'`.
3.  **Exported Members:**
    *   `yDoc`: The shared `Y.Doc`.
    *   `persistence`: The `IndexeddbPersistence` instance.
    *   `waitForYjsSync(timeoutMs?: number)`: A robust helper.
4.  **Error Handling:**
    *   Listen to `persistence.on('error', ...)` and log to `Logger`.

**Code Skeleton:**
```typescript
import * as Y from 'yjs';
import { IndexeddbPersistence } from 'y-indexeddb';
import { Logger } from '../lib/logger';

export const yDoc = new Y.Doc();

let persistence: IndexeddbPersistence | null = null;

if (typeof window !== 'undefined' && window.indexedDB) {
    persistence = new IndexeddbPersistence('versicle-yjs', yDoc);
    persistence.on('synced', () => Logger.info('Yjs', 'Content loaded from IndexedDB'));
}

export const waitForYjsSync = (timeoutMs = 5000): Promise<void> => {
    if (!persistence || persistence.synced) return Promise.resolve();
    return new Promise((resolve, reject) => {
        const timer = setTimeout(() => {
            Logger.warn('Yjs', 'Sync timeout reached');
            resolve(); // Resolve anyway to allow app to start, though maybe degraded
        }, timeoutMs);

        persistence!.once('synced', () => {
            clearTimeout(timer);
            resolve();
        });
    });
};
```

## 4. Schema Validation (Early Integration)

**Goal:** Ensure data written to Yjs matches our expected types.

**File:** `src/lib/sync/validators.ts`
*   Define Zod schemas matching `UserInventoryItem`, `UserProgress`, etc.
*   Export a `validateYjsUpdate` helper.

## 5. Monitoring & Debugging

**Goal:** Visibility into the CRDT state.

**File:** `src/lib/sync/YjsMonitor.ts`
*   Utility to calculate `yDoc.encodeStateVector().byteLength`.
*   Log the number of keys in various `Y.Map` instances.

**File:** `src/components/debug/YjsTest.tsx` (Internal Debug Tool)
*   Display sync status (Connected/Synced).
*   Buttons to "Simulate Conflict" or "Clear Yjs Cache" (for recovery).

## 6. Recovery Strategy

If the local Yjs database becomes corrupted or inconsistent:
*   Implement a `resetYjsPersistence()` function that destroys the `IndexeddbPersistence` instance and deletes the `versicle-yjs` IndexedDB database.
*   This triggers a clean pull from either the legacy stores (manual migration) or the cloud (future sync).

## 7. Validation Script (Updated)

1.  **Test Component:** Use `src/components/debug/YjsTest.tsx`.
2.  **Logic:**
    *   Write complex object -> Refresh -> Verify integrity via Zod.
    *   Verify `versicle-yjs` exists via DevTools.
    *   Test `waitForYjsSync` by mocking a delay.

