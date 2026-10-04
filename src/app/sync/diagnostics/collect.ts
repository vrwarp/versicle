/**
 * Build the sync diagnostics report: everything needed to explain "device A
 * and device B are not converging" from two exported files, without access
 * to either device.
 *
 * Comparing two devices' reports answers, in order:
 *  1. Are they even pointed at the same place? (firebase projectId, uid,
 *     activeWorkspaceId, the remote workspace directory)
 *  2. Is the connection actually live? (orchestrator status, the y-cinder
 *     provider's queue/retry/epoch-fence internals, recent sync events, the
 *     log ring)
 *  3. Has each device SEEN the other's writes? (the Y.Doc state vector —
 *     one clock per writing client — plus pending structs, i.e. updates
 *     received but blocked on a missing dependency)
 *  4. Where exactly do the replicas differ? (per top-level map: key list
 *     with a content hash per entry and any epoch-ms timestamp fields — no
 *     content itself)
 *
 * PRIVACY: values are never exported, only hashes; the email is masked and
 * the Firebase API key is reduced to a fingerprint. Entry KEYS (book ids,
 * device ids, …) are included because the cross-device diff needs them.
 */
import * as Y from 'yjs';
import { Capacitor } from '@capacitor/core';
import { getYDoc, getYjsPersistence, CURRENT_SCHEMA_VERSION } from '@store/yjs-provider';
import { useSyncStore } from '@store/useSyncStore';
import { useDeviceStore } from '@store/useDeviceStore';
import { getDeviceId } from '@lib/device-id';
import { getRecentLogs } from '@lib/logger';
import { MigrationStateService } from '@domains/sync/workspaces/MigrationStateService';
import { peekSyncOrchestrator, isSyncEnabled } from '../createSync';
import { getRecorderSnapshot } from './recorder';
import packageJson from '../../../../package.json';

/** Bump when the report shape changes incompatibly. */
const SYNC_DIAGNOSTICS_FORMAT = 1;

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
  return `{${Object.keys(obj)
    .sort()
    .map((k) => `${JSON.stringify(k)}:${stableStringify(obj[k])}`)
    .join(',')}}`;
}

export function maskEmail(email: string | null | undefined): string | null {
  if (!email) return null;
  const at = email.indexOf('@');
  if (at <= 0) return '***';
  return `${email[0]}***${email.slice(at)}`;
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

/** Summarize the replicated doc (see module docs, questions 3 + 4). */
export function summarizeDoc(doc: Y.Doc): Record<string, unknown> {
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

async function withTimeout<T>(promise: Promise<T>, ms: number, label: string): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      promise,
      new Promise<never>((_, reject) => {
        timer = setTimeout(() => reject(new Error(`${label} timed out after ${ms}ms`)), ms);
      }),
    ]);
  } finally {
    if (timer !== undefined) clearTimeout(timer);
  }
}

async function safely<T>(run: () => T | Promise<T>): Promise<T | { error: string }> {
  try {
    return await run();
  } catch (error) {
    return { error: String(error) };
  }
}

function environment(): Record<string, unknown> {
  const nav = typeof navigator !== 'undefined' ? navigator : undefined;
  return {
    appVersion: packageJson.version,
    buildMode: import.meta.env.MODE,
    platform: Capacitor.getPlatform(),
    native: Capacitor.isNativePlatform(),
    userAgent: nav?.userAgent ?? null,
    language: nav?.language ?? null,
    online: nav?.onLine ?? null,
    visibility: typeof document !== 'undefined' ? document.visibilityState : null,
    timeZone: Intl.DateTimeFormat().resolvedOptions().timeZone,
    timeOrigin: typeof performance !== 'undefined' ? performance.timeOrigin : null,
    uptimeMs: typeof performance !== 'undefined' ? Math.round(performance.now()) : null,
  };
}

function syncSettings(): Record<string, unknown> {
  const s = useSyncStore.getState();
  return {
    syncEnabledGate: isSyncEnabled(),
    firebaseEnabled: s.firebaseEnabled,
    firestoreStatus: s.firestoreStatus,
    firebaseAuthStatus: s.firebaseAuthStatus,
    firebaseUserEmail: maskEmail(s.firebaseUserEmail),
    activeWorkspaceId: s.activeWorkspaceId,
    lastSyncTime: s.lastSyncTime,
    hasCompletedOnboarding: s.hasCompletedOnboarding,
    firebaseConfig: {
      projectId: s.firebaseConfig.projectId || null,
      authDomain: s.firebaseConfig.authDomain || null,
      storageBucket: s.firebaseConfig.storageBucket || null,
      appId: s.firebaseConfig.appId || null,
      apiKeyFingerprint: s.firebaseConfig.apiKey ? fnv1a(s.firebaseConfig.apiKey) : null,
    },
  };
}

function devices(): Record<string, unknown> {
  const all = useDeviceStore.getState().devices;
  return {
    currentDeviceId: getDeviceId(),
    known: Object.values(all).map((d) => ({
      id: d.id,
      name: d.name,
      platform: d.platform,
      browser: d.browser,
      model: d.model,
      appVersion: d.appVersion,
      lastActive: d.lastActive,
      created: d.created,
    })),
  };
}

export interface SyncDiagnosticsReport {
  format: number;
  generatedAt: number;
  generatedAtIso: string;
  [section: string]: unknown;
}

/**
 * Collect the full report. Never throws: each section records its own
 * failure. The remote probe is skipped when sync never composed, and is
 * time-bounded so an offline device still exports promptly.
 */
export async function collectSyncDiagnostics(opts?: { remoteTimeoutMs?: number }): Promise<SyncDiagnosticsReport> {
  const orchestrator = peekSyncOrchestrator();
  const remoteTimeoutMs = opts?.remoteTimeoutMs ?? 8000;
  const persistence = getYjsPersistence();

  const [remote, storageEstimate] = await Promise.all([
    orchestrator
      ? safely(() =>
          withTimeout(orchestrator.probeRemoteDiagnostics(remoteTimeoutMs), remoteTimeoutMs + 2000, 'remote probe')
        )
      : Promise.resolve({ skipped: 'sync orchestrator never composed on this device (sync off or not configured)' }),
    safely(async () =>
      typeof navigator !== 'undefined' && navigator.storage?.estimate ? await navigator.storage.estimate() : null
    ),
  ]);

  const now = Date.now();
  return {
    format: SYNC_DIAGNOSTICS_FORMAT,
    generatedAt: now,
    generatedAtIso: new Date(now).toISOString(),
    environment: await safely(environment),
    devices: await safely(devices),
    syncSettings: await safely(syncSettings),
    migrationState: await safely(() => MigrationStateService.getState()),
    orchestrator: orchestrator ? await safely(() => orchestrator.getDiagnostics()) : null,
    remote,
    localPersistence: {
      started: persistence !== null,
      synced: persistence ? persistence.synced : null,
      destroyed: persistence ? Boolean(persistence._destroyed) : null,
      storageEstimate,
    },
    crdt: {
      currentSchemaVersion: CURRENT_SCHEMA_VERSION,
      doc: await safely(() => summarizeDoc(getYDoc())),
    },
    recorder: getRecorderSnapshot(),
    logs: getRecentLogs(),
  };
}
