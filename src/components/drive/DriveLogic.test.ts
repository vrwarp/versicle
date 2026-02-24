import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { renderHook, act, waitFor } from '@testing-library/react';
import { DriveService } from '../../lib/drive/DriveService';
import { useDriveBrowser } from './useDriveBrowser';
import { googleIntegrationManager } from '../../lib/google/GoogleIntegrationManager';

// Mock dependencies
vi.mock('../../lib/google/GoogleIntegrationManager', () => ({
    googleIntegrationManager: {
        getValidToken: vi.fn(),
        connectService: vi.fn(),
    }
}));

describe('Drive Integration', () => {
    beforeEach(() => {
        vi.resetAllMocks();
        global.fetch = vi.fn();
    });

    afterEach(() => {
        vi.clearAllMocks();
        vi.restoreAllMocks();
    });

    describe('DriveService', () => {
        it('fetches with auth token', async () => {
            vi.mocked(googleIntegrationManager.getValidToken).mockResolvedValue('test-token');
            vi.mocked(global.fetch).mockResolvedValue({
                ok: true,
                json: async () => ({ files: [] })
            } as Response);

            await DriveService.listFolders();

            expect(googleIntegrationManager.getValidToken).toHaveBeenCalledWith('drive');
            expect(global.fetch).toHaveBeenCalledWith(
                expect.stringContaining('https://www.googleapis.com/drive/v3/files'),
                expect.objectContaining({
                    headers: expect.objectContaining({
                        'Authorization': 'Bearer test-token'
                    })
                })
            );
        });

        it('retries on 401', async () => {
            vi.spyOn(console, 'warn').mockImplementation(() => {});
            vi.spyOn(console, 'log').mockImplementation(() => {});
            vi.mocked(googleIntegrationManager.getValidToken)
                .mockResolvedValueOnce('expired-token')
                .mockResolvedValueOnce('new-token');

            vi.mocked(global.fetch)
                .mockResolvedValueOnce({ status: 401, ok: false } as Response) // First call fails
                .mockResolvedValueOnce({ ok: true, json: async () => ({ files: [] }) } as Response); // Retry succeeds

            await DriveService.listFolders();

            expect(googleIntegrationManager.getValidToken).toHaveBeenCalledTimes(2);
            expect(global.fetch).toHaveBeenCalledTimes(2);
            expect(global.fetch).toHaveBeenLastCalledWith(
                expect.any(String),
                expect.objectContaining({
                    headers: expect.objectContaining({
                        'Authorization': 'Bearer new-token'
                    })
                })
            );
        });
    });

    describe('useDriveBrowser', () => {
        it('fetches folders on mount', async () => {
            vi.mocked(googleIntegrationManager.getValidToken).mockResolvedValue('token');
            vi.mocked(global.fetch).mockResolvedValue({
                ok: true,
                json: async () => ({ files: [{ id: '1', name: 'Folder 1' }] })
            } as Response);

            const { result } = renderHook(() => useDriveBrowser());

            expect(result.current.isLoading).toBe(true);

            await waitFor(() => {
                expect(result.current.isLoading).toBe(false);
            });

            expect(result.current.items).toHaveLength(1);
            expect(result.current.items[0].name).toBe('Folder 1');
        });

        it('navigates to folder', async () => {
            vi.mocked(googleIntegrationManager.getValidToken).mockResolvedValue('token');
            vi.mocked(global.fetch).mockResolvedValue({
                ok: true,
                json: async () => ({ files: [] })
            } as Response);

            const { result } = renderHook(() => useDriveBrowser());

            await waitFor(() => expect(result.current.isLoading).toBe(false));

            act(() => {
                result.current.openFolder('folder-2', 'Folder 2');
            });

            expect(result.current.currentFolderId).toBe('folder-2');
            expect(result.current.breadcrumbs).toHaveLength(2);
            expect(result.current.breadcrumbs[1].name).toBe('Folder 2');

            // Wait for loading to finish to avoid act warnings
            await waitFor(() => expect(result.current.isLoading).toBe(false));
        });

        it('navigates up', async () => {
            vi.mocked(googleIntegrationManager.getValidToken).mockResolvedValue('token');
            vi.mocked(global.fetch).mockResolvedValue({
                ok: true,
                json: async () => ({ files: [] })
            } as Response);

            const { result } = renderHook(() => useDriveBrowser());
            await waitFor(() => expect(result.current.isLoading).toBe(false));

            act(() => {
                result.current.openFolder('folder-2', 'Folder 2');
            });

            act(() => {
                result.current.navigateUp();
            });

            expect(result.current.currentFolderId).toBe('root');
            expect(result.current.breadcrumbs).toHaveLength(1);

            // Wait for loading to finish to avoid act warnings
            await waitFor(() => expect(result.current.isLoading).toBe(false));
        });
    });
});
