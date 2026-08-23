/**
 * Re-deriving a book's content from its stored binary. The self-check is
 * the load-bearing part: if the fresh extraction is worse than what is
 * already stored, the old rows must be RETAINED — a failed re-extract
 * degrades to current behaviour, never to a book with its chapters gone.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const getBookFile = vi.fn();
const getManifest = vi.fn();
const listTtsPrepForBook = vi.fn();
const replaceDerivedContent = vi.fn();
const extractPreamble = vi.fn();
const mapChapters = vi.fn();
const extractContentOffscreen = vi.fn();

vi.mock('@data/repos/bookContent', () => ({
  bookContent: {
    getBookFile: (...a: unknown[]) => getBookFile(...a),
    getManifest: (...a: unknown[]) => getManifest(...a),
    listTtsPrepForBook: (...a: unknown[]) => listTtsPrepForBook(...a),
    replaceDerivedContent: (...a: unknown[]) => replaceDerivedContent(...a),
  },
}));

vi.mock('./extract', () => ({
  extractPreamble: (...a: unknown[]) => extractPreamble(...a),
  mapChapters: (...a: unknown[]) => mapChapters(...a),
}));

vi.mock('@domains/reader/engine/offscreen/offscreen-renderer', () => ({
  extractContentOffscreen: (...a: unknown[]) => extractContentOffscreen(...a),
}));

const { reprocessBookContent } = await import('./reprocess');

const mapping = () => ({
  totalChars: 1234,
  syntheticToc: [{ label: 'Synthetic 1', href: 's1' }],
  sections: [{ sectionId: 'sec-1', characterCount: 100, playOrder: 0 }],
  ttsContentBatches: [{ id: 'tts-1' }],
  tableBatches: [{ id: 'tbl-1' }],
  searchSections: [{ sectionId: 'sec-1', text: 'hello' }],
});

beforeEach(() => {
  for (const m of [getBookFile, getManifest, listTtsPrepForBook, replaceDerivedContent,
    extractPreamble, mapChapters, extractContentOffscreen]) {
    m.mockReset();
  }

  getBookFile.mockResolvedValue(new Blob(['epub-bytes']));
  extractPreamble.mockResolvedValue({ toc: [], language: 'en' });
  extractContentOffscreen.mockResolvedValue({ chapters: [], baseFontSize: 16, baseLineHeight: 24 });
  mapChapters.mockReturnValue(mapping());
  getManifest.mockResolvedValue({ bookId: 'b1' });
  replaceDerivedContent.mockResolvedValue(undefined);
  listTtsPrepForBook.mockResolvedValue([{ id: 'old-1' }]);
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe('reprocessBookContent', () => {
  it('rejects when the source file is missing', async () => {
    getBookFile.mockResolvedValue(undefined);

    await expect(reprocessBookContent('b1')).rejects.toThrow('Book source file not found for ID: b1');
    expect(replaceDerivedContent).not.toHaveBeenCalled();
  });

  it('wraps a non-Blob source before extracting', async () => {
    getBookFile.mockResolvedValue(new Uint8Array([1, 2, 3]));

    await reprocessBookContent('b1');

    expect(extractPreamble.mock.calls[0][0]).toBeInstanceOf(Blob);
  });

  it('passes a Blob source through as-is', async () => {
    const blob = new Blob(['x']);

    getBookFile.mockResolvedValue(blob);
    await reprocessBookContent('b1');

    expect(extractPreamble.mock.calls[0][0]).toBe(blob);
  });

  /* Reprocess parity: the palette comes from the RAW cover, uncompressed. */
  it('extracts the palette from the raw cover', async () => {
    await reprocessBookContent('b1');

    expect(extractPreamble.mock.calls[0][1]).toMatchObject({ cover: 'raw' });
  });

  it('threads the abort signal into both extraction steps', async () => {
    const controller = new AbortController();

    await reprocessBookContent('b1', { signal: controller.signal });

    expect(extractPreamble.mock.calls[0][1].signal).toBe(controller.signal);
    expect(extractContentOffscreen.mock.calls[0][3]).toBe(controller.signal);
  });

  it('passes the detected language through as the extraction locale', async () => {
    extractPreamble.mockResolvedValue({ toc: [], language: 'zh' });

    await reprocessBookContent('b1');

    expect(extractContentOffscreen.mock.calls[0][1]).toMatchObject({ locale: 'zh' });
  });

  it('merges caller extraction options with the locale', async () => {
    await reprocessBookContent('b1', { extraction: { minSentenceChars: 5 } as never });

    expect(extractContentOffscreen.mock.calls[0][1]).toMatchObject({
      minSentenceChars: 5,
      locale: 'en',
    });
  });

  describe('the re-ingest self-check', () => {
    it('is skipped when no verifier is supplied', async () => {
      await reprocessBookContent('b1');

      expect(listTtsPrepForBook).not.toHaveBeenCalled();
      expect(replaceDerivedContent).toHaveBeenCalled();
    });

    it('passes the old rows and the fresh mapping to the verifier', async () => {
      const verifyDerived = vi.fn(() => true);

      await reprocessBookContent('b1', { verifyDerived });

      expect(verifyDerived).toHaveBeenCalledWith([{ id: 'old-1' }], expect.objectContaining({
        totalChars: 1234,
      }));
    });

    it('persists when the check passes', async () => {
      await reprocessBookContent('b1', { verifyDerived: () => true });

      expect(replaceDerivedContent).toHaveBeenCalled();
    });

    /*
     * The whole point: a failed check must leave the stored rows alone.
     */
    it('retains the old rows and throws when the check fails', async () => {
      await expect(reprocessBookContent('b1', { verifyDerived: () => false }))
        .rejects.toMatchObject({ code: 'INGEST_VERIFICATION_FAILED' });

      expect(replaceDerivedContent).not.toHaveBeenCalled();
    });

    it('names the book in the failure context', async () => {
      await expect(reprocessBookContent('b7', { verifyDerived: () => false }))
        .rejects.toMatchObject({ context: { bookId: 'b7' } });
    });
  });

  describe('manifest updates', () => {
    it('stamps the fresh totals and measured metrics', async () => {
      const manifest: Record<string, unknown> = { bookId: 'b1' };

      getManifest.mockResolvedValue(manifest);
      await reprocessBookContent('b1');

      expect(manifest.totalChars).toBe(1234);
      expect(manifest.baseFontSize).toBe(16);
      expect(manifest.baseLineHeight).toBe(24);
      expect(manifest.schemaVersion).toBeDefined();
    });

    it('writes palettes only when the extraction produced them', async () => {
      const manifest: Record<string, unknown> = { bookId: 'b1' };

      getManifest.mockResolvedValue(manifest);
      extractPreamble.mockResolvedValue({ toc: [], language: 'en' });
      await reprocessBookContent('b1');

      expect('coverPalette' in manifest).toBe(false);
      expect('perceptualPalette' in manifest).toBe(false);
    });

    it('writes palettes when present', async () => {
      const manifest: Record<string, unknown> = { bookId: 'b1' };

      getManifest.mockResolvedValue(manifest);
      extractPreamble.mockResolvedValue({
        toc: [],
        language: 'en',
        coverPalette: [1, 2, 3],
        perceptualPalette: { dominant: '#abc' },
      });
      await reprocessBookContent('b1');

      expect(manifest.coverPalette).toEqual([1, 2, 3]);
      expect(manifest.perceptualPalette).toEqual({ dominant: '#abc' });
    });

    it('still persists derived content when there is no manifest', async () => {
      getManifest.mockResolvedValue(undefined);

      await expect(reprocessBookContent('b1')).resolves.toBeDefined();
      expect(replaceDerivedContent).toHaveBeenCalled();
    });
  });

  describe('persisted structure', () => {
    it('prefers the real table of contents', async () => {
      extractPreamble.mockResolvedValue({ toc: [{ label: 'Real', href: 'r' }], language: 'en' });

      await reprocessBookContent('b1');

      expect(replaceDerivedContent.mock.calls[0][1].structure.toc)
        .toEqual([{ label: 'Real', href: 'r' }]);
    });

    it('falls back to the synthetic table of contents when the book has none', async () => {
      await reprocessBookContent('b1');

      expect(replaceDerivedContent.mock.calls[0][1].structure.toc)
        .toEqual([{ label: 'Synthetic 1', href: 's1' }]);
    });

    it('maps sections onto spine items', async () => {
      await reprocessBookContent('b1');

      expect(replaceDerivedContent.mock.calls[0][1].structure.spineItems)
        .toEqual([{ id: 'sec-1', characterCount: 100, index: 0 }]);
    });

    it('persists the tts and table batches', async () => {
      await reprocessBookContent('b1');

      const payload = replaceDerivedContent.mock.calls[0][1];

      expect(payload.ttsPrep).toEqual([{ id: 'tts-1' }]);
      expect(payload.tableImages).toEqual([{ id: 'tbl-1' }]);
    });
  });

  it('returns the palettes and a fresh search corpus', async () => {
    extractPreamble.mockResolvedValue({
      toc: [],
      language: 'en',
      coverPalette: [9],
      perceptualPalette: { dominant: '#fff' },
    });

    const result = await reprocessBookContent('b1');

    expect(result.coverPalette).toEqual([9]);
    expect(result.perceptualPalette).toEqual({ dominant: '#fff' });
    expect(result.searchText.sections).toEqual([{ sectionId: 'sec-1', text: 'hello' }]);
    expect(result.searchText.extractionVersion).toBeDefined();
  });
});
