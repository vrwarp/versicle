# Design Document: Cloud Sync via Firestore (y-fire)

**Status:** Draft
**Objective:** Enable cross-device synchronization of user data (progress, annotations, library metadata) using Firestore as a relay and persistence layer, while strictly maintaining `IndexedDB` (`y-indexeddb`) as the primary local-first storage.

## 1. Architecture: Dual Provider Overlay

Versicles is a **Local-First** application. The existing `yjs-provider.ts` initializes the `Y.Doc` and connects it to `y-indexeddb` immediately on startup. This ensures offline capability and fast load times.

We will introduce `y-fire` as a **Secondary, Conditional Provider** that acts as a "Cloud Overlay".

```mermaid
graph TD
    A[Zustand Stores] <-->|Middleware| B(Y.Doc Memory)
    B <-->|y-indexeddb| C[(IndexedDB 'versicle-yjs')]
    B <-->|y-fire| D[Firestore & WebRTC Peers]

    subgraph Local Device (Always Active)
    A
    B
    C
    end

    subgraph Cloud Overlay (Auth Only)
    D
    end
```

### Roles
*   **y-indexeddb:** Primary. Always active. Source of truth for offline state.
*   **y-fire:** Secondary. Active **only** when authenticated and online. Syncs local `Y.Doc` changes to Firestore.

## 2. Current Implementation Analysis

We have analyzed the existing stores in `src/store/` to identify what will be synced and the associated risks.

### Synced Stores (via `zustand-middleware-yjs`)
These stores are already wrapped with `yjs()` middleware and writing to the shared `Y.Doc`.

| Namespace | Store | Content | Risk Analysis |
| :--- | :--- | :--- | :--- |
| `library` | `useLibraryStore` | `books: Record<string, UserInventoryItem>` | **Medium Risk.** `UserInventoryItem` is synced as a whole object. If Device A updates `rating` and Device B updates `tags` simultaneously, **Last-Write-Wins (LWW) will overwrite one change**. Acceptable for single-user scenarios. |
| `progress` | `useReadingStateStore` | `progress: Record<string, UserProgress>` | **High Risk (Cost).** Updates occur frequently (e.g., every page turn via `updateLocation`). `UserProgress` contains `completedRanges` which can grow large. **Mitigation:** Aggressive debouncing in `y-fire` config. |
| `annotations` | `useAnnotationStore` | `annotations: Record<string, UserAnnotation>` | **Low Risk.** Keyed by UUID. Set semantics work well here. |
| `reading-list` | `useReadingListStore` | `entries: Record<string, ReadingListEntry>` | **Low Risk.** Similar LWW constraints as Library. |
| `preferences` | `usePreferencesStore` | Theme, Font, etc. | **Low Risk.** Infrequent updates. |

### Ghost Book Support
The codebase is **already prepared** for the Ghost Book scenario (Metadata present, Blob missing).
*   `useLibraryStore.hydrateStaticMetadata` only populates `staticMetadata` if the blob exists in IDB.
*   `src/store/selectors.ts` (`useAllBooks`) gracefully handles missing static metadata, returning `undefined` for `coverBlob` while falling back to the synced `UserInventoryItem` for `title` and `author`.

## 3. LWW Mitigation Strategy

The primary disadvantage of the current `Record<string, Object>` structure in Zustand is that Yjs treats the `Object` as an atomic unit when syncing via the middleware's Map implementation (unless deeply nested proxies are used, which `zustand-middleware-yjs` has specific behavior for).

**Problem:** If Device A updates `book.rating` and Device B updates `book.tags` for the same book ID at the same time, the Last-Write-Wins (LWW) strategy will pick one object and discard the other's changes.

**Solution: Granular Y.Map Binding**

To mitigate this, we must ensure that `UserInventoryItem` properties are treated as individual keys in a Y.Map (or Subdoc), rather than a single JSON blob.

### 1. Refactoring Data Structures
Instead of:
```typescript
// Current: One big object per book
libraryMap.set('book-123', { rating: 5, tags: ['a'], status: 'read' })
```

We should structure the Yjs data as nested Maps:
```typescript
// Proposed: Nested Map for granular conflict resolution
const bookMap = new Y.Map();
bookMap.set('rating', 5);
bookMap.set('tags', ['a']);
libraryMap.set('book-123', bookMap);
```

### 2. Middleware Configuration
We need to verify if `zustand-middleware-yjs` automatically proxies nested objects to `Y.Map`.
*   **If Yes:** We are safe. The middleware handles deep merging.
*   **If No:** We must flatten the store or explicitly configure the middleware to handle deep observation.

**Investigation Plan:**
Check `zustand-middleware-yjs` documentation or source. Most modern wrappers support deep proxing. If not, we will refactor `useLibraryStore` actions to update specific fields rather than replacing whole objects:

