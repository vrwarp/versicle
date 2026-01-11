/* eslint-disable @typescript-eslint/no-explicit-any */
import { describe, it, expect, beforeEach, vi, afterEach } from 'vitest';
import { processEpub, validateZipSignature } from './ingestion';
import { getDB } from '../db/db';

// Mock getDB
vi.mock('../db/db', () => ({
  getDB: vi.fn(),
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

describe('ingestion', () => {
  const mockDB = {
    getAllFromIndex: vi.fn(),
    add: vi.fn(),
    delete: vi.fn(),
    get: vi.fn(),
    put: vi.fn(),
    getAll: vi.fn(),
    transaction: vi.fn(() => ({
      objectStore: vi.fn(() => ({
        put: vi.fn(),
        clear: vi.fn(),
        get: vi.fn(),
      })),
      done: Promise.resolve(),
    })),
    objectStoreNames: {
      contains: vi.fn(() => true),
      [Symbol.iterator]: function* () { yield 'static_manifests'; }
    }
  };

  beforeEach(() => {
    vi.spyOn(window, 'confirm').mockImplementation(() => true);

    // Reset mocks
    vi.clearAllMocks();
    mockDB.put.mockResolvedValue(undefined);
    mockDB.get.mockResolvedValue(undefined);
    mockDB.getAll.mockResolvedValue([]);

    (getDB as any).mockResolvedValue(mockDB);
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

  it('processEpub should reject invalid file format', async () => {
    const file = createMockFile(false);
    await expect(processEpub(file)).rejects.toThrow("Invalid file format");
  });

  it('should process an epub file correctly', async () => {
    const mockFile = createMockFile(true);
    const bookId = await processEpub(mockFile);

    expect(bookId).toBe('mock-uuid');

    // Verify DB puts
    expect(mockDB.put).toHaveBeenCalledWith('static_manifests', expect.objectContaining({
      title: 'Mock Title',
      author: 'Mock Author',
      description: 'Mock Description',
      bookId: 'mock-uuid'
    }));

    expect(mockDB.put).toHaveBeenCalledWith('user_inventory', expect.objectContaining({
      bookId: 'mock-uuid',
      sourceFilename: 'test.epub'
    }));

    expect(mockDB.put).toHaveBeenCalledWith('static_resources', expect.objectContaining({
      bookId: 'mock-uuid',
      epubBlob: expect.anything()
    }));
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

    // Re-mock getDB because resetModules might have cleared it? 
    // Actually getDB mock is top-level. But import might be re-evaluated?
    // Let's rely on global mock.
    // We need to re-apply the mockResolvedValue because beforeEach runs before resetModules?
    // No, beforeEach runs before test. Test calls resetModules.
    // CodeUnderTest imports 'ingestion'. 'ingestion' imports 'db'.
    const { processEpub: processEpubReimported } = await import('./ingestion');
    (getDB as any).mockResolvedValue(mockDB); // Ensure it returns our mock

    const mockFile = createMockFile(true);
    const bookId = await processEpubReimported(mockFile);

    expect(mockDB.put).toHaveBeenCalledWith('static_manifests', expect.objectContaining({
      title: 'No Cover Book',
      coverBlob: undefined
    }));
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

    const { processEpub: processEpubReimported } = await import('./ingestion');
    (getDB as any).mockResolvedValue(mockDB);

    const mockFile = createMockFile(true);
    await processEpubReimported(mockFile);

    expect(mockDB.put).toHaveBeenCalledWith('static_manifests', expect.objectContaining({
      title: 'Untitled',
      author: 'Unknown Author'
    }));
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

    const { processEpub: processEpubReimported } = await import('./ingestion');
    (getDB as any).mockResolvedValue(mockDB);

    const mockFile = createMockFile(true);
    await processEpubReimported(mockFile);

    expect(confirmSpy).not.toHaveBeenCalled();

    // Verify title length in put call
    const putCalls = mockDB.put.mock.calls;
    const manifestCall = putCalls.find((call: any[]) => call[0] === 'static_manifests');
    expect(manifestCall).toBeDefined();
    // Safe check for typescript
    if (manifestCall) {
      expect(manifestCall[1].title.length).toBe(500);
    }

    consoleSpy.mockRestore();
  });
});
