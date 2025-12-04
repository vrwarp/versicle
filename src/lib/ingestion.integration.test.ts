import { describe, it, expect, beforeEach, vi, afterEach } from 'vitest';
import { processEpub } from './ingestion';
import * as fs from 'fs';
import * as path from 'path';

// Mock DB
const mockAdd = vi.fn();
const mockTransaction = {
  objectStore: vi.fn(() => ({
    add: mockAdd,
  })),
  done: Promise.resolve(),
};
const mockDB = {
  transaction: vi.fn(() => mockTransaction),
};

vi.mock('../db/db', () => ({
  getDB: vi.fn(() => Promise.resolve(mockDB)),
}));

// We do NOT mock epubjs here because we want to test the real parsing integration.
// But we DO mock DB to avoid the fake-indexeddb blob issue.

describe('ingestion integration', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  it('should process a real epub file (Alice in Wonderland) and extract metadata + cover', async () => {
    // Mock fetch to handle blob URL for cover
    const fetchSpy = vi.spyOn(global, 'fetch').mockImplementation(async (url) => {
        if (typeof url === 'string' && url.startsWith('blob:')) {
            return {
                blob: async () => new Blob(['mock-cover'], { type: 'image/jpeg' }),
                ok: true,
                status: 200
            } as Response;
        }
        return Promise.reject(new Error(`Unexpected fetch: ${url}`));
    });

    // Read the fixture file
    const fixturePath = path.resolve(__dirname, '../test/fixtures/alice.epub');
    const buffer = fs.readFileSync(fixturePath);

    // Create a File object
    const file = new File([buffer], 'alice.epub', { type: 'application/epub+zip' });

    // Process the epub
    const bookId = await processEpub(file);

    expect(bookId).toBeDefined();

    // Verify metadata via DB spy
    const addCalls = mockAdd.mock.calls;

    // Find metadata call
    const metadataCall = addCalls.find(call => call[0].title !== undefined);
    expect(metadataCall).toBeDefined();
    const book = metadataCall?.[0];

    // The title in the epub metadata is "Alice's Adventures in Wonderland"
    expect(book.title).toContain("Alice's Adventures in Wonderland");
    // Author might be 'Lewis Carroll' or 'Carroll, Lewis'
    expect(book.author).toContain('Lewis Carroll');
    // Cover blob should be defined
    expect(book.coverBlob).toBeDefined();

    // Verify file storage call
    const fileCall = addCalls.find(call => call[0] instanceof File);
    expect(fileCall).toBeDefined();
    const storedFile = fileCall?.[0];

    // Check that we stored the exact file we passed
    expect(storedFile).toBe(file);
    // Double check size match
    expect(storedFile.size).toBe(buffer.length);

    // Restore fetch
    fetchSpy.mockRestore();
  });
});
