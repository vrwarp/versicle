import { renderHook, act, waitFor } from '@testing-library/react';
import { useDriveBrowser } from './useDriveBrowser';
import { DriveService } from '../../lib/drive/DriveService';
import { vi, describe, it, expect, beforeEach } from 'vitest';

vi.mock('../../lib/drive/DriveService', () => ({
    DriveService: {
        listFolders: vi.fn()
    }
}));

describe('useDriveBrowser race condition', () => {
    beforeEach(() => {
        vi.clearAllMocks();
    });

    it('ignores stale responses if folder changes rapidly', async () => {
        let resolveFolder1: (value: unknown) => void;
        let resolveFolder2: (value: unknown) => void;

        vi.mocked(DriveService.listFolders).mockImplementation(async (folderId) => {
            if (folderId === 'folder1') {
                return new Promise(r => resolveFolder1 = r);
            }
            if (folderId === 'folder2') {
                return new Promise(r => resolveFolder2 = r);
            }
            return [];
        });

        const { result } = renderHook(() => useDriveBrowser('folder1'));

        act(() => {
            result.current.openFolder('folder2', 'Folder 2');
        });

        // Resolve folder 2 first
        act(() => {
            resolveFolder2([{ id: '2', name: 'File 2' }]);
        });

        // Resolve folder 1 later
        act(() => {
            resolveFolder1([{ id: '1', name: 'File 1' }]);
        });

        await waitFor(() => {
            expect(result.current.isLoading).toBe(false);
        });

        // Expect items to be from folder 2, not folder 1!
        expect(result.current.items).toEqual([{ id: '2', name: 'File 2' }]);
    });
});