*   **Bad:** `set({ books: { ...books, [id]: { ...book, rating: 5 } } })` (Replaces object)
*   **Good:** `set((state) => { state.books[id].rating = 5 })` (Requires Immer + Yjs Proxy support)

**Proposed Plan for Phase 4 (Refinement):**
1.  **Audit Middleware:** Confirm if it uses `y-utility/y-map` or deep proxies.
2.  **Explicit Merging:** If deep proxying is unreliable, we will implement a custom `merge` function in the store that manually reconciles fields (e.g., merging `tags` arrays) before committing to state.

## 4. Authentication & Security

### Strategy
*   **Provider:** Firebase Auth (Google Sign-In).
*   **Data Partitioning:** `users/${uid}/versicle/sync_root`.

### Firestore Rules
```javascript
rules_version = '2';
service cloud.firestore {
  match /databases/{database}/documents {
    match /users/{userId}/{document=**} {
      allow read, write: if request.auth != null && request.auth.uid == userId;
    }
  }
}
```

## 5. Implementation Plan

**Constraint:** Do not modify existing store logic. Implement `SyncManager` as an additive service.

### Step 1: Dependencies
*   Add `firebase` and `y-fire` to `package.json`.
*   Note: `y-fire` typically requires `yjs` and `firebase` as peers.

### Step 2: Firebase Configuration
Create `src/lib/sync/firebase-config.ts` to export initialized `auth` and `firestore`.

### Step 3: Sync Manager Service
Create `src/lib/sync/SyncManager.ts`.

**Responsibilities:**
1.  **Monitor Auth:** Listen to `onAuthStateChanged`.
2.  **Manage Connection:**
    *   **On Login:** Import `yDoc` from `src/store/yjs-provider.ts` and initialize `FireProvider`.
    *   **On Logout:** Call `provider.destroy()`.
3.  **Cost Control:**
    *   Configure `maxWaitFirestoreTime` to **2000ms** (or higher) to debounce high-frequency progress updates.
    *   This ensures that scrubbing a slider doesn't result in 50 Firestore writes.

**Code Sketch:**
```typescript
import { FireProvider } from 'y-fire';
import { yDoc } from '../../store/yjs-provider';
import { auth, app } from './firebase-config';
import { Logger } from '../logger';

let fireProvider: FireProvider | null = null;

export const initSyncService = () => {
    auth.onAuthStateChanged((user) => {
        if (user) {
            Logger.info('Sync', `User logged in: ${user.uid}`);
            connectFireProvider(user.uid);
        } else {
            Logger.info('Sync', 'User logged out');
            disconnectFireProvider();
        }
    });
};

const connectFireProvider = (uid: string) => {
    if (fireProvider) return;

    try {
        fireProvider = new FireProvider({
            firebaseApp: app,
            ydoc: yDoc,
            path: `users/${uid}/versicle/main`,
            // CRITICAL: Debounce writes to save costs/bandwidth
            maxWaitFirestoreTime: 2000,
            maxUpdatesThreshold: 50
        });

        fireProvider.on('synced', () => Logger.info('Sync', 'Cloud synced'));
        // y-fire might throw connection errors, need robust listeners
    } catch (e) {
        Logger.error('Sync', 'Failed to connect FireProvider', e);
    }
};

const disconnectFireProvider = () => {
    if (fireProvider) {
        fireProvider.destroy();
        fireProvider = null;
    }
};
```

### Step 4: UI Integration
*   Add a "Sync" section to the Settings page.
*   Show current Auth state and a "Sign In with Google" button.
*   (Future) Show sync status icon in the header.

## 6. Risks & Mitigations

| Risk | Mitigation |
| :--- | :--- |
| **High Firestore Costs** | `maxWaitFirestoreTime: 2000` is mandatory. Monitor usage during beta. |
| **Object LWW Data Loss** | **Action:** Implement "LWW Mitigation Strategy" (Section 3). Verify middleware deep proxy support. |
| **Large `completedRanges`** | If `UserProgress` grows > 1MB (Firestore document limit), sync will fail. **Future Action:** Implement compaction logic in `useReadingStateStore` to merge overlapping ranges. |
| **WebRTC Connection Limits** | `y-fire` uses WebRTC. On restricted networks (corporate/school), direct peering fails. It falls back to Firestore (slower, costlier). |

## 7. Verification Plan

1.  **Unit Tests:** Verify `SyncManager` correctly initializes/destroys provider on auth state mock changes.
2.  **Integration (Manual):**
    *   Open App in Simulator A (Logged In).
    *   Open App in Simulator B (Logged In, same account).
    *   Change Theme on A -> Verify B updates.
    *   Add Bookmark on A -> Verify B updates.
    *   Turn off Network on A -> Make changes -> Turn on -> Verify sync.
