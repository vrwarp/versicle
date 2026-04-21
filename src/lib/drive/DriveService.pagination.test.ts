import { describe, it, expect, vi, beforeEach } from 'vitest';
import { DriveService } from './DriveService';

vi.mock('../google/GoogleIntegrationManager', () => ({
    googleIntegrationManager: {
        getValidToken: vi.fn().mockResolvedValue('fake-token'),
    }
}));

describe('DriveService Pagination', () => {
    beforeEach(() => {
        global.fetch = vi.fn();
        vi.clearAllMocks();
    });

    it('should handle pagination in listFiles', async () => {
        const page1 = {
            ok: true,
            json: async () => ({
                files: [{ id: '1', name: 'File 1' }],
                nextPageToken: 'token-page-2'
            })
        };
        const page2 = {
            ok: true,
            json: async () => ({
                files: [{ id: '2', name: 'File 2' }]
            })
        };

        vi.mocked(global.fetch)
            .mockResolvedValueOnce(page1 as Response)
            .mockResolvedValueOnce(page2 as Response);

        const files = await DriveService.listFiles('root');

        expect(files).toHaveLength(2);
        expect(global.fetch).toHaveBeenCalledTimes(2);
    });

    it('should handle pagination in listFolders', async () => {
        const page1 = {
            ok: true,
            json: async () => ({
                files: [{ id: '1', name: 'Folder 1' }],
                nextPageToken: 'token-page-2'
            })
        };
        const page2 = {
            ok: true,
            json: async () => ({
                files: [{ id: '2', name: 'Folder 2' }]
            })
        };

        vi.mocked(global.fetch)
            .mockResolvedValueOnce(page1 as Response)
            .mockResolvedValueOnce(page2 as Response);

        const folders = await DriveService.listFolders('root');

        expect(folders).toHaveLength(2);
        expect(global.fetch).toHaveBeenCalledTimes(2);
    });
});
