import * as Y from "yjs";
import { ChangeType, Change, } from "./types";
import { getChanges, } from "./diff";
import { arrayToYArray, objectToYMap, stringToYText, } from "./mapping";
import { StoreApi, } from "zustand/vanilla";

/**
 * Options accepted by patchSharedType (and threaded through its recursion).
 */
export interface SharedTypePatchOptions
{
  atomicKeys?: string[];
  disableYText?: boolean;
  yTextKeys?: string[];
  previousState?: any;

  /**
   * Top-level replication whitelist (phase2-fork-surgery.md §2.1). Applied
   * only at the ROOT diff: both the shared-type JSON and the new state are
   * filtered to these keys before diffing, so a non-listed state key is never
   * inserted into the Y.Map and a foreign map key is never updated or deleted
   * by this client (the resurrection guard). NEVER threaded into recursion —
   * nesting below a synced key replicates fully.
   */
  syncedKeys?: ReadonlySet<string>;
}

const isPlainRecord = (value: any): value is Record<string, any> =>
  typeof value === "object" && value !== null && !Array.isArray(value);

/** Shallow-pick the listed keys (presence-preserving: `undefined` values survive). */
const pickKeys = (
  source: Record<string, any>,
  keys: ReadonlySet<string>
): Record<string, any> =>
{
  const picked: Record<string, any> = {};

  keys.forEach((key) =>
  {
    if (key in source)
      picked[key] = source[key];
  });

  return picked;
};

/**
 * Applies an already-computed change list to a Yjs shared type. Extracted
 * from patchSharedType so the scoped-diff path can reuse the exact same
 * INSERT/UPDATE/DELETE/PENDING application semantics (incl. the verbatim
 * `previousState` delete-protection and the Y.Text↔string mismatch repair).
 *
 * @param sharedType The Yjs shared type to apply the changes to.
 * @param changes The change list (as produced by getChanges).
 * @param newState The new state the changes were computed against.
 * @param options Mapping options; `previousState` guards DELETEs.
 */
const applyChangesToSharedType = (
  sharedType: Y.Map<any> | Y.Array<any> | Y.Text,
  changes: Change[],
  newState: any,
  options?: SharedTypePatchOptions
): void =>
{
  changes.forEach(([ type, property, value ]) =>
  {
    switch (type)
    {
    case ChangeType.INSERT:
    case ChangeType.UPDATE:
      if ((value instanceof Function) === false)
      {
        if (sharedType instanceof Y.Map)
        {
          if (typeof value === "string")
          {
            if (options?.disableYText)
            {
              if (options.yTextKeys?.includes(property as string))
                sharedType.set(property as string, stringToYText(value));
              else
                sharedType.set(property as string, value);
            }
            else
            {
              if (options?.atomicKeys?.includes(property as string))
                sharedType.set(property as string, value);
              else
                sharedType.set(property as string, stringToYText(value));
            }
          }
          else if (Array.isArray(value))
            sharedType.set(property as string, arrayToYArray(value, options));
          else if (typeof value === "object" && value !== null)
            sharedType.set(property as string, objectToYMap(value, options));
          else
            sharedType.set(property as string, value);
        }

        else if (sharedType instanceof Y.Array)
        {
          const index = property as number;

          if (type === ChangeType.UPDATE)
            sharedType.delete(index);

          if (typeof value === "string")
          {
            if (options?.disableYText)
              sharedType.insert(index, [ value ]);
            else
              sharedType.insert(index, [ stringToYText(value) ]);
          }
          else if (Array.isArray(value))
            sharedType.insert(index, [ arrayToYArray(value, options) ]);
          else if (typeof value === "object" && value !== null)
            sharedType.insert(index, [ objectToYMap(value, options) ]);
          else
            sharedType.insert(index, [ value ]);
        }

        else if (sharedType instanceof Y.Text)
          sharedType.insert(property as number, value);
      }
      break;

    case ChangeType.DELETE:
      {
        const prev = options?.previousState;

        if (prev && typeof prev === "object" && !(property in prev))
          return;
      }

      if (sharedType instanceof Y.Map)
        sharedType.delete(property as string);

      else if (sharedType instanceof Y.Array)
      {
        const index = property as number;
        sharedType.delete(sharedType.length <= index
          ? sharedType.length - 1
          : index);
      }

      else if (sharedType instanceof Y.Text)
        // A delete operation for text is only ever for a single character.
        sharedType.delete(property as number, 1);

      break;

    case ChangeType.PENDING:
      {
        let childPreviousState;

        if (options?.previousState && typeof options.previousState === "object")
          childPreviousState = options.previousState[property as string];

        if (sharedType instanceof Y.Map)
        {
          const existing = sharedType.get(property as string);
          const newValue = newState[property as string];
          let isTextMappingMismatch = false;

          if (typeof newValue === "string")
          {
            const wantsYText = options?.disableYText
              ? options.yTextKeys?.includes(property as string)
              : !options?.atomicKeys?.includes(property as string);

            if (wantsYText && !(existing instanceof Y.Text))
              isTextMappingMismatch = true;
            else if (!wantsYText && (existing instanceof Y.Text))
              isTextMappingMismatch = true;
          }

          if (isTextMappingMismatch)
          {
            const wantsYText = options?.disableYText
              ? options.yTextKeys?.includes(property as string)
              : !options?.atomicKeys?.includes(property as string);

            if (wantsYText)
              sharedType.set(property as string, stringToYText(newValue));
            else
              sharedType.set(property as string, newValue);
          }
          else
          {
            if (typeof newValue === "string" && !(existing instanceof Y.Text))
            {
              // Plain string diff - set it directly since primitive strings can't be patched incrementally
              sharedType.set(property as string, newValue);
            }
            else
            {
              patchSharedType(
                existing,
                newValue,
                { ...options, syncedKeys: undefined, previousState: childPreviousState }
              );
            }
          }
        }
        else if (sharedType instanceof Y.Array)
        {
          const existing = sharedType.get(property as number);
          const newValue = newState[property as number];
          let isTextMappingMismatch = false;

          if (typeof newValue === "string")
          {
            const wantsYText = !options?.disableYText; // Arrays only support strings vs Y.Text based on disableYText, not keys

            if (wantsYText && !(existing instanceof Y.Text))
              isTextMappingMismatch = true;
            else if (!wantsYText && (existing instanceof Y.Text))
              isTextMappingMismatch = true;
          }

          if (isTextMappingMismatch)
          {
            sharedType.delete(property as number);

            const wantsYText = !options?.disableYText;
            if (wantsYText)
              sharedType.insert(property as number, [ stringToYText(newValue) ]);
            else
              sharedType.insert(property as number, [ newValue ]);
          }
          else
          {
            if (typeof newValue === "string" && !(existing instanceof Y.Text))
            {
              // Plain string diff - update directly by replacing the element
              sharedType.delete(property as number);
              sharedType.insert(property as number, [ newValue ]);
            }
            else
            {
              patchSharedType(
                existing,
                newValue,
                { ...options, syncedKeys: undefined, previousState: childPreviousState }
              );
            }
          }
        }
      }
      break;

    default:
      break;
    }
  });
};

