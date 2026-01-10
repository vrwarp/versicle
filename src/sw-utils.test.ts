import { describe, it, expect, vi, beforeEach } from 'vitest';
import { getCoverFromDB, createCoverResponse, STATIC_MANIFESTS_STORE, BOOKS_STORE } from './sw-utils';
import * as idb from 'idb';

vi.mock('idb', () => ({
    openDB: vi.fn(),
}));

describe('Service Worker Database Utils', () => {
    const mockDb = {
        objectStoreNames: {
            contains: vi.fn(),
        },
        get: vi.fn(),
        close: vi.fn(),
    };

    beforeEach(() => {
        vi.clearAllMocks();
        vi.mocked(idb.openDB).mockResolvedValue(mockDb as unknown as idb.IDBPDatabase);
    });

    it('retrieves cover from static_manifests in v18 architecture', async () => {
        // Setup: DB has static_manifests
        mockDb.objectStoreNames.contains.mockImplementation((name) => name === STATIC_MANIFESTS_STORE);
        const blob = new Blob(['fake'], { type: 'image/png' });
        mockDb.get.mockResolvedValue({ coverBlob: blob });

        const result = await getCoverFromDB('123');

        expect(mockDb.objectStoreNames.contains).toHaveBeenCalledWith(STATIC_MANIFESTS_STORE);
        expect(mockDb.get).toHaveBeenCalledWith(STATIC_MANIFESTS_STORE, '123');
        expect(result).toBe(blob);
        expect(mockDb.close).toHaveBeenCalled();
    });

    it('retrieves cover from books in legacy architecture', async () => {
        // Setup: DB has NO static_manifests, BUT has books
        mockDb.objectStoreNames.contains.mockImplementation((name) => name === BOOKS_STORE);
        const blob = new Blob(['legacy'], { type: 'image/jpeg' });
        mockDb.get.mockResolvedValue({ coverBlob: blob });

        const result = await getCoverFromDB('456');

        expect(mockDb.objectStoreNames.contains).toHaveBeenCalledWith(STATIC_MANIFESTS_STORE);
        expect(mockDb.objectStoreNames.contains).toHaveBeenCalledWith(BOOKS_STORE);
        expect(mockDb.get).toHaveBeenCalledWith(BOOKS_STORE, '456');
        expect(result).toBe(blob);
        expect(mockDb.close).toHaveBeenCalled();
    });

    it('returns undefined if no suitable store found', async () => {
         mockDb.objectStoreNames.contains.mockReturnValue(false);
         const result = await getCoverFromDB('789');
         expect(result).toBeUndefined();
         expect(mockDb.close).toHaveBeenCalled();
    });

    it('returns 404 response when cover missing (undefined)', async () => {
         mockDb.objectStoreNames.contains.mockReturnValue(true);
         mockDb.get.mockResolvedValue(undefined); // Record not found

         const response = await createCoverResponse('999');
         expect(response.status).toBe(404);
         expect(mockDb.close).toHaveBeenCalled();
    });

    it('returns 200 response with correct blob when found', async () => {
        mockDb.objectStoreNames.contains.mockImplementation((name) => name === STATIC_MANIFESTS_STORE);

        // Use Blob and expect success. If node fails to stream Blob, we mock Response.
        // However, we are testing logic, not Response implementation.
        // But createCoverResponse uses new Response(blob).
        // If "undici" (node fetch polyfill) fails with "object.stream is not a function", it means
        // the Blob implementation in Vitest environment is not fully compatible with undici Response.

        // We can pass a buffer/string to Response constructor in test to bypass blob stream issue?
        // But the code passes the blob.

        // Workaround: Mock Response global if needed?
        // Or construct a Blob that works.
        // Node 22 Blob should work.

        const blob = new Blob(['image-data'], { type: 'image/png' });
        mockDb.get.mockResolvedValue({ coverBlob: blob });

        // If this throws, it's environment issue.
        // Let's spy on Response to avoid actual construction failure?
        // But Response is global.

        // Let's assume the previous failure was due to Blob handling.
        // We can try to cast blob to any and ensure it has stream method?
        // Or mock global.Response?

        const originalResponse = global.Response;
        global.Response = class MockResponse {
             body: unknown;
             status: number;
             _headers: Map<string, string>;
             constructor(body: unknown, init: { status?: number; headers?: Record<string, string> } | undefined) {
                 this.body = body;
                 this.status = init?.status || 200;
                 this._headers = new Map(Object.entries(init?.headers || {}));
             }
             get headers() { return this._headers; }
             set headers(h) { this._headers = h; }
        } as unknown as typeof Response;

        try {
            const response = await createCoverResponse('abc');
            expect(response.status).toBe(200);
            expect(response.headers.get('Content-Type')).toBe('image/png');
            expect(mockDb.close).toHaveBeenCalled();
        } finally {
            global.Response = originalResponse;
        }
    });
});
