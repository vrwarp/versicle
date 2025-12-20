/* eslint-disable @typescript-eslint/no-explicit-any */
import { describe, it, expect, beforeEach, vi, afterEach } from 'vitest';
import { processEpub, validateEpubFile } from './ingestion';
import { getDB } from '../db/db';

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
      archive: {
        getBlob: vi.fn(() => Promise.resolve(new Blob(['<html xmlns="http://www.w3.org/1999/xhtml"><body><p>Chapter Content. Second Sentence.</p></body></html>'], { type: 'application/xhtml+xml' }))),
      },
      spine: {
        each: (cb: any) => {
            const items = [
                { id: 'chap1', href: 'chapter1.html', index: 0 },
                { id: 'chap2', href: 'chapter2.html', index: 1 }
            ];
            items.forEach(cb);
        }
      }
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
    const tx = db.transaction(['books', 'files', 'sections', 'annotations'], 'readwrite');
    await tx.objectStore('books').clear();
    await tx.objectStore('files').clear();
    await tx.objectStore('sections').clear();
    await tx.done;
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

  it('validateEpubFile should return true for valid zip signature', async () => {
      const file = createMockFile(true);
      const isValid = await validateEpubFile(file);
      expect(isValid).toBe(true);
  });

  it('validateEpubFile should return false for invalid signature', async () => {
      const file = createMockFile(false);
      const isValid = await validateEpubFile(file);
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
    const book = await db.get('books', bookId);

    expect(book).toBeDefined();
    expect(book?.title).toBe('Mock Title');
    expect(book?.author).toBe('Mock Author');
    expect(book?.description).toBe('Mock Description');
    expect(book?.id).toBe('mock-uuid');
    expect(book?.coverBlob).toBeDefined();

    const storedFile = await db.get('files', bookId);
    expect(storedFile).toBeDefined();

    // Verify TTS content
    const ttsContent = await db.getAll('tts_content');
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
      spine: { each: vi.fn() },
      archive: { getBlob: vi.fn() }
    }));

    const mockFile = createMockFile(true);
    const bookId = await processEpub(mockFile);

    const db = await getDB();
    const book = await db.get('books', bookId);

    expect(book).toBeDefined();
    expect(book?.title).toBe('No Cover Book');
    expect(book?.coverBlob).toBeUndefined();
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
      spine: { each: vi.fn() },
      archive: { getBlob: vi.fn() }
    }));

    const mockFile = createMockFile(true);
    const bookId = await processEpub(mockFile);

    const db = await getDB();
    const book = await db.get('books', bookId);

    expect(book).toBeDefined();
    expect(book?.title).toBe('Untitled');
    expect(book?.author).toBe('Unknown Author');
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
       spine: { each: vi.fn() },
       archive: { getBlob: vi.fn() }
     }));

     // Confirm should NOT be called
     const confirmSpy = vi.spyOn(window, 'confirm');

     const mockFile = createMockFile(true);
     const bookId = await processEpub(mockFile);

     const db = await getDB();
     const book = await db.get('books', bookId);

     expect(confirmSpy).not.toHaveBeenCalled();
     expect(book?.title.length).toBe(500);
     expect(book?.title).not.toBe(longTitle);
   });
});