/**
 * Diffs sharedType and newState to create a list of changes for transforming
 * the contents of sharedType into that of newState. For every nested, 'pending'
 * change detected, this function recurses, as a nested object or array is
 * represented as a Y.Map or Y.Array.
 *
 * When `options.syncedKeys` is set (top-level Y.Map calls only), BOTH sides
 * of the diff are first filtered to the whitelist, so non-listed keys are
 * invisible in either direction (phase2-fork-surgery.md §2.1).
 *
 * @param sharedType The Yjs shared type to patch.
 * @param newState The new state to patch the shared type into.
 * @param options Mapping options, delete-protection state, and the whitelist.
 */
export const patchSharedType = (
  sharedType: Y.Map<any> | Y.Array<any> | Y.Text,

  newState: any,
  options?: SharedTypePatchOptions
): void =>
{
  const sharedTypeJson = typeof sharedType.toJSON === "function" ? sharedType.toJSON() : sharedType.toString();

  const syncedKeys = options?.syncedKeys;
  const applyWhitelist = syncedKeys !== undefined
    && isPlainRecord(sharedTypeJson)
    && isPlainRecord(newState);

  const a = applyWhitelist ? pickKeys(sharedTypeJson, syncedKeys) : sharedTypeJson;
  const b = applyWhitelist ? pickKeys(newState, syncedKeys) : newState;

  const changes = getChanges(a, b);

  applyChangesToSharedType(sharedType, changes, b, options);
};

/**
 * Patches oldState to be identical to newState. This function recurses when
 * an array or object is encountered. If oldState and newState are already
 * identical (indicated by an empty diff), then oldState is returned.
 *
 * @param oldState The state we want to patch.
 * @param newState The state we want oldState to match after patching.
 *
 * @returns The patched oldState, identical to newState.
 */

