import { describe, it, expect, vi, beforeEach, Mock } from 'vitest';
import { DriveService, type DriveFile } from './DriveService';

// Mock dependencies
// Since DriveService is a const object, we can spy on its methods directly
// provided we restore them.

describe('DriveService Recursive', () => {
    beforeEach(() => {
        vi.restoreAllMocks();
    });

    it('should recursively list files', async () => {
        // Mock data
        const rootFiles: DriveFile[] = [
            { id: 'f1', name: 'File1.epub', mimeType: 'application/epub+zip' }
        ];
        const rootFolders: DriveFile[] = [
            { id: 'sub1', name: 'Subfolder 1', mimeType: 'application/vnd.google-apps.folder' }
        ];
        const subFiles: DriveFile[] = [
            { id: 'f2', name: 'File2.epub', mimeType: 'application/epub+zip' }
        ];
        const subFolders: DriveFile[] = []; // No more subfolders

        // Spy on methods
        const listFilesSpy = vi.spyOn(DriveService, 'listFiles');
        const listFoldersSpy = vi.spyOn(DriveService, 'listFolders');

        // Setup mock returns
        listFilesSpy.mockImplementation(async (parentId) => {
            if (parentId === 'root-id') return rootFiles;
            if (parentId === 'sub1') return subFiles;
            return [];
        });

        listFoldersSpy.mockImplementation(async (parentId) => {
            if (parentId === 'root-id') return rootFolders;
            if (parentId === 'sub1') return subFolders;
            return [];
        });

        // Call the new method (cast to any because it's not defined yet)
        const result = await (DriveService as any).listFilesRecursive('root-id', 'application/epub+zip');

        expect(result).toHaveLength(2);
        expect(result.map((f: any) => f.name)).toEqual(expect.arrayContaining(['File1.epub', 'File2.epub']));

        expect(listFilesSpy).toHaveBeenCalledWith('root-id', 'application/epub+zip');
        expect(listFoldersSpy).toHaveBeenCalledWith('root-id');
        expect(listFilesSpy).toHaveBeenCalledWith('sub1', 'application/epub+zip');
    });

    it('should handle nested folders', async () => {
        // Level 1 -> Level 2 -> Level 3
        const level1Folders = [{ id: 'L2', name: 'Level 2', mimeType: 'folder' }];
        const level2Folders = [{ id: 'L3', name: 'Level 3', mimeType: 'folder' }];

        const listFilesSpy = vi.spyOn(DriveService, 'listFiles');
        const listFoldersSpy = vi.spyOn(DriveService, 'listFolders');

        listFoldersSpy.mockImplementation(async (id) => {
            if (id === 'L1') return level1Folders as any;
            if (id === 'L2') return level2Folders as any;
            return [];
        });

        listFilesSpy.mockImplementation(async (id) => {
            if (id === 'L1') return [{ id: 'f1', name: 'f1' }] as any;
            if (id === 'L2') return [{ id: 'f2', name: 'f2' }] as any;
            if (id === 'L3') return [{ id: 'f3', name: 'f3' }] as any;
            return [];
        });

        const result = await (DriveService as any).listFilesRecursive('L1', 'type');

        expect(result).toHaveLength(3);
        expect(result.map((f: any) => f.name)).toEqual(expect.arrayContaining(['f1', 'f2', 'f3']));
    });

    it('should detect cycles and avoid infinite recursion', async () => {
        // Cycle: L1 -> L2 -> L1
        const listFilesSpy = vi.spyOn(DriveService, 'listFiles');
        const listFoldersSpy = vi.spyOn(DriveService, 'listFolders');
        const consoleWarnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});

        listFoldersSpy.mockImplementation(async (id) => {
            if (id === 'L1') return [{ id: 'L2', name: 'Level 2', mimeType: 'folder' }] as any;
            if (id === 'L2') return [{ id: 'L1', name: 'Level 1', mimeType: 'folder' }] as any;
            return [];
        });

        listFilesSpy.mockResolvedValue([]);

        const result = await (DriveService as any).listFilesRecursive('L1', 'type');

        expect(consoleWarnSpy).toHaveBeenCalledWith(expect.stringContaining('Cycle detected'));
        expect(result).toEqual([]); // Should return empty or partial results, but definitely terminate.
        // Actually, L1 calls L2, L2 calls L1. L1(first call) visits L1. L2 visits L2.
        // L2 calls L1(second call). L1(second call) sees L1 visited -> returns [].
        // So L2 returns its files (empty) + L1(second call) files (empty).
        // L1(first call) returns its files (empty) + L2 files (empty).
        // Total empty.

        consoleWarnSpy.mockRestore();
    });
});
