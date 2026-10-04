import { describe, it, expect } from 'vitest';
import { collectSyncDiagnostics, maskEmail } from './collect';

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