export const patchState = (oldState: any, newState: any): any =>
{
  const changes = getChanges(oldState, newState);

  const applyChanges = (
    state: (string | any[] | Record<string, any>),
    changes: Change[]
  ): any =>
  {
    if (typeof state === "string")
      return applyChangesToString(state as string, changes);
    else if (Array.isArray(state))
      return applyChangesToArray(state as any[], changes);
    else if (typeof state === "object" && state !== null)
      return applyChangesToObject(state as Record<string, any>, changes);
  };

  const applyChangesToArray = (array: any[], changes: Change[]): any =>
  {
    const revisedArray = [ ...array ];
    const deletes = changes
      .filter(([ type ]) =>
        type === ChangeType.DELETE)
      .sort(([ , indexA ], [ , indexB ]) =>
        Math.sign((indexB as number) - (indexA as number))); // Descending

    const others = changes
      .filter(([ type ]) =>
        type !== ChangeType.DELETE)
      .sort(([ , indexA ], [ , indexB ]) =>
        Math.sign((indexA as number) - (indexB as number))); // Ascending

    deletes.forEach(([ , index ]) =>
    {
      revisedArray.splice(index as number, 1);
    });

    return others.reduce(
      (currentArray, [ type, index, value ]) =>
      {
        switch (type)
        {
        case ChangeType.INSERT:
        {
          currentArray.splice(index as number, 0, value);
          return currentArray;
        }

        case ChangeType.UPDATE:
        {
          currentArray[index as number] = value;
          return currentArray;
        }

        case ChangeType.PENDING:
        {
          currentArray[index as number] =
            applyChanges(currentArray[index as number], value);
          return currentArray;
        }

        case ChangeType.NONE:
        default:
          return currentArray;
        }
      },
      revisedArray
    );
  };

  const applyChangesToObject = (
    object: Record<string, any>,
    changes: Change[]
  ): any =>
    changes
      .reduce(
        (revisedObject, [ type, property, value ]) =>
        {
          switch (type)
          {
          case ChangeType.INSERT:
          case ChangeType.UPDATE:
          {
            revisedObject[property] = value;
            return revisedObject;
          }

          case ChangeType.PENDING:
          {
            revisedObject[property] = applyChanges(revisedObject[property], value);
            return revisedObject;
          }

          case ChangeType.DELETE:
          {
            delete revisedObject[property];
            return revisedObject;
          }

          case ChangeType.NONE:
          default:
            return revisedObject;
          }
        },
        { ...object, }
      );

  const applyChangesToString = (string: string, changes: Change[]): any =>
    changes
      .reduce(
        (revisedString, [ type, index, value ]) =>
        {
          switch (type)
          {
          case ChangeType.INSERT:
          {
            const left = revisedString.slice(0, index as number);
            const right = revisedString.slice(index as number);
            return left + value + right;
          }

          case ChangeType.DELETE:
          {
            const left = revisedString.slice(0, index as number);
            const right = revisedString.slice((index as number) + 1);
            return left + right;
          }

          default:
          {
            return revisedString;
          }
          }
        },
        string
      );

  if (changes.length === 0)
    return oldState;

  else
    return applyChanges(oldState, changes);
};


/**
 * Options for the inbound (Y.Map JSON → Zustand state) application path.
 */
export interface InboundStateOptions
{
  /**
   * Top-level replication whitelist (phase2-fork-surgery.md §2.1). When set,
   * only the listed keys are diffed (map subset vs state subset) and the
   * patched subset is applied over the FULL state — a foreign map key is
   * never inserted into store state, and a non-listed local key is never
   * touched by remote updates.
   */
  syncedKeys?: ReadonlySet<string>;
}

/**
 * Computes the next Zustand state for an inbound patch from map JSON.
 *
 * Without options this is exactly the legacy `patchState(currentState,
 * newState)` (replace-with-delete hydration, finding D2 — pinned by contract
 * case A.5). With `syncedKeys` the diff/application universe is restricted
 * to the whitelist; deletes are still honored INSIDE the subset.
 *
 * @param currentState The current (already cloned) Zustand state.
 * @param newState The Y.Map JSON to patch toward.
 * @param options Inbound options (whitelist).
 * @returns The next state object to set with replace=true.
 */
export const computeInboundState = (
  currentState: any,
  newState: any,
  options?: InboundStateOptions
): any =>
{
  const syncedKeys = options?.syncedKeys;

  if (syncedKeys === undefined)
    return patchState(currentState, newState);

  // pickKeys is presence-preserving, but function-valued state keys are
  // excluded from the replication universe entirely (functions are never
  // synced; a function entry in syncedKeys is a dev-mode error upstream).
  const oldSubset: Record<string, any> = {};
  syncedKeys.forEach((key) =>
  {
    if (key in currentState && (currentState[key] instanceof Function) === false)
      oldSubset[key] = currentState[key];
  });

  const newSubset = isPlainRecord(newState) ? pickKeys(newState, syncedKeys) : {};
  const patchedSubset = patchState(oldSubset, newSubset);

  // Apply the patched subset over the full state: keys deleted within the
  // subset are absent from patchedSubset and must be removed; everything
  // outside the whitelist is left untouched (object identity preserved).
  const next = { ...currentState, };
  syncedKeys.forEach((key) =>
  {
    if (key in next && (next[key] instanceof Function) === false)
      delete next[key];
  });

  return Object.assign(next, patchedSubset);
};

/**
 * Diffs the current state stored in the Zustand store and the given newState.
 * The current Zustand state is patched into the given new state recursively.
 *
 * @param store The Zustand API that manages the store we want to patch.
 * @param newState The new state that the Zustand store should be patched to.
 * @param options Inbound options (replication whitelist).
 */
export const patchStore = <S>(
  store: StoreApi<S>,

  newState: any,
  options?: InboundStateOptions
): void =>
{
  // Clone the oldState instead of using it directly from store.getState().
  const oldState = {
    ...(store.getState() as Record<string, unknown>),
  };

  store.setState(
    computeInboundState(oldState, newState, options),
    true // Replace with the patched state.
  );
};