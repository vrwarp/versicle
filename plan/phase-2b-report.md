## Phase 2B Execution Report (Decoupling & Reactive Wrappers)

**Status:** Phase 2B Complete.

**Implementation Summary:**
- **Core:** Created `YjsObserverService` in `src/lib/crdt/YjsObserverService.ts` to bridge Yjs events to Zustand stores.
- **Store Refactor:**
    - Updated `useLibraryStore` to include `internalSync` for reactive book updates.
    - Updated `useAnnotationStore` to include `internalSync` for reactive annotation updates.
    - Refactored `useReaderStore` to implement throttled writes to Yjs (Moral Layer) for reading progress (`lastRead`, `progress`) using a 60s debounce, ensuring local fluidity while preventing CRDT history bloat.
- **Integration:** Hooked `YjsObserverService` into `App.tsx` initialization.
- **Testing:**
    - Verified `useReaderStore` throttle logic logic via unit tests.
    - Ensured `internalSync` updates correctly via integration tests.
    - Mocked dependencies in tests (e.g. `fast-deep-equal`, `lodash/debounce`) to ensure isolation.
    - Fixed mocked dependencies in `App_Capacitor.test.tsx` to align with the new store structure.

**Findings & Deviations:**
- **Throttling Strategy:** Instead of using `SyncOrchestrator`'s debounce for local persistence, a dedicated `throttledCrdtUpdate` utility was created to manage Yjs writes independently. This decoupling ensures that local "Moral Layer" persistence happens regardless of cloud sync status.
- **Store Subscriptions:** `YjsObserverService` uses `useStore.getState().internalSync` to push updates. This avoids subscription loops because `internalSync` only updates the React state and does not trigger a DB write back to Yjs (which `DBService` methods do).
- **Test Mocks:** Extensive mocking of `zustand` stores was required for `App_Capacitor.test.tsx` to handle the new `getState()` calls introduced by the observer service.
