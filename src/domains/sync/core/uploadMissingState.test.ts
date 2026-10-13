/**
 * uploadMissingState over a scripted backend (the real-y-cinder proof is
 * src/lib/sync/repairUpload.emulator.test.ts). The scripted connection
 * seeds the throwaway doc with the "cloud" state, announces `synced`, and —
 * like a provider — "saves" every local (non-cloud) update it sees.
 *
 * Every result is pinned EXACTLY (toEqual, exact log lines, exact listener
 * bookkeeping): the repair is a manual operator action whose report is the
 * only thing the operator sees, so a loosely-matched shape is a silent lie.
 */
import { describe, it, expect, vi, afterEach } from 'vitest';
import * as Y from 'yjs';
import type {
  ConnectOptions,
  SyncBackend,
  SyncConnection,
  SyncConnectionEvents,
} from '../backend/SyncBackend';
import { uploadMissingState } from './uploadMissingState';

afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
});

interface Script {
  cloud: Uint8Array | null;
  synced?: boolean;
  rejectSave?: boolean;
  /** Announce a `sync-failure` (with this payload) instead of `synced`. */
  syncFailure?: unknown;
  connectThrows?: Error;
  destroyThrows?: Error;
  uploads: Uint8Array[];
  /** Transaction origin of every local update the temp doc produced. */
  origins: unknown[];
  destroyed: number;
  connectOptions: ConnectOptions[];
  tempDoc: Y.Doc | null;
  /** Live listener count per event — the cleanup contract of waitFor. */
  listenerCounts: () => Record<string, number>;
}

const script = (over: Partial<Script> & Pick<Script, 'cloud'>): Script => ({
  uploads: [],
  origins: [],
  destroyed: 0,
  connectOptions: [],
  tempDoc: null,
  listenerCounts: () => ({}),
  ...over,
});

function scriptedBackend(s: Script): SyncBackend {
  return {
    connect: (tempDoc: Y.Doc, _workspaceId: string, options: ConnectOptions): SyncConnection => {
      s.connectOptions.push({ ...options });
      s.tempDoc = tempDoc;
      if (s.connectThrows) throw s.connectThrows;
      const listeners = new Map<string, Set<(...args: unknown[]) => void>>();
      s.listenerCounts = () =>
        Object.fromEntries([...listeners].map(([event, set]) => [event, set.size]));
      const emit = (event: keyof SyncConnectionEvents, ...args: unknown[]): void => {
        for (const cb of [...(listeners.get(event) ?? [])]) cb(...args);
      };
      tempDoc.on('update', (u: Uint8Array, origin: unknown) => {
        if (origin === 'cloud') return;
        s.uploads.push(u);
        s.origins.push(origin);
        setTimeout(() =>
          s.rejectSave
            ? emit('save-rejected', { code: 'max-retries-exceeded' })
            : emit('saved', Date.now())
        );
      });
      setTimeout(() => {
        if (s.cloud) Y.applyUpdate(tempDoc, s.cloud, 'cloud');
        if (s.syncFailure !== undefined) emit('sync-failure', s.syncFailure);
        else if (s.synced !== false) emit('synced');
      });
      return {
        on: (event, cb) => {
          if (!listeners.has(event)) listeners.set(event, new Set());
          listeners.get(event)!.add(cb as never);
        },
        off: (event, cb) => {
          listeners.get(event)?.delete(cb as never);
        },
        destroy: () => {
          s.destroyed++;
          if (s.destroyThrows) throw s.destroyThrows;
        },
      };
    },
  } as unknown as SyncBackend;
}

/**
 * Every listener set the repair registered has been emptied again: the
 * download phase waits on `synced`, the upload phase on `saved`, and both
 * watch the two failure events.
 */
const noListenersLeft = (s: Script, phases: 'download' | 'download+upload'): void => {
  const expected: Record<string, number> = { synced: 0, 'save-rejected': 0, 'sync-failure': 0 };
  if (phases === 'download+upload') expected.saved = 0;
  expect(s.listenerCounts()).toEqual(expected);
};

/** `ms` is a real elapsed duration, not a timestamp sum. */
const elapsedMs = (ms: number): void => {
  expect(ms).toBeGreaterThanOrEqual(0);
  expect(ms).toBeLessThan(10_000);
};

const silenceConsole = (): void => {
  vi.spyOn(console, 'warn').mockImplementation(() => {});
  vi.spyOn(console, 'info').mockImplementation(() => {});
  vi.spyOn(console, 'error').mockImplementation(() => {});
};

/** A device doc with three edits, and the cloud copy missing the middle one. */
function gappedFixture(): { device: Y.Doc; cloud: Uint8Array; missingBytes: number } {
  silenceConsole();
  const device = new Y.Doc();
  const updates: Uint8Array[] = [];
  device.on('update', (u: Uint8Array) => updates.push(u));
  device.getMap('annotations').set('note-1', 'a');
  device.getMap('annotations').set('note-2', 'b');
  device.getMap('library').set('book', 'c');
  const cloud = Y.mergeUpdates([updates[0], updates[2]]);
  // What the cloud INTEGRATES (the parked third edit does not count).
  const cloudDoc = new Y.Doc();
  Y.applyUpdate(cloudDoc, cloud);
  const missingBytes = Y.encodeStateAsUpdate(device, Y.encodeStateVector(cloudDoc)).byteLength;
  cloudDoc.destroy();
  return { device, cloud, missingBytes };
}

