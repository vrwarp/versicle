import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import * as Y from 'yjs';
import packageJson from '../../../../package.json';
import { useSyncStore } from '@store/useSyncStore';
import { useDeviceStore } from '@store/useDeviceStore';
import { getYDoc, CURRENT_SCHEMA_VERSION } from '@store/yjs-provider';
import { getDeviceId } from '@lib/device-id';
import { fnv1a } from './docSummary';

// ── doubles: the composition root's orchestrator peek + sync gate ──────────

interface FakeOrchestrator {
  getDiagnostics: () => Record<string, unknown>;
  probeRemoteDiagnostics: (timeoutMs: number) => Promise<unknown>;
  downloadRemoteStateForDiagnostics: (
    timeoutMs: number
  ) => Promise<{ ok: true; workspaceId: string; update: Uint8Array; ms: number } | { ok: false; error: string; ms: number }>;
}

const h = vi.hoisted(() => ({
  syncEnabled: false,
  orchestrator: null as null | FakeOrchestrator,
}));

vi.mock('../createSync', () => ({
  peekSyncOrchestrator: () => h.orchestrator,
  isSyncEnabled: () => h.syncEnabled,
}));

import { collectSyncDiagnostics, maskEmail, uploadHealth } from './collect';

const VERDICT_LABELS = [
  'zustand-middleware-yjs (store ↔ doc)',
  'y-idb (doc ↔ IndexedDB)',
  'y-cinder (doc ↔ Firestore)',
  'yjs (encode round trip)',
];

/** An orchestrator whose remote is a replica of the live doc; records the budgets it was given. */
function fakeOrchestrator(overrides: Partial<FakeOrchestrator> = {}): FakeOrchestrator & {
  probeTimeouts: number[];
  downloadTimeouts: number[];
} {
  const probeTimeouts: number[] = [];
  const downloadTimeouts: number[] = [];
  return {
    probeTimeouts,
    downloadTimeouts,
    getDiagnostics: () => ({
      status: 'connected',
      provider: { transport: { saveInFlight: false, pendingUpdates: 0, saveRetryCount: 0 } },
    }),
    probeRemoteDiagnostics: async (timeoutMs) => {
      probeTimeouts.push(timeoutMs);
      return { workspaces: [], pendingWrites: { state: 'acknowledged' } };
    },
    downloadRemoteStateForDiagnostics: async (timeoutMs) => {
      downloadTimeouts.push(timeoutMs);
      return { ok: true, workspaceId: 'ws_1', update: Y.encodeStateAsUpdate(getYDoc()), ms: 1 };
    },
    ...overrides,
  };
}

beforeEach(() => {
  h.syncEnabled = false;
  h.orchestrator = null;
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.useRealTimers();
});

describe('maskEmail', () => {
  it('keeps only the first letter and the domain', () => {
    expect(maskEmail('reader@example.com')).toBe('r***@example.com');
    expect(maskEmail('a@b')).toBe('a***@b');
  });

  it('hides everything of an address without a local part, and nothing of no address', () => {
    expect(maskEmail('no-at-sign')).toBe('***');
    expect(maskEmail('@example.com')).toBe('***');
    expect(maskEmail(null)).toBeNull();
    expect(maskEmail(undefined)).toBeNull();
    expect(maskEmail('')).toBeNull();
  });
});

