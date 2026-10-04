/**
 * Content fingerprinting for the sync diagnostics: a Y.Doc summary that two
 * replicas can be compared on WITHOUT exporting any content — state vector,
 * pending structs, and per top-level map an FNV-1a hash per entry (over a
 * key-order-independent JSON rendering) plus any epoch-ms timestamp fields.
 * Shared by the report collector (./collect.ts) and the library cross-checks
 * (./integrity.ts).
 */
import * as Y from 'yjs';

/** Per-map entry cap (keeps a pathological map from bloating the export). */
const MAX_ENTRIES_PER_MAP = 20000;

/** 32-bit FNV-1a, hex. Stable across devices/engines for the same string. */
export function fnv1a(input: string): string {
  let hash = 0x811c9dc5;
  for (let i = 0; i < input.length; i++) {
    hash ^= input.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193);
  }
  return (hash >>> 0).toString(16).padStart(8, '0');
}

/** JSON with object keys sorted, so equal values hash equally on every device. */
export function stableStringify(value: unknown): string {
  if (value === undefined) return 'undefined';
  if (value === null || typeof value !== 'object') return JSON.stringify(value) ?? String(value);
  if (value instanceof Uint8Array) return `bytes:${value.byteLength}:${fnv1a(Array.from(value).join(','))}`;
  if (Array.isArray(value)) return `[${value.map(stableStringify).join(',')}]`;
  const obj = value as Record<string, unknown>;
  // Like JSON: an undefined-valued key is the same as an absent one (the
  // CRDT can hold an explicit `undefined` where the store simply omits it).
  return `{${Object.keys(obj)
    .filter((k) => obj[k] !== undefined)
    .sort()
    .map((k) => `${JSON.stringify(k)}:${stableStringify(obj[k])}`)
    .join(',')}}`;
}

function toPlain(value: unknown): unknown {
  if (value instanceof Y.AbstractType) return value.toJSON();
  return value;
}

/** Epoch-millisecond-looking numeric top-level fields (2001‥2286). */
function timestampFields(value: unknown): Record<string, number> | undefined {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return undefined;
  const out: Record<string, number> = {};
  let n = 0;
  for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
    if (typeof v === 'number' && v > 1e12 && v < 1e13) {
      out[k] = v;
      if (++n >= 8) break;
    }
  }
  return n > 0 ? out : undefined;
}

interface MapEntrySummary {
  /** FNV-1a of the stable JSON of the value. */
  h: string;
  /** Epoch-ms timestamp fields of the value, when it is an object. */
  ts?: Record<string, number>;
}

interface SharedTypeSummary {
  kind: string;
  size: number;
  /** Hash over all entry hashes — equal digests ⇒ identical content. */
  digest: string;
  entries?: Record<string, MapEntrySummary>;
  truncated?: boolean;
}

export interface DocSummary {
  clientID: number;
  gc: boolean;
  encodedStateBytes: number;
  /** One entry per client that ever wrote, highest clock first. */
  stateVector: Array<{ client: number; clock: number; self: boolean }>;
  /** Updates received but blocked on a missing dependency (null = none). */
  pendingStructs: { missing: Record<string, number>; updateBytes: number } | null;
  pendingDeleteSetBytes: number;
  metaSchemaVersion: unknown;
  shared: Record<string, SharedTypeSummary>;
}

/** Summarize a doc so two replicas can be compared without their content. */
export function summarizeDoc(doc: Y.Doc): DocSummary {
  const stateVector = Y.decodeStateVector(Y.encodeStateVector(doc));
  const clients = [...stateVector.entries()]
    .map(([client, clock]) => ({ client, clock, self: client === doc.clientID }))
    .sort((a, b) => b.clock - a.clock);

  const store = doc.store as unknown as {
    pendingStructs: { missing: Map<number, number>; update: Uint8Array } | null;
    pendingDs: Uint8Array | null;
  };
  const pendingStructs = store.pendingStructs
    ? {
        missing: Object.fromEntries(store.pendingStructs.missing),
        updateBytes: store.pendingStructs.update.byteLength,
      }
    : null;

  const shared: Record<string, SharedTypeSummary> = {};
  for (const [name, type] of doc.share) {
    if (type instanceof Y.Map) {
      const entries: Record<string, MapEntrySummary> = {};
      const hashes: string[] = [];
      let count = 0;
      let truncated = false;
      for (const key of [...type.keys()].sort()) {
        const plain = toPlain(type.get(key));
        const h = fnv1a(stableStringify(plain));
        hashes.push(`${key}=${h}`);
        if (count < MAX_ENTRIES_PER_MAP) {
          const ts = timestampFields(plain);
          entries[key] = ts ? { h, ts } : { h };
        } else {
          truncated = true;
        }
        count++;
      }
      shared[name] = {
        kind: 'map',
        size: type.size,
        digest: fnv1a(hashes.join('|')),
        entries,
        ...(truncated ? { truncated } : {}),
      };
    } else if (type instanceof Y.Array) {
      shared[name] = { kind: 'array', size: type.length, digest: fnv1a(stableStringify(type.toJSON())) };
    } else if (type instanceof Y.Text) {
      shared[name] = { kind: 'text', size: type.length, digest: fnv1a(type.toString()) };
    } else {
      // A root nobody on this device has accessed with a concrete type yet
      // (data arrived from elsewhere). Report its raw shape only.
      const raw = type as unknown as { _map: Map<string, unknown>; _length: number };
      shared[name] = {
        kind: 'untyped',
        size: raw._map?.size ?? raw._length ?? 0,
        digest: fnv1a([...(raw._map?.keys() ?? [])].sort().join('|')),
      };
    }
  }

  return {
    clientID: doc.clientID,
    gc: doc.gc,
    encodedStateBytes: Y.encodeStateAsUpdate(doc).byteLength,
    stateVector: clients,
    pendingStructs,
    pendingDeleteSetBytes: store.pendingDs?.byteLength ?? 0,
    metaSchemaVersion: doc.share.has('meta') ? (doc.getMap('meta').get('schemaVersion') ?? null) : null,
    shared,
  };
}
