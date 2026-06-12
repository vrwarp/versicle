/* eslint-disable @typescript-eslint/no-explicit-any */
import { describe, it, expect, beforeEach, vi, afterEach } from 'vitest';
import { validateZipSignature, sanitizeString, getSanitizedBookMetadata } from './ingestion';
import { extractBook, type FullBookExtraction } from '@domains/library/import/extract';

// Re-pointed at PR-L1/L2 (phase7): `extractBookData` was a deleted delegate;
// the same assertions now exercise the unified extractor directly.
const extractBookData = (file: File) => extractBook(file, { depth: 'full' });
import { TTS_EXTRACTION_VERSION } from './ingestion/sentence-extraction';

// Mock browser-image-compression
vi.mock('browser-image-compression', () => ({
  default: vi.fn(() => Promise.resolve(new Blob(['thumbnail'], { type: 'image/webp' })))
}));

// Mock offscreen renderer
vi.mock('./offscreen-renderer', () => ({
  extractContentOffscreen: vi.fn(async (_file, _options, onProgress) => {
    if (onProgress) onProgress(50, 'Processing...');
    return {
      chapters: [
        {
          href: 'chapter1.html',
          sentences: [{ text: 'Chapter Content.', cfi: 'epubcfi(/6/2!/4/2/1:0)' }],
          textContent: 'Chapter Content.',
          title: 'Mock Chapter 1',
          tables: []
        }
      ],
      baseFontSize: 16,
      baseLineHeight: 24
    };
  })
}));

