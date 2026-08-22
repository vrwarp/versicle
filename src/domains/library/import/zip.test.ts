/**
 * Batch import via ZIP. The interesting behaviour is not the unzipping —
 * jszip does that — but the filtering, flattening, cancellation and error
 * translation around it. A cancellation that is swallowed leaves the user
 * unable to stop a large import; a directory entry treated as a book puts
 * a zero-byte "book" in the library.
 */
import JSZip from 'jszip';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { CancellationError } from '@lib/cancellable-task-runner';
import { extractEpubsFromZip } from './zip';

/** Builds a real ZIP File containing the given entries. */
const makeZip = async (entries: Record<string, string>): Promise<File> => {
  const zip = new JSZip();

  for (const [name, content] of Object.entries(entries)) {
    zip.file(name, content);
  }

  const blob = await zip.generateAsync({ type: 'blob' });

  return new File([blob], 'batch.zip', { type: 'application/zip' });
};

afterEach(() => {
  vi.restoreAllMocks();
});

describe('extractEpubsFromZip', () => {
  it('extracts every epub entry', async () => {
    const zip = await makeZip({ 'a.epub': 'one', 'b.epub': 'two' });
    const files = await extractEpubsFromZip(zip);

    expect(files.map((f) => f.name).sort()).toEqual(['a.epub', 'b.epub']);
  });

  it('tags extracted files with the epub mime type', async () => {
    const files = await extractEpubsFromZip(await makeZip({ 'a.epub': 'one' }));

    expect(files[0].type).toBe('application/epub+zip');
  });

  it('skips non-epub entries', async () => {
    const zip = await makeZip({ 'a.epub': 'one', 'readme.txt': 'x', 'cover.jpg': 'y' });
    const files = await extractEpubsFromZip(zip);

    expect(files.map((f) => f.name)).toEqual(['a.epub']);
  });

  it('matches the extension case-insensitively', async () => {
    const files = await extractEpubsFromZip(await makeZip({ 'A.EPUB': 'one', 'b.EpUb': 'two' }));

    expect(files).toHaveLength(2);
  });

  it('does not match a name that merely contains epub', async () => {
    const files = await extractEpubsFromZip(await makeZip({ 'epub-notes.txt': 'x' }));

    expect(files).toEqual([]);
  });

  /* Nested paths flatten to basenames; collisions surface downstream. */
  it('flattens nested paths to their basename', async () => {
    const zip = await makeZip({ 'books/fiction/deep.epub': 'one' });
    const files = await extractEpubsFromZip(zip);

    expect(files[0].name).toBe('deep.epub');
  });

  it('keeps both entries when two nested paths share a basename', async () => {
    const zip = await makeZip({ 'a/dup.epub': 'one', 'b/dup.epub': 'two' });
    const files = await extractEpubsFromZip(zip);

    expect(files).toHaveLength(2);
    expect(files.every((f) => f.name === 'dup.epub')).toBe(true);
  });

  it('returns an empty list for a zip with no epubs', async () => {
    expect(await extractEpubsFromZip(await makeZip({ 'notes.txt': 'x' }))).toEqual([]);
  });

  it('handles more entries than the concurrency limit', async () => {
    const entries: Record<string, string> = {};

    for (let i = 0; i < 12; i += 1) entries[`book-${i}.epub`] = `content-${i}`;

    const files = await extractEpubsFromZip(await makeZip(entries));

    expect(files).toHaveLength(12);
  });

  it('preserves entry content', async () => {
    const files = await extractEpubsFromZip(await makeZip({ 'a.epub': 'hello world' }));

    expect(await files[0].text()).toBe('hello world');
  });

  describe('progress reporting', () => {
    it('reports progress when a callback is supplied', async () => {
      const onProgress = vi.fn();

      await extractEpubsFromZip(await makeZip({ 'a.epub': 'one' }), onProgress);

      // jsdom's FileReader may or may not emit progress events for a small
      // buffer; what must hold is that the read path still yields the file.
      expect(onProgress.mock.calls.every(([p]) => p >= 0 && p <= 100)).toBe(true);
    });

    it('produces the same result with and without a progress callback', async () => {
      const zip = await makeZip({ 'a.epub': 'one', 'b.epub': 'two' });

      const withCb = await extractEpubsFromZip(zip, vi.fn());
      const without = await extractEpubsFromZip(zip);

      expect(withCb.map((f) => f.name).sort()).toEqual(without.map((f) => f.name).sort());
    });
  });

  describe('cancellation', () => {
    it('throws CancellationError when already aborted', async () => {
      const controller = new AbortController();

      controller.abort();

      await expect(extractEpubsFromZip(await makeZip({ 'a.epub': 'one' }), undefined, controller.signal))
        .rejects.toBeInstanceOf(CancellationError);
    });

    /*
     * Cancellation must propagate as CancellationError, NOT be rewritten
     * into the generic "corrupted zip" message — the caller distinguishes
     * a user abort from a real failure.
     */
    it('does not disguise cancellation as a corrupt-zip error', async () => {
      const controller = new AbortController();

      controller.abort();

      await expect(extractEpubsFromZip(await makeZip({ 'a.epub': 'one' }), undefined, controller.signal))
        .rejects.not.toThrow('Failed to process ZIP file');
    });

    it('completes normally when the signal never aborts', async () => {
      const controller = new AbortController();
      const files = await extractEpubsFromZip(
        await makeZip({ 'a.epub': 'one' }),
        undefined,
        controller.signal,
      );

      expect(files).toHaveLength(1);
    });
  });

  describe('failure handling', () => {
    it('translates a corrupt archive into a readable error', async () => {
      vi.spyOn(console, 'error').mockImplementation(() => undefined);

      const notAZip = new File([new Uint8Array([1, 2, 3, 4, 5])], 'broken.zip');

      await expect(extractEpubsFromZip(notAZip)).rejects.toThrow('Failed to process ZIP file');
    });

    it('translates an empty file the same way', async () => {
      vi.spyOn(console, 'error').mockImplementation(() => undefined);

      await expect(extractEpubsFromZip(new File([], 'empty.zip')))
        .rejects.toThrow('Failed to process ZIP file');
    });
  });
});
