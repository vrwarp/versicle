/* eslint-disable @typescript-eslint/no-explicit-any */
import { describe, it, expect, beforeEach, vi, afterEach } from 'vitest';
import { extractBookData, validateZipSignature } from './ingestion';
import type { BookExtractionData } from './ingestion';

// Mock logger
vi.mock('./logger', () => ({
  createLogger: vi.fn(() => ({
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
  }))
}));

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

// Mock extractCoverPalette
vi.mock('./cover-palette', () => ({
    extractCoverPalette: vi.fn().mockResolvedValue([1, 2, 3, 4, 5])
}));

describe('ingestion', () => {
  beforeEach(async () => {
    vi.spyOn(window, 'confirm').mockImplementation(() => true);
  });

  afterEach(() => {
    vi.clearAllMocks();
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
  });
});
