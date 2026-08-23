/**
 * `extractBook` / `extractPreamble` — the branch arms.
 *
 * extract.test.ts pins the PR-L1 exit criteria (short-circuit, preamble
 * reuse, cancellation, extractor outputs) on the happy path. This file
 * walks the degrade paths instead: every optional the preamble tolerates
 * (no cover, an unreachable cover, compression that fails, a palette that
 * fails or comes back empty, missing OPF fields, no navigation) and the
 * assembly decisions the full pass makes on top of it.
 *
 * Each collaborator is mocked per test so a single arm can be selected
 * without staging a real EPUB.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import imageCompression from 'browser-image-compression';
import { extractCoverPalette } from '@lib/cover-palette';
import { extractContentOffscreen } from '@domains/reader/engine/offscreen/offscreen-renderer';
import { localFetch } from '@kernel/net';
import { extractBook, extractPreamble, type BookMetadataExtraction } from './extract';

// ── module doubles ─────────────────────────────────────────────────────────

interface BookShape {
  metadata?: Record<string, unknown>;
  navigation?: unknown;
  coverUrl?: string | null;
  destroyed?: number;
  openedRejects?: boolean;
}

let bookShape: BookShape;
const destroyCalls: string[] = [];
const epubOptions: unknown[] = [];

vi.mock('epubjs', () => ({
  default: (_file: unknown, opts: unknown) => {
    epubOptions.push(opts);
    return {
      ready: Promise.resolve(),
      opened: bookShape.openedRejects ? Promise.reject(new Error('never opened')) : Promise.resolve(),
      loaded: {
        metadata: Promise.resolve(bookShape.metadata ?? {}),
        navigation: Promise.resolve(bookShape.navigation),
      },
      coverUrl: async () => bookShape.coverUrl ?? null,
      destroy: () => destroyCalls.push('destroy'),
    };
  },
}));

vi.mock('browser-image-compression', () => ({ default: vi.fn() }));
vi.mock('@lib/cover-palette', () => ({ extractCoverPalette: vi.fn() }));
vi.mock('@kernel/net', () => ({ localFetch: vi.fn() }));
vi.mock('uuid', () => ({ v4: () => 'mock-uuid' }));
vi.mock('@domains/reader/engine/offscreen/offscreen-renderer', () => ({
  extractContentOffscreen: vi.fn(),
}));

const mockCompression = vi.mocked(imageCompression);
const mockPalette = vi.mocked(extractCoverPalette);
const mockFetch = vi.mocked(localFetch);
const mockOffscreen = vi.mocked(extractContentOffscreen);

// ── fixtures ───────────────────────────────────────────────────────────────

const ZIP_MAGIC = new Uint8Array([0x50, 0x4b, 0x03, 0x04, 0x01, 0x02]);

const makeEpubFile = (name = 'test.epub', bytes = ZIP_MAGIC): File => {
  const file = new File([bytes], name, { type: 'application/epub+zip' });
  Object.defineProperty(file, 'arrayBuffer', { value: async () => bytes.buffer });
  return file;
};

const coverResponse = (): Response =>
  ({ blob: async () => new Blob(['cover'], { type: 'image/jpeg' }) }) as Response;

const chapter = (over: Record<string, unknown> = {}) => ({
  href: 'ch1.html',
  sentences: [{ text: 'Body text.', cfi: 'epubcfi(/6/2!/4/2/1:0)' }],
  citationMarkers: [],
  textContent: 'Body text.',
  title: 'One',
  tables: [],
  ...over,
});

let warnLogs: string[];

beforeEach(() => {
  bookShape = {
    metadata: { title: 'T', creator: 'A', description: 'D', language: 'en' },
    navigation: { toc: [] },
    coverUrl: null,
  };
  destroyCalls.length = 0;
  epubOptions.length = 0;
  warnLogs = [];
  mockCompression.mockReset().mockResolvedValue(new Blob(['thumb'], { type: 'image/webp' }) as File);
  mockPalette.mockReset().mockResolvedValue({
    palette: [1, 2, 3],
    perceptualPalette: { vibrant: [10, 20, 30] },
  } as unknown as Awaited<ReturnType<typeof extractCoverPalette>>);
  mockFetch.mockReset().mockResolvedValue(coverResponse());
  mockOffscreen.mockReset().mockResolvedValue({
    chapters: [chapter()],
    baseFontSize: 16,
    baseLineHeight: 24,
  } as Awaited<ReturnType<typeof extractContentOffscreen>>);
  vi.spyOn(console, 'warn').mockImplementation((...a: unknown[]) => {
    warnLogs.push(a.map(String).join(' '));
  });
  vi.spyOn(console, 'info').mockImplementation(() => {});
  vi.spyOn(console, 'debug').mockImplementation(() => {});
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe('extractPreamble — OPF metadata', () => {
  it('opens the book with replacements disabled', async () => {
    await extractPreamble(makeEpubFile(), { cover: 'raw' });

    expect(epubOptions).toEqual([{ replacements: 'none' }]);
  });

  it('carries the RAW (unsanitized) metadata through — the fingerprint hashes it', async () => {
    bookShape.metadata = {
      title: '<b>Bold</b> Title',
      creator: 'A. Author',
      description: 'Desc',
      language: 'en',
    };

    const preamble = await extractPreamble(makeEpubFile(), { cover: 'raw' });

    expect(preamble).toMatchObject({
      rawTitle: '<b>Bold</b> Title',
      rawAuthor: 'A. Author',
      rawDescription: 'Desc',
    });
  });

  it('substitutes placeholders for missing title and author, and blanks the description', async () => {
    bookShape.metadata = { language: 'en' };

    const preamble = await extractPreamble(makeEpubFile(), { cover: 'raw' });

    expect(preamble).toMatchObject({
      rawTitle: 'Untitled',
      rawAuthor: 'Unknown Author',
      rawDescription: '',
    });
  });

  it("reads the legacy `lang` key when `language` is absent", async () => {
    bookShape.metadata = { title: 'T', lang: 'fr-FR' };

    expect((await extractPreamble(makeEpubFile(), { cover: 'raw' })).language).toBe('fr');
  });

  it('prefers `language` over `lang` when both are present', async () => {
    bookShape.metadata = { title: 'T', language: 'de-DE', lang: 'fr-FR' };

    expect((await extractPreamble(makeEpubFile(), { cover: 'raw' })).language).toBe('de');
  });

  it('takes the publisher TOC, or an empty one when navigation never loaded', async () => {
    const toc = [{ id: '1', href: 'a', label: 'A', subitems: [] }];
    bookShape.navigation = { toc };
    expect((await extractPreamble(makeEpubFile(), { cover: 'raw' })).toc).toBe(toc);

    bookShape.navigation = undefined;
    expect((await extractPreamble(makeEpubFile(), { cover: 'raw' })).toc).toEqual([]);
  });

  it('always destroys the book, even when it never opened', async () => {
    bookShape.openedRejects = true;

    await extractPreamble(makeEpubFile(), { cover: 'raw' });

    expect(destroyCalls).toEqual(['destroy']);
  });

  it('rejects immediately on an already-aborted signal', async () => {
    const controller = new AbortController();
    controller.abort();

    await expect(
      extractPreamble(makeEpubFile(), { cover: 'raw', signal: controller.signal })
    ).rejects.toThrow('Extraction cancelled');
  });
});

describe('extractPreamble — the cover pipeline', () => {
  it('skips fetch, compression and palette entirely when the book has no cover', async () => {
    bookShape.coverUrl = null;

    const preamble = await extractPreamble(makeEpubFile(), { cover: 'thumbnail' });

    expect(mockFetch).not.toHaveBeenCalled();
    expect(mockCompression).not.toHaveBeenCalled();
    expect(mockPalette).not.toHaveBeenCalled();
    expect(preamble.coverBlob).toBeUndefined();
    expect(preamble.coverPalette).toBeUndefined();
    expect(preamble.perceptualPalette).toBeUndefined();
  });

  it("compresses to a webp thumbnail under 'thumbnail'", async () => {
    bookShape.coverUrl = 'blob:cover';

    const preamble = await extractPreamble(makeEpubFile(), { cover: 'thumbnail' });

    expect(mockCompression).toHaveBeenCalledWith(expect.any(Blob), {
      maxSizeMB: 0.1,
      maxWidthOrHeight: 600,
      useWebWorker: true,
      fileType: 'image/webp',
    });
    expect(preamble.coverBlob?.type).toBe('image/webp');
  });

  it("keeps the original cover under 'raw' (reprocess parity)", async () => {
    bookShape.coverUrl = 'blob:cover';

    const preamble = await extractPreamble(makeEpubFile(), { cover: 'raw' });

    expect(mockCompression).not.toHaveBeenCalled();
    expect(preamble.coverBlob?.type).toBe('image/jpeg');
  });

  it('falls back to the ORIGINAL cover when compression fails', async () => {
    bookShape.coverUrl = 'blob:cover';
    mockCompression.mockRejectedValue(new Error('worker died'));

    const preamble = await extractPreamble(makeEpubFile(), { cover: 'thumbnail' });

    expect(preamble.coverBlob?.type).toBe('image/jpeg');
    expect(warnLogs.some((l) => l.includes('Failed to compress cover image'))).toBe(true);
    // The palette still runs — off the uncompressed original.
    expect(mockPalette).toHaveBeenCalled();
  });

  it('keeps extracting when the cover itself cannot be retrieved', async () => {
    bookShape.coverUrl = 'blob:cover';
    mockFetch.mockRejectedValue(new Error('revoked'));

    const preamble = await extractPreamble(makeEpubFile(), { cover: 'thumbnail' });

    expect(preamble.coverBlob).toBeUndefined();
    expect(mockPalette).not.toHaveBeenCalled();
    expect(warnLogs.some((l) => l.includes('Failed to retrieve cover blob'))).toBe(true);
    expect(preamble.rawTitle).toBe('T');
  });

  it('takes the palette from the THUMBNAIL when one was produced', async () => {
    bookShape.coverUrl = 'blob:cover';
    const thumb = new Blob(['thumb'], { type: 'image/webp' });
    mockCompression.mockResolvedValue(thumb as File);

    await extractPreamble(makeEpubFile(), { cover: 'thumbnail' });

    expect(mockPalette).toHaveBeenCalledWith(thumb);
  });

  it('reports both palettes on success', async () => {
    bookShape.coverUrl = 'blob:cover';

    const preamble = await extractPreamble(makeEpubFile(), { cover: 'raw' });

    expect(preamble.coverPalette).toEqual([1, 2, 3]);
    expect(preamble.perceptualPalette).toEqual({ vibrant: [10, 20, 30] });
  });

  it('drops an EMPTY palette rather than reporting one', async () => {
    bookShape.coverUrl = 'blob:cover';
    mockPalette.mockResolvedValue({ palette: [], perceptualPalette: { vibrant: [1, 2, 3] } } as never);

    const preamble = await extractPreamble(makeEpubFile(), { cover: 'raw' });

    expect(preamble.coverPalette).toBeUndefined();
    // The perceptual palette is independent and survives.
    expect(preamble.perceptualPalette).toEqual({ vibrant: [1, 2, 3] });
  });

  it('a palette failure never aborts extraction — the cover still lands', async () => {
    bookShape.coverUrl = 'blob:cover';
    mockPalette.mockRejectedValue(new Error('canvas unavailable'));

    const preamble = await extractPreamble(makeEpubFile(), { cover: 'raw' });

    expect(preamble.coverBlob).toBeDefined();
    expect(preamble.coverPalette).toBeUndefined();
    expect(preamble.perceptualPalette).toBeUndefined();
    expect(warnLogs.some((l) => l.includes('Failed to extract cover palette'))).toBe(true);
  });
});

describe('extractBook — the metadata pass', () => {
  it('refuses a file that is not a ZIP archive', async () => {
    const notAZip = makeEpubFile('fake.epub', new Uint8Array([0x00, 0x01, 0x02, 0x03]));

    await expect(extractBook(notAZip, { depth: 'metadata' })).rejects.toThrow(
      'Invalid file format. File must be a valid EPUB (ZIP archive).'
    );
  });

  it('short-circuits before the offscreen render', async () => {
    const result = await extractBook(makeEpubFile(), { depth: 'metadata' });

    expect(result.depth).toBe('metadata');
    expect(mockOffscreen).not.toHaveBeenCalled();
  });

  it('reports SANITIZED metadata even though the fingerprint hashed the raw form', async () => {
    bookShape.metadata = {
      title: 'Clean <script>alert(1)</script>',
      creator: 'A',
      description: 'D',
      language: 'en',
    };

    const result = await extractBook(makeEpubFile(), { depth: 'metadata' });

    expect(result.title).not.toContain('<script>');
    expect(warnLogs.some((l) => l.includes('Metadata sanitized'))).toBe(true);
  });

  it('carries both identity hashes', async () => {
    const result = await extractBook(makeEpubFile(), { depth: 'metadata' });

    expect(result.contentHash).toEqual(expect.any(String));
    expect(result.legacyFingerprint).toEqual(expect.any(String));
    expect(result.contentHash).not.toBe('');
  });

  it('a REUSED preamble skips validation, the epubjs open and the hashes entirely', async () => {
    const reused: BookMetadataExtraction = {
      depth: 'metadata',
      title: 'Reused',
      author: 'Reused Author',
      description: '',
      language: 'en',
      contentHash: 'hash-c',
      legacyFingerprint: 'hash-l',
      toc: [],
    } as BookMetadataExtraction;

    const result = await extractBook(makeEpubFile('x.epub', new Uint8Array([0, 0, 0, 0])), {
      depth: 'metadata',
      preamble: reused,
    });

    expect(result).toBe(reused);
    expect(mockFetch).not.toHaveBeenCalled();
    expect(destroyCalls).toEqual([]);
  });
});

describe('extractBook — the full pass', () => {
  const fullOpts = { depth: 'full' as const, extraction: { sanitizationEnabled: true } };

  it('passes the book language down to the sentence extractor as the locale', async () => {
    bookShape.metadata = { title: 'T', creator: 'A', language: 'fr-FR' };

    await extractBook(makeEpubFile(), fullOpts);

    expect(mockOffscreen).toHaveBeenCalledWith(
      expect.any(File),
      expect.objectContaining({ sanitizationEnabled: true, locale: 'fr' }),
      undefined,
      undefined
    );
  });

  it('forwards the progress callback and the abort signal to the renderer', async () => {
    const onProgress = vi.fn();
    const controller = new AbortController();

    await extractBook(makeEpubFile(), { ...fullOpts, onProgress, signal: controller.signal });

    expect(mockOffscreen).toHaveBeenCalledWith(
      expect.any(File),
      expect.anything(),
      onProgress,
      controller.signal
    );
  });

  it('aborts AFTER the metadata pass and before the render', async () => {
    const controller = new AbortController();
    let aborted = false;
    mockFetch.mockImplementation(async () => {
      if (!aborted) {
        aborted = true;
        controller.abort();
      }
      return coverResponse();
    });
    bookShape.coverUrl = 'blob:cover';

    await expect(extractBook(makeEpubFile(), { ...fullOpts, signal: controller.signal })).rejects.toThrow(
      'Extraction cancelled'
    );
    expect(mockOffscreen).not.toHaveBeenCalled();
  });

  it('keeps the PUBLISHER toc when the book has one', async () => {
    const toc = [{ id: '1', href: 'a', label: 'Publisher Chapter', subitems: [] }];
    bookShape.navigation = { toc };

    const result = await extractBook(makeEpubFile(), fullOpts);

    expect(result.structure.toc).toBe(toc);
  });

  it('synthesizes a toc from the chapters when the publisher shipped none', async () => {
    bookShape.navigation = { toc: [] };
    mockOffscreen.mockResolvedValue({
      chapters: [chapter({ href: 'a.html', title: 'A' }), chapter({ href: 'b.html', title: 'B' })],
    } as never);

    const result = await extractBook(makeEpubFile(), fullOpts);

    expect(result.structure.toc.map((t) => t.label)).toEqual(['A', 'B']);
  });

  it('stamps the manifest with the file size, both hashes and the measured base styles', async () => {
    const file = makeEpubFile();

    const result = await extractBook(file, fullOpts);

    expect(result.manifest).toMatchObject({
      bookId: 'mock-uuid',
      fileSize: file.size,
      baseFontSize: 16,
      baseLineHeight: 24,
      contentHash: result.contentHash,
      fileHash: result.legacyFingerprint,
    });
    expect(result.manifest.totalChars).toBeGreaterThan(0);
  });

  it('leaves the base styles undefined when the renderer could not measure them', async () => {
    mockOffscreen.mockResolvedValue({ chapters: [chapter()] } as never);

    const result = await extractBook(makeEpubFile(), fullOpts);

    expect(result.manifest.baseFontSize).toBeUndefined();
    expect(result.manifest.baseLineHeight).toBeUndefined();
  });

  it('builds the spine index from the mapped sections', async () => {
    mockOffscreen.mockResolvedValue({
      chapters: [chapter({ href: 'a.html' }), chapter({ href: 'b.html' })],
    } as never);

    const result = await extractBook(makeEpubFile(), fullOpts);

    expect(result.structure.spineItems).toHaveLength(2);
    expect(result.structure.spineItems[0]).toMatchObject({ index: 0 });
    expect(result.structure.spineItems[1]).toMatchObject({ index: 1 });
  });

  it('seeds the inventory item as unread, from the source filename, with the palettes', async () => {
    bookShape.coverUrl = 'blob:cover';
    bookShape.metadata = { title: 'T', creator: 'A', language: 'es' };

    const result = await extractBook(makeEpubFile('Some Book.epub'), fullOpts);

    expect(result.inventory).toMatchObject({
      bookId: 'mock-uuid',
      sourceFilename: 'Some Book.epub',
      status: 'unread',
      tags: [],
      language: 'es',
      coverPalette: [1, 2, 3],
      perceptualPalette: { vibrant: [10, 20, 30] },
    });
    expect(result.inventory.addedAt).toBe(result.inventory.lastInteraction);
  });

  it("seeds progress at zero and the reading-list entry as 'to-read'", async () => {
    const result = await extractBook(makeEpubFile('Some Book.epub'), fullOpts);

    expect(result.progress).toEqual({
      bookId: 'mock-uuid',
      percentage: 0,
      lastRead: 0,
      completedRanges: [],
    });
    expect(result.readingListEntry).toMatchObject({
      filename: 'Some Book.epub',
      status: 'to-read',
      percentage: 0,
      rating: undefined,
      isbn: undefined,
    });
    expect(result.overrides).toEqual({ bookId: 'mock-uuid', lexicon: [] });
  });

  it('carries the epub blob through as the stored resource', async () => {
    const file = makeEpubFile();

    const result = await extractBook(file, fullOpts);

    expect(result.resource).toEqual({ bookId: 'mock-uuid', epubBlob: file });
  });

  it('stamps the search corpus with the extraction version', async () => {
    const result = await extractBook(makeEpubFile(), fullOpts);

    expect(result.searchText.extractionVersion).toEqual(expect.any(Number));
    expect(result.searchText.sections).toHaveLength(1);
  });

  it('reuses a supplied preamble for the full pass too', async () => {
    const reused = {
      depth: 'metadata',
      title: 'Reused Title',
      author: 'Reused Author',
      description: 'Reused Desc',
      language: 'ja',
      contentHash: 'hash-c',
      legacyFingerprint: 'hash-l',
      toc: [],
      coverPalette: [9],
    } as unknown as BookMetadataExtraction;

    const result = await extractBook(makeEpubFile(), { ...fullOpts, preamble: reused });

    expect(result.title).toBe('Reused Title');
    expect(result.manifest.contentHash).toBe('hash-c');
    expect(result.manifest.fileHash).toBe('hash-l');
    expect(destroyCalls).toEqual([]);
    expect(mockOffscreen).toHaveBeenCalledWith(
      expect.any(File),
      expect.objectContaining({ locale: 'ja' }),
      undefined,
      undefined
    );
  });
});
