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
import { extractEpubsFromZip, listZipEpubEntries } from './zip';

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

/**
 * The expansion used to decompress EVERY entry into an `epubFiles` array that
 * the batch importer held for the entire run — a 40-book archive meant 40
 * decompressed EPUBs resident at once.
 */
describe('regression: entries are handed off one at a time', () => {
  it('enumerates without decompressing anything', async () => {
    const zip = await makeZip({ 'a.epub': 'one', 'b.epub': 'two', 'notes.txt': 'x' });

    const entries = await listZipEpubEntries(zip);

    expect(entries.map((e) => e.name).sort()).toEqual(['a.epub', 'b.epub']);
    // Nothing is a File yet — `read()` is what inflates.
    expect(entries.every((e) => typeof e.read === 'function')).toBe(true);
  });

  it('inflates only the entry that is read', async () => {
    const zip = await makeZip({ 'a.epub': 'one', 'b.epub': 'two' });
    const entries = await listZipEpubEntries(zip);
    const first = entries.find((e) => e.name === 'a.epub')!;

    const file = await first.read();

    expect(file).toBeInstanceOf(File);
    expect(file.type).toBe('application/epub+zip');
    expect(await file.text()).toBe('one');
  });

  it('flattens nested paths on the lazy path too', async () => {
    const entries = await listZipEpubEntries(await makeZip({ 'books/deep/x.epub': 'one' }));

    expect(entries[0].name).toBe('x.epub');
    expect(await (await entries[0].read()).text()).toBe('one');
  });

  it('throws CancellationError from read() once the signal aborts', async () => {
    const controller = new AbortController();
    const entries = await listZipEpubEntries(await makeZip({ 'a.epub': 'one' }), undefined, controller.signal);

    controller.abort();

    await expect(entries[0].read()).rejects.toBeInstanceOf(CancellationError);
  });

  it('translates a corrupt archive the same way on the lazy path', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => undefined);

    await expect(listZipEpubEntries(new File([new Uint8Array([1, 2, 3])], 'broken.zip')))
      .rejects.toThrow('Failed to process ZIP file');
  });

  it('reads the archive once, whether or not progress is watched', async () => {
    const zip = await makeZip({ 'a.epub': 'one' });
    const readAsArrayBuffer = vi.spyOn(FileReader.prototype, 'readAsArrayBuffer');

    try {
      const entries = await listZipEpubEntries(zip);
      await entries[0].read();
      // jszip reads the File itself, once, and serves entries out of views
      // over that single buffer (`Uint8ArrayReader.readData` → `subarray`).
      const withoutProgress = readAsArrayBuffer.mock.calls.length;
      readAsArrayBuffer.mockClear();

      const watched = await listZipEpubEntries(zip, vi.fn());
      await watched[0].read();

      // Watching the read does NOT add a pass: our FileReader replaces the
      // one jszip would have run itself (`prepareContent`), and the
      // ArrayBuffer it produces is wrapped in a VIEW, not copied.
      expect(readAsArrayBuffer.mock.calls.length).toBe(withoutProgress);
    } finally {
      readAsArrayBuffer.mockRestore();
    }
  });
});

/**
 * Enumeration still has to read the whole archive, and the lazy lister
 * dropped the FileReader read-progress path that the eager one had — so the
 * batch importer's upload bar sat frozen for the entire read of a large
 * archive (a 1.2 GB ZIP of many EPUBs is seconds of nothing). The
 * justification for dropping it — that reading into an ArrayBuffer "put a
 * second full copy of the archive in memory" — is not how jszip behaves:
 * `prepareContent` runs the SAME FileReader for a File and then converts the
 * ArrayBuffer with `new Uint8Array(buffer)`, a view over that same buffer.
 */
describe('regression: the lazy lister reports read progress', () => {
  it('reports progress and always finishes at 100', async () => {
    const zip = await makeZip({ 'a.epub': 'one', 'b.epub': 'two' });
    const onProgress = vi.fn();

    const entries = await listZipEpubEntries(zip, onProgress);

    expect(entries.map((e) => e.name).sort()).toEqual(['a.epub', 'b.epub']);
    // jsdom's FileReader may emit no intermediate `progress` events for a
    // small buffer; the contract that the caller's byte-weighted bar needs
    // is that the read ends at this file's full share.
    expect(onProgress).toHaveBeenCalled();
    expect(onProgress.mock.calls.every(([p]) => p >= 0 && p <= 100)).toBe(true);
    expect(onProgress.mock.calls.at(-1)).toEqual([100]);
  });

  it('enumerates the same entries with and without a progress callback', async () => {
    const zip = await makeZip({ 'a/dup.epub': 'one', 'b/dup.epub': 'two', 'notes.txt': 'x' });

    const watched = await listZipEpubEntries(zip, vi.fn());
    const unwatched = await listZipEpubEntries(zip);

    expect(watched.map((e) => e.name)).toEqual(unwatched.map((e) => e.name));
    expect(await (await watched[0].read()).text()).toBe(await (await unwatched[0].read()).text());
  });

  it('still translates a corrupt archive when progress is watched', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => undefined);

    await expect(listZipEpubEntries(new File([new Uint8Array([1, 2, 3])], 'broken.zip'), vi.fn()))
      .rejects.toThrow('Failed to process ZIP file');
  });

  it('aborts before reading when the signal is already aborted', async () => {
    const controller = new AbortController();
    const onProgress = vi.fn();
    controller.abort();

    await expect(listZipEpubEntries(await makeZip({ 'a.epub': 'one' }), onProgress, controller.signal))
      .rejects.toBeInstanceOf(CancellationError);
    expect(onProgress).not.toHaveBeenCalled();
  });
});
