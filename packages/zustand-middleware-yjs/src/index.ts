import {
  StateCreator,
  StoreMutatorIdentifier,
} from "zustand";
import * as Y from "yjs";
import { computeInboundState, patchSharedType, patchStore, } from "./patching";
import { isDevEnvironment, } from "./env";

type Yjs = <
  T,
  Mps extends [StoreMutatorIdentifier, unknown][] = [],
  Mcs extends [StoreMutatorIdentifier, unknown][] = []
>(
  doc: Y.Doc,
  name: string,
  f: StateCreator<T, Mps, Mcs>,
  options?: YjsOptions
) => StateCreator<T, Mps, Mcs>;

/**
 * Options for the Yjs middleware.
 */
export interface YjsOptions {
  /**
   * specific keys that should be treated as atomic strings.
   *
   * By default, strings in the Zustand store are converted to Y.Text objects
   * in Yjs to support collaborative text editing. However, for some strings
   * like UUIDs, Enums, or base64 data, this behavior is not desirable.
   *
   * Keys listed here will be stored as primitive strings in the Yjs map,
   * bypassing the Y.Text conversion.
   */
  atomicKeys?: string[];

  /**
   * Disables the default behavior of converting strings to Y.Text objects.
   * If true, all strings will be stored as primitive strings in the Yjs map.
   */
  disableYText?: boolean;

  /**
   * specific keys that should be treated as Y.Text objects when disableYText is true.
   *
   * When disableYText is enabled, this provides a way to opt-in specific keys to
   * be stored as Y.Text.
   */
  yTextKeys?: string[];

  /**
   * A callback that is called when the store is first loaded from the Yjs document.
   */
  onLoaded?: () => void;

  /**
   * The schema version this client supports. When a remote peer writes a
   * higher `__schemaVersion` into the Yjs document, the middleware permanently
   * halts synchronization to prevent legacy clients from corrupting upgraded
   * data structures.
   */
  schemaVersion?: number;

  /**
   * Called once when the middleware detects a `__schemaVersion` in the Yjs
   * document that exceeds the local `schemaVersion`. After this fires, all
   * inbound and outbound sync is permanently disabled.
   *
   * @param incomingVersion The schema version found in the Yjs document.
   */
  onObsolete?: (incomingVersion: number) => void;

  /**
   * Top-level keys replicated to the Y.Map (phase2-fork-surgery.md §2.1).
   * `undefined` = legacy behavior: every non-function top-level key syncs.
   *
   * When provided, the replication universe for this store is exactly this
   * key set, BOTH directions (top level only; nesting below a synced key
   * replicates fully):
   *
   * - Outbound: a non-listed key can never be inserted, updated, or deleted
   *   in the Y.Map by this client.
   * - Inbound: a foreign map key is never inserted into store state, and a
   *   non-listed local key is never touched by remote updates.
   * - Resurrection guard: a key removed from `syncedKeys` whose value still
   *   exists in old docs is ignored both directions — only a migration can
   *   remove it from the doc, and nothing can write it back.
   *
   * `__schemaVersion` is implicitly a synced key whenever `schemaVersion` is
   * set (the poison-pill read and the migration dual-write depend on it);
   * stores need not list it.
   *
   * Dev-mode misconfiguration is a loud error at store creation: every entry
   * must exist in the initial state and must not be a function.
   */
  syncedKeys?: readonly string[];
}

type YjsImpl = <T>(
  doc: Y.Doc,
  name: string,
  config: StateCreator<T, [], []>,
  options?: YjsOptions
) => StateCreator<T, [], []>;


/**
 * This function is the middleware the sets up the Zustand store to mirror state
 * into a Yjs store for peer-to-peer synchronization.
 *
 * @example <caption>Using yjs</caption>
 * const useState = create(
 *   yjs(
 *     new Y.Doc(), // A Y.Doc to back our store with.
 *     "shared",    // A name to give the Y.Map our store is backed by.
 *     (set) =>
 *     ({
 *       "count": 1,
 *     })
 *   )
 * );
 *
 * @param doc The Yjs document to create the store in.
 * @param name The name that the store should be listed under in the doc.
 * @param config The initial state of the store we should be using.
 * @param options The options for the middleware.
 * @returns A Zustand state creator.
 */
