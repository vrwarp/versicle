/**
 * PR-L1 exit pins for the unified extractor (phase7-library-google.md §A):
 *  - depth:'metadata' short-circuits before the offscreen render;
 *  - preamble reuse means the ghost probe's compression/palette work is
 *    never repeated by the full pass (call-count spies);
 *  - `signal` aborts as CancellationError;
 *  - searchText/inventory are extractor outputs (perceptualPalette +
 *    language restored to the inventory item, D4).
 * Behavior parity of the legacy delegates stays pinned by
 * `src/lib/ingestion.test.ts` (re-pointed, not weakened).
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import imageCompression from 'browser-image-compression';
import { extractBook } from './extract';
import { cheapHash } from './identity';
import { extractCoverPalette } from '@lib/cover-palette';
import { extractContentOffscreen } from '@domains/reader/engine/offscreen/offscreen-renderer';
import { CancellationError } from '@lib/cancellable-task-runner';
import { TTS_EXTRACTION_VERSION } from '@lib/ingestion/sentence-extraction';

vi.mock('browser-image-compression', () => ({
  default: vi.fn(() => Promise.resolve(new Blob(['thumbnail'], { type: 'image/webp' }))),
}));

vi.mock('@domains/reader/engine/offscreen/offscreen-renderer', () => ({
  extractContentOffscreen: vi.fn(async (_file, _options, onProgress, signal) => {
    if (signal?.aborted) {
      const { CancellationError } = await import('@lib/cancellable-task-runner');
      throw new CancellationError('Extraction cancelled');
    }
    if (onProgress) onProgress(50, 'Processing...');
    return {
      chapters: [
        {
          href: 'chapter1.html',
          sentences: [{ text: 'Chapter Content.', cfi: 'epubcfi(/6/2!/4/2/1:0)' }],
          citationMarkers: [],
          textContent: 'Chapter Content.',
          title: 'Mock Chapter 1',
          tables: [],
        },
      ],
      baseFontSize: 16,
      baseLineHeight: 24,
    };
  }),
}));

vi.mock('epubjs', () => ({
  default: vi.fn(() => ({
    ready: Promise.resolve(),
    opened: Promise.resolve(),
    loaded: {
      metadata: Promise.resolve({
        title: 'Mock Title',
        creator: 'Mock Author',
        description: 'Mock Description',
        language: 'fr-FR',
      }),
    },
    coverUrl: vi.fn(() => Promise.resolve('blob:cover')),
    destroy: vi.fn(),
  })),
}));

vi.mock('@lib/cover-palette', () => ({
  extractCoverPalette: vi
    .fn()
    .mockResolvedValue({ palette: [1, 2, 3], perceptualPalette: { vibrant: [10, 20, 30] } }),
}));

vi.mock('uuid', () => ({ v4: () => 'mock-uuid' }));

global.fetch = vi.fn(() =>
  Promise.resolve({
    blob: () => Promise.resolve(new Blob(['cover'], { type: 'image/jpeg' })),
  } as Response),
);

const mockExtractContentOffscreen = vi.mocked(extractContentOffscreen);
const mockPalette = vi.mocked(extractCoverPalette);
const mockCompression = vi.mocked(imageCompression);

function makeEpubFile(): File {
  const content = new Uint8Array([0x50, 0x4b, 0x03, 0x04, 0x01, 0x02]);
  const file = new File([content], 'test.epub', { type: 'application/epub+zip' });
  Object.defineProperty(file, 'arrayBuffer', {
    value: async () => content.buffer,
    writable: true,
    enumerable: false,
    configurable: true,
  });
  return file;
}

describe('extractBook', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("depth:'metadata' short-circuits after the preamble — no offscreen render", async () => {
    const result = await extractBook(makeEpubFile(), { depth: 'metadata' });

    expect(result.depth).toBe('metadata');
    expect(result.title).toBe('Mock Title');
    expect(result.author).toBe('Mock Author');
    expect(result.language).toBe('fr');
    expect(result.contentHash).toMatch(/^[0-9a-f]{64}$/);
    expect(result.legacyFingerprint).toContain('test.epub-Mock Title-Mock Author-');
    expect(mockExtractContentOffscreen).not.toHaveBeenCalled();
    expect(mockPalette).toHaveBeenCalledTimes(1);
  });

  it('full depth reusing the probe preamble never repeats compression/palette work (PR-L1 exit)', async () => {
    const file = makeEpubFile();

    const probe = await extractBook(file, { depth: 'metadata' });
    expect(mockPalette).toHaveBeenCalledTimes(1);
    expect(mockCompression).toHaveBeenCalledTimes(1);

    const full = await extractBook(file, { depth: 'full', preamble: probe });

    // The expensive preamble ran exactly once across probe + full import.
    expect(mockPalette).toHaveBeenCalledTimes(1);
    expect(mockCompression).toHaveBeenCalledTimes(1);
    expect(full.depth).toBe('full');
    expect(full.bookId).toBe('mock-uuid');
    expect(full.manifest.contentHash).toBe(probe.contentHash);
    expect(full.manifest.fileHash).toBe(probe.legacyFingerprint);
  });

  it('emits searchText and an inventory item carrying perceptualPalette + language (D4)', async () => {
    const full = await extractBook(makeEpubFile(), { depth: 'full' });

    expect(full.searchText).toEqual({
      extractionVersion: TTS_EXTRACTION_VERSION,
      sections: [
        {
          href: 'chapter1.html',
          title: 'Mock Chapter 1',
          text: 'Chapter Content.',
          // sectionTextHash is stamped at import (Increment C §3): cheapHash of
          // the UTF-8 bytes of the section text.
          sectionTextHash: cheapHash(new TextEncoder().encode('Chapter Content.').buffer),
        },
      ],
    });
    expect(full.inventory).toMatchObject({
      bookId: 'mock-uuid',
      sourceFilename: 'test.epub',
      language: 'fr',
      perceptualPalette: { vibrant: [10, 20, 30] },
      coverPalette: [1, 2, 3],
    });
    expect(full.ttsContentBatches[0].extractionVersion).toBe(TTS_EXTRACTION_VERSION);
  });

  it('an aborted signal surfaces as CancellationError', async () => {
    const controller = new AbortController();
    controller.abort();

    await expect(
      extractBook(makeEpubFile(), { depth: 'full', signal: controller.signal }),
    ).rejects.toBeInstanceOf(CancellationError);
  });

  it('rejects non-ZIP files before opening them', async () => {
    const bogus = new File([new Uint8Array([0, 0, 0, 0])], 'bad.epub');
    await expect(extractBook(bogus, { depth: 'metadata' })).rejects.toThrow('Invalid file format');
  });
});
