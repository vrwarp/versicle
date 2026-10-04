/**
 * Library-layer cross-checks for the sync diagnostics export.
 *
 * Sync rides on three vendored libraries, each owning one hop of the data
 * path. Each check below rebuilds the data at ONE hop independently and
 * compares it with the live in-memory Y.Doc, so a mismatch points at the
 * library that owns that hop:
 *
 *   zustand store ──(zustand-middleware-yjs)── Y.Doc ──(y-idb)── IndexedDB
 *                                                │
 *                                            (y-cinder)
 *                                                │
 *                                            Firestore
 *
 *  - `bindings`    — zustand-middleware-yjs: each synced store's state vs
 *                    the Y.Map it is bound to (after flushing its outbound
 *                    batch). A mismatch = the UI shows something the CRDT
 *                    does not hold, or vice versa.
 *  - `persistence` — y-idb: memory vs what IndexedDB actually holds (read
 *                    raw, no binding, after a bounded flush). Memory ahead =
 *                    local writes that a kill/reload would lose.
 *  - `remote`      — y-cinder: memory vs a fresh download of the Firestore
 *                    document. Memory ahead = uploads not landing; remote
 *                    ahead = remote updates this device never applied.
 *  - `roundTrip`   — yjs itself: encode → decode reproduces the same content.
 *
 * Replica comparison is by Yjs snapshot (state vector + delete set) AND by
 * content digest. The decisive library-bug signature is "snapshots equal but
 * content differs" — two replicas that have integrated exactly the same
 * operations must hold identical content.
 *
 * Every check is read-only with respect to user data and individually
 * failure-tolerant; the export still completes offline.
 */
import * as Y from 'yjs';
import { getYDoc, flushYjsPersistence } from '@store/yjs-provider';
import { SYNCED_STORES, yjsHandleOf } from '@store/registry';
import { readSnapshot } from '@data/snapshot/YjsSnapshotService';
import { peekSyncOrchestrator } from '../createSync';
import { fnv1a, stableStringify, summarizeDoc, type DocSummary } from './docSummary';

/** Cap on keys listed per difference bucket. */
const MAX_LISTED = 200;

type Verdict = 'match' | 'mismatch' | 'skipped' | 'error';

export interface ReplicaComparison {
  verdict: Verdict;
  /** Same state vector AND delete set (Y.equalSnapshots). */
  snapshotsEqual: boolean;
  /** Same content digest on every root. */
  contentEqual: boolean;
  /** THE library-bug signature: same operations integrated, different content. */
  sameOpsDifferentContent: boolean;
  /** Clients where `local` has integrated more than `other`, and vice versa. */
  localAhead: Array<{ client: number; local: number; other: number }>;
  otherAhead: Array<{ client: number; local: number; other: number }>;
  /** Bytes of the update each side would need from the other. */
  otherMissingBytes: number;
  localMissingBytes: number;
  otherPendingStructs: DocSummary['pendingStructs'];
  roots: Record<
    string,
    {
      localDigest: string | null;
      otherDigest: string | null;
      onlyLocal?: string[];
      onlyOther?: string[];
      differing?: string[];
      truncated?: boolean;
    }
  >;
}

const capped = (keys: string[]): { list: string[]; truncated: boolean } => ({
  list: keys.slice(0, MAX_LISTED),
  truncated: keys.length > MAX_LISTED,
});

/**
 * Give `other`'s roots the same concrete types `local` uses, so per-entry
 * digests are computed the same way on both (a doc rebuilt from bytes has
 * untyped roots until something calls getMap/getArray/getText on them).
 */
function alignRootTypes(local: Y.Doc, other: Y.Doc): void {
  for (const [name, type] of local.share) {
    if (type instanceof Y.Map) other.getMap(name);
    else if (type instanceof Y.Array) other.getArray(name);
    else if (type instanceof Y.Text) other.getText(name);
  }
}

