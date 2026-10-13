import { describe, it, expect, vi, afterEach } from 'vitest';
import { gunzipSync, strFromU8 } from 'fflate';

const exported = vi.hoisted(() => {
  // A device id longer than the 8 characters the filename keeps, so the cap
  // is observable (the generated ids are exactly 8 characters long).
  localStorage.setItem('versicle-device-id', 'device-0123456789abcdef');
  return { calls: [] as Array<{ filename: string; data: string | Blob; mimeType?: string }> };
});
vi.mock('@lib/export', () => ({
  exportFile: async (opts: { filename: string; data: string | Blob; mimeType?: string }) => {
    exported.calls.push(opts);
  },
}));

import { exportSyncDiagnostics, gzipString } from './export';

afterEach(() => vi.unstubAllGlobals());

const stampOf = (json: string): string =>
  new Date((JSON.parse(json) as { generatedAt: number }).generatedAt).toISOString().slice(0, 19).replace(/[:T]/g, '-');

describe('sync diagnostics export', () => {
  it('gzipString round-trips and tags the blob as gzip', async () => {
    const gz = await gzipString('hello hello hello');
    expect(gz).not.toBeNull();
    expect(gz!.type).toBe('application/gzip');
    const bytes = new Uint8Array(await gz!.arrayBuffer());
    expect(strFromU8(gunzipSync(bytes))).toBe('hello hello hello');
  });

  it('gzipString yields null (never throws) where CompressionStream or ReadableStream is missing', async () => {
    vi.stubGlobal('CompressionStream', undefined);
    await expect(gzipString('x')).resolves.toBeNull();
    vi.unstubAllGlobals();

    vi.stubGlobal('ReadableStream', undefined);
    await expect(gzipString('x')).resolves.toBeNull();
  });

  it('exports a .json.gz holding the full report', async () => {
    const result = await exportSyncDiagnostics();

    const call = exported.calls.at(-1)!;
    const json = strFromU8(gunzipSync(new Uint8Array(await (call.data as Blob).arrayBuffer())));
    expect(result).toStrictEqual({
      filename: `versicle-sync-web-01234567-${stampOf(json)}.json.gz`,
      rawBytes: new Blob([json]).size,
      exportedBytes: (call.data as Blob).size,
      compressed: true,
    });
    expect(result.exportedBytes).toBeLessThan(result.rawBytes);
    expect(call).toStrictEqual({ filename: result.filename, data: expect.any(Blob), mimeType: 'application/gzip' });
    expect((call.data as Blob).type).toBe('application/gzip');
    expect(JSON.parse(json)).toMatchObject({ format: 2, crdt: { doc: { stateVector: expect.any(Array) } } });
  });

  it('falls back to a plain .json export where the platform cannot gzip', async () => {
    vi.stubGlobal('CompressionStream', undefined);

    const result = await exportSyncDiagnostics();

    const call = exported.calls.at(-1)!;
    const json = call.data as string;
    expect(result).toStrictEqual({
      filename: `versicle-sync-web-01234567-${stampOf(json)}.json`,
      rawBytes: new Blob([json]).size,
      exportedBytes: new Blob([json]).size,
      compressed: false,
    });
    expect(call).toStrictEqual({ filename: result.filename, data: expect.any(String), mimeType: 'application/json' });
    expect(JSON.parse(json)).toMatchObject({ format: 2 });
  });
});