describe('collectSyncDiagnostics', () => {
  it('produces a complete, JSON-serializable report when sync never composed', async () => {
    const report = await collectSyncDiagnostics();

    expect(report.format).toBe(2);
    expect(report.generatedAtIso).toBe(new Date(report.generatedAt).toISOString());
    expect(report.orchestrator).toBeNull();
    expect(report.remote).toStrictEqual({
      skipped: 'sync orchestrator never composed on this device (sync off or not configured)',
    });
    expect(report.uploads).toStrictEqual({ verdict: 'skipped', reason: 'no live sync connection' });
    expect(Object.keys(report.verdicts as object)).toStrictEqual(VERDICT_LABELS);
    expect(report.verdicts).toStrictEqual((report.integrity as { verdicts: unknown }).verdicts);
    expect(report.migrationState).toBeNull();
    expect(report.localPersistence).toStrictEqual({ started: false, synced: null, destroyed: null, storageEstimate: null });
    expect(report.crdt).toMatchObject({ currentSchemaVersion: CURRENT_SCHEMA_VERSION, doc: { stateVector: expect.any(Array) } });
    expect(report).toHaveProperty('recorder.updates');
    expect(Array.isArray(report.logs)).toBe(true);
    expect(() => JSON.stringify(report)).not.toThrow();
    expect(JSON.stringify(report)).not.toMatch(/apiKey"/);
  });

  it('reports the declared sync-path library pins of this build', async () => {
    const deps = packageJson.dependencies as Record<string, string>;

    const { libraries } = await collectSyncDiagnostics();

    expect(libraries).toStrictEqual({
      yjs: deps.yjs,
      'y-cinder': deps['y-cinder'],
      'y-idb': deps['y-idb'],
      'zustand-middleware-yjs': deps['zustand-middleware-yjs'],
      firebase: deps.firebase,
      zustand: deps.zustand,
    });
    expect(typeof deps.yjs).toBe('string');
  });

  it('reports the environment of this bundle and host', async () => {
    const build = { sha: 'abc1234', dirty: false, time: '2026-10-12T00:00:00Z' };
    vi.stubGlobal('__VERSICLE_BUILD__', build);

    const { environment } = await collectSyncDiagnostics();

    expect(environment).toStrictEqual({
      appVersion: packageJson.version,
      build,
      buildMode: 'test',
      platform: 'web',
      native: false,
      userAgent: navigator.userAgent,
      language: navigator.language,
      online: true,
      visibility: document.visibilityState,
      timeZone: Intl.DateTimeFormat().resolvedOptions().timeZone,
      timeOrigin: performance.timeOrigin,
      uptimeMs: expect.any(Number),
    });
    expect((environment as { uptimeMs: number }).uptimeMs).toBeGreaterThan(0);
    expect(Number.isInteger((environment as { uptimeMs: number }).uptimeMs)).toBe(true);
  });

  it('reports a null build stamp outside a Vite build', async () => {
    const { environment } = await collectSyncDiagnostics();
    expect((environment as { build: unknown }).build).toBeNull();
  });

  it('reports the sync settings with the email masked and the API key reduced to a fingerprint', async () => {
    useSyncStore.setState({
      firebaseUserEmail: 'reader@example.com',
      activeWorkspaceId: 'ws_9',
      firebaseConfig: {
        ...useSyncStore.getState().firebaseConfig,
        projectId: 'proj',
        authDomain: 'proj.firebaseapp.com',
        storageBucket: 'proj.appspot.com',
        appId: '1:2:web:3',
        apiKey: 'AIza-secret',
      },
    });
    h.syncEnabled = true;
    const s = useSyncStore.getState();

    const { syncSettings } = await collectSyncDiagnostics();

    expect(syncSettings).toStrictEqual({
      syncEnabledGate: true,
      firebaseEnabled: s.firebaseEnabled,
      firestoreStatus: s.firestoreStatus,
      firebaseAuthStatus: s.firebaseAuthStatus,
      firebaseUserEmail: 'r***@example.com',
      activeWorkspaceId: 'ws_9',
      lastSyncTime: s.lastSyncTime,
      hasCompletedOnboarding: s.hasCompletedOnboarding,
      firebaseConfig: {
        projectId: 'proj',
        authDomain: 'proj.firebaseapp.com',
        storageBucket: 'proj.appspot.com',
        appId: '1:2:web:3',
        apiKeyFingerprint: fnv1a('AIza-secret'),
      },
    });
  });

  it('reports an unconfigured Firebase as nulls, never empty strings', async () => {
    useSyncStore.setState({
      firebaseUserEmail: null,
      firebaseConfig: { ...useSyncStore.getState().firebaseConfig, projectId: '', authDomain: '', storageBucket: '', appId: '', apiKey: '' },
    });

    const { syncSettings } = await collectSyncDiagnostics();

    expect((syncSettings as { syncEnabledGate: boolean }).syncEnabledGate).toBe(false);
    expect((syncSettings as { firebaseUserEmail: unknown }).firebaseUserEmail).toBeNull();
    expect((syncSettings as { firebaseConfig: unknown }).firebaseConfig).toStrictEqual({
      projectId: null,
      authDomain: null,
      storageBucket: null,
      appId: null,
      apiKeyFingerprint: null,
    });
  });

  it('lists the known devices by their public fingerprint only (no profile, no user agent)', async () => {
    useDeviceStore.setState({
      devices: {
        'device-aaaaaaaa': {
          id: 'device-aaaaaaaa',
          name: 'Pixel',
          platform: 'Android',
          browser: 'Chrome',
          model: 'Pixel 8',
          userAgent: 'Mozilla/5.0 (Linux; Android 15)',
          appVersion: '9.9.9',
          lastActive: 1_700_000_000_500,
          created: 1_700_000_000_000,
          profile: {} as never,
        },
      },
    });

    const { devices } = await collectSyncDiagnostics();

    expect(devices).toStrictEqual({
      currentDeviceId: getDeviceId(),
      known: [
        {
          id: 'device-aaaaaaaa',
          name: 'Pixel',
          platform: 'Android',
          browser: 'Chrome',
          model: 'Pixel 8',
          appVersion: '9.9.9',
          lastActive: 1_700_000_000_500,
          created: 1_700_000_000_000,
        },
      ],
    });
  });

  it('includes the storage estimate where the platform offers one', async () => {
    Object.defineProperty(navigator, 'storage', {
      configurable: true,
      value: { estimate: async () => ({ usage: 1234, quota: 5678 }) },
    });
    try {
      const { localPersistence } = await collectSyncDiagnostics();
      expect((localPersistence as { storageEstimate: unknown }).storageEstimate).toStrictEqual({ usage: 1234, quota: 5678 });
    } finally {
      delete (navigator as { storage?: unknown }).storage;
    }
  });

  it('with a live orchestrator: probes the remote and hands each probe its own budget', async () => {
    const orchestrator = fakeOrchestrator();
    h.orchestrator = orchestrator;

    const report = await collectSyncDiagnostics({ remoteTimeoutMs: 5, integrityRemoteTimeoutMs: 77 });

    expect(orchestrator.probeTimeouts).toStrictEqual([5]);
    expect(orchestrator.downloadTimeouts).toStrictEqual([77]);
    expect(report.remote).toStrictEqual({ workspaces: [], pendingWrites: { state: 'acknowledged' } });
    expect(report.orchestrator).toStrictEqual(orchestrator.getDiagnostics());
    expect(report.uploads).toStrictEqual({
      verdict: 'ok',
      saveInFlight: false,
      pendingUpdates: 0,
      oldestPendingAgeMs: null,
      saveRetryCount: 0,
      firestorePendingWrites: { state: 'acknowledged' },
    });
    expect(Object.keys(report.verdicts as object)).toStrictEqual(VERDICT_LABELS);
  });

  it('with a live orchestrator: the default budgets are 8s for the probe and 20s for the download', async () => {
    const orchestrator = fakeOrchestrator();
    h.orchestrator = orchestrator;

    await collectSyncDiagnostics();

    expect(orchestrator.probeTimeouts).toStrictEqual([8000]);
    expect(orchestrator.downloadTimeouts).toStrictEqual([20000]);
  });

  it('records a remote probe that never answers as a timeout (its budget + 2s)', async () => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
    h.orchestrator = fakeOrchestrator({ probeRemoteDiagnostics: () => new Promise(() => {}) });

    let settled = false;
    const pending = collectSyncDiagnostics({ remoteTimeoutMs: 1 }).finally(() => {
      settled = true;
    });
    // The IndexedDB-backed integrity checks that follow the probe schedule
    // their own (short) timers: keep advancing the clock until the report is in.
    for (let i = 0; i < 100 && !settled; i++) await vi.advanceTimersByTimeAsync(2001);
    const report = await pending;

    expect(report.remote).toStrictEqual({ error: 'Error: remote probe timed out after 2001ms' });
  });

  it('a remote probe that answers in time leaves no timeout timer behind', async () => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
    h.orchestrator = fakeOrchestrator();

    let settled = false;
    const pending = collectSyncDiagnostics({ remoteTimeoutMs: 5 }).finally(() => {
      settled = true;
    });
    for (let i = 0; i < 100 && !settled; i++) await vi.advanceTimersByTimeAsync(1);
    const report = await pending;

    expect(report.remote).toStrictEqual({ workspaces: [], pendingWrites: { state: 'acknowledged' } });
    expect(vi.getTimerCount()).toBe(0);
  });

  it('records a remote probe that fails as that failure', async () => {
    h.orchestrator = fakeOrchestrator({ probeRemoteDiagnostics: async () => { throw new Error('boom'); } });

    const report = await collectSyncDiagnostics({ remoteTimeoutMs: 1 });

    expect(report.remote).toStrictEqual({ error: 'Error: boom' });
  });

  describe('regression: a throwing orchestrator never fails the whole export', () => {
    it('records the failure in the uploads and orchestrator sections instead of rejecting', async () => {
      h.orchestrator = fakeOrchestrator({ getDiagnostics: () => { throw new Error('diag boom'); } });

      const report = await collectSyncDiagnostics({ remoteTimeoutMs: 1 });

      expect(report.uploads).toStrictEqual({ error: 'Error: diag boom' });
      expect(report.orchestrator).toStrictEqual({ error: 'Error: diag boom' });
      expect(report.format).toBe(2);
    });
  });
});

