import { describe, it, expect, vi } from 'vitest';
import { gunzipSync, strFromU8 } from 'fflate';

const exported = vi.hoisted(() => ({ calls: [] as Array<{ filename: string; data: string | Blob; mimeType?: string }> }));
vi.mock('@lib/export', () => ({
  exportFile: async (opts: { filename: string; data: string | Blob; mimeType?: string }) => {
    exported.calls.push(opts);
  },
}));

import { exportSyncDiagnostics, gzipString } from './export';

describe('sync diagnostics export', () => {
  it('gzipString round-trips', async () => {
    const gz = await gzipString('hello hello hello');
    expect(gz).not.toBeNull();
    const bytes = new Uint8Array(await gz!.arrayBuffer());
    expect(strFromU8(gunzipSync(bytes))).toBe('hello hello hello');
  });

  it('exports a .json.gz holding the full report', async () => {
    const result = await exportSyncDiagnostics();

    expect(result.compressed).toBe(true);
    expect(result.filename).toMatch(/^versicle-sync-web-[\w-]{1,8}-\d{4}-\d{2}-\d{2}-\d{2}-\d{2}-\d{2}\.json\.gz$/);
    expect(result.exportedBytes).toBeLessThan(result.rawBytes);
    const call = exported.calls.at(-1)!;
    expect(call.filename).toBe(result.filename);
    const json = strFromU8(gunzipSync(new Uint8Array(await (call.data as Blob).arrayBuffer())));
    expect(JSON.parse(json)).toMatchObject({ format: 2, crdt: { doc: { stateVector: expect.any(Array) } } });
  });
});
