import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { extractContentOffscreen } from './offscreen-renderer';
import ePub from 'epubjs';
import { snapdom } from '@zumer/snapdom';

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
  extractSentencesFromNode: vi.fn(() => ({ sentences: [], citationMarkers: [] })),
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

    expect(ePub).toHaveBeenCalledWith(file);
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
});
