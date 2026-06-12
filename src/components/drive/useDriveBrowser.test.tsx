import { renderHook, act, waitFor } from '@testing-library/react';
import { useDriveBrowser } from './useDriveBrowser';
import { DriveService } from '@lib/drive/DriveService';
import { vi, describe, it, expect, beforeEach } from 'vitest';

vi.mock('@lib/drive/DriveService', () => ({
    DriveService: {
        listFolders: vi.fn()
    }
}));

describe('useDriveBrowser race condition', () => {
    beforeEach(() => {
        vi.clearAllMocks();
    });

    it('ignores stale responses if folder changes rapidly', async () => {
        type ListFoldersResult = Awaited<ReturnType<typeof DriveService.listFolders>>;
        let resolveFolder1: (value: ListFoldersResult | PromiseLike<ListFoldersResult>) => void;
        let resolveFolder2: (value: ListFoldersResult | PromiseLike<ListFoldersResult>) => void;

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
            resolveFolder2([{ id: '2', name: 'File 2', mimeType: 'application/vnd.google-apps.folder' }]);
        });

        // Resolve folder 1 later
        act(() => {
            resolveFolder1([{ id: '1', name: 'File 1', mimeType: 'application/vnd.google-apps.folder' }]);
        });

        await waitFor(() => {
            expect(result.current.isLoading).toBe(false);
        });

        // Expect items to be from folder 2, not folder 1!
        expect(result.current.items).toEqual([{ id: '2', name: 'File 2', mimeType: 'application/vnd.google-apps.folder' }]);
    });
});

// Absorbed from the deleted DriveLogic.test.ts §useDriveBrowser (Phase 7
// test-absorption ledger): basic navigation semantics over the mocked
// DriveService façade.
describe('regression: useDriveBrowser navigation (ex-DriveLogic.test.ts)', () => {
    beforeEach(() => {
        vi.clearAllMocks();
    });

    it('fetches folders on mount', async () => {
        vi.mocked(DriveService.listFolders).mockResolvedValue([
            { id: '1', name: 'Folder 1', mimeType: 'application/vnd.google-apps.folder' },
        ]);

        const { result } = renderHook(() => useDriveBrowser());

        expect(result.current.isLoading).toBe(true);
        await waitFor(() => expect(result.current.isLoading).toBe(false));

        expect(result.current.items).toHaveLength(1);
        expect(result.current.items[0].name).toBe('Folder 1');
    });

    it('navigates to a folder and back up', async () => {
        vi.mocked(DriveService.listFolders).mockResolvedValue([]);

        const { result } = renderHook(() => useDriveBrowser());
        await waitFor(() => expect(result.current.isLoading).toBe(false));

        act(() => {
            result.current.openFolder('folder-2', 'Folder 2');
        });
        expect(result.current.currentFolderId).toBe('folder-2');
        expect(result.current.breadcrumbs).toHaveLength(2);
        expect(result.current.breadcrumbs[1].name).toBe('Folder 2');
        await waitFor(() => expect(result.current.isLoading).toBe(false));

        act(() => {
            result.current.navigateUp();
        });
        expect(result.current.currentFolderId).toBe('root');
        expect(result.current.breadcrumbs).toHaveLength(1);
        await waitFor(() => expect(result.current.isLoading).toBe(false));
    });
});
