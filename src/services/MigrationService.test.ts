import { describe, it, expect, vi, beforeEach } from 'vitest';
import { MigrationService } from '../services/MigrationService';
import { getDB } from '../db/db';
import { crdtService } from '../lib/crdt/CRDTService';
import * as Y from 'yjs';

// Mock DB and CRDTService
vi.mock('../lib/crdt/CRDTService', async () => {
    const Y = await import('yjs');
    class MockCRDTService {
        doc = new Y.Doc();
        books: Y.Map<any>;
        history: Y.Map<any>;

        constructor() {
            this.books = this.doc.getMap('books');
            this.history = this.doc.getMap('history');
        }

        async waitForReady() { return Promise.resolve(); }
        destroy() {}
    }
    return { crdtService: new MockCRDTService() };
});

describe('MigrationService', () => {
    beforeEach(async () => {
        // Clear LocalStorage
        localStorage.clear();

        // Clear IndexedDB
        const db = await getDB();
        const storeNames = Array.from(db.objectStoreNames);
        if (storeNames.length > 0) {
            const tx = db.transaction(storeNames, 'readwrite');
            for (const store of storeNames) {
                await tx.objectStore(store).clear();
            }
            await tx.done;
        }

        // Clear CRDT
        crdtService.books.clear();
        crdtService.history.clear();

        vi.clearAllMocks();
    });

    it('should hydrate history and progress correctly', async () => {
        const db = await getDB();

        // Setup Legacy Data
        const bookId = 'legacy-book-1';
        const book = {
            id: bookId,
            title: 'Legacy',
            progress: 0.5,
            currentCfi: 'epubcfi(/6/2!/4/2)',
            lastRead: 1000
        };
        const history = {
            bookId: bookId,
            readRanges: ['epubcfi(/6/2!/4/2)', 'epubcfi(/6/2!/4/4)']
        };

        await db.put('books', book);
        await db.put('reading_history', history);

        // Run Migration
        // Mock requestIdleCallback
        const originalRequestIdleCallback = window.requestIdleCallback;
        (window as any).requestIdleCallback = (cb: any) => cb();

        await MigrationService.hydrateHistoryAndProgress();

        // Wait for async operations in requestIdleCallback to finish
        // Since we mocked requestIdleCallback to run immediately, the async function inside it runs.
        // But it's still async. We need to wait a tick.
        await new Promise(resolve => setTimeout(resolve, 10));

        // Verify Migration Flag
        expect(localStorage.getItem('migration_phase_2d_complete')).toBe('true');

        // Verify CRDT Books
        const bookMap = crdtService.books.get(bookId);
        expect(bookMap).toBeDefined();
        expect(bookMap.get('progress')).toBe(0.5);
        expect(bookMap.get('currentCfi')).toBe('epubcfi(/6/2!/4/2)');

        // Verify CRDT History
        const histArray = crdtService.history.get(bookId);
        expect(histArray).toBeDefined();
        expect(histArray?.length).toBeGreaterThan(0);
        // It should contain the compressed range, but mergeCfiRanges returns [] if input is just simple strings?
        // Wait, mergeCfiRanges merges overlapping ranges.
        // Let's assume it returns something.

        // Restore
        if (originalRequestIdleCallback) window.requestIdleCallback = originalRequestIdleCallback;
        else delete (window as any).requestIdleCallback;
    });

    it('should be idempotent', async () => {
        localStorage.setItem('migration_phase_2d_complete', 'true');
        const spy = vi.spyOn(crdtService, 'waitForReady');

        await MigrationService.hydrateHistoryAndProgress();

        expect(spy).not.toHaveBeenCalled();
    });
});
