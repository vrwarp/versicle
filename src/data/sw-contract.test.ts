// Absorbed from src/sw-utils.test.ts in the same PR that absorbed
// src/sw-utils.ts into src/data/sw-contract.ts (P3-4; test-absorption
// ledger, master plan §4 rule 8). The covers.ts suite below pins the
// app↔SW cover-route contract that used to be five copy-pasted literals.
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { getCoverFromDB, createCoverResponse, closeCoverConnection, STATIC_MANIFESTS_STORE, BOOKS_STORE, DB_NAME } from './sw-contract';
import { COVERS_ENDPOINT_PREFIX, coverUrl, parseCoverPath } from './covers';
import * as idb from 'idb';

vi.mock('idb', () => ({
    openDB: vi.fn(),
}));

describe('covers.ts — the app↔SW cover-route contract', () => {
    it('pins the route prefix (persisted-URL surface: cached SW responses)', () => {
        // The one deliberate literal outside covers.ts: a silent prefix
        // change would break every cached cover response.
        expect(COVERS_ENDPOINT_PREFIX).toBe('/__versicle__/covers/');
    });

    it('coverUrl builds the SW route and parseCoverPath inverts it', () => {
        const url = coverUrl('book-123');
        expect(url).toBe(`${COVERS_ENDPOINT_PREFIX}book-123`);
        expect(parseCoverPath(url)).toBe('book-123');
    });

    it('parseCoverPath rejects non-cover paths and empty ids', () => {
        expect(parseCoverPath(COVERS_ENDPOINT_PREFIX)).toBeNull();
        expect(parseCoverPath('/somewhere/else')).toBeNull();
        expect(parseCoverPath(`${COVERS_ENDPOINT_PREFIX.slice(0, -1)}X/abc`)).toBeNull();
    });

    it('the SW contract reads the same database name as the schema module', () => {
        expect(DB_NAME).toBe('EpubLibraryDB');
    });
});

describe('Service Worker Database Utils', () => {
    const mockDb = {
        objectStoreNames: {
            contains: vi.fn(),
        },
        get: vi.fn(),
        close: vi.fn(),
    };

    beforeEach(async () => {
        // The cover connection is shared across calls now — drop it so each
        // test starts from a cold open.
        await closeCoverConnection();
        vi.clearAllMocks();
        vi.mocked(idb.openDB).mockResolvedValue(mockDb as unknown as idb.IDBPDatabase);
    });

    afterEach(async () => {
        await closeCoverConnection();
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
    });

    it('returns undefined if no suitable store found', async () => {
         mockDb.objectStoreNames.contains.mockReturnValue(false);
         const result = await getCoverFromDB('789');
         expect(result).toBeUndefined();
    });

    it('returns 404 response when cover missing (undefined)', async () => {
         mockDb.objectStoreNames.contains.mockReturnValue(true);
         mockDb.get.mockResolvedValue(undefined); // Record not found

         const response = await createCoverResponse('999');
         expect(response.status).toBe(404);
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
        } finally {
            global.Response = originalResponse;
        }
    });
});

/**
 * getCoverFromDB opened a NEW IndexedDB connection per cover and closed it in
 * a finally — one full open/close handshake per visible cover per paint, on
 * the service worker's single thread.
 */
describe('regression: cover reads share one connection', () => {
    const mockDb = {
        objectStoreNames: { contains: vi.fn(() => true) },
        get: vi.fn(async () => ({ coverBlob: new Blob(['x'], { type: 'image/webp' }) })),
        close: vi.fn(),
    };

    beforeEach(async () => {
        await closeCoverConnection();
        vi.clearAllMocks();
        mockDb.objectStoreNames.contains.mockReturnValue(true);
        vi.mocked(idb.openDB).mockResolvedValue(mockDb as unknown as idb.IDBPDatabase);
    });

    afterEach(async () => {
        await closeCoverConnection();
    });

    it('opens the database once across a burst of cover requests', async () => {
        await Promise.all(Array.from({ length: 8 }, (_, i) => getCoverFromDB(`book-${i}`)));
        await getCoverFromDB('book-later');

        expect(idb.openDB).toHaveBeenCalledTimes(1);
        expect(mockDb.get).toHaveBeenCalledTimes(9);
        expect(mockDb.close).not.toHaveBeenCalled();
    });

    it('opens unversioned so the service worker can never trigger an upgrade', async () => {
        await getCoverFromDB('book-1');

        const [name, version] = vi.mocked(idb.openDB).mock.calls[0];
        expect(name).toBe(DB_NAME);
        expect(version).toBeUndefined();
    });

    it('closes the shared connection when another context needs an upgrade', async () => {
        await getCoverFromDB('book-1');

        const options = vi.mocked(idb.openDB).mock.calls[0][2];
        options?.blocking?.(1, 2, {} as IDBVersionChangeEvent);
        await Promise.resolve();
        await Promise.resolve();

        expect(mockDb.close).toHaveBeenCalledTimes(1);

        // …and the next cover reopens.
        await getCoverFromDB('book-2');
        expect(idb.openDB).toHaveBeenCalledTimes(2);
    });

    it('does not cache a failed open', async () => {
        vi.mocked(idb.openDB).mockRejectedValueOnce(new Error('nope'));

        await expect(getCoverFromDB('book-1')).rejects.toThrow('nope');
        // The next request retries the open instead of replaying the failure.
        await expect(getCoverFromDB('book-1')).resolves.toBeInstanceOf(Blob);
        expect(idb.openDB).toHaveBeenCalledTimes(2);
    });

    it('serves an untyped (ArrayBuffer) cover as webp — what the capture path writes', async () => {
        mockDb.get.mockResolvedValue({
            coverBlob: new Uint8Array([1, 2, 3]).buffer as unknown as Blob,
        });

        const originalResponse = global.Response;
        global.Response = class MockResponse {
            status: number;
            _headers: Map<string, string>;
            constructor(_body: unknown, init?: { status?: number; headers?: Record<string, string> }) {
                this.status = init?.status || 200;
                this._headers = new Map(Object.entries(init?.headers || {}));
            }
            get headers() { return this._headers; }
        } as unknown as typeof Response;

        try {
            const response = await createCoverResponse('book-1');
            expect(response.headers.get('Content-Type')).toBe('image/webp');
        } finally {
            global.Response = originalResponse;
        }
    });
});