/** Compare the live doc with another replica of it (see module docs). */
export function compareReplicas(local: Y.Doc, other: Y.Doc): ReplicaComparison {
  alignRootTypes(local, other);
  const a = summarizeDoc(local);
  const b = summarizeDoc(other);

  const svA = new Map(a.stateVector.map((c) => [c.client, c.clock]));
  const svB = new Map(b.stateVector.map((c) => [c.client, c.clock]));
  const localAhead: ReplicaComparison['localAhead'] = [];
  const otherAhead: ReplicaComparison['otherAhead'] = [];
  for (const client of new Set([...svA.keys(), ...svB.keys()])) {
    const l = svA.get(client) ?? 0;
    const o = svB.get(client) ?? 0;
    if (l > o) localAhead.push({ client, local: l, other: o });
    else if (o > l) otherAhead.push({ client, local: l, other: o });
  }

  let snapshotsEqual = false;
  try {
    snapshotsEqual = Y.equalSnapshots(Y.snapshot(local), Y.snapshot(other));
  } catch {
    snapshotsEqual = false;
  }

  const roots: ReplicaComparison['roots'] = {};
  let contentEqual = true;
  for (const name of new Set([...Object.keys(a.shared), ...Object.keys(b.shared)])) {
    const ra = a.shared[name];
    const rb = b.shared[name];
    const localDigest = ra?.digest ?? null;
    const otherDigest = rb?.digest ?? null;
    // A root that exists on one side but is EMPTY there is not a difference.
    const emptyA = !ra || ra.size === 0;
    const emptyB = !rb || rb.size === 0;
    if (localDigest === otherDigest || (emptyA && emptyB)) continue;
    contentEqual = false;
    const entry: ReplicaComparison['roots'][string] = { localDigest, otherDigest };
    // A side that lacks the root entirely (or holds it empty) contributes
    // no entries, so every key on the other side is listed as one-sided.
    if ((ra?.entries || emptyA) && (rb?.entries || emptyB)) {
      const ea = ra?.entries ?? {};
      const eb = rb?.entries ?? {};
      const onlyLocal = capped(Object.keys(ea).filter((k) => !(k in eb)));
      const onlyOther = capped(Object.keys(eb).filter((k) => !(k in ea)));
      const differing = capped(Object.keys(ea).filter((k) => k in eb && ea[k].h !== eb[k].h));
      entry.onlyLocal = onlyLocal.list;
      entry.onlyOther = onlyOther.list;
      entry.differing = differing.list;
      if (onlyLocal.truncated || onlyOther.truncated || differing.truncated) entry.truncated = true;
    }
    roots[name] = entry;
  }

  const diffBytes = (from: Y.Doc, to: Y.Doc): number => {
    try {
      return Y.encodeStateAsUpdate(from, Y.encodeStateVector(to)).byteLength;
    } catch {
      return -1;
    }
  };

  return {
    verdict: snapshotsEqual && contentEqual ? 'match' : 'mismatch',
    snapshotsEqual,
    contentEqual,
    sameOpsDifferentContent: snapshotsEqual && !contentEqual,
    localAhead: localAhead.slice(0, MAX_LISTED),
    otherAhead: otherAhead.slice(0, MAX_LISTED),
    otherMissingBytes: diffBytes(local, other),
    localMissingBytes: diffBytes(other, local),
    otherPendingStructs: b.pendingStructs,
    roots,
  };
}

function docFromUpdate(update: Uint8Array | null): Y.Doc {
  const doc = new Y.Doc();
  if (update && update.byteLength > 0) Y.applyUpdate(doc, update);
  return doc;
}

async function withDeadline<T>(promise: Promise<T>, ms: number): Promise<T | 'timeout'> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      promise,
      new Promise<'timeout'>((resolve) => {
        timer = setTimeout(() => resolve('timeout'), ms);
      }),
    ]);
  } finally {
    if (timer !== undefined) clearTimeout(timer);
  }
}

/** Plain-JSON view (drops undefined fields, Y types → JSON) for comparison. */
function plain(value: unknown): unknown {
  if (value instanceof Y.AbstractType) return value.toJSON();
  if (value === undefined) return undefined;
  try {
    return JSON.parse(JSON.stringify(value)) as unknown;
  } catch {
    return value;
  }
}

const isRecord = (v: unknown): v is Record<string, unknown> =>
  v !== null && typeof v === 'object' && !Array.isArray(v);

/** Which top-level fields of one entry differ between store and doc. */
function fieldDiff(a: unknown, b: unknown): Record<string, { store: string; doc: string }> | { store: string; doc: string } {
  if (!isRecord(a) || !isRecord(b)) {
    return { store: fnv1a(stableStringify(a)), doc: fnv1a(stableStringify(b)) };
  }
  const out: Record<string, { store: string; doc: string }> = {};
  for (const f of new Set([...Object.keys(a), ...Object.keys(b)])) {
    const sa = stableStringify(a[f]);
    const sb = stableStringify(b[f]);
    if (sa !== sb) {
      out[f] = {
        store: f in a ? fnv1a(sa) : '(absent)',
        doc: f in b ? fnv1a(sb) : '(absent)',
      };
    }
  }
  return out;
}

