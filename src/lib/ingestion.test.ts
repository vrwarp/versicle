/* eslint-disable @typescript-eslint/no-explicit-any */
import { describe, it, expect, beforeEach, vi, afterEach } from 'vitest';
import { processEpub, validateZipSignature } from './ingestion';
import { getDB } from '../db/db';

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
    const db = await getDB();
    // Update reset logic to include new v18 stores
    const stores = [
        'static_manifests', 'static_resources', 'static_structure',
        'user_inventory', 'user_progress', 'user_annotations',
        'user_overrides', 'cache_tts_preparation', 'cache_render_metrics'
    ];

    // Check stores exist before clearing (IDB safe)
    const existingStores = Array.from(db.objectStoreNames);
    const storesToClear = stores.filter(s => existingStores.includes(s));

    if (storesToClear.length > 0) {
        const tx = db.transaction(storesToClear, 'readwrite');
        for (const store of storesToClear) {
            await tx.objectStore(store).clear();
        }
        await tx.done;
    }
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

    const db = await getDB();
    const manifest = await db.get('static_manifests', bookId);
    const resource = await db.get('static_resources', bookId);
    const inventory = await db.get('user_inventory', bookId);
    const progress = await db.get('user_progress', bookId);

    expect(manifest).toBeDefined();
    expect(manifest?.title).toBe('Mock Title');
    expect(manifest?.author).toBe('Mock Author');
    expect(manifest?.description).toBe('Mock Description');
    expect(manifest?.bookId).toBe('mock-uuid');
    expect(manifest?.coverBlob).toBeDefined();

    // Check v18 mapping
    expect(manifest?.fileHash).toBeDefined();

    expect(inventory).toBeDefined();
    expect(inventory?.sourceFilename).toBe('test.epub');

    expect(progress).toBeDefined();
    // isOffloaded is derived, not stored directly in v18

    // File in static_resources
    expect(resource?.epubBlob).toBeDefined();

    // Verify TTS content (cache_tts_preparation)
    const ttsContent = await db.getAll('cache_tts_preparation');
    expect(ttsContent.length).toBeGreaterThan(0);
    expect(ttsContent[0].bookId).toBe(bookId);
    expect(ttsContent[0].sentences.length).toBeGreaterThan(0);
    expect(ttsContent[0].sentences[0].text).toBe('Chapter Content.');
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
    const bookId = await processEpub(mockFile);

    const db = await getDB();
    const manifest = await db.get('static_manifests', bookId);

    expect(manifest).toBeDefined();
    expect(manifest?.title).toBe('No Cover Book');
    expect(manifest?.coverBlob).toBeUndefined();
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
    const bookId = await processEpub(mockFile);

    const db = await getDB();
    const manifest = await db.get('static_manifests', bookId);

    expect(manifest).toBeDefined();
    expect(manifest?.title).toBe('Untitled');
    expect(manifest?.author).toBe('Unknown Author');
  });

  it('should always sanitize metadata', async () => {
      const consoleSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
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

     // Confirm should NOT be called
     const confirmSpy = vi.spyOn(window, 'confirm');

     const mockFile = createMockFile(true);
     const bookId = await processEpub(mockFile);

     const db = await getDB();
     const manifest = await db.get('static_manifests', bookId);

     expect(confirmSpy).not.toHaveBeenCalled();
     expect(manifest?.title.length).toBe(500);
     expect(manifest?.title).not.toBe(longTitle);
     consoleSpy.mockRestore();
  });
});
