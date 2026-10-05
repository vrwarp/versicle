/**
 * uploadMissingState over a scripted backend (the real-y-cinder proof is
 * src/lib/sync/repairUpload.emulator.test.ts). The scripted connection
 * seeds the throwaway doc with the "cloud" state, announces `synced`, and —
 * like a provider — "saves" every local (non-cloud) update it sees.
 */
import { describe, it, expect, vi, afterEach } from 'vitest';
import * as Y from 'yjs';
import type { SyncBackend, SyncConnection, SyncConnectionEvents } from '../backend/SyncBackend';
import { uploadMissingState } from './uploadMissingState';

afterEach(() => vi.restoreAllMocks());

interface Script {
  cloud: Uint8Array | null;
  synced?: boolean;
  rejectSave?: boolean;
  uploads: Uint8Array[];
  destroyed: number;
}

function scriptedBackend(script: Script): SyncBackend {
  return {
    connect: (tempDoc: Y.Doc): SyncConnection => {
      const listeners = new Map<string, Set<(...args: unknown[]) => void>>();
      const emit = (event: keyof SyncConnectionEvents, ...args: unknown[]): void => {
        for (const cb of [...(listeners.get(event) ?? [])]) cb(...args);
      };
      tempDoc.on('update', (u: Uint8Array, origin: unknown) => {
        if (origin === 'cloud') return;
        script.uploads.push(u);
        setTimeout(() =>
          script.rejectSave
            ? emit('save-rejected', { code: 'max-retries-exceeded' })
            : emit('saved', Date.now())
        );
      });
      setTimeout(() => {
        if (script.cloud) Y.applyUpdate(tempDoc, script.cloud, 'cloud');
        if (script.synced !== false) emit('synced');
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
          script.destroyed++;
        },
      };
    },
  } as unknown as SyncBackend;
}

/** A device doc with three edits, and the cloud copy missing the middle one. */
function gappedFixture(): { device: Y.Doc; cloud: Uint8Array } {
  vi.spyOn(console, 'warn').mockImplementation(() => {});
  vi.spyOn(console, 'info').mockImplementation(() => {});
  const device = new Y.Doc();
  const updates: Uint8Array[] = [];
  device.on('update', (u: Uint8Array) => updates.push(u));
  device.getMap('annotations').set('note-1', 'a');
  device.getMap('annotations').set('note-2', 'b');
  device.getMap('library').set('book', 'c');
  return { device, cloud: Y.mergeUpdates([updates[0], updates[2]]) };
}

describe('uploadMissingState', () => {
  it('uploads exactly what the cloud does not integrate, filling the gap', async () => {
    const { device, cloud } = gappedFixture();
    const script: Script = { cloud, uploads: [], destroyed: 0 };

    const result = await uploadMissingState(scriptedBackend(script), 'ws_1', device, {
      maxWaitTimeMs: 1,
      timeoutMs: 1000,
    });

    expect(result).toMatchObject({
      ok: true,
      uploaded: true,
      clientsBehind: [{ client: device.clientID }],
      cloudPendingBefore: { [device.clientID]: expect.any(Number) },
      cloudPendingAfter: null,
    });
    // A peer holding the old cloud copy + the uploads converges.
    const peer = new Y.Doc();
    Y.applyUpdate(peer, cloud);
    for (const u of script.uploads) Y.applyUpdate(peer, u);
    expect(peer.getMap('annotations').toJSON()).toEqual({ 'note-1': 'a', 'note-2': 'b' });
    expect(peer.getMap('library').get('book')).toBe('c');
    expect(script.destroyed).toBe(1);
  });

  it('is a no-op when the cloud already integrates everything', async () => {
    const device = new Y.Doc();
    device.getMap('library').set('b1', 1);
    const script: Script = { cloud: Y.encodeStateAsUpdate(device), uploads: [], destroyed: 0 };
    vi.spyOn(console, 'info').mockImplementation(() => {});

    const result = await uploadMissingState(scriptedBackend(script), 'ws_1', device, {
      maxWaitTimeMs: 1,
      timeoutMs: 1000,
    });

    expect(result).toMatchObject({ ok: true, uploaded: false, bytes: 0, clientsBehind: [] });
    expect(script.uploads).toEqual([]);
    expect(script.destroyed).toBe(1);
  });

  it('fails (never uploads blind) when the cloud download does not complete', async () => {
    const { device } = gappedFixture();
    vi.spyOn(console, 'error').mockImplementation(() => {});
    const script: Script = { cloud: null, synced: false, uploads: [], destroyed: 0 };

    const result = await uploadMissingState(scriptedBackend(script), 'ws_1', device, {
      maxWaitTimeMs: 1,
      timeoutMs: 20,
    });

    expect(result).toMatchObject({ ok: false, error: expect.stringContaining('Cloud download timed out') });
    expect(script.uploads).toEqual([]);
    expect(script.destroyed).toBe(1);
  });

  it('reports a rejected upload as a failure', async () => {
    const { device, cloud } = gappedFixture();
    vi.spyOn(console, 'error').mockImplementation(() => {});
    const script: Script = { cloud, rejectSave: true, uploads: [], destroyed: 0 };

    const result = await uploadMissingState(scriptedBackend(script), 'ws_1', device, {
      maxWaitTimeMs: 1,
      timeoutMs: 1000,
    });

    expect(result).toMatchObject({ ok: false, error: expect.stringContaining('Repair upload failed') });
  });
});
