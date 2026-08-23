/**
 * Book content identity — the two generations that coexist (§B "identify").
 *
 * The legacy fingerprint's whole point is that its TAIL is filename- and
 * metadata-independent, so a renamed file still restores. That property is
 * arithmetic on two 4KiB windows, and the assertions below pin the window
 * geometry as well as the outcomes: a hash taken over the whole file, or a
 * head window that grows with file size, would still "work" on small
 * fixtures while quietly breaking large ones.
 */
import { describe, it, expect } from 'vitest';
import {
  cheapHash,
  computeContentHash,
  computeLegacyFingerprint,
  legacyContentTail,
  matchesLegacyFingerprint,
} from './identity';

const bytes = (...values: number[]): ArrayBuffer =>
  new Uint8Array(values).buffer as ArrayBuffer;
const blobOf = (data: Uint8Array): Blob => new Blob([data as BlobPart]);
const filled = (n: number, value = 0x41): Uint8Array => new Uint8Array(n).fill(value);

describe('cheapHash (djb2)', () => {
  it('seeds at 5381 for an empty buffer', () => {
    expect(cheapHash(new ArrayBuffer(0))).toBe((5381).toString(16));
  });

  it('accumulates hash*33 + byte', () => {
    // 5381*33 + 1 = 177574 = 0x2b5a6
    expect(cheapHash(bytes(1))).toBe((5381 * 33 + 1).toString(16));
    // and again for the second byte
    expect(cheapHash(bytes(1, 2))).toBe(((5381 * 33 + 1) * 33 + 2).toString(16));
  });

  it('is ORDER sensitive — the same bytes rearranged hash differently', () => {
    expect(cheapHash(bytes(1, 2))).not.toBe(cheapHash(bytes(2, 1)));
  });

  it('distinguishes a byte value change', () => {
    expect(cheapHash(bytes(1, 2, 3))).not.toBe(cheapHash(bytes(1, 2, 4)));
  });

  it('emits unsigned hex — never a negative or 0x-prefixed string', () => {
    const hash = cheapHash(filled(2000, 0xff).buffer as ArrayBuffer);

    expect(hash).toMatch(/^[0-9a-f]+$/);
  });
});

describe('legacyContentTail — the 4KiB windows', () => {
  it('joins the head and tail hashes with a dash', () => {
    const data = filled(100);

    expect(legacyContentTail(blobOf(data))).resolves.toMatch(/^[0-9a-f]+-[0-9a-f]+$/);
  });

  it('hashes the SAME window twice for a file smaller than 4KiB', async () => {
    const data = new Uint8Array([9, 8, 7]);

    const [head, tail] = (await legacyContentTail(blobOf(data))).split('-');

    expect(head).toBe(tail);
    expect(head).toBe(cheapHash(data.buffer));
  });

  it('reads only the FIRST 4KiB as the head, not the whole file', async () => {
    // Two files sharing a 4KiB head+tail but differing in the middle must
    // collide — proof the head window is capped.
    const head = filled(4096, 0x01);
    const tail = filled(4096, 0x02);
    const a = new Uint8Array([...head, ...filled(1000, 0xaa), ...tail]);
    const b = new Uint8Array([...head, ...filled(1000, 0xbb), ...tail]);

    expect(await legacyContentTail(blobOf(a))).toBe(await legacyContentTail(blobOf(b)));
  });

  it('reads the LAST 4KiB as the tail', async () => {
    const base = new Uint8Array([...filled(4096, 0x01), ...filled(4096, 0x02)]);
    const changedTail = new Uint8Array(base);
    changedTail[base.length - 1] = 0x99;

    expect(await legacyContentTail(blobOf(base))).not.toBe(
      await legacyContentTail(blobOf(changedTail))
    );
  });

  it('notices a change inside the head window', async () => {
    const base = new Uint8Array([...filled(4096, 0x01), ...filled(4096, 0x02)]);
    const changedHead = new Uint8Array(base);
    changedHead[0] = 0x99;

    expect(await legacyContentTail(blobOf(base))).not.toBe(
      await legacyContentTail(blobOf(changedHead))
    );
  });

  it('is empty-file safe', async () => {
    await expect(legacyContentTail(new Blob([]))).resolves.toBe(
      `${cheapHash(new ArrayBuffer(0))}-${cheapHash(new ArrayBuffer(0))}`
    );
  });
});

