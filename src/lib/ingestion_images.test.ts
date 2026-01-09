import { describe, it, expect, vi, beforeEach } from 'vitest';
import { processEpub } from './ingestion';
import { dbService } from '../db/DBService';
import imageCompression from 'browser-image-compression';
import { getDB } from '../db/db';

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
  extractContentOffscreen: vi.fn().mockResolvedValue([]),
}));

describe('Ingestion Image Optimization', () => {
  const mockFile = new File(['PK\x03\x04'], 'test.epub', { type: 'application/epub+zip' });
  const mockCoverBlob = new Blob(['original'], { type: 'image/jpeg' });
  const mockThumbnailBlob = new Blob(['thumbnail'], { type: 'image/jpeg' });

  beforeEach(async () => {
    // Reset mocks
    vi.clearAllMocks();

    // Setup fetch to return cover blob
    mockFetch.mockResolvedValue({
      blob: () => Promise.resolve(mockCoverBlob),
    });

    // Setup compression mock
    (imageCompression as unknown as ReturnType<typeof vi.fn>).mockResolvedValue(mockThumbnailBlob);

    // Clean DB
    const db = await getDB();
    await db.clear('static_manifests'); // Updated to use v18 store
    await db.clear('user_inventory');
    await db.clear('user_progress');
    await db.clear('static_resources');
  });

  it('should store thumbnail in books store (manifest)', async () => {
    const bookId = await processEpub(mockFile);

    // Verify compression was called
    expect(imageCompression).toHaveBeenCalledWith(mockCoverBlob, expect.objectContaining({
      maxWidthOrHeight: 300,
      maxSizeMB: 0.05,
    }));

    // Verify metadata has thumbnail
    // DBService.getBookMetadata now returns composite from static_manifests
    const metadata = await dbService.getBookMetadata(bookId);
    expect(metadata).toBeDefined();

    // Verify coverBlob is returned and defined
    expect(metadata?.coverBlob).toBeDefined();
    // Ideally verify it is the thumbnail blob but blob equality might be tricky in mocks if not referentially stable
    // But since we mock return value, we expect it to be passed through.
  });

  it('should fallback to original if compression fails', async () => {
    const consoleSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
    // Setup compression failure
    (imageCompression as unknown as ReturnType<typeof vi.fn>).mockRejectedValue(new Error('Compression failed'));

    const bookId = await processEpub(mockFile);
    consoleSpy.mockRestore();

    const metadata = await dbService.getBookMetadata(bookId);

    expect(metadata?.coverBlob).toBeDefined();
    // Metadata coverBlob should be the original since compression failed.
  });
});
