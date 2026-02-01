import { describe, it, expect, vi, beforeEach } from 'vitest';
import { extractBookData } from './ingestion';
import imageCompression from 'browser-image-compression';

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

// Mock createImageBitmap and Canvas
global.createImageBitmap = vi.fn().mockResolvedValue({
  width: 100,
  height: 100,
  close: vi.fn(),
} as unknown as ImageBitmap);

class MockOffscreenCanvas {
  getContext() {
    return {
      drawImage: vi.fn(),
      getImageData: vi.fn().mockReturnValue({
        data: new Uint8ClampedArray(16 * 16 * 4).fill(0),
      }),
    };
  }
}
// eslint-disable-next-line @typescript-eslint/no-explicit-any
(global as any).OffscreenCanvas = MockOffscreenCanvas;

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
// Mock uuid
vi.mock('uuid', () => ({
  v4: () => 'mock-uuid',
}));

describe('Ingestion Image Optimization', () => {
  const mockFile = new File(['PK\x03\x04'], 'test.epub', { type: 'application/epub+zip' });
  const mockCoverBlob = new Blob(['original'], { type: 'image/jpeg' });
  const mockThumbnailBlob = new Blob(['thumbnail'], { type: 'image/webp' });

  beforeEach(async () => {
    // Reset mocks
    vi.clearAllMocks();

    // Setup fetch to return cover blob
    mockFetch.mockResolvedValue({
      blob: () => Promise.resolve(mockCoverBlob),
    });

    // Setup compression mock
    (imageCompression as unknown as ReturnType<typeof vi.fn>).mockResolvedValue(mockThumbnailBlob);
  });

  it('should generate thumbnail for cover', async () => {
    const data = await extractBookData(mockFile);

    // Verify compression was called
    expect(imageCompression).toHaveBeenCalledWith(mockCoverBlob, expect.objectContaining({
      maxWidthOrHeight: 600,
      maxSizeMB: 0.1,
      fileType: 'image/webp',
    }));

    expect(data.manifest.coverBlob).toBeDefined();
    // In extractBookData, the returned cover is the optimized one (or original if optimization fails/not needed)
    // We mocked optimization to return mockThumbnailBlob
    // Check if the logic in extractBookData uses the optimized blob.
  });

  it('should extract table images', async () => {
    const data = await extractBookData(mockFile);

    expect(data.tableBatches).toHaveLength(1);
    expect(data.tableBatches[0]).toEqual(expect.objectContaining({
      sectionId: 'chapter1.xhtml',
      cfi: 'epubcfi(/6/2[chapter1]!/4/2/1:0)',
    }));
    expect(data.tableBatches[0].imageBlob).toBeDefined();
  });

  it('should fallback to original if compression fails', async () => {
    const consoleSpy = vi.spyOn(console, 'warn').mockImplementation(() => { });
    // Setup compression failure
    (imageCompression as unknown as ReturnType<typeof vi.fn>).mockRejectedValue(new Error('Compression failed'));

    const data = await extractBookData(mockFile);
    consoleSpy.mockRestore();

    expect(data.manifest.coverBlob).toBeDefined();
    // Should be original blob since compression failed
    // We check existence here.
  });
});
