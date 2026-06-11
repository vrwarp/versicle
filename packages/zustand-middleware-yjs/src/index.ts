import {
  StateCreator,
  StoreMutatorIdentifier,
} from "zustand";
import * as Y from "yjs";
import {
  assertScopedDiffConvergence,
  computeInboundState,
  patchSharedType,
  patchSharedTypeScoped,
  patchStore,
} from "./patching";
import { isDevEnvironment, } from "./env";

/**
 * DEV-only sampling control for the scopedDiff divergence tripwire
 * (phase2-fork-surgery.md §2.3): after a scoped flush, with this probability
 * a full state-vs-map diff runs and asserts convergence, failing LOUDLY on
 * mutate-in-place divergence. Exported so tests can pin it to 1 (always) or
 * 0 (deterministic perf assertions). No-op in production builds.
 */
export const __scopedDiffDevSampling = { rate: 0.02 };

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

  /**
   * Inbound semantics for top-level state keys absent from the Y.Map
   * (phase2-fork-surgery.md §2.2). Default `'replace'` = legacy
   * replace-with-delete hydration (finding D2: a field newly added to a
   * synced store's initial state is wiped on first hydration from an older
   * doc).
   *
   * `'merge-defaults'`: a TOP-LEVEL inbound DELETE is suppressed iff the key
   * is one of the store's declared defaults (the non-function keys of the
   * initial state as returned by the state creator, captured before any
   * patching). Everything else applies unchanged — inserts, updates, and ALL
   * nested deletes (the only deletions normal operation produces; they ride
   * inside a present top-level key). Retention is top-level-key-presence
   * based and shallow: a map key that is present but "poorer" than the
   * default (e.g. an empty record) wins entirely. A retained default is not
   * written back to the doc until something actually set()s it (lazy
   * backfill). Deliberate top-level key removal remains a migration concern:
   * remove the key from defaults/syncedKeys and bump the schema version in
   * the same release.
   */
  hydration?: 'replace' | 'merge-defaults';

  /**
   * Per-top-level-key scoped diffing (phase2-fork-surgery.md §2.3, the D13
   * fix). Default false = legacy full-tree diff (`sharedType.toJSON()` of
   * the entire map on every outbound flush; `map.toJSON()` of the whole
   * tree on every inbound batch).
   *
   * When true:
   * - Outbound: only top-level keys whose value changed by `Object.is`
   *   between the batch-start previousState and the current state are
   *   diffed, each against its own subtree only. Sound for stores following
   *   zustand's immutable-update convention; mutate-in-place writes are
   *   invisible to the fast path — guarded by the DEV sampling tripwire
   *   (loud failure) and the contract suite's fast-check equivalence
   *   property. First-ever flush (no previousState) falls back to the full
   *   legacy diff.
   * - Inbound: only the top-level keys named by the batch's Yjs events are
   *   re-read and patched; untouched keys keep their object identity.
   */
  scopedDiff?: boolean;
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

      const sharedOptions = {
        atomicKeys: options?.atomicKeys,
        disableYText: options?.disableYText,
        yTextKeys: options?.yTextKeys,
        syncedKeys: syncedKeySet,
      };

      if (options?.scopedDiff && previousState !== undefined) {
        // Scoped path (§2.3): diff only the Object.is-changed top-level keys,
        // each against its own subtree.
        const state = api.getState();
        doc.transact(() =>
          patchSharedTypeScoped(map, state, previousState, sharedOptions), api);

        // Divergence tripwire: occasionally verify the scoped flush against
        // a full diff and fail loudly on drift (mutate-in-place writes).
        if (isDevEnvironment() && Math.random() < __scopedDiffDevSampling.rate)
          assertScopedDiffConvergence(map, api.getState(), syncedKeySet);
      }
      else {
        // Legacy full-tree diff. Also the defensive fallback for a first
        // flush without a captured previousState.
        // Read the FINAL state after all synchronous mutations this tick.
        doc.transact(() =>
          patchSharedType(map, api.getState(), {
            ...sharedOptions,
            previousState,
          }), api);
      }
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
     * Merge-over-declared-defaults hydration (phase2-fork-surgery.md §2.2):
     * capture the declared defaults — the non-function keys of the initial
     * state as returned by the state creator, BEFORE any patching. Inbound
     * top-level DELETEs for these keys are suppressed; nested deletes still
     * propagate. Undefined (hydration 'replace', the default) = legacy
     * replace-with-delete behavior, pinned by contract case A.5.
     */
    const declaredDefaultKeys: ReadonlySet<string> | undefined =
      options?.hydration === "merge-defaults"
        ? new Set(
          Object.entries(initialState as Record<string, unknown>)
            .filter(([ , value ]) => (value instanceof Function) === false)
            .map(([ key ]) => key)
        )
        : undefined;

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
        {
          syncedKeys: syncedKeySet,
          suppressTopLevelDeleteKeys: declaredDefaultKeys,
        }
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

    // Under scopedDiff: the top-level keys named by the foreign Yjs events
    // of the current inbound batch (phase2-fork-surgery.md §2.3 inbound).
    let pendingInboundKeys: Set<string> | undefined;

    const processBatch = () => {
      isUpdatePending = false;

      const storeForPatch = {
        ...api,
        "setState": originalSetState,
      };

      if (options?.scopedDiff) {
        // Scoped inbound: re-read ONLY the affected top-level keys; the
        // patched subset is applied over the full state, so untouched keys
        // keep their object identity (referential stability, case D.4).
        const collected = pendingInboundKeys;
        pendingInboundKeys = undefined;

        if (collected === undefined || collected.size === 0) return;

        const affectedKeys: ReadonlySet<string> = syncedKeySet
          ? new Set([...collected].filter((key) => syncedKeySet.has(key)))
          : collected;

        if (affectedKeys.size === 0) return;

        const partialMapJson: Record<string, any> = {};
        affectedKeys.forEach((key) => {
          if (map.has(key)) {
            const value = map.get(key);
            partialMapJson[key] =
              value instanceof Y.AbstractType ? value.toJSON() : value;
          }
        });

        patchStore(storeForPatch, partialMapJson, {
          syncedKeys: affectedKeys,
          suppressTopLevelDeleteKeys: declaredDefaultKeys,
        });
        return;
      }

      patchStore(
        storeForPatch,
        map.toJSON(),
        {
          syncedKeys: syncedKeySet,
          suppressTopLevelDeleteKeys: declaredDefaultKeys,
        }
      );
    };

    map.observeDeep((events, transaction) => {
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

      // Scoped inbound (§2.3): collect the affected top-level keys across
      // the microtask batch — deep events carry the key in path[0]; events
      // on the root map name their keys in changes.keys.
      if (options?.scopedDiff) {
        pendingInboundKeys ??= new Set<string>();
        const keys = pendingInboundKeys;
        events.forEach((event) => {
          if (event.path.length > 0)
            keys.add(String(event.path[0]));
          else
            event.changes.keys.forEach((_change, key) => keys.add(key));
        });
      }

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
