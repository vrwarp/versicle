/* eslint-disable @typescript-eslint/no-explicit-any */
import { describe, it, expect, beforeEach, vi, afterEach } from 'vitest';
import { extractBookData, validateZipSignature, extractCoverPalette } from './ingestion';
import type { BookExtractionData } from './ingestion';

// Mock browser-image-compression
vi.mock('browser-image-compression', () => ({
  default: vi.fn(() => Promise.resolve(new Blob(['thumbnail'], { type: 'image/jpeg' })))
}));

// Mock offscreen renderer
vi.mock('./offscreen-renderer', () => ({
  extractContentOffscreen: vi.fn(async (file, options, onProgress) => {
    if (onProgress) onProgress(50, 'Processing...');
    return [
      {
        href: 'chapter1.html',
        sentences: [{ text: 'Chapter Content.', cfi: 'epubcfi(/6/2!/4/2/1:0)' }],
        textContent: 'Chapter Content.',
        title: 'Mock Chapter 1'
      }
    ];
  })
}));

// Mock epubjs
vi.mock('epubjs', () => {
  return {
    default: vi.fn(() => ({
      ready: Promise.resolve(),
      loaded: {
        metadata: Promise.resolve({
          title: 'Mock Title',
          creator: 'Mock Author',
          description: 'Mock Description',
        }),
      },
      coverUrl: vi.fn(() => Promise.resolve('blob:cover')),
      destroy: vi.fn(),
    })),
    // Mock EpubCFI class
    EpubCFI: class {
      toString() { return 'epubcfi(/6/2[chap1]!/4/2/1:0)'; }
      compare() { return 0; }
    }
  };
});

// Mock fetch
global.fetch = vi.fn(() =>
  Promise.resolve({
    blob: () => Promise.resolve(new Blob(['cover'], { type: 'image/jpeg' })),
  } as Response)
);

// Mock uuid
vi.mock('uuid', () => ({
  v4: () => 'mock-uuid',
}));

