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

### Remaining Risk: Scalar LWW (Progress Regression)
While object merging works, **Scalar** values (like `percentage` or `currentCfi`) still suffer from Last-Write-Wins (LWW).
*   **Scenario:**
    1.  User reads to **50%** on Device A. Goes offline.
    2.  User reads to **10%** on Device B (re-reading).
    3.  Device A comes online.
    4.  If Device B's update (10%) has a later timestamp (or arbitrarily wins), Device A's progress (50%) is overwritten.
*   **Impact:** User loses their "furthest read" location.

## 3. Mitigation Strategy: Per-Device Progress Tracking

To solve the Scalar LWW issue for reading progress, we will switch from a "Shared Register" model to a "Multi-Value Register" (per-device) model.

### 1. Schema Refactoring
Instead of storing a single `UserProgress` object per book, we will store a map of progress objects keyed by `deviceId`.

**Current Schema:**
```typescript
progress: Record<bookId, UserProgress>
```

**Proposed Schema:**
```typescript
progress: Record<bookId, Record<deviceId, UserProgress>>
```

### 2. Device ID Management
*   Generate a stable `deviceId` (UUID) on first app launch.
*   Store it in `localStorage` (not synced).

### 3. Read-Side Aggregation (Selector Logic)
The `useBookProgress` selector will become smart. Instead of returning a raw object, it will aggregate all device entries for a book and return the "best" one.

**Logic:**
1.  Fetch all entries: `state.progress[bookId]`.
2.  Values: `[Progress(DevA, 50%, TS=100), Progress(DevB, 10%, TS=120)]`.
3.  **Strategy:** Return the entry with the **highest percentage** (or latest timestamp, user preference).
    *   *Default:* Max Percentage Wins (prevents regression).
4.  UI sees a single, coherent progress state.

### 4. Write-Side Isolation
*   `updateLocation(bookId, ...)` only writes to `state.progress[bookId][currentDeviceId]`.
*   **Result:** No write conflicts. Device A never overwrites Device B's entry.

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
| **Data Growth** | Per-device entries grow over time. **Action:** Implement "Pruning" logic in `SyncManager` to delete entries older than 6 months. |
| **Object LWW** | **Resolved:** Middleware supports deep merging. |
| **WebRTC Blocking** | `y-fire` falls back to Firestore automatically. |

## 7. Verification Plan

1.  **Unit Tests:** Verify `SyncManager` auth handling.
2.  **Granularity Test:** Write a test confirming that modifying `fieldA` on one client and `fieldB` on another (for the same ID) results in a merged object, verifying the middleware's behavior.
3.  **Progress Conflict Test:**
    *   Simulate Device A writing `progress[id][A] = 50%`.
    *   Simulate Device B writing `progress[id][B] = 10%`.
    *   Verify selector `useBookProgress` returns 50%.
