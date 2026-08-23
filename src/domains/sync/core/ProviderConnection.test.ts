/**
 * `ProviderConnection` unit suite — the attach/detach lifecycle, the
 * transport→SyncEvent normalization and the §D5.2 live quarantine observer.
 *
 * The orchestrator characterization suite drives this class through the
 * real wiring; this file pins it directly, so each transport event's
 * translation (status side-effect + emitted event + operator log) and the
 * failure arms (connect throws, destroy throws, pre-attach quarantine) are
 * asserted individually rather than incidentally.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import * as Y from 'yjs';
import type { FirestoreSyncStatus } from '~types/sync';
import type {
  ConnectOptions,
  SyncBackend,
  SyncConnection,
  SyncConnectionEvents,
} from '../backend/SyncBackend';
import type { SyncEvent } from '../events';
import { ProviderConnection } from './ProviderConnection';

const SCHEMA_VERSION = 6;
const OPTS: ConnectOptions = { maxWaitTimeMs: 100, maxUpdatesThreshold: 5 };

type Listeners = { [E in keyof SyncConnectionEvents]?: SyncConnectionEvents[E][] };

interface FakeConnection extends SyncConnection {
  fire<E extends keyof SyncConnectionEvents>(
    event: E,
    ...args: Parameters<SyncConnectionEvents[E]>
  ): void;
  destroyed: number;
  subscribed: string[];
}

const makeConnection = (onDestroy?: () => void): FakeConnection => {
  const listeners: Listeners = {};
  const conn: FakeConnection = {
    destroyed: 0,
    subscribed: [],
    on: (event, cb) => {
      conn.subscribed.push(event as string);
      ((listeners[event] ??= []) as unknown[]).push(cb);
    },
    off: () => undefined,
    destroy: () => {
      conn.destroyed += 1;
      onDestroy?.();
    },
    fire: (event, ...args) => {
      for (const cb of (listeners[event] ?? []) as Array<(...a: unknown[]) => void>) {
        cb(...(args as unknown[]));
      }
    },
  };
  return conn;
};

interface Harness {
  provider: ProviderConnection;
  doc: Y.Doc;
  events: SyncEvent[];
  statuses: FirestoreSyncStatus[];
  obsoleteCalls: number[];
  warnLogs: string[];
  errorLogs: unknown[][];
  infoLogs: string[];
}

let harness: Harness;

const makeHarness = (
  onObsolete: (v: number, h: Harness) => void = () => undefined
): Harness => {
  const doc = new Y.Doc();
  const events: SyncEvent[] = [];
  const statuses: FirestoreSyncStatus[] = [];
  const obsoleteCalls: number[] = [];
  const warnLogs: string[] = [];
  const errorLogs: unknown[][] = [];
  const infoLogs: string[] = [];

  vi.spyOn(console, 'info').mockImplementation((...a: unknown[]) => {
    infoLogs.push(a.map(String).join(' '));
  });
  vi.spyOn(console, 'debug').mockImplementation(() => {});
  vi.spyOn(console, 'warn').mockImplementation((...a: unknown[]) => {
    warnLogs.push(a.map(String).join(' '));
  });
  vi.spyOn(console, 'error').mockImplementation((...a: unknown[]) => {
    errorLogs.push(a);
  });

  const h = {
    doc,
    events,
    statuses,
    obsoleteCalls,
    warnLogs,
    errorLogs,
    infoLogs,
  } as Harness;

  h.provider = new ProviderConnection({
    events: {
      emit: (e) => {
        events.push(e);
      },
      on: () => () => undefined,
    },
    doc: () => doc,
    currentSchemaVersion: SCHEMA_VERSION,
    onObsolete: (v) => {
      obsoleteCalls.push(v);
      onObsolete(v, h);
    },
    setStatus: (s) => {
      statuses.push(s);
    },
  });
  return h;
};

const backendFor = (connection: SyncConnection | (() => never)): SyncBackend =>
  ({
    uid: 'unit',
    connect: typeof connection === 'function' ? connection : () => connection,
  }) as unknown as SyncBackend;

beforeEach(() => {
  harness = makeHarness();
});

afterEach(() => {
  vi.restoreAllMocks();
  harness.doc.destroy();
});

describe('ProviderConnection.attach — the happy path', () => {
  it('reports connecting then connected, and subscribes to every transport event', () => {
    const conn = makeConnection();

    harness.provider.attach(backendFor(conn), 'ws_1', OPTS);

    expect(harness.statuses).toEqual(['connecting', 'connected']);
    expect(harness.provider.isAttached()).toBe(true);
    expect(new Set(conn.subscribed)).toEqual(
      new Set(['connection-error', 'sync-failure', 'save-rejected', 'saved', 'epoch-changed'])
    );
    expect(harness.infoLogs.some((l) => l.includes('Connected to workspace: ws_1'))).toBe(true);
  });

  it('forwards the connect options and the live doc to the backend verbatim', () => {
    const seen: unknown[] = [];
    const backend = {
      uid: 'unit',
      connect: (doc: Y.Doc, workspaceId: string, opts: ConnectOptions) => {
        seen.push(doc, workspaceId, opts);
        return makeConnection();
      },
    } as unknown as SyncBackend;

    harness.provider.attach(backend, 'ws_9', OPTS);

    expect(seen).toEqual([harness.doc, 'ws_9', OPTS]);
  });

  it('is NOT attached before the first attach', () => {
    expect(harness.provider.isAttached()).toBe(false);
  });
});

describe('ProviderConnection.attach — transport event normalization', () => {
  const attach = (): FakeConnection => {
    const conn = makeConnection();
    harness.provider.attach(backendFor(conn), 'ws_1', OPTS);
    harness.statuses.length = 0;
    harness.events.length = 0;
    return conn;
  };

  it('a connection error becomes status=error plus a connection-error event carrying the denial flag', () => {
    const conn = attach();

    conn.fire('connection-error', { code: 'permission-denied' });

    expect(harness.statuses).toEqual(['error']);
    expect(harness.events).toEqual([{ type: 'connection-error', permissionDenied: true }]);
    expect(
      harness.errorLogs.some((a) => a.some((x) => String(x).includes('Firestore connection error')))
    ).toBe(true);
  });

  it('a non-permission connection error reports permissionDenied: false', () => {
    const conn = attach();

    conn.fire('connection-error', { code: 'unavailable' });

    expect(harness.events).toEqual([{ type: 'connection-error', permissionDenied: false }]);
  });

  it('a max-retries sync failure becomes status=error plus a sync-failure event', () => {
    const conn = attach();

    conn.fire('sync-failure', { code: 'permission-denied' });

    expect(harness.statuses).toEqual(['error']);
    expect(harness.events).toEqual([{ type: 'sync-failure', permissionDenied: true }]);
    expect(
      harness.errorLogs.some((a) =>
        a.some((x) => String(x).includes('Firestore sync failure after max retries'))
      )
    ).toBe(true);
  });

  it('a rejected save forwards code and size alongside the denial flag', () => {
    const conn = attach();

    conn.fire('save-rejected', { code: 'document-too-large', sizeBytes: 1_234_567 });

    expect(harness.statuses).toEqual(['error']);
    expect(harness.events).toEqual([
      {
        type: 'save-rejected',
        code: 'document-too-large',
        sizeBytes: 1_234_567,
        permissionDenied: false,
      },
    ]);
    expect(
      harness.errorLogs.some((a) => a.some((x) => String(x).includes('Firestore save rejected')))
    ).toBe(true);
  });

  it('a committed save becomes a `flushed` event at the reported timestamp — and does NOT touch status', () => {
    const conn = attach();

    conn.fire('saved', 1_700_000_000_000);

    expect(harness.events).toEqual([{ type: 'flushed', at: 1_700_000_000_000 }]);
    expect(harness.statuses).toEqual([]);
  });

  it('an epoch change reports the connection DOWN and republishes the epoch pair', () => {
    const conn = attach();

    conn.fire('epoch-changed', { epoch: 4, previousEpoch: 3, self: false });

    expect(harness.statuses).toEqual(['disconnected']);
    expect(harness.events).toEqual([
      { type: 'epoch-changed', epoch: 4, previousEpoch: 3, self: false },
    ]);
    const line = harness.warnLogs.find((l) => l.includes('epoch'));
    expect(line).toContain('moved to epoch 4');
    expect(line).toContain('local epoch 3');
    expect(line).toContain('Sync is fenced');
    expect(line).not.toContain('squashed by this device');
  });

  it('marks the log when THIS device ran the squash', () => {
    const conn = attach();

    conn.fire('epoch-changed', { epoch: 4, previousEpoch: 3, self: true });

    expect(harness.warnLogs.find((l) => l.includes('epoch'))).toContain(
      'squashed by this device'
    );
    expect(harness.events).toEqual([
      { type: 'epoch-changed', epoch: 4, previousEpoch: 3, self: true },
    ]);
  });
});

describe('ProviderConnection.attach — live quarantine (§D5.2)', () => {
  it('a doc ALREADY past the supported version never reports connected', () => {
    // The real subscriber severs re-entrantly; model that by detaching.
    harness = makeHarness((_v, h) => h.provider.detach());
    harness.doc.getMap('meta').set('schemaVersion', SCHEMA_VERSION + 1);

    harness.provider.attach(backendFor(makeConnection()), 'ws_1', OPTS);

    expect(harness.obsoleteCalls).toEqual([SCHEMA_VERSION + 1]);
    expect(harness.statuses).toEqual(['connecting', 'disconnected']);
    expect(harness.statuses).not.toContain('connected');
    expect(harness.warnLogs.some((l) => l.includes('Live quarantine'))).toBe(true);
    expect(harness.warnLogs.some((l) => l.includes('v7') && l.includes('v6'))).toBe(true);
  });

  it('a doc at EXACTLY the supported version attaches normally', () => {
    harness.doc.getMap('meta').set('schemaVersion', SCHEMA_VERSION);

    harness.provider.attach(backendFor(makeConnection()), 'ws_1', OPTS);

    expect(harness.obsoleteCalls).toEqual([]);
    expect(harness.statuses).toEqual(['connecting', 'connected']);
  });

  it('a NON-numeric schemaVersion is ignored rather than compared', () => {
    harness.doc.getMap('meta').set('schemaVersion', '99');

    harness.provider.attach(backendFor(makeConnection()), 'ws_1', OPTS);

    expect(harness.obsoleteCalls).toEqual([]);
    expect(harness.statuses).toEqual(['connecting', 'connected']);
  });

  it('fires synchronously when a REMOTE write lifts meta.schemaVersion past ours', () => {
    harness.provider.attach(backendFor(makeConnection()), 'ws_1', OPTS);
    expect(harness.obsoleteCalls).toEqual([]);

    harness.doc.getMap('meta').set('schemaVersion', 9);

    expect(harness.obsoleteCalls).toEqual([9]);
  });

  it('watches `meta` specifically — a sibling map at the same key is inert', () => {
    harness.provider.attach(backendFor(makeConnection()), 'ws_1', OPTS);

    harness.doc.getMap('library').set('schemaVersion', 9);

    expect(harness.obsoleteCalls).toEqual([]);
  });

  it('stops observing once detached', () => {
    harness.provider.attach(backendFor(makeConnection()), 'ws_1', OPTS);
    harness.provider.detach();

    harness.doc.getMap('meta').set('schemaVersion', 9);

    expect(harness.obsoleteCalls).toEqual([]);
  });
});

describe('ProviderConnection.attach — connect failure', () => {
  it('swallows a synchronous connect throw, reports error, and stays unattached', () => {
    const boom = new Error('offline');

    harness.provider.attach(
      backendFor(() => {
        throw boom;
      }),
      'ws_1',
      OPTS
    );

    expect(harness.statuses).toEqual(['connecting', 'error']);
    expect(harness.provider.isAttached()).toBe(false);
    expect(harness.events).toEqual([]);
    expect(
      harness.errorLogs.some(
        (a) => a.some((x) => String(x).includes('Failed to connect')) && a.includes(boom)
      )
    ).toBe(true);
  });
});

describe('ProviderConnection.detach', () => {
  it('destroys the connection, drops the attachment, and reports disconnected', () => {
    const conn = makeConnection();
    harness.provider.attach(backendFor(conn), 'ws_1', OPTS);

    harness.provider.detach();

    expect(conn.destroyed).toBe(1);
    expect(harness.provider.isAttached()).toBe(false);
    expect(harness.statuses.at(-1)).toBe('disconnected');
  });

  it('is idempotent — a second detach destroys nothing but still reports disconnected', () => {
    const conn = makeConnection();
    harness.provider.attach(backendFor(conn), 'ws_1', OPTS);
    harness.provider.detach();
    harness.statuses.length = 0;

    harness.provider.detach();

    expect(conn.destroyed).toBe(1);
    expect(harness.statuses).toEqual(['disconnected']);
  });

  it('reports disconnected even when nothing was ever attached', () => {
    harness.provider.detach();

    expect(harness.statuses).toEqual(['disconnected']);
  });

  it('a throwing destroy is logged but still clears the attachment and reports disconnected', () => {
    const conn = makeConnection(() => {
      throw new Error('teardown exploded');
    });
    harness.provider.attach(backendFor(conn), 'ws_1', OPTS);

    expect(() => harness.provider.detach()).not.toThrow();

    expect(harness.provider.isAttached()).toBe(false);
    expect(harness.statuses.at(-1)).toBe('disconnected');
    expect(
      harness.errorLogs.some((a) => a.some((x) => String(x).includes('Error destroying provider')))
    ).toBe(true);
  });
});
