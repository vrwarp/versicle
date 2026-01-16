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

## 2. Current Implementation Analysis & Investigation Findings

We have analyzed the existing stores in `src/store/` and investigated the `zustand-middleware-yjs` implementation.

### Investigation Result: Deep Diffing Supported
Our analysis of `node_modules/zustand-middleware-yjs/dist/yjs.mjs` confirms that the middleware performs **deep diffing and recursive patching**.
*   It does **not** blindly replace top-level objects with JSON blobs.
*   It converts nested objects into nested `Y.Map` instances.
*   **Conclusion:** If Device A updates `book.rating` and Device B updates `book.tags`, the middleware will merge these changes correctly. The previously feared "Object-level LWW" risk is **resolved**.

### Remaining Risk: Scalar LWW
While object merging works for distinct fields, conflicting updates to the *same* scalar field (e.g., `percentage`) still suffer from Last-Write-Wins (LWW).

#### Scenario 1: Reading Progress (High Frequency)
*   **Issue:** Device A (50%) vs Device B (10%). LWW might overwrite the "furthest read" point with the "latest timestamp" point (which could be the 10% on Device B).
*   **Mitigation:** Per-Device tracking (Multi-Value Register).

#### Scenario 2: Reading List (Composite Data)
*   **Issue:** `ReadingListEntry` contains `percentage`, `status`, `rating`.
    *   *Conflict:* Device A updates `percentage` (reading). Device B updates `rating` (reviewing).
    *   *Resolution:* Middleware handles this (Field-level LWW). We get `percentage` from A and `rating` from B. Correct.
    *   *Conflict:* Device A reads to 50%. Device B reads to 52%.
    *   *Resolution:* Standard LWW. The latest write wins. This is generally acceptable for history/list views, unlike the granular position saving needed for resuming a book.

## 3. Mitigation Strategy: Hybrid Approach

We will apply different strategies based on the data type and conflict risk.

### Strategy A: Per-Device Tracking (Reading Progress)
*   **Target:** `useReadingStateStore`.
*   **Problem:** Scalar LWW on `percentage`/`cfi` causes regression.
*   **Solution:** Store progress per-device.
    ```typescript
    progress: Record<bookId, Record<deviceId, UserProgress>>
    ```
*   **Read Logic:** `useBookProgress` selector aggregates all device entries and returns the one with the **highest percentage**.
*   **Write Logic:** Only write to `progress[bookId][currentDeviceId]`.

### Strategy B: Granular Field Merging (Reading List & Library)
*   **Target:** `useReadingListStore` and `useLibraryStore`.
*   **Problem:** Concurrent edits to *different* fields (e.g., `status` vs `rating`).
*   **Solution:** Rely on `zustand-middleware-yjs`'s deep diffing.
    *   `entries` will be a Y.Map.
    *   Each `ReadingListEntry` will be a nested Y.Map.
*   **Result:** Field-level LWW. This is sufficient. We **do not** need per-device tracking here because `ReadingListEntry` is a summary, not a precision state.

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
    *   Configure `maxWaitFirestoreTime` to **2000ms** to debounce high-frequency progress updates.

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
            connectFireProvider(user.uid);
        } else {
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
            maxWaitFirestoreTime: 2000,
            maxUpdatesThreshold: 50
        });
    } catch (e) {
        Logger.error('Sync', 'Failed to connect', e);
    }
};

const disconnectFireProvider = () => {
    if (fireProvider) {
        fireProvider.destroy();
        fireProvider = null;
    }
};
```

## 6. Risks & Mitigations

| Risk | Mitigation |
| :--- | :--- |
| **High Firestore Costs** | `maxWaitFirestoreTime: 2000` is mandatory. |
| **Data Growth (Progress)** | Per-device entries grow over time. **Action:** Implement "Pruning" logic in `SyncManager` to delete entries older than 6 months. |
| **Object LWW (Library/List)** | **Resolved:** Middleware supports deep merging. Distinct field updates merge cleanly. |
| **Scalar LWW (Library/List)** | Conflict on same field (e.g. rating) uses LWW. Accepted behavior. |

## 7. Verification Plan

1.  **Unit Tests:** Verify `SyncManager` auth handling.
2.  **Field Merge Test:**
    *   Device A: `updateEntry('file.epub', { rating: 5 })`
    *   Device B: `updateEntry('file.epub', { status: 'read' })`
    *   Verify result: `{ rating: 5, status: 'read' }`.
3.  **Progress Conflict Test:**
    *   Simulate Device A writing `progress[id][A] = 50%`.
    *   Simulate Device B writing `progress[id][B] = 10%`.
    *   Verify selector `useBookProgress` returns 50% (Max Strategy).
