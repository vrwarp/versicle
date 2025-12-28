import { describe, it, expect, vi, beforeEach } from 'vitest';
import { MigrationService } from './MigrationService';
import { getDB } from '../db/db';
import { extractContentOffscreen } from './offscreen-renderer';

// Mock dependencies
vi.mock('../db/db', () => ({
    getDB: vi.fn()
}));

vi.mock('./offscreen-renderer', () => ({
    extractContentOffscreen: vi.fn()
}));

describe('MigrationService', () => {
    let mockDB: any;

    beforeEach(() => {
        mockDB = {
            get: vi.fn(),
            getAll: vi.fn(),
            put: vi.fn(),
            transaction: vi.fn()
        };
        (getDB as any).mockResolvedValue(mockDB);
        vi.clearAllMocks();
    });

    it('should determine migration is required if version is missing', async () => {
        mockDB.get.mockResolvedValue(undefined); // version missing
        const result = await MigrationService.isMigrationRequired();
        expect(result).toBe(true);
        expect(mockDB.get).toHaveBeenCalledWith('app_metadata', 'segmentation_version');
    });

    it('should determine migration is NOT required if version is current', async () => {
        mockDB.get.mockResolvedValue(1); // CURRENT_SEGMENTATION_VERSION is 1
        const result = await MigrationService.isMigrationRequired();
        expect(result).toBe(false);
    });

    it('should migrate books successfully', async () => {
        const mockBooks = [
            { id: 'book1', title: 'Test Book', isOffloaded: false }
        ];
        const mockFile = new Blob(['dummy content']);

        mockDB.getAll.mockResolvedValue(mockBooks);
        mockDB.get.mockResolvedValue(mockFile); // For files store

        // Mock extractContentOffscreen to return some chapters
        (extractContentOffscreen as any).mockResolvedValue([
            { href: 'chap1.html', sentences: [{ text: 'Test.', cfi: 'cfi1' }] }
        ]);

        const mockPut = vi.fn();
        mockDB.transaction.mockReturnValue({
            objectStore: () => ({
                put: mockPut
            })
        });

        const onProgress = vi.fn();
        await MigrationService.migrateLibrary(onProgress);

        // Verify flow
        expect(mockDB.getAll).toHaveBeenCalledWith('books');
        expect(mockDB.get).toHaveBeenCalledWith('files', 'book1');

        // Verify extraction called with empty options
        expect(extractContentOffscreen).toHaveBeenCalledWith(mockFile, {
            abbreviations: [],
            alwaysMerge: [],
            sanitizationEnabled: true
        });

        // Verify DB update
        expect(mockPut).toHaveBeenCalledWith({
            id: 'book1-chap1.html',
            bookId: 'book1',
            sectionId: 'chap1.html',
            sentences: [{ text: 'Test.', cfi: 'cfi1' }]
        });

        // Verify final version update
        expect(mockDB.put).toHaveBeenCalledWith('app_metadata', 1, 'segmentation_version');
        expect(onProgress).toHaveBeenCalledWith(100, expect.any(String));
    });

    it('should skip offloaded books', async () => {
        const mockBooks = [
            { id: 'book1', title: 'Offloaded Book', isOffloaded: true }
        ];
        mockDB.getAll.mockResolvedValue(mockBooks);
        mockDB.get.mockResolvedValue(undefined); // File missing

        await MigrationService.migrateLibrary();

        expect(extractContentOffscreen).not.toHaveBeenCalled();
        // Should still mark migration as complete so we don't loop forever
        expect(mockDB.put).toHaveBeenCalledWith('app_metadata', 1, 'segmentation_version');
    });
});
