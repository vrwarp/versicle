import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { extractContentOffscreen } from './offscreen-renderer';
import ePub from 'epubjs';
import { snapdom } from '@zumer/snapdom';
import { sanitizeContent } from './sanitizer';

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
  let mockBook: any;
  let mockRendition: any;
  let mockSpine: any;
  let container: HTMLDivElement;

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
        cfiFromRange: vi.fn(() => 'epubcfi(/6/2!/4/1:0)')
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
        cfiFromRange: vi.fn(() => 'epubcfi(/6/2!/4/2)')
    }]);

    // Mock snapdom response
    const mockBlob = new Blob(['image data'], { type: 'image/webp' });
    (snapdom.toBlob as unknown as ReturnType<typeof vi.fn>).mockResolvedValue(mockBlob);

    const file = new Blob(['dummy content']);
    const results = await extractContentOffscreen(file);

    expect(snapdom.toBlob).toHaveBeenCalledWith(table, expect.objectContaining({
        type: 'webp',
        quality: 0.5,
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
        cfiFromRange: vi.fn(() => 'epubcfi(/6/2!/4/2)')
    }]);

    (snapdom.toBlob as unknown as ReturnType<typeof vi.fn>).mockRejectedValue(new Error('Snap failed'));

    const file = new Blob(['dummy content']);
    const results = await extractContentOffscreen(file);

    expect(results[0].tables).toHaveLength(0);
    // Should not throw
  });
});
