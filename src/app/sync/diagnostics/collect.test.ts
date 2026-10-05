import { describe, it, expect } from 'vitest';
import { collectSyncDiagnostics, maskEmail, uploadHealth } from './collect';

describe('maskEmail', () => {
  it('maskEmail keeps only the first letter and the domain', () => {
    expect(maskEmail('reader@example.com')).toBe('r***@example.com');
    expect(maskEmail(null)).toBeNull();
  });
});

describe('collectSyncDiagnostics', () => {
  it('produces a complete, JSON-serializable report when sync never composed', async () => {
    const report = await collectSyncDiagnostics();
    expect(report.format).toBe(2);
    expect(report.orchestrator).toBeNull();
    expect(report.remote).toMatchObject({ skipped: expect.any(String) });
    expect(report).toHaveProperty('syncSettings.firebaseConfig');
    expect(report).toHaveProperty('crdt.doc.stateVector');
    expect(report).toHaveProperty('recorder.updates');
    expect(Array.isArray(report.logs)).toBe(true);
    expect(() => JSON.stringify(report)).not.toThrow();
    expect(JSON.stringify(report)).not.toMatch(/apiKey"/);
  });
});

describe('uploadHealth', () => {
  const now = 1_000_000;
  const diag = (transport: Record<string, unknown> | null) => ({ provider: { transport } });

  it('stuck: a save in flight for over a minute with updates queued behind it', () => {
    expect(
      uploadHealth(diag({ saveInFlight: true, pendingUpdates: 12, pendingSince: now - 90_000 }), null, now)
    ).toMatchObject({ verdict: 'stuck', pendingUpdates: 12, oldestPendingAgeMs: 90_000 });
  });

  it('stuck: Firestore never acknowledged the writes already issued', () => {
    expect(
      uploadHealth(diag({ saveInFlight: false }), { pendingWrites: { state: 'stuck', ms: 8000 } }, now)
    ).toMatchObject({ verdict: 'stuck', firestorePendingWrites: { state: 'stuck' } });
  });

  it('ok: a fresh save in flight is normal', () => {
    expect(
      uploadHealth(diag({ saveInFlight: true, pendingSince: now - 500 }), { pendingWrites: { state: 'acknowledged' } }, now)
    ).toMatchObject({ verdict: 'ok' });
  });

  it('skipped without a live connection', () => {
    expect(uploadHealth(null, null, now)).toMatchObject({ verdict: 'skipped' });
    expect(uploadHealth(diag(null), null, now)).toMatchObject({ verdict: 'skipped' });
  });
});