const yjs: YjsImpl = <S>(
  doc: Y.Doc,
  name: string,
  config: StateCreator<S>,
  options?: YjsOptions
): StateCreator<S> => {
  // The root Y.Map that the store is written and read from.
  const map: Y.Map<any> = doc.getMap(name);

  /*
   * The effective replication whitelist (undefined = legacy "all non-function
   * keys"). `__schemaVersion` is implicitly synced whenever the poison pill
   * is configured — the per-map version check and the migration dual-write
   * depend on it reaching both the doc and store state.
   */
  const syncedKeySet: ReadonlySet<string> | undefined = options?.syncedKeys
    ? new Set<string>(
      options.schemaVersion !== undefined
        ? [ ...options.syncedKeys, "__schemaVersion" ]
        : options.syncedKeys
    )
    : undefined;

  // Permanent kill switch: once set, no further inbound or outbound sync occurs.
  let isObsolete = false;

  // Augment the store.
  return (set, get, api) => {
    // Initialize the loading state.
    let loaded = false;

    if (map.size > 0) {
      loaded = true;
      options?.onLoaded?.();
    }

    /*
     * Outbound Microtask Batching: multiple Zustand set() / setState() calls
     * within the same event-loop tick are coalesced into a single Yjs
     * transaction. This reduces complexity from O(T×N) to O(1×N) per tick.
     */
    let isOutboundPending = false;
    // The Zustand state captured BEFORE the first set() / setState() of each batch.
    // Subsequent calls in the same tick do not overwrite this; only the first-call
    // "user's view" baseline is needed for the three-way merge guard.
    let batchPreviousState: S | undefined;

    const originalSetState = api.setState;

    const flushOutbound = () => {
      isOutboundPending = false;
      const previousState = batchPreviousState;
      batchPreviousState = undefined;
      // Read the FINAL state after all synchronous mutations this tick.
      doc.transact(() =>
        patchSharedType(map, api.getState(), {
          atomicKeys: options?.atomicKeys,
          disableYText: options?.disableYText,
          yTextKeys: options?.yTextKeys,
          previousState,
          syncedKeys: syncedKeySet,
        }), api);
    };

    const scheduleOutbound = (capturedPreviousState: S) => {
      if (isObsolete) return; // Prevent local state from polluting newer CRDT schemas

      if (!isOutboundPending) {
        isOutboundPending = true;
        // Record the pre-mutation state only for the FIRST set() of this batch.
        batchPreviousState = capturedPreviousState;
        queueMicrotask(flushOutbound);
      }
    };

    /*
     * Capture the initial state so that we can initialize the Yjs store to the
     * same values as the initial values of the Zustand store.
     */
    let initialState = config(
      /*
       * Create a new set function that applies local state immediately (for
       * optimistic UI / React responsiveness) then schedules a Yjs sync.
       */
      (partial, replace) => {
        const previousState = get() as S;
        set(partial as any, replace as any);
        scheduleOutbound(previousState);
      },
      get,
      api
    );

    /*
     * Loud dev-mode misconfiguration check (phase2-fork-surgery.md §2.1): a
     * syncedKeys entry that is absent from the initial state would silently
     * never sync (a typo), and a function entry could never sync (functions
     * are excluded from replication by design).
     */
    if (options?.syncedKeys && isDevEnvironment()) {
      const initialRecord = initialState as Record<string, unknown>;
      options.syncedKeys.forEach((key) => {
        if (!(key in initialRecord)) {
          throw new Error(
            `[zustand-middleware-yjs] syncedKeys entry "${key}" is not a key ` +
            `of the initial state of store "${name}". Synced keys must exist ` +
            `in the object returned by the state creator (likely a typo — ` +
            `the key would otherwise silently never sync).`
          );
        }
        if (initialRecord[key] instanceof Function) {
          throw new Error(
            `[zustand-middleware-yjs] syncedKeys entry "${key}" of store ` +
            `"${name}" is a function. Functions are never replicated; remove ` +
            `it from syncedKeys.`
          );
        }
      });
    }

    if (map.size > 0) {
      initialState = computeInboundState(
        initialState,
        map.toJSON(),
        { syncedKeys: syncedKeySet }
      );
      api.setState(initialState, true as any);
    }

    api.setState = (partial, replace) => {
      const previousState = api.getState() as S;
      originalSetState(partial as any, replace as any);
      scheduleOutbound(previousState);
    };

    /*
     * We do not initialize the Yjs map with the initial state here.
     * Doing so would trigger a transaction that could overwrite remote state
     * in offline-first scenarios (e.g. "late join"), because the local write
     * might appear newer than the remote state.
     *
     * See "Does not reset state on second join" test in index.spec.ts.
     */

    /*
     * Whenever the Yjs store changes, we perform a set operation on the local
     * Zustand store. We avoid using the Yjs enabled set to prevent unnecessary
     * ping-pong of updates.
     *
     * Inbound Microtask Batching: multiple Yjs transactions arriving within the
     * same event-loop tick are coalesced into a single patchStore call.
     * This reduces complexity from O(T×N) to O(1×N) per tick, preventing
     * main-thread blocking during bulk remote updates.
     */

    // Flag to prevent scheduling more than one sync per event-loop tick.
    let isUpdatePending = false;

    const processBatch = () => {
      isUpdatePending = false;
      patchStore(
        {
          ...api,
          "setState": originalSetState,
        },
        map.toJSON(),
        { syncedKeys: syncedKeySet }
      );
    };

    map.observeDeep((_, transaction) => {
      if (isObsolete) return; // Permanently disabled

      // 1. Poison Pill Check
      if (options?.schemaVersion !== undefined) {
        const incomingVersion = (map.get('__schemaVersion') as number | undefined) || 0;
        if (incomingVersion > options.schemaVersion) {
          isObsolete = true;
          options.onObsolete?.(incomingVersion);
          return;
        }
      }

      // 2. Initial Load Handling (unchanged behaviour).
      if (!loaded && transaction.origin !== api) {
        loaded = true;
        options?.onLoaded?.();
      }

      // 2. Local Echo Suppression.
      // If we originated this transaction, the Zustand store is already
      // up-to-date. Skip the round-trip entirely.
      if (transaction.origin === api) return;

      // 3. Microtask Coalescing.
      // Schedule at most one synchronisation per event-loop tick.
      if (!isUpdatePending) {
        isUpdatePending = true;
        queueMicrotask(processBatch);
      }
    });

    // Return the initial state to create or the next middleware.
    return initialState;
  };
};

export default yjs as unknown as Yjs;