// Mock epubjs
vi.mock('epubjs', () => {
  return {
    default: vi.fn(() => ({
      ready: Promise.resolve(),
      opened: Promise.resolve(),
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
  extractCoverPalette: vi.fn().mockResolvedValue({ palette: [1, 2, 3, 4, 5] })
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
    const data: FullBookExtraction = await extractBookData(mockFile);

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
      opened: Promise.resolve(),
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

  it('should extract correct language from metadata', async () => {
    vi.resetModules();
    const epubjs = await import('epubjs');
    (epubjs.default as any).mockImplementation(() => ({
      ready: Promise.resolve(),
      opened: Promise.resolve(),
      loaded: {
        metadata: Promise.resolve({
          language: 'zh-CN'
        }),
      },
      coverUrl: vi.fn(() => Promise.resolve(null)),
      destroy: vi.fn(),
    }));

    const file = createMockFile();
    const data = await extractBookData(file);
    expect(data.inventory.language).toBe('zh');
    expect(data.manifest.language).toBe('zh');
  });

  it('should default to english for malformed language metadata', async () => {
    vi.resetModules();
    const epubjs = await import('epubjs');
    (epubjs.default as any).mockImplementation(() => ({
      ready: Promise.resolve(),
      opened: Promise.resolve(),
      loaded: {
        metadata: Promise.resolve({
          language: 'invalidlanguage'
        }),
      },
      coverUrl: vi.fn(() => Promise.resolve(null)),
      destroy: vi.fn(),
    }));

    const file = createMockFile();
    const data = await extractBookData(file);
    expect(data.inventory.language).toBe('en');
    expect(data.manifest.language).toBe('en');
  });

  it('should use default values when metadata is missing', async () => {
    vi.resetModules();
    const epubjs = await import('epubjs');
    (epubjs.default as any).mockImplementation(() => ({
      ready: Promise.resolve(),
      opened: Promise.resolve(),
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
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => { });
    const longTitle = 'A'.repeat(600);

    vi.resetModules();
    const epubjs = await import('epubjs');
    (epubjs.default as any).mockImplementation(() => ({
      ready: Promise.resolve(),
      opened: Promise.resolve(),
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
    warnSpy.mockRestore();
  });

  describe('regression: NFKD/CFI fix-forward extraction version stamp', () => {
    it('stamps newly written TTS preparation rows with the current extraction version', async () => {
      const mockFile = createMockFile(true);
      const data: FullBookExtraction = await extractBookData(mockFile);

      // Rows without this stamp predate the raw-offset segmentation fix and may
      // carry drifted CFIs for non-ASCII books (re-ingestion targets them later).
      expect(data.ttsContentBatches.length).toBeGreaterThan(0);
      for (const batch of data.ttsContentBatches) {
        expect(batch.extractionVersion).toBe(TTS_EXTRACTION_VERSION);
      }
    });
  });

  // Absorbed from src/db/validators.test.ts in the same PR that dissolved
  // src/db/validators.ts into this module (Phase 3 D4; test-absorption
  // ledger, plan/overhaul/README.md section 4 rule 8).
  describe('regression: metadata sanitization (absorbed from db/validators.test.ts)', () => {
    beforeEach(() => {
      vi.spyOn(console, 'error').mockImplementation(() => {});
      vi.spyOn(console, 'warn').mockImplementation(() => {});
    });

    describe('sanitizeString', () => {
      it('trims whitespace', () => {
        expect(sanitizeString('  hello  ')).toBe('hello');
      });

      it('truncates to max length', () => {
        expect(sanitizeString('hello world', 5)).toBe('hello');
      });

      it('returns empty string for non-string input', () => {
        expect(sanitizeString(123 as any)).toBe('');
      });

      it('robustly sanitizes tricky HTML payloads (using DOMPurify)', () => {
        // Nested tags: DOMPurify strips tags; the first < survives as text.
        expect(sanitizeString('<<script>script>alert(1)</script>')).toBe('<');
        // Attribute injection
        expect(sanitizeString('<a title=">">Link</a>')).toBe('Link');
        // Complex image tag
        expect(sanitizeString('<<img src=x onerror=alert(1)>')).toBe('<');
        // Script with whitespace: element removed along with content
        expect(sanitizeString('<script >alert(1)</script >')).toBe('');
        // Style tag removal: element removed along with content
        expect(sanitizeString('<style>body{color:red}</style>')).toBe('');
      });
    });

    describe('getSanitizedBookMetadata', () => {
      const validBook = {
        id: '123',
        title: 'Title',
        author: 'Author',
        addedAt: 1234567890,
      };

      it('sanitizes string fields and detects modifications', () => {
        const result = getSanitizedBookMetadata({
          ...validBook,
          title: '  Title  ',
          author: '  Author  ',
          description: '  Desc  ',
        });
        expect(result).not.toBeNull();
        expect(result?.wasModified).toBe(true);
        expect(result?.sanitized.title).toBe('Title');
        expect(result?.sanitized.author).toBe('Author');
        expect(result?.sanitized.description).toBe('Desc');
      });

      it('truncates overly long fields and reports it', () => {
        const longString = 'a'.repeat(3000);
        const result = getSanitizedBookMetadata({
          ...validBook,
          title: longString,
          author: longString,
          description: longString,
        });
        expect(result).not.toBeNull();
        expect(result?.wasModified).toBe(true);
        expect(result?.sanitized.title.length).toBe(500);
        expect(result?.sanitized.author.length).toBe(255);
        expect(result?.sanitized.description?.length).toBe(2000);
        expect(result?.modifications).toHaveLength(3);
        expect(result?.modifications[0]).toContain('Title sanitized');
      });

      it('strips HTML tags but preserves math symbols', () => {
        const result = getSanitizedBookMetadata({
          ...validBook,
          title: '<b>Title</b>',
          author: 'A < B',
          description: '<script>alert(1)</script>',
        });
        expect(result?.wasModified).toBe(true);
        expect(result?.sanitized.title).toBe('Title');
        expect(result?.sanitized.author).toBe('A < B'); // Preserved as text
        expect(result?.sanitized.description).toBe('');
        expect(result?.modifications[0]).toContain('Title sanitized');
      });

      it('returns null for invalid structure', () => {
        expect(getSanitizedBookMetadata(null)).toBeNull();
        expect(getSanitizedBookMetadata({})).toBeNull();
      });
    });
  });
});
