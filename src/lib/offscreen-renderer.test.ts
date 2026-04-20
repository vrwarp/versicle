import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { extractContentOffscreen, calculateDominantStyle, StyleAccumulator } from './offscreen-renderer';
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
vi.mock('./tts', () => ({
  extractSentencesFromNode: vi.fn(() => []),
  ExtractionOptions: {}
}));
vi.mock('./sanitizer', () => ({
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
    const { chapters } = await extractContentOffscreen(file);

    expect(snapdom.toBlob).toHaveBeenCalledWith(table, expect.objectContaining({
      type: 'webp',
      quality: 0.1,
      scale: 0.5
    }));

    expect(chapters[0].tables).toHaveLength(1);
    expect(chapters[0].tables?.[0]).toEqual({
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
    const { chapters } = await extractContentOffscreen(file);

    expect(chapters[0].tables).toHaveLength(0);
    expect(consoleSpy).toHaveBeenCalledWith('[OffscreenRenderer]', 'Failed to snap table', error);

    consoleSpy.mockRestore();
  });
});

describe('calculateDominantStyle', () => {
  it('should calculate the dominant style based on volume', () => {
    const accumulator: StyleAccumulator = new Map();

    // Minor front-matter styles (small font)
    accumulator.set(12, { count: 10, charCount: 500, totalLineHeight: 144 });

    // Body styles (dominant volume)
    accumulator.set(18, { count: 50, charCount: 15000, totalLineHeight: 1080 }); // 1080 / 50 = 21.6 lineHeight

    // Footnote styles (tiny font, medium volume)
    accumulator.set(10, { count: 20, charCount: 2000, totalLineHeight: 240 });

    const result = calculateDominantStyle(accumulator);

    expect(result).not.toBeNull();
    expect(result?.fontSize).toBe(18);
    expect(result?.lineHeight).toBe(21.6);
  });

  it('should return null for an empty accumulator', () => {
    const accumulator: StyleAccumulator = new Map();
    const result = calculateDominantStyle(accumulator);
    expect(result).toBeNull();
  });
});
