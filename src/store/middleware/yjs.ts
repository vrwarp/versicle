import type { StateCreator, StoreApi, StoreMutatorIdentifier } from 'zustand';
import * as Y from 'yjs';

type YjsMiddleware = <
  T extends object,
  Mps extends [StoreMutatorIdentifier, unknown][] = [],
  Mcs extends [StoreMutatorIdentifier, unknown][] = []
>(
  doc: Y.Doc,
  mapName: string,
  config: StateCreator<T, Mps, Mcs>
) => StateCreator<T, Mps, Mcs>;

type Write<T, U> = Omit<T, keyof U> & U;

export const yjs = <T extends object>(
  doc: Y.Doc,
  mapName: string,
  config: StateCreator<T>
): StateCreator<T> => {
  return (set, get, api) => {
    const map = doc.getMap(mapName);
    let isSyncing = false;

    // 1. Initialize from Yjs (Hydration)
    const initialYjsState: any = {};
    if (map.size > 0) {
        map.forEach((value, key) => {
            initialYjsState[key] = value;
        });
    }

    // 2. Observe Yjs -> Store
    map.observe((e) => {
      if (isSyncing) return;
      isSyncing = true;

      // Incremental updates are better, but for simplicity/robustness we sync the changed keys
      // or just re-read the map. Re-reading is safer for now.
      const nextState: any = { ...get() };
      let hasChanges = false;

      // Handle deletions and updates
      // We iterate the map to get current source of truth
      const currentKeys = new Set(map.keys());

      // Update/Add
      map.forEach((value, key) => {
          if (nextState[key] !== value) {
              nextState[key] = value;
              hasChanges = true;
          }
      });

      // Delete (keys in state but not in map)
      // Note: This assumes the store ONLY contains the map data.
      // If the store has actions, they are functions and won't be in the map usually.
      Object.keys(nextState).forEach(key => {
          if (!currentKeys.has(key) && typeof nextState[key] !== 'function') {
              delete nextState[key];
              hasChanges = true;
          }
      });

      if (hasChanges) {
          set(nextState);
      }
      isSyncing = false;
    });

    // 3. Intercept Store -> Yjs
    const originalSetState = api.setState;
    api.setState = (partial: any, replace?: boolean) => {
      const prevState = get();
      originalSetState(partial, replace);
      const newState = get();

      if (isSyncing) return;
      isSyncing = true;

      doc.transact(() => {
          // Identify changes
          // 1. Updates/Adds
          Object.keys(newState).forEach(key => {
              const newVal = (newState as any)[key];
              const prevVal = (prevState as any)[key];

              if (typeof newVal === 'function') return; // Skip actions

              if (newVal !== prevVal) {
                  if (newVal === undefined) {
                      map.delete(key);
                  } else {
                      // Y.Map values must be JSON serializable (primitives, objects, arrays)
                      // Yjs handles structure cloning.
                      map.set(key, newVal);
                  }
              }
          });

          // 2. Deletes (if replace is true, or if we need to detect removed keys)
          // With Zustand 'set', partial updates merge. keys are rarely removed unless 'replace' is true
          // or explicitly set to undefined (handled above).
          if (replace) {
              Object.keys(prevState).forEach(key => {
                  if (!(key in newState) && typeof (prevState as any)[key] !== 'function') {
                      map.delete(key);
                  }
              });
          }
      });

      isSyncing = false;
    };

    // Initialize the store
    const state = config(
        (partial, replace) => api.setState(partial, replace),
        get,
        api
    );

    // Apply initial Yjs state over the default state (hydrated)
    // We filter out actions from state if any, but usually spreading works.
    return { ...state, ...initialYjsState };
  };
};
