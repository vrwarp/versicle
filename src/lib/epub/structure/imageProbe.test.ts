import { describe, it, expect, vi, afterEach } from 'vitest';
import { makePng } from '@test/harness/epubFixtures';
import { probeImage, readImageSize } from './imageProbe';

const blob = (bytes: number[] | Uint8Array, type = '') => new Blob([new Uint8Array(bytes) as BlobPart], { type });

/** Minimal JPEG: SOI, an APP0 segment to skip, then SOF0 with h=1391 w=900. */
const JPEG = [
  0xff, 0xd8,
  0xff, 0xe0, 0x00, 0x04, 0x00, 0x00,
  0xff, 0xc0, 0x00, 0x11, 0x08, 0x05, 0x6f, 0x03, 0x84, 0x03, 0x01, 0x22, 0x00,
];
const GIF = [0x47, 0x49, 0x46, 0x38, 0x39, 0x61, 0x2c, 0x01, 0xc2, 0x01];
const WEBP_VP8X = [
  ...'RIFF'.split('').map((c) => c.charCodeAt(0)), 0, 0, 0, 0,
  ...'WEBP'.split('').map((c) => c.charCodeAt(0)),
  ...'VP8X'.split('').map((c) => c.charCodeAt(0)), 10, 0, 0, 0,
  0, 0, 0, 0,
  0x2b, 0x01, 0x00, // width - 1 = 299
  0xc1, 0x01, 0x00, // height - 1 = 449
];

describe('readImageSize', () => {
  it.each([
    ['png', makePng(300, 450), { width: 300, height: 450 }],
    ['jpeg (skipping APP segments)', JPEG, { width: 900, height: 1391 }],
    ['gif', GIF, { width: 300, height: 450 }],
    ['webp VP8X', WEBP_VP8X, { width: 300, height: 450 }],
  ])('%s', async (_name, bytes, size) => {
    expect(await readImageSize(blob(bytes as number[]))).toEqual(size);
  });

  it('returns null for unknown or truncated data', async () => {
    expect(await readImageSize(blob([1, 2, 3]))).toBeNull();
    expect(await readImageSize(blob([0xff, 0xd8, 0xff]))).toBeNull();
  });
});

describe('probeImage', () => {
  afterEach(() => vi.unstubAllGlobals());

  const stubBitmap = (impl: (b: Blob, o?: ImageBitmapOptions) => Promise<{ width: number; height: number }>) => {
    const fn = vi.fn(async (b: Blob, o?: ImageBitmapOptions) => ({ ...(await impl(b, o)), close: vi.fn() }));
    vi.stubGlobal('createImageBitmap', fn);
    return fn;
  };

  it('is "unknown" without a platform decoder, and for SVG', async () => {
    vi.stubGlobal('createImageBitmap', undefined);
    expect(await probeImage(blob(makePng(300, 450), 'image/png'))).toBe('unknown');
    stubBitmap(async () => ({ width: 1, height: 1 }));
    expect(await probeImage(blob([1], 'image/svg+xml'))).toBe('unknown');
  });

  it('measures from the header and decodes only a thumbnail', async () => {
    const fn = stubBitmap(async () => ({ width: 64, height: 96 }));
    expect(await probeImage(blob(makePng(300, 450), 'image/png'))).toEqual({ width: 300, height: 450 });
    expect(fn.mock.calls[0][1]).toMatchObject({ resizeWidth: 64 });
  });

  it('takes orientation from the decoded thumbnail (EXIF-rotated JPEG)', async () => {
    // Header says 1391×900 landscape; the decoder applied EXIF rotation → portrait.
    const rotated = [...JPEG.slice(0, 13), 0x03, 0x84, 0x05, 0x6f, ...JPEG.slice(17)];
    stubBitmap(async () => ({ width: 64, height: 99 }));
    expect(await probeImage(blob(rotated, 'image/jpeg'))).toEqual({ width: 900, height: 1391 });
  });

  it('falls back to a full decode for formats it cannot read the header of', async () => {
    const fn = stubBitmap(async () => ({ width: 320, height: 480 }));
    expect(await probeImage(blob([0, 0, 0, 0], 'image/avif'))).toEqual({ width: 320, height: 480 });
    expect(fn.mock.calls[0][1]).toBeUndefined();
  });

  it('is "undecodable" when the decoder rejects the bytes', async () => {
    stubBitmap(async () => {
      throw new Error('The source image could not be decoded.');
    });
    expect(await probeImage(blob(JPEG, 'image/jpeg'))).toBe('undecodable');
  });
});