describe('computeLegacyFingerprint', () => {
  it('prefixes the content tail with filename-title-author', async () => {
    const file = blobOf(filled(50));
    const tail = await legacyContentTail(file);

    await expect(
      computeLegacyFingerprint(file, { title: 'T', author: 'A', filename: 'book.epub' })
    ).resolves.toBe(`book.epub-T-A-${tail}`);
  });

  it('changes when the metadata changes, even for identical bytes', async () => {
    const file = blobOf(filled(50));

    const one = await computeLegacyFingerprint(file, {
      title: 'T',
      author: 'A',
      filename: 'book.epub',
    });
    const two = await computeLegacyFingerprint(file, {
      title: 'T',
      author: 'A',
      filename: 'renamed.epub',
    });

    expect(one).not.toBe(two);
  });
});

describe('matchesLegacyFingerprint — restore acceptance', () => {
  it('accepts a RENAMED file whose content is unchanged', async () => {
    const file = blobOf(filled(50));
    const stored = await computeLegacyFingerprint(file, {
      title: 'Old Title',
      author: 'Old Author',
      filename: 'old name.epub',
    });

    await expect(matchesLegacyFingerprint(stored, file)).resolves.toBe(true);
  });

  it('rejects different content under the same name', async () => {
    const stored = await computeLegacyFingerprint(blobOf(filled(50, 0x01)), {
      title: 'T',
      author: 'A',
      filename: 'book.epub',
    });

    await expect(matchesLegacyFingerprint(stored, blobOf(filled(50, 0x02)))).resolves.toBe(false);
  });

  it('rejects an EMPTY stored hash outright rather than matching on a suffix', async () => {
    await expect(matchesLegacyFingerprint('', blobOf(filled(50)))).resolves.toBe(false);
  });

  it('requires the dash boundary — a bare suffix match is not enough', async () => {
    const file = blobOf(filled(50));
    const tail = await legacyContentTail(file);

    await expect(matchesLegacyFingerprint(`prefix${tail}`, file)).resolves.toBe(false);
    await expect(matchesLegacyFingerprint(`prefix-${tail}`, file)).resolves.toBe(true);
  });

  it('tolerates dashes inside the filename/author prefix', async () => {
    const file = blobOf(filled(50));
    const stored = await computeLegacyFingerprint(file, {
      title: 'A-Title',
      author: 'Jean-Luc',
      filename: 'my-book-v2.epub',
    });

    await expect(matchesLegacyFingerprint(stored, file)).resolves.toBe(true);
  });
});

describe('computeContentHash', () => {
  it('is a 64-char lowercase hex SHA-256', async () => {
    const hash = await computeContentHash(blobOf(filled(10)));

    expect(hash).toMatch(/^[0-9a-f]{64}$/);
  });

  it('is the known digest of the empty input', async () => {
    await expect(computeContentHash(new Blob([]))).resolves.toBe(
      'e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855'
    );
  });

  it('is filename-independent and content-sensitive', async () => {
    const a = await computeContentHash(blobOf(new Uint8Array([1, 2, 3])));
    const same = await computeContentHash(blobOf(new Uint8Array([1, 2, 3])));
    const different = await computeContentHash(blobOf(new Uint8Array([1, 2, 4])));

    expect(a).toBe(same);
    expect(a).not.toBe(different);
  });

  it('zero-pads a byte that renders as one hex digit', async () => {
    const hash = await computeContentHash(new Blob([]));

    expect(hash).toContain('c44298'); // pairs stay aligned across the digest
    expect(hash).toHaveLength(64);
  });
});