describe('ingestion', () => {
  beforeEach(async () => {
    vi.spyOn(window, 'confirm').mockImplementation(() => true);
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  // Preserve global scope
  const originalOffscreenCanvas = global.OffscreenCanvas;
  const originalDocumentCreateElement = document.createElement;

  afterEach(() => {
    global.OffscreenCanvas = originalOffscreenCanvas;
    document.createElement = originalDocumentCreateElement;
    vi.restoreAllMocks();
  });

  const createMockFile = (isValid: boolean = true) => {
    const header = isValid ? [0x50, 0x4B, 0x03, 0x04] : [0x00, 0x00, 0x00, 0x00];
    const content = new Uint8Array([...header, 0x01, 0x02]); // some dummy content
    const file = new File([content], 'test.epub', { type: 'application/epub+zip' });

    // Mock arrayBuffer explicitly
    Object.defineProperty(file, 'arrayBuffer', {
      value: async () => content.buffer,
      writable: true,
      enumerable: false,
      configurable: true
    });
    return file;
  };

  it('validateZipSignature should return true for valid zip signature', async () => {
    const file = createMockFile(true);
    const isValid = await validateZipSignature(file);
    expect(isValid).toBe(true);
  });

  it('validateZipSignature should return false for invalid signature', async () => {
    const file = createMockFile(false);
    const isValid = await validateZipSignature(file);
    expect(isValid).toBe(false);
  });

  it('extractBookData should reject invalid file format', async () => {
    const file = createMockFile(false);
    await expect(extractBookData(file)).rejects.toThrow("Invalid file format");
  });

  it('should extract book data correctly', async () => {
    const mockFile = createMockFile(true);
    const data: BookExtractionData = await extractBookData(mockFile);

    expect(data.bookId).toBe('mock-uuid');
    expect(data.manifest.title).toBe('Mock Title');
    expect(data.manifest.author).toBe('Mock Author');
    expect(data.manifest.description).toBe('Mock Description');

    expect(data.manifest.coverBlob).toBeDefined();
    expect(data.resource.epubBlob).toBeDefined();

    // Check TTS Content
    expect(data.ttsContentBatches).toBeDefined();
    expect(data.ttsContentBatches.length).toBeGreaterThan(0);
    expect(data.ttsContentBatches[0].sentences[0].text).toBe('Chapter Content.');
  });

  it('should handle missing cover gracefully', async () => {
    vi.resetModules();
    const epubjs = await import('epubjs');
    (epubjs.default as any).mockImplementation(() => ({
      ready: Promise.resolve(),
      loaded: {
        metadata: Promise.resolve({
          title: 'No Cover Book',
          creator: 'Unknown',
        }),
      },
      coverUrl: vi.fn(() => Promise.resolve(null)),
      destroy: vi.fn(),
    }));

    const mockFile = createMockFile(true);
    const data = await extractBookData(mockFile);

    expect(data.manifest.title).toBe('No Cover Book');
    expect(data.manifest.coverBlob).toBeUndefined();
  });

  it('should use default values when metadata is missing', async () => {
    vi.resetModules();
    const epubjs = await import('epubjs');
    (epubjs.default as any).mockImplementation(() => ({
      ready: Promise.resolve(),
      loaded: {
        metadata: Promise.resolve({
          // Missing title, creator, and description
        }),
      },
      coverUrl: vi.fn(() => Promise.resolve(null)),
      destroy: vi.fn(),
    }));

    const mockFile = createMockFile(true);
    const data = await extractBookData(mockFile);

    expect(data.manifest.title).toBe('Untitled');
    expect(data.manifest.author).toBe('Unknown Author');
  });

  it('should always sanitize metadata', async () => {
    const consoleSpy = vi.spyOn(console, 'log').mockImplementation(() => { });
    const longTitle = 'A'.repeat(600);

    vi.resetModules();
    const epubjs = await import('epubjs');
    (epubjs.default as any).mockImplementation(() => ({
      ready: Promise.resolve(),
      loaded: {
        metadata: Promise.resolve({
          title: longTitle,
          creator: 'Author',
          description: 'Desc',
        }),
      },
      coverUrl: vi.fn(() => Promise.resolve(null)),
      destroy: vi.fn(),
    }));

    const confirmSpy = vi.spyOn(window, 'confirm');

    const mockFile = createMockFile(true);
    const data = await extractBookData(mockFile);

    expect(confirmSpy).not.toHaveBeenCalled();
    expect(data.manifest.title.length).toBe(500);
    expect(data.manifest.title).not.toBe(longTitle);
    consoleSpy.mockRestore();
  });

  describe('extractCoverPalette', () => {
    it('should extract palette using OffscreenCanvas when available', async () => {
         // Mock OffscreenCanvas
        const mockContext = {
            drawImage: vi.fn(),
            getImageData: vi.fn().mockReturnValue({
                data: new Uint8ClampedArray(1024).fill(255) // White
            })
        };

        class MockOffscreenCanvas {
            getContext() {
                return mockContext;
            }
        }
        // Mock global.OffscreenCanvas as a class (constructor)
        global.OffscreenCanvas = vi.fn(function() {
            return new MockOffscreenCanvas();
        }) as unknown as typeof OffscreenCanvas;

        global.createImageBitmap = vi.fn().mockResolvedValue({} as ImageBitmap);

        const blob = new Blob(['test']);
        const palette = await extractCoverPalette(blob);

        expect(global.OffscreenCanvas).toHaveBeenCalled();
        expect(mockContext.drawImage).toHaveBeenCalled();
        expect(palette).toHaveLength(5);

        // Verify packing (approximate due to weighted averaging)
        // With weighted K-Means, we expect 5 colors.
        // We mocked a simple 4-pixel buffer but the code expects 16x16.
        // The mock context needs to provide enough data for 16x16.
        // 16 * 16 * 4 = 1024 bytes.

        expect(palette).toHaveLength(5);
    });

    it('should fallback to document.createElement if OffscreenCanvas is missing', async () => {
        // Unset OffscreenCanvas
        (global as any).OffscreenCanvas = undefined;

        const mockContext = {
            drawImage: vi.fn(),
            getImageData: vi.fn().mockReturnValue({
                data: new Uint8ClampedArray(1024).fill(0) // All black (16*16*4)
            })
        };

        const mockCanvas = {
            width: 0,
            height: 0,
            getContext: vi.fn().mockReturnValue(mockContext)
        };

        vi.spyOn(document, 'createElement').mockReturnValue(mockCanvas as unknown as HTMLElement);
        global.createImageBitmap = vi.fn().mockResolvedValue({} as ImageBitmap);

        const blob = new Blob(['test']);
        const palette = await extractCoverPalette(blob);

        expect(document.createElement).toHaveBeenCalledWith('canvas');
        expect(mockCanvas.width).toBe(16);
        expect(mockCanvas.height).toBe(16);
        expect(mockContext.drawImage).toHaveBeenCalled();
        expect(palette).toEqual([0, 0, 0, 0, 0]);
    });

    it('should return empty array if context creation fails', async () => {
        (global as any).OffscreenCanvas = undefined;

        const mockCanvas = {
            getContext: vi.fn().mockReturnValue(null) // Context failure
        };
        vi.spyOn(document, 'createElement').mockReturnValue(mockCanvas as unknown as HTMLElement);
        global.createImageBitmap = vi.fn().mockResolvedValue({} as ImageBitmap);

        const blob = new Blob(['test']);
        const palette = await extractCoverPalette(blob);

        expect(palette).toEqual([]);
    });

    it('should return empty array if createImageBitmap fails', async () => {
        (global as any).OffscreenCanvas = undefined;
        global.createImageBitmap = vi.fn().mockRejectedValue(new Error('Failed'));

        const blob = new Blob(['test']);
        const palette = await extractCoverPalette(blob);

        expect(palette).toEqual([]);
    });
  });
});