describe('uploadMissingState', () => {
  it('uploads exactly what the cloud does not integrate, filling the gap', async () => {
    const { device, cloud, missingBytes } = gappedFixture();
    const s = script({ cloud });

    const result = await uploadMissingState(scriptedBackend(s), 'ws_1', device, {
      maxWaitTimeMs: 1,
      timeoutMs: 1000,
    });

    expect(result).toEqual({
      ok: true,
      uploaded: true,
      bytes: missingBytes,
      // The cloud integrated clock 1 of 3; clock 2 is the gap, clock 3 is parked.
      clientsBehind: [{ client: device.clientID, cloud: 1, local: 3 }],
      cloudPendingBefore: { [device.clientID]: 1 },
      cloudPendingAfter: null,
      ms: expect.any(Number),
    });
    elapsedMs(result.ms);
    expect(missingBytes).toBeGreaterThan(0);
    // A peer holding the old cloud copy + the uploads converges.
    const peer = new Y.Doc();
    Y.applyUpdate(peer, cloud);
    for (const u of s.uploads) Y.applyUpdate(peer, u);
    expect(peer.getMap('annotations').toJSON()).toEqual({ 'note-1': 'a', 'note-2': 'b' });
    expect(peer.getMap('library').get('book')).toBe('c');
    expect(s.destroyed).toBe(1);
    expect(console.warn).toHaveBeenCalledTimes(1);
    expect(console.warn).toHaveBeenCalledWith(
      '[uploadMissingState]',
      `Repair: cloud is behind this device for 1 client(s); uploading ${missingBytes} bytes.`
    );
    expect(console.error).not.toHaveBeenCalled();
  });

  it('applies the repair as ONE local transaction tagged with the repair origin', async () => {
    const { device, cloud } = gappedFixture();
    const s = script({ cloud });

    await uploadMissingState(scriptedBackend(s), 'ws_1', device, { maxWaitTimeMs: 1, timeoutMs: 1000 });

    expect(s.origins).toEqual(['versicle:repair']);
    expect(s.uploads).toHaveLength(1);
  });

  it('connects the throwaway doc with the caller debounce and an un-reachable compaction threshold', async () => {
    const { device, cloud } = gappedFixture();
    const s = script({ cloud });

    await uploadMissingState(scriptedBackend(s), 'ws_1', device, { maxWaitTimeMs: 7, timeoutMs: 1000 });

    expect(s.connectOptions).toEqual([{ maxWaitTimeMs: 7, maxUpdatesThreshold: 1_000_000_000 }]);
  });

  it('is a no-op when the cloud already integrates everything', async () => {
    silenceConsole();
    const device = new Y.Doc();
    device.getMap('library').set('b1', 1);
    const s = script({ cloud: Y.encodeStateAsUpdate(device) });

    const result = await uploadMissingState(scriptedBackend(s), 'ws_1', device, {
      maxWaitTimeMs: 1,
      timeoutMs: 1000,
    });

    expect(result).toEqual({
      ok: true,
      uploaded: false,
      bytes: 0,
      clientsBehind: [],
      cloudPendingBefore: null,
      cloudPendingAfter: null,
      ms: expect.any(Number),
    });
    elapsedMs(result.ms);
    expect(s.uploads).toEqual([]);
    expect(s.destroyed).toBe(1);
    expect(console.info).toHaveBeenCalledWith(
      '[uploadMissingState]',
      'Repair: the cloud already integrates everything this device holds.'
    );
    expect(console.warn).not.toHaveBeenCalled();
    noListenersLeft(s, 'download');
  });

  it('fails (never uploads blind) when the cloud download does not complete', async () => {
    const { device } = gappedFixture();
    const s = script({ cloud: null, synced: false });

    const result = await uploadMissingState(scriptedBackend(s), 'ws_1', device, {
      maxWaitTimeMs: 1,
      timeoutMs: 20,
    });

    expect(result).toEqual({
      ok: false,
      error: 'Error: Cloud download timed out after 20ms',
      ms: expect.any(Number),
    });
    elapsedMs(result.ms);
    expect(s.uploads).toEqual([]);
    expect(s.destroyed).toBe(1);
    expect(console.error).toHaveBeenCalledTimes(1);
    expect(console.error).toHaveBeenCalledWith('[uploadMissingState]', 'Repair failed:', expect.any(Error));
    noListenersLeft(s, 'download');
  });

  it('reports a rejected upload as a failure', async () => {
    const { device, cloud } = gappedFixture();
    const s = script({ cloud, rejectSave: true });

    const result = await uploadMissingState(scriptedBackend(s), 'ws_1', device, {
      maxWaitTimeMs: 1,
      timeoutMs: 1000,
    });

    expect(result).toEqual({
      ok: false,
      error: 'Error: Repair upload failed: {"code":"max-retries-exceeded"}',
      ms: expect.any(Number),
    });
    elapsedMs(result.ms);
    expect(s.destroyed).toBe(1);
    noListenersLeft(s, 'download+upload');
  });

  it('reports a transport sync-failure during the download as that failure, not a timeout', async () => {
    const { device, cloud } = gappedFixture();
    const s = script({ cloud, syncFailure: new Error('cloud exploded') });

    const result = await uploadMissingState(scriptedBackend(s), 'ws_1', device, {
      maxWaitTimeMs: 1,
      timeoutMs: 50,
    });

    expect(result).toEqual({ ok: false, error: 'Error: cloud exploded', ms: expect.any(Number) });
    expect(s.uploads).toEqual([]);
    expect(s.destroyed).toBe(1);
    expect(console.error).toHaveBeenCalledWith('[uploadMissingState]', 'Repair failed:', expect.any(Error));
    noListenersLeft(s, 'download');
  });

  it('detaches every listener and timer it registered once the repair resolves', async () => {
    const { device, cloud } = gappedFixture();
    const s = script({ cloud });
    vi.useFakeTimers();

    const pending = uploadMissingState(scriptedBackend(s), 'ws_1', device, {
      maxWaitTimeMs: 1,
      timeoutMs: 1000,
    });
    // Only the scripted 0ms announcements run; the 1000ms budgets must be
    // CLEARED by the repair itself, never run out.
    await vi.advanceTimersByTimeAsync(1);
    await vi.advanceTimersByTimeAsync(1);
    const result = await pending;

    expect(result).toMatchObject({ ok: true, uploaded: true });
    noListenersLeft(s, 'download+upload');
    expect(vi.getTimerCount()).toBe(0);
  });

  it('caps the per-client report at 200 entries', async () => {
    silenceConsole();
    const device = new Y.Doc();
    for (let i = 0; i < 201; i++) {
      const peer = new Y.Doc();
      peer.getMap('library').set(`k${i}`, i);
      Y.applyUpdate(device, Y.encodeStateAsUpdate(peer));
      peer.destroy();
    }
    const s = script({ cloud: null });

    const result = await uploadMissingState(scriptedBackend(s), 'ws_1', device, {
      maxWaitTimeMs: 1,
      timeoutMs: 1000,
    });

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.uploaded).toBe(true);
    expect(result.clientsBehind).toHaveLength(200);
    expect(result.clientsBehind.every((c) => c.cloud === 0 && c.local === 1)).toBe(true);
    expect(console.warn).toHaveBeenCalledWith(
      '[uploadMissingState]',
      `Repair: cloud is behind this device for 201 client(s); uploading ${result.bytes} bytes.`
    );
  });

  it('fails cleanly when the backend refuses to connect — nothing to destroy', async () => {
    const { device, cloud } = gappedFixture();
    const s = script({ cloud, connectThrows: new Error('attach refused') });

    const result = await uploadMissingState(scriptedBackend(s), 'ws_1', device, {
      maxWaitTimeMs: 1,
      timeoutMs: 1000,
    });

    expect(result).toEqual({ ok: false, error: 'Error: attach refused', ms: expect.any(Number) });
    elapsedMs(result.ms);
    expect(s.destroyed).toBe(0);
    expect(console.error).toHaveBeenCalledTimes(1);
    expect(console.error).toHaveBeenCalledWith('[uploadMissingState]', 'Repair failed:', s.connectThrows);
    expect(s.tempDoc?.isDestroyed).toBe(true);
  });

  it('a throwing provider destroy is logged, and the repair still reports success', async () => {
    const { device, cloud } = gappedFixture();
    const s = script({ cloud, destroyThrows: new Error('teardown exploded') });

    const result = await uploadMissingState(scriptedBackend(s), 'ws_1', device, {
      maxWaitTimeMs: 1,
      timeoutMs: 1000,
    });

    expect(result).toMatchObject({ ok: true, uploaded: true });
    expect(s.destroyed).toBe(1);
    expect(console.error).toHaveBeenCalledTimes(1);
    expect(console.error).toHaveBeenCalledWith(
      '[uploadMissingState]',
      'Error destroying repair provider',
      s.destroyThrows
    );
  });

  it('always destroys the throwaway doc', async () => {
    const { device, cloud } = gappedFixture();
    const s = script({ cloud });

    await uploadMissingState(scriptedBackend(s), 'ws_1', device, { maxWaitTimeMs: 1, timeoutMs: 1000 });

    expect(s.tempDoc).not.toBeNull();
    expect(s.tempDoc).not.toBe(device);
    expect(s.tempDoc?.isDestroyed).toBe(true);
    expect(device.isDestroyed).toBe(false);
  });
});
