import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import {
  extractContentOffscreen,
  isHeavyMediaAsset,
  tableMarkupOf,
  referencesAssetFile,
} from './offscreen-renderer';
import ePub from 'epubjs';
import { snapdom } from '@zumer/snapdom';
import { extractSentencesFromNodeAsync } from '@lib/ingestion/sentence-extraction';

// Mock dependencies
vi.mock('epubjs');
vi.mock('@zumer/snapdom', () => {
  return {
    snapdom: {
      toBlob: vi.fn()
    }
  };
});
vi.mock('@lib/ingestion/sentence-extraction', () => ({
  extractSentencesFromNodeAsync: vi.fn(async () => ({ sentences: [], citationMarkers: [] })),
  ExtractionOptions: {}
}));
vi.mock('@lib/sanitizer', () => ({
  sanitizeContent: vi.fn((html) => html)
}));

describe('extractContentOffscreen', () => {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let mockBook: any;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let mockRendition: any;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let mockSpine: any;

  beforeEach(() => {
    // Setup mock Rendition
    mockRendition = {
      display: vi.fn().mockResolvedValue(undefined),
      getContents: vi.fn(() => []),
      hooks: {
        content: { register: vi.fn() }
      }
    };

    // Setup mock Spine
    mockSpine = {
      items: [
        { href: 'chapter1.xhtml' },
        { href: 'chapter2.xhtml' }
      ],
      hooks: {
        serialize: { register: vi.fn() }
      }
    };

    // Setup mock Book
    mockBook = {
      ready: Promise.resolve(),
      opened: Promise.resolve(),
      renderTo: vi.fn(() => mockRendition),
      spine: mockSpine,
      destroy: vi.fn(),
    };

    (ePub as unknown as ReturnType<typeof vi.fn>).mockReturnValue(mockBook);

    // Reset snapdom mock
    (snapdom.toBlob as unknown as ReturnType<typeof vi.fn>).mockReset();
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  it('should initialize epubjs and render chapters', async () => {
    // Mock getContents to return a dummy document
    const mockDoc = document.implementation.createHTMLDocument();
    mockRendition.getContents.mockReturnValue([{
      document: mockDoc,
      cfiFromRange: vi.fn(() => 'epubcfi(/6/2!/4/1:0)'),
      cfiFromNode: vi.fn(() => 'epubcfi(/6/2!/4/2)')
    }]);

    const file = new Blob(['dummy content']);
    await extractContentOffscreen(file);

    expect(ePub).toHaveBeenCalledWith(file, { replacements: 'none' });
    expect(mockBook.renderTo).toHaveBeenCalled();
    expect(mockRendition.display).toHaveBeenCalledTimes(2);
    expect(mockRendition.display).toHaveBeenCalledWith('chapter1.xhtml');
    expect(mockRendition.display).toHaveBeenCalledWith('chapter2.xhtml');
    expect(mockBook.destroy).toHaveBeenCalled();
  });

  it('should detect and snap tables', async () => {
    // Create a document with a table
    const mockDoc = document.implementation.createHTMLDocument();
    const table = mockDoc.createElement('table');
    mockDoc.body.appendChild(table);

    mockRendition.getContents.mockReturnValue([{
      document: mockDoc,
      cfiFromRange: vi.fn(() => 'epubcfi(/6/2!/4/2)'),
      cfiFromNode: vi.fn(() => 'epubcfi(/6/2!/4/2)')
    }]);

    // Mock snapdom response
    const mockBlob = new Blob(['image data'], { type: 'image/webp' });
    (snapdom.toBlob as unknown as ReturnType<typeof vi.fn>).mockResolvedValue(mockBlob);

    const file = new Blob(['dummy content']);
    const { chapters: results } = await extractContentOffscreen(file);

    expect(snapdom.toBlob).toHaveBeenCalledWith(table, expect.objectContaining({
      type: 'webp',
      quality: 0.1,
      scale: 0.5
    }));

    expect(results[0].tables).toHaveLength(1);
    expect(results[0].tables?.[0]).toEqual({
      cfi: 'epubcfi(/6/2!/4/2)',
      imageBlob: mockBlob
    });
  });

  it('should handle snapdom failures gracefully', async () => {
    const mockDoc = document.implementation.createHTMLDocument();
    const table = mockDoc.createElement('table');
    mockDoc.body.appendChild(table);

    mockRendition.getContents.mockReturnValue([{
      document: mockDoc,
      cfiFromRange: vi.fn(() => 'epubcfi(/6/2!/4/2)'),
      cfiFromNode: vi.fn(() => 'epubcfi(/6/2!/4/2)')
    }]);

    // Mock failure
    const error = new Error('Snap failed');
    (snapdom.toBlob as unknown as ReturnType<typeof vi.fn>).mockRejectedValue(error);

    // Spy on console.warn to suppress the expected error log
    const consoleSpy = vi.spyOn(console, 'warn').mockImplementation(() => { });

    const file = new Blob(['dummy content']);
    const { chapters: results } = await extractContentOffscreen(file);

    expect(results[0].tables).toHaveLength(0);
    expect(consoleSpy).toHaveBeenCalledWith('[OffscreenRenderer]', 'Failed to snap table', error);

    consoleSpy.mockRestore();
  });

  it('reports progress per chapter and completion at the end', async () => {
    mockRendition.getContents.mockReturnValue([]);
    const onProgress = vi.fn();

    await extractContentOffscreen(new Blob(['x']), {}, onProgress);

    expect(onProgress.mock.calls).toEqual([
      [0, 'Processing chapter 1 of 2'],
      [50, 'Processing chapter 2 of 2'],
      [100, 'Ingestion complete'],
    ]);
  });

  it('walks an `each`-style spine as well as an items array', async () => {
    mockBook.spine = {
      each: (cb: (item: { href: string }) => void) => {
        cb({ href: 'a.xhtml' });
        cb({ href: 'b.xhtml' });
        cb({ href: 'c.xhtml' });
      },
      hooks: { serialize: { register: vi.fn() } },
    };
    mockRendition.getContents.mockReturnValue([]);

    await extractContentOffscreen(new Blob(['x']));

    expect(mockRendition.display).toHaveBeenCalledTimes(3);
  });

  it('renders through a scrolled single-column flow (no columnization)', async () => {
    mockRendition.getContents.mockReturnValue([]);

    await extractContentOffscreen(new Blob(['x']));

    expect(mockBook.renderTo).toHaveBeenCalledWith(
      expect.any(HTMLElement),
      expect.objectContaining({ flow: 'scrolled-doc', manager: 'default' }),
    );
  });

  it('mounts the container OFFSCREEN and removes it afterwards', async () => {
    mockRendition.getContents.mockReturnValue([]);
    const before = document.body.childElementCount;
    let mounted: HTMLElement | undefined;
    mockBook.renderTo = vi.fn((container: HTMLElement) => {
      mounted = container;
      expect(container.parentNode).toBe(document.body);
      expect(container.style.visibility).toBe('hidden');
      expect(container.style.position).toBe('absolute');
      return mockRendition;
    });

    await extractContentOffscreen(new Blob(['x']));

    expect(mounted).toBeDefined();
    expect(mounted?.parentNode).toBeNull();
    expect(document.body.childElementCount).toBe(before);
  });

  it('re-ticks the epub.js queue onto the zero-delay scheduler when one exists', async () => {
    mockRendition.q = { tick: undefined };
    mockRendition.getContents.mockReturnValue([]);

    await extractContentOffscreen(new Blob(['x']));

    expect(mockRendition.q.tick).toEqual(expect.any(Function));
  });

  it('tolerates a rendition with no internal queue', async () => {
    mockRendition.getContents.mockReturnValue([]);

    await expect(extractContentOffscreen(new Blob(['x']))).resolves.toBeDefined();
  });

  it('skips a chapter whose contents never materialized', async () => {
    mockRendition.getContents.mockReturnValue([]);

    const result = await extractContentOffscreen(new Blob(['x']));

    expect(result.chapters).toEqual([]);
  });

  it('names each chapter and carries its href and text', async () => {
    const doc = document.implementation.createHTMLDocument();
    doc.body.innerHTML = '<h1>Down the Rabbit-Hole</h1><p>Alice was beginning.</p>';
    mockRendition.getContents.mockReturnValue([
      { document: doc, cfiFromRange: vi.fn(), cfiFromNode: vi.fn() },
    ]);

    const result = await extractContentOffscreen(new Blob(['x']));

    expect(result.chapters).toHaveLength(2);
    expect(result.chapters[0]).toMatchObject({
      href: 'chapter1.xhtml',
      title: 'Down the Rabbit-Hole',
    });
    expect(result.chapters[0].textContent).toContain('Alice was beginning');
  });

  it('ABORTS between chapters on a cancelled signal, and still tears down', async () => {
    mockRendition.getContents.mockReturnValue([]);
    const controller = new AbortController();
    controller.abort();

    await expect(
      extractContentOffscreen(new Blob(['x']), {}, undefined, controller.signal),
    ).rejects.toThrow('Extraction cancelled');

    expect(mockRendition.display).not.toHaveBeenCalled();
    expect(mockBook.destroy).toHaveBeenCalled();
  });

  it('stops mid-book when the signal aborts partway', async () => {
    mockRendition.getContents.mockReturnValue([]);
    const controller = new AbortController();
    mockRendition.display = vi.fn(async () => {
      controller.abort();
    });

    await expect(
      extractContentOffscreen(new Blob(['x']), {}, undefined, controller.signal),
    ).rejects.toThrow('Extraction cancelled');

    expect(mockRendition.display).toHaveBeenCalledTimes(1);
  });

  it('reports no base styles when nothing could be measured', async () => {
    mockRendition.getContents.mockReturnValue([]);

    const result = await extractContentOffscreen(new Blob(['x']));

    expect(result.baseFontSize).toBeUndefined();
    expect(result.baseLineHeight).toBeUndefined();
  });

  it('tears the book down even when a chapter render throws', async () => {
    mockRendition.display = vi.fn(async () => {
      throw new Error('render failed');
    });

    await expect(extractContentOffscreen(new Blob(['x']))).rejects.toThrow('render failed');

    expect(mockBook.destroy).toHaveBeenCalled();
  });

  it('swallows a book that never opened during teardown', async () => {
    mockBook.opened = Promise.reject(new Error('never opened'));
    mockRendition.getContents.mockReturnValue([]);

    await expect(extractContentOffscreen(new Blob(['x']))).resolves.toBeDefined();
    expect(mockBook.destroy).toHaveBeenCalled();
  });

  /**
   * Extraction used to be one unbroken synchronous pass per chapter (the only
   * yield was BETWEEN chapters), and every table capture left snapdom's
   * module-global image/font/resource caches populated for the session.
   */
  describe('regression: the chapter pass yields and leaves no snapdom cache', () => {
    it('hands the extractor a yield seam bound to the chapter budget', async () => {
      const mockDoc = document.implementation.createHTMLDocument();
      mockRendition.getContents.mockReturnValue([{
        document: mockDoc,
        cfiFromRange: vi.fn(() => 'epubcfi(/6/2!/4/1:0)'),
        cfiFromNode: vi.fn(() => 'epubcfi(/6/2!/4/2)'),
      }]);

      await extractContentOffscreen(new Blob(['x']));

      const extractor = vi.mocked(extractSentencesFromNodeAsync);
      expect(extractor).toHaveBeenCalled();
      const control = extractor.mock.calls[0][3];
      expect(typeof control?.shouldYield).toBe('function');
      expect(typeof control?.yieldFn).toBe('function');
      // The seam actually yields (and does not throw) when invoked.
      await expect(control?.yieldFn?.()).resolves.toBeUndefined();
      expect(typeof control?.shouldYield()).toBe('boolean');
    });

    it('captures tables with snapdom caching disabled', async () => {
      const mockDoc = document.implementation.createHTMLDocument();
      const table = mockDoc.createElement('table');
      mockDoc.body.appendChild(table);
      mockRendition.getContents.mockReturnValue([{
        document: mockDoc,
        cfiFromRange: vi.fn(() => 'epubcfi(/6/2!/4/1:0)'),
        cfiFromNode: vi.fn(() => 'epubcfi(/6/2!/4/2)'),
      }]);
      (snapdom.toBlob as unknown as ReturnType<typeof vi.fn>)
        .mockResolvedValue(new Blob(['image'], { type: 'image/webp' }));

      await extractContentOffscreen(new Blob(['x']));

      expect(snapdom.toBlob).toHaveBeenCalledWith(table, expect.objectContaining({
        cache: 'disabled',
      }));
    });
  });

  /**
   * `cache: 'disabled'` reclaims snapdom's unbounded module-global maps — but
   * it also empties `defaultStyle`/`baseStyle`, which are keyed by tag name
   * and are the most expensive things it caches (a miss = createElement into
   * a sandbox in the MAIN document + a full getComputedStyle walk). Sending
   * it on EVERY capture re-probed roughly ten tags per table; a ~300-table
   * reference book paid that 300 times over. The reset belongs at chapter
   * granularity, where the unbounded maps are actually worth reclaiming.
   */
  describe('regression: the snapdom cache reset is per chapter, not per table', () => {
    const chapterWithTables = (count: number) => {
      const mockDoc = document.implementation.createHTMLDocument();
      for (let i = 0; i < count; i += 1) {
        mockDoc.body.appendChild(mockDoc.createElement('table'));
      }
      mockRendition.getContents.mockReturnValue([{
        document: mockDoc,
        cfiFromRange: vi.fn(() => 'epubcfi(/6/2!/4/1:0)'),
        cfiFromNode: vi.fn(() => 'epubcfi(/6/2!/4/2)'),
      }]);
      (snapdom.toBlob as unknown as ReturnType<typeof vi.fn>)
        .mockResolvedValue(new Blob(['image'], { type: 'image/webp' }));
    };

    const cachePolicies = () =>
      (snapdom.toBlob as unknown as ReturnType<typeof vi.fn>).mock.calls
        .map((call: unknown[]) => (call[1] as { cache?: string }).cache);

    it('disables caching for the first capture of each chapter and reuses it after', async () => {
      // Two spine items × three tables each.
      chapterWithTables(3);

      await extractContentOffscreen(new Blob(['x']));

      expect(cachePolicies()).toEqual([
        'disabled', 'soft', 'soft',
        'disabled', 'soft', 'soft',
      ]);
    });

    it('still resets on the first capture when a chapter has a single table', async () => {
      chapterWithTables(1);

      await extractContentOffscreen(new Blob(['x']));

      expect(cachePolicies()).toEqual(['disabled', 'disabled']);
    });

    it('captures every table either way — the policy changes nothing about the output', async () => {
      chapterWithTables(3);

      const { chapters } = await extractContentOffscreen(new Blob(['x']));

      expect(chapters[0].tables).toHaveLength(3);
      expect(chapters[0].tables?.every((t) => t.cfi === 'epubcfi(/6/2!/4/2)')).toBe(true);
      expect(chapters[0].tables?.every((t) => t.imageBlob instanceof Blob)).toBe(true);
    });
  });

  /**
   * The sentences accumulator is wall-clock around the extraction call, and
   * extraction now deliberately SLEEPS inside that window via the injected
   * yield. Its sibling accumulators measure work that never sleeps, so the one
   * phase this change optimized was the only measure inflated by its own
   * yields — and chained zero-delay timeouts get clamped once nesting passes a
   * few levels, so a multi-second extraction records hundreds of ms of sleep.
   */
  describe('regression: the sentences metric excludes its own yield sleep', () => {
    const recordMeasures = () => {
      const measures = new Map<string, number>();
      vi.spyOn(performance, 'measure').mockImplementation(((
        name: string,
        opts: { start: number; end: number },
      ) => {
        measures.set(name, opts.end - opts.start);
        return undefined as unknown as PerformanceMeasure;
      }) as typeof performance.measure);
      return measures;
    };

    /** An extractor that does no work at all, and only yields. */
    const yieldOnly = (times: number) => {
      vi.mocked(extractSentencesFromNodeAsync).mockImplementation(
        async (_node, _cfi, _options, control) => {
          for (let i = 0; i < times; i += 1) await control?.yieldFn?.();
          return { sentences: [], citationMarkers: [] };
        },
      );
    };

    beforeEach(() => {
      const mockDoc = document.implementation.createHTMLDocument();
      mockRendition.getContents.mockReturnValue([{
        document: mockDoc,
        cfiFromRange: vi.fn(() => 'epubcfi(/6/2!/4/1:0)'),
        cfiFromNode: vi.fn(() => 'epubcfi(/6/2!/4/2)'),
      }]);
    });

    afterEach(() => {
      vi.mocked(extractSentencesFromNodeAsync)
        .mockImplementation(async () => ({ sentences: [], citationMarkers: [] }));
    });

    it('reports the yielded time as its own measure', async () => {
      const measures = recordMeasures();
      yieldOnly(25);

      await extractContentOffscreen(new Blob(['x']));

      expect(measures.has('import:offscreen:sentences-yield')).toBe(true);
      expect(measures.get('import:offscreen:sentences-yield')!).toBeGreaterThan(0);
    });

    it('does not charge that sleep to the sentences measure', async () => {
      const measures = recordMeasures();
      yieldOnly(25);

      await extractContentOffscreen(new Blob(['x']));

      // The extractor double burns no CPU, so essentially the whole window is
      // sleep. Wall-clock would put all of it in `sentences`.
      const sentences = measures.get('import:offscreen:sentences')!;
      const yielded = measures.get('import:offscreen:sentences-yield')!;
      expect(sentences).toBeLessThan(yielded);
      expect(sentences).toBeGreaterThanOrEqual(0);
    });

    it('leaves the sibling accumulators measuring what they always did', async () => {
      const measures = recordMeasures();
      yieldOnly(5);

      await extractContentOffscreen(new Blob(['x']));

      for (const name of ['import:offscreen:display', 'import:offscreen:styles', 'import:offscreen:tables']) {
        expect(measures.has(name)).toBe(true);
        expect(measures.get(name)!).toBeGreaterThanOrEqual(0);
      }
    });
  });

  /**
   * Opening an ARCHIVED book ran epub.js's `Book.replacements()` whatever
   * `replacements` was set to, and that inflates EVERY non-HTML manifest
   * entry — Uint8Array → Blob → object URL — in one `Promise.all` before the
   * first chapter renders. On a 25 MB illustrated EPUB that is the whole
   * image payload resident at once, for a pass that only wants text and
   * CFIs. (Measured on verification/pride-and-prejudice.epub: 180 object
   * URLs / 24.9 MB before, 17 / 0.48 MB after, with the persisted
   * sentences, CFIs, baseFontSize, baseLineHeight and table captures
   * byte-identical.)
   *
   * The catch is that snapdom's table captures ARE persisted extraction
   * output, so any media a table points at still has to be real — dropping
   * it outright shrank that book's title-page capture from 4200 to 1094
   * bytes. Hence the scoping the tests below pin.
   */
  describe('regression: asset inflation is scoped to what extraction output needs', () => {
    /** A Resources double shaped like epub.js 0.3.93's. */
    const makeResources = (opts: {
      assets: { href: string; type?: string }[];
      html?: { href: string }[];
      sections?: Record<string, string>;
    }) => {
      const sections = opts.sections ?? {};
      return {
        urls: opts.assets.map((a) => a.href),
        assets: opts.assets,
        html: opts.html ?? [],
        replacementUrls: [] as (string | undefined)[],
        replaceCss: vi.fn(async () => undefined),
        settings: {
          resolver: (p: string) => `/${p}`,
          archive: {
            getText: vi.fn(async (url: string) => sections[url.replace(/^\//, '')]),
            getBlob: vi.fn(async (url: string) => new Blob([url], { type: 'application/octet-stream' })),
          },
        },
      };
    };

    const renderEmptyChapters = () => {
      mockRendition.getContents.mockReturnValue([{
        document: document.implementation.createHTMLDocument(),
        cfiFromRange: vi.fn(() => 'epubcfi(/6/2!/4/1:0)'),
        cfiFromNode: vi.fn(() => 'epubcfi(/6/2!/4/2)'),
      }]);
    };

    it('opens the extraction book with replacements disabled', async () => {
      renderEmptyChapters();
      const file = new Blob(['x']);

      await extractContentOffscreen(file);

      expect(ePub).toHaveBeenCalledWith(file, { replacements: 'none' });
    });

    it('inflates stylesheets and fonts but not bulk media no table uses', async () => {
      const resources = makeResources({
        assets: [
          { href: 'style.css', type: 'text/css' },
          { href: 'fonts/body.otf', type: 'application/vnd.ms-opentype' },
          { href: 'images/plate1.jpg', type: 'image/jpeg' },
          { href: 'audio/track.mp3', type: 'audio/mpeg' },
        ],
        html: [{ href: 'ch1.xhtml' }],
        sections: { 'ch1.xhtml': '<p>no tables here</p>' },
      });
      mockBook.resources = resources;
      renderEmptyChapters();

      await extractContentOffscreen(new Blob(['x']));

      expect(resources.replacementUrls[0]).toMatch(/^blob:/); // css
      expect(resources.replacementUrls[1]).toMatch(/^blob:/); // font
      expect(resources.replacementUrls[2]).toBeUndefined(); // image
      expect(resources.replacementUrls[3]).toBeUndefined(); // audio
    });

    it('inflates media a table references, wherever in the book that table is', async () => {
      const resources = makeResources({
        assets: [
          { href: 'images/peacock.png', type: 'image/png' },
          { href: 'images/plate1.jpg', type: 'image/jpeg' },
        ],
        html: [{ href: 'ch1.xhtml' }, { href: 'ch2.xhtml' }],
        sections: {
          'ch1.xhtml': '<p><img src="plate1.jpg"/></p>',
          'ch2.xhtml': '<table><tr><td><img src="../images/peacock.png"/></td></tr></table>',
        },
      });
      mockBook.resources = resources;
      renderEmptyChapters();

      await extractContentOffscreen(new Blob(['x']));

      expect(resources.replacementUrls[0]).toMatch(/^blob:/);
      // Referenced only OUTSIDE a table: not extraction output, stays out.
      expect(resources.replacementUrls[1]).toBeUndefined();
    });

    it('inflates media a stylesheet names (a cell background lands in the capture)', async () => {
      const resources = makeResources({
        assets: [
          { href: 'style.css', type: 'text/css' },
          { href: 'images/cellbg.png', type: 'image/png' },
          { href: 'images/plate1.jpg', type: 'image/jpeg' },
        ],
        html: [{ href: 'ch1.xhtml' }],
        sections: {
          'ch1.xhtml': '<p>no tables</p>',
          'style.css': 'td.bg { background-image: url(images/cellbg.png); }',
        },
      });
      mockBook.resources = resources;
      renderEmptyChapters();

      await extractContentOffscreen(new Blob(['x']));

      expect(resources.replacementUrls[1]).toMatch(/^blob:/);
      expect(resources.replacementUrls[2]).toBeUndefined();
    });

    it('re-runs replaceCss so stylesheet url() refs see the new urls', async () => {
      const resources = makeResources({
        assets: [{ href: 'fonts/body.woff2', type: 'font/woff2' }],
      });
      mockBook.resources = resources;
      renderEmptyChapters();

      await extractContentOffscreen(new Blob(['x']));

      // epub.js already ran it once at open, against an EMPTY table.
      expect(resources.replaceCss).toHaveBeenCalledTimes(1);
    });

    it('revokes every object url it created (epub.js revokes none)', async () => {
      const revoke = vi.spyOn(URL, 'revokeObjectURL');
      const resources = makeResources({
        assets: [{ href: 'style.css', type: 'text/css' }],
      });
      mockBook.resources = resources;
      renderEmptyChapters();

      await extractContentOffscreen(new Blob(['x']));

      expect(revoke).toHaveBeenCalledWith(resources.replacementUrls[0]);
      revoke.mockRestore();
    });

    it('is inert on a book with no resources (and never blocks extraction)', async () => {
      renderEmptyChapters();
      await expect(extractContentOffscreen(new Blob(['x']))).resolves.toBeDefined();
    });

    it('classifies bulk media by media-type, falling back to the extension', () => {
      expect(isHeavyMediaAsset({ href: 'a.png', type: 'image/png' })).toBe(true);
      expect(isHeavyMediaAsset({ href: 'a.mp3', type: 'audio/mpeg' })).toBe(true);
      expect(isHeavyMediaAsset({ href: 'a.mp4', type: 'video/mp4' })).toBe(true);
      expect(isHeavyMediaAsset({ href: 'a.css', type: 'text/css' })).toBe(false);
      expect(isHeavyMediaAsset({ href: 'f.otf', type: 'application/vnd.ms-opentype' })).toBe(false);
      // No media-type in the manifest: fall back to the file extension.
      expect(isHeavyMediaAsset({ href: 'art/cover.JPEG' })).toBe(true);
      expect(isHeavyMediaAsset({ href: 'css/main.css' })).toBe(false);
    });

    it('collects table markup without swallowing the document between tables', () => {
      const html = '<p>a</p><table id="one"><td>x</td></table><p>mid</p><table>y</table>';
      const markup = tableMarkupOf(html);
      expect(markup).toContain('id="one"');
      expect(markup).toContain('y');
      expect(markup).not.toContain('mid');
      expect(tableMarkupOf('<p>no tables</p>')).toBe('');
      // A tag that merely starts with "table" is not a table.
      expect(tableMarkupOf('<tablet>x</tablet>')).toBe('');
    });

    it('matches a reference across relative-path and encoding shapes', () => {
      const markup = '<table><img src="../img/pea%20cock.png"/></table>';
      expect(referencesAssetFile(markup, 'OEBPS/img/pea cock.png')).toBe(true);
      expect(referencesAssetFile(markup, 'img/pea%20cock.png')).toBe(true);
      expect(referencesAssetFile(markup, 'img/other.png')).toBe(false);
      expect(referencesAssetFile('<table>x</table>', '')).toBe(false);
      // Same matcher serves stylesheet text.
      expect(referencesAssetFile('td{background-image:url(../i/bg.png)}', 'i/bg.png')).toBe(true);
    });
  });
});