/** zustand-middleware-yjs: each synced store vs its Y.Map (see module docs). */
export function checkStoreBindings(doc: Y.Doc): Record<string, unknown> {
  const stores: Record<string, unknown> = {};
  let mismatches = 0;
  for (const { def, store } of SYNCED_STORES) {
    try {
      const handle = yjsHandleOf(store);
      handle?.flush();
      const root = doc.getMap(def.name);
      const map = def.scope ? root.get(def.scope.key) : root;
      const state = (store as { getState: () => Record<string, unknown> }).getState();
      const keys: Record<string, unknown> = {};
      let storeMismatch = false;
      for (const key of def.syncedKeys) {
        const fromStore = plain(state[key]);
        const fromDoc = map instanceof Y.Map ? plain(map.get(key)) : undefined;
        if (stableStringify(fromStore) === stableStringify(fromDoc)) continue;
        // An absent doc key with a store default is the merge-defaults
        // contract, not a binding fault — report it, but separately.
        if (fromDoc === undefined) {
          keys[key] = { absentInDoc: true, storeHash: fnv1a(stableStringify(fromStore)) };
          continue;
        }
        storeMismatch = true;
        if (isRecord(fromStore) && isRecord(fromDoc)) {
          const differingKeys = Object.keys(fromStore).filter(
            (k) => k in fromDoc && stableStringify(fromStore[k]) !== stableStringify(fromDoc[k])
          );
          keys[key] = {
            onlyInStore: capped(Object.keys(fromStore).filter((k) => !(k in fromDoc))).list,
            onlyInDoc: capped(Object.keys(fromDoc).filter((k) => !(k in fromStore))).list,
            differing: capped(differingKeys).list,
            // Field-level detail for the first few differing entries: which
            // fields differ, and their hashes on each side (no values).
            fields: Object.fromEntries(
              differingKeys.slice(0, 20).map((k) => [k, fieldDiff(fromStore[k], fromDoc[k])])
            ),
          };
        } else {
          keys[key] = {
            storeHash: fnv1a(stableStringify(fromStore)),
            docHash: fnv1a(stableStringify(fromDoc)),
          };
        }
      }
      if (storeMismatch) mismatches++;
      stores[def.name] = {
        verdict: storeMismatch ? 'mismatch' : 'match',
        hydrated: handle?.hasHydrated() ?? null,
        obsolete: handle?.isObsolete() ?? null,
        ...(Object.keys(keys).length > 0 ? { keys } : {}),
      };
    } catch (error) {
      stores[def.name] = { verdict: 'error', error: String(error) };
    }
  }
  return { verdict: mismatches > 0 ? 'mismatch' : 'match', mismatchedStores: mismatches, stores };
}

/** y-idb: memory vs IndexedDB (see module docs). */
export async function checkPersistence(doc: Y.Doc): Promise<Record<string, unknown>> {
  try {
    const flushed = await withDeadline(flushYjsPersistence().then(() => 'ok' as const), 5000);
    const update = await readSnapshot();
    if (!update) return { verdict: 'mismatch', flushed, note: 'IndexedDB holds no Yjs state at all' };
    const disk = docFromUpdate(update);
    try {
      return { flushed, diskBytes: update.byteLength, ...compareReplicas(doc, disk) };
    } finally {
      disk.destroy();
    }
  } catch (error) {
    return { verdict: 'error', error: String(error) };
  }
}

/** y-cinder: memory vs a fresh Firestore download (see module docs). */
export async function checkRemote(doc: Y.Doc, timeoutMs: number): Promise<Record<string, unknown>> {
  const orchestrator = peekSyncOrchestrator();
  if (!orchestrator) return { verdict: 'skipped', reason: 'sync never composed on this device' };
  // What the LIVE provider still had queued at check time: a small
  // local-ahead gap is expected while these are in flight.
  const providerBefore = orchestrator.getDiagnostics().provider;
  const result = await orchestrator.downloadRemoteStateForDiagnostics(timeoutMs);
  if (!result.ok) return { verdict: 'error', error: result.error, ms: result.ms, providerBefore };
  const remote = docFromUpdate(result.update);
  try {
    return {
      workspaceId: result.workspaceId,
      ms: result.ms,
      remoteBytes: result.update.byteLength,
      providerBefore,
      ...compareReplicas(doc, remote),
    };
  } finally {
    remote.destroy();
  }
}

/** yjs: encode → decode → same content. */
export function checkRoundTrip(doc: Y.Doc): Record<string, unknown> {
  try {
    const copy = docFromUpdate(Y.encodeStateAsUpdate(doc));
    try {
      const c = compareReplicas(doc, copy);
      return { verdict: c.verdict, snapshotsEqual: c.snapshotsEqual, contentEqual: c.contentEqual, roots: c.roots };
    } finally {
      copy.destroy();
    }
  } catch (error) {
    return { verdict: 'error', error: String(error) };
  }
}

/** Run every layer check; `verdicts` is the one-glance summary. */
export async function runIntegrityChecks(opts?: { remoteTimeoutMs?: number }): Promise<Record<string, unknown>> {
  const doc = getYDoc();
  const bindings = checkStoreBindings(doc);
  const roundTrip = checkRoundTrip(doc);
  const persistence = await checkPersistence(doc);
  const remote = await checkRemote(doc, opts?.remoteTimeoutMs ?? 20000);
  const v = (r: Record<string, unknown>): unknown => r.verdict;
  return {
    verdicts: {
      'zustand-middleware-yjs (store ↔ doc)': v(bindings),
      'y-idb (doc ↔ IndexedDB)': v(persistence),
      'y-cinder (doc ↔ Firestore)': v(remote),
      'yjs (encode round trip)': v(roundTrip),
    },
    bindings,
    persistence,
    remote,
    roundTrip,
  };
}
