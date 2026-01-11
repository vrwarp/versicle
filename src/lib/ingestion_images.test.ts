import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { processEpub } from './ingestion';
import { getDB } from '../db/db';
import imageCompression from 'browser-image-compression';

// Mock getDB
vi.mock('../db/db', () => ({
  getDB: vi.fn(),
}));

// Mock dependencies
vi.mock('browser-image-compression', () => ({
  default: vi.fn(),
}));

// Mock epubjs
vi.mock('epubjs', () => {
  return {
    default: vi.fn(() => ({
      ready: Promise.resolve(),
      loaded: {
        metadata: Promise.resolve({
          title: 'Test Book',
          creator: 'Test Author',
        }),
      },
      coverUrl: vi.fn().mockResolvedValue('blob:cover'),
      destroy: vi.fn(),
    })),
  };
});

// Mock fetch
const mockFetch = vi.fn();
global.fetch = mockFetch;

// Mock extractContentOffscreen
vi.mock('./offscreen-renderer', () => ({
  extractContentOffscreen: vi.fn().mockResolvedValue([
    {
      href: 'chapter1.xhtml',
      sentences: [],
      textContent: 'Chapter 1 content',
      title: 'Chapter 1',
      tables: [
        {
          cfi: 'epubcfi(/6/2[chapter1]!/4/2/1:0)',
          imageBlob: new Blob(['table-image'], { type: 'image/webp' }),
        }
      ]
    }
  ]),
}));

// Mock UUID
vi.mock('uuid', () => ({
  v4: () => 'mock-uuid',
}));

describe('Ingestion Image Optimization', () => {
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
        add: vi.fn(),
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

  const mockFile = new File(['PK\x03\x04'], 'test.epub', { type: 'application/epub+zip' });
  // Mock arrayBuffer for mockFile
  Object.defineProperty(mockFile, 'arrayBuffer', {
    value: async () => new Uint8Array([0x50, 0x4B, 0x03, 0x04]).buffer
  });

  const mockCoverBlob = new Blob(['original'], { type: 'image/jpeg' });
  const mockThumbnailBlob = new Blob(['thumbnail'], { type: 'image/jpeg' });

  beforeEach(async () => {
    vi.clearAllMocks();

    // Setup fetch to return cover blob
    mockFetch.mockResolvedValue({
      blob: () => Promise.resolve(mockCoverBlob),
    });

    // Setup compression mock
    (imageCompression as unknown as ReturnType<typeof vi.fn>).mockResolvedValue(mockThumbnailBlob);

    // Mock DB setup
    mockDB.put.mockResolvedValue(undefined);
    mockDB.get.mockResolvedValue(undefined);
    mockDB.getAll.mockResolvedValue([]);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (getDB as any).mockResolvedValue(mockDB);
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  it('should store thumbnail in books store (manifest)', async () => {
    const mockAdd = vi.fn();
    mockDB.transaction = vi.fn(() => ({
      objectStore: vi.fn(() => ({
        add: mockAdd
      })),
      done: Promise.resolve()
    })) as any;

    const metadata = await processEpub(mockFile);
    const bookId = metadata.id;

    // Verify compression was called
    expect(imageCompression).toHaveBeenCalled();

    // Verify metadata has thumbnail in static_manifests put call
    // Note: processEpub uses transaction.objectStore().add() for manifests
    expect(mockAdd).toHaveBeenCalledWith(expect.objectContaining({
      bookId,
      coverBlob: mockThumbnailBlob
    }));
  });

  it('should store table images in cache_table_images', async () => {
    // Setup transaction mock
    const mockAdd = vi.fn();
    const mockPut = vi.fn();
    mockDB.transaction = vi.fn(() => ({
      objectStore: vi.fn(() => ({
        add: mockAdd,
        put: mockPut
      })),
      done: Promise.resolve()
    })) as any;

    const metadata = await processEpub(mockFile);
    const bookId = metadata.id;

    // processEpub iterates tables and uses tableStore.add(table)
    // tableStore is derived from transaction.objectStore('cache_table_images')
    // Since our mock returns the same object with mockAdd for ALL stores, we just check mockAdd.

    expect(mockAdd).toHaveBeenCalledWith(expect.objectContaining({
      bookId,
      sectionId: 'chapter1.xhtml',
      cfi: 'epubcfi(/6/2[chapter1]!/4/2/1:0)',
      imageBlob: expect.anything()
    }));
  });

  it('should fallback to original if compression fails', async () => {
    const consoleSpy = vi.spyOn(console, 'warn').mockImplementation(() => { });
    // Setup compression failure
    (imageCompression as unknown as ReturnType<typeof vi.fn>).mockRejectedValue(new Error('Compression failed'));

    const mockAdd = vi.fn();
    mockDB.transaction = vi.fn(() => ({
      objectStore: vi.fn(() => ({
        add: mockAdd
      })),
      done: Promise.resolve()
    })) as any;

    const metadata = await processEpub(mockFile);
    const bookId = metadata.id;

    // Check manifest uses original cover blob
    expect(mockAdd).toHaveBeenCalledWith(expect.objectContaining({
      bookId,
      coverBlob: mockCoverBlob
    }));

    consoleSpy.mockRestore();
  });
});