describe('uploadHealth', () => {
  const now = 1_000_000;
  const diag = (transport: Record<string, unknown> | null) => ({ provider: { transport } });

  it('stuck: a save in flight for over a minute with updates queued behind it', () => {
    expect(
      uploadHealth(diag({ saveInFlight: true, pendingUpdates: 12, pendingSince: now - 90_000, saveRetryCount: 2 }), null, now)
    ).toStrictEqual({
      verdict: 'stuck',
      saveInFlight: true,
      pendingUpdates: 12,
      oldestPendingAgeMs: 90_000,
      saveRetryCount: 2,
      firestorePendingWrites: null,
    });
  });

  it('stuck: Firestore never acknowledged the writes already issued', () => {
    expect(
      uploadHealth(diag({ saveInFlight: false }), { pendingWrites: { state: 'stuck', ms: 8000 } }, now)
    ).toMatchObject({ verdict: 'stuck', firestorePendingWrites: { state: 'stuck', ms: 8000 } });
  });

  it('ok: a fresh save in flight is normal, and a minute exactly is not yet stuck', () => {
    expect(
      uploadHealth(diag({ saveInFlight: true, pendingSince: now - 500 }), { pendingWrites: { state: 'acknowledged' } }, now)
    ).toMatchObject({ verdict: 'ok', oldestPendingAgeMs: 500 });
    expect(uploadHealth(diag({ saveInFlight: true, pendingSince: now - 60_000 }), null, now)).toMatchObject({
      verdict: 'ok',
      oldestPendingAgeMs: 60_000,
    });
  });

  it('ok: an old pending timestamp without a save in flight is not a stall', () => {
    expect(uploadHealth(diag({ saveInFlight: false, pendingSince: now - 90_000 }), null, now)).toMatchObject({
      verdict: 'ok',
      saveInFlight: false,
      oldestPendingAgeMs: 90_000,
    });
  });

  it('ok: a save in flight with no pending timestamp has no age to judge', () => {
    expect(uploadHealth(diag({ saveInFlight: true, pendingUpdates: 3 }), null, now)).toStrictEqual({
      verdict: 'ok',
      saveInFlight: true,
      pendingUpdates: 3,
      oldestPendingAgeMs: null,
      saveRetryCount: null,
      firestorePendingWrites: null,
    });
    expect(uploadHealth(diag({ saveInFlight: true, pendingSince: 'soon' }), null, now)).toMatchObject({
      verdict: 'ok',
      oldestPendingAgeMs: null,
    });
  });

  it('skipped without a live connection', () => {
    expect(uploadHealth(null, null, now)).toStrictEqual({ verdict: 'skipped', reason: 'no live sync connection' });
    expect(uploadHealth(diag(null), null, now)).toStrictEqual({ verdict: 'skipped', reason: 'no live sync connection' });
    expect(uploadHealth({}, null, now)).toStrictEqual({ verdict: 'skipped', reason: 'no live sync connection' });
  });
});
