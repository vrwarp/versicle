import { describe, it, expect, vi, beforeEach } from 'vitest';

const mocks = vi.hoisted(() => ({
  isNative: true,
  writes: [] as Array<{ op: 'write' | 'append'; path: string; data: string; encoding?: string }>,
  share: vi.fn(async () => ({})),
  saveAs: vi.fn(),
}));

vi.mock('@capacitor/core', () => ({
  Capacitor: { isNativePlatform: () => mocks.isNative },
}));

vi.mock('@capacitor/filesystem', () => ({
  Directory: { Cache: 'CACHE' },
  Filesystem: {
    writeFile: async (o: { path: string; data: string; encoding?: string }) => {
      mocks.writes.push({ op: 'write', ...o });
      return { uri: `file:///cache/${o.path}` };
    },
    appendFile: async (o: { path: string; data: string; encoding?: string }) => {
      mocks.writes.push({ op: 'append', ...o });
    },
    getUri: async (o: { path: string }) => ({ uri: `file:///cache/${o.path}` }),
  },
}));

vi.mock('@capacitor/share', () => ({ Share: { share: mocks.share } }));
vi.mock('file-saver', () => ({ saveAs: mocks.saveAs }));

import { exportFile, NATIVE_WRITE_CHUNK_BYTES } from './export';

function decodeWrittenBytes(): Uint8Array {
  const parts = mocks.writes.map((w) => Uint8Array.from(atob(w.data), (c) => c.charCodeAt(0)));
  const out = new Uint8Array(parts.reduce((n, p) => n + p.length, 0));
  let offset = 0;
  for (const p of parts) {
    out.set(p, offset);
    offset += p.length;
  }
  return out;
}

describe('exportFile', () => {
  beforeEach(() => {
    mocks.isNative = true;
    mocks.writes.length = 0;
    mocks.share.mockClear();
    mocks.saveAs.mockClear();
  });

  it('writes a small text export natively in one call and shares it', async () => {
    await exportFile({ filename: 'a.json', data: '{"x":1}', mimeType: 'application/json' });

    expect(mocks.writes.map((w) => w.op)).toEqual(['write']);
    expect(new TextDecoder().decode(decodeWrittenBytes())).toBe('{"x":1}');
    expect(mocks.share).toHaveBeenCalledWith({ title: 'Export a.json', files: ['file:///cache/a.json'] });
  });

  it('writes an empty export as a single empty file', async () => {
    await exportFile({ filename: 'empty.txt', data: '' });

    expect(mocks.writes).toHaveLength(1);
    expect(mocks.writes[0]).toMatchObject({ op: 'write', data: '' });
  });

  it('falls back to a browser download on web', async () => {
    mocks.isNative = false;
    await exportFile({ filename: 'a.txt', data: 'hi' });

    expect(mocks.writes).toHaveLength(0);
    expect(mocks.saveAs).toHaveBeenCalledOnce();
  });

  describe('regression: Android OOM on large exports (single bridge message)', () => {
    it('splits a large text export into bounded chunks that reassemble byte-exactly', async () => {
      // Multi-byte characters straddling chunk boundaries must survive.
      const text = 'é漢😀abc'.repeat(Math.ceil((NATIVE_WRITE_CHUNK_BYTES * 2.5) / 12));
      await exportFile({ filename: 'big.json', data: text, mimeType: 'application/json' });

      expect(mocks.writes.length).toBeGreaterThan(2);
      expect(mocks.writes[0].op).toBe('write');
      expect(mocks.writes.slice(1).every((w) => w.op === 'append')).toBe(true);
      for (const w of mocks.writes) {
        expect(w.path).toBe('big.json');
        expect(w.encoding).toBeUndefined();
        // base64 of at most one chunk's bytes
        expect(w.data.length).toBeLessThanOrEqual((NATIVE_WRITE_CHUNK_BYTES / 3) * 4);
      }
      expect(new TextDecoder().decode(decodeWrittenBytes())).toBe(text);
      expect(mocks.share).toHaveBeenCalledOnce();
    });

    it('splits a large binary export the same way', async () => {
      const bytes = new Uint8Array(NATIVE_WRITE_CHUNK_BYTES * 2 + 7);
      for (let i = 0; i < bytes.length; i++) bytes[i] = (i * 31) & 0xff;
      await exportFile({ filename: 'big.zip', data: new Blob([bytes]), mimeType: 'application/zip' });

      expect(mocks.writes.map((w) => w.op)).toEqual(['write', 'append', 'append']);
      expect(decodeWrittenBytes()).toEqual(bytes);
    });
  });
});
