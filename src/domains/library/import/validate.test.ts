/**
 * The ZIP-signature gate is the first thing an uploaded file meets. Waving
 * through a non-EPUB means the failure surfaces much later as a confusing
 * parse error; rejecting a valid one means the user simply cannot add their
 * book. Each of the four magic bytes is checked separately here because a
 * mutated comparison on any one of them widens the gate silently.
 */
import { describe, expect, it, vi, afterEach } from 'vitest';
import { validateZipSignature } from './validate';

/** A File whose first bytes are the given values. */
const fileWith = (bytes: number[]): File =>
  new File([new Uint8Array([...bytes, 0, 0, 0, 0])], 'book.epub');

const ZIP_MAGIC = [0x50, 0x4b, 0x03, 0x04];

afterEach(() => {
  vi.restoreAllMocks();
});

describe('validateZipSignature', () => {
  it('accepts the ZIP local-file-header magic', async () => {
    expect(await validateZipSignature(fileWith(ZIP_MAGIC))).toBe(true);
  });

  it.each([0, 1, 2, 3])('rejects a file whose byte %i is wrong', async (index) => {
    const corrupted = [...ZIP_MAGIC];

    corrupted[index] = 0xff;

    expect(await validateZipSignature(fileWith(corrupted))).toBe(false);
  });

  it('rejects a plain text file', async () => {
    expect(await validateZipSignature(new File(['not a zip at all'], 'book.epub'))).toBe(false);
  });

  it('rejects a PDF, which is a common mis-upload', async () => {
    // %PDF
    expect(await validateZipSignature(fileWith([0x25, 0x50, 0x44, 0x46]))).toBe(false);
  });

  it('rejects an empty file rather than throwing', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => undefined);

    expect(await validateZipSignature(new File([], 'empty.epub'))).toBe(false);
  });

  it('rejects a file shorter than the signature', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => undefined);

    expect(await validateZipSignature(new File([new Uint8Array([0x50, 0x4b])], 'short.epub')))
      .toBe(false);
  });

  it('accepts regardless of what follows the signature', async () => {
    const withPayload = new File(
      [new Uint8Array([...ZIP_MAGIC, ...Array.from({ length: 500 }, (_v, i) => i % 256)])],
      'book.epub',
    );

    expect(await validateZipSignature(withPayload)).toBe(true);
  });

  /* A read failure must be reported as invalid, not thrown at the caller. */
  it('returns false when the file cannot be read', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => undefined);

    const broken = {
      slice: () => ({ arrayBuffer: () => Promise.reject(new Error('read failed')) }),
    } as unknown as File;

    expect(await validateZipSignature(broken)).toBe(false);
  });
});