/**
 * The idle-close timer was module-level and unbound: its callback closed
 * whatever `dbPromise` happened to hold 30s later, nothing cancelled it when a
 * new request began, and `terminated`/a failed open dropped the connection
 * while leaving it armed. So a read that was in flight when another tab's
 * upgrade closed connection C1 armed a timer from its `finally` AFTER C1 was
 * gone — and that timer closed C2 out from under live cover requests.
 */
describe('regression: the idle close is bound to the connection it was armed for', () => {
    const openConnection = () => ({
        objectStoreNames: { contains: vi.fn(() => true) },
        get: vi.fn(async () => ({ coverBlob: new Blob(['x'], { type: 'image/webp' }) })),
        close: vi.fn(),
    });

    beforeEach(async () => {
        await closeCoverConnection();
        vi.clearAllMocks();
    });

    afterEach(async () => {
        vi.useRealTimers();
        await closeCoverConnection();
    });

    it('still closes its OWN connection once the burst goes idle', async () => {
        const c1 = openConnection();
        vi.mocked(idb.openDB).mockResolvedValue(c1 as unknown as idb.IDBPDatabase);
        vi.useFakeTimers();

        await getCoverFromDB('book-1');
        expect(c1.close).not.toHaveBeenCalled();

        await vi.advanceTimersByTimeAsync(30_000);
        expect(c1.close).toHaveBeenCalledTimes(1);
    });

    it('a timer armed for a closed connection cannot close its successor', async () => {
        const c1 = openConnection();
        const c2 = openConnection();
        // The first read hangs until we release it — it is still in flight when
        // the upgrade closes C1, exactly like a cover read during a paint.
        let releaseFirstRead!: (cover: { coverBlob: Blob }) => void;
        c1.get.mockImplementationOnce(
            () => new Promise((resolve) => { releaseFirstRead = resolve; }),
        );
        vi.mocked(idb.openDB)
            .mockResolvedValueOnce(c1 as unknown as idb.IDBPDatabase)
            .mockResolvedValueOnce(c2 as unknown as idb.IDBPDatabase);
        vi.useFakeTimers();

        const inFlight = getCoverFromDB('book-1');
        await Promise.resolve();
        await Promise.resolve();

        // Another tab starts an upgrade: C1 is closed and dropped.
        const options = vi.mocked(idb.openDB).mock.calls[0][2];
        options?.blocking?.(1, 2, {} as IDBVersionChangeEvent);
        await Promise.resolve();
        await Promise.resolve();
        expect(c1.close).toHaveBeenCalledTimes(1);

        // The in-flight read finishes and arms the idle close from its finally —
        // for a connection that no longer exists.
        releaseFirstRead({ coverBlob: new Blob(['x'], { type: 'image/webp' }) });
        await inFlight;

        // …then the next cover request opens C2 and is STILL IN FLIGHT when the
        // stale timer comes due (the burst the SW is actually serving).
        let releaseSecondRead!: (cover: { coverBlob: Blob }) => void;
        c2.get.mockImplementationOnce(
            () => new Promise((resolve) => { releaseSecondRead = resolve; }),
        );
        const live = getCoverFromDB('book-2');
        await Promise.resolve();
        await Promise.resolve();
        expect(idb.openDB).toHaveBeenCalledTimes(2);

        await vi.advanceTimersByTimeAsync(30_000);
        expect(c2.close).not.toHaveBeenCalled();

        releaseSecondRead({ coverBlob: new Blob(['x'], { type: 'image/webp' }) });
        await expect(live).resolves.toBeInstanceOf(Blob);
        // C2 survived, so the next cover still rides the same connection.
        await expect(getCoverFromDB('book-3')).resolves.toBeInstanceOf(Blob);
        expect(idb.openDB).toHaveBeenCalledTimes(2);
    });
});
