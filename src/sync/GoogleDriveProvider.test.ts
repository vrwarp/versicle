import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { GoogleDriveProvider } from './GoogleDriveProvider';
import type { SyncManifest } from './types';

describe('GoogleDriveProvider', () => {
    let provider: GoogleDriveProvider;
    let mockGapi: any;
    let mockGoogle: any;

    beforeEach(() => {
        // Mock gapi
        mockGapi = {
            load: vi.fn((lib, callback) => callback()),
            client: {
                init: vi.fn(),
                drive: {
                    files: {
                        list: vi.fn(),
                        get: vi.fn(),
                        create: vi.fn(),
                        update: vi.fn(),
                    }
                }
            }
        };

        // Mock google (GIS)
        mockGoogle = {
            accounts: {
                oauth2: {
                    initTokenClient: vi.fn().mockReturnValue({
                        requestAccessToken: vi.fn()
                    }),
                    revoke: vi.fn((token, cb) => cb && cb()),
                }
            }
        };

        // Assign to global
        global.gapi = mockGapi;
        global.google = mockGoogle;

        provider = new GoogleDriveProvider();
    });

    afterEach(() => {
        vi.clearAllMocks();
        // delete global.gapi;
        // delete global.google;
    });

    describe('authorize', () => {
        it('should initialize token client and gapi client', async () => {
            const authorizePromise = provider.authorize();

            // Simulate GIS callback
            const initCall = mockGoogle.accounts.oauth2.initTokenClient.mock.calls[0];
            const callback = initCall[0].callback;
            callback({ access_token: 'test-token' });

            await authorizePromise;

            expect(mockGoogle.accounts.oauth2.initTokenClient).toHaveBeenCalled();
            expect(mockGapi.load).toHaveBeenCalledWith('client', expect.any(Function));
            expect(mockGapi.client.init).toHaveBeenCalled();
            expect(provider.isAuthorized()).toBe(true);
        });

        it('should handle auth error', async () => {
             const authorizePromise = provider.authorize();

            // Simulate GIS error
            const initCall = mockGoogle.accounts.oauth2.initTokenClient.mock.calls[0];
            const callback = initCall[0].callback;
            // eslint-disable-next-line prefer-promise-reject-errors
            try {
                callback({ error: 'access_denied' });
            } catch (e) {
                // Expected
            }

            await expect(authorizePromise).rejects.toEqual({ error: 'access_denied' });
            expect(provider.isAuthorized()).toBe(false);
        });
    });

    describe('getManifest', () => {
        beforeEach(async () => {
            // fast-track auth
            const p = provider.authorize();
            mockGoogle.accounts.oauth2.initTokenClient.mock.calls[0][0].callback({ access_token: 't' });
            await p;
        });

        it('should return null if file not found', async () => {
            mockGapi.client.drive.files.list.mockResolvedValue({
                result: { files: [] }
            });

            const result = await provider.getManifest();
            expect(result).toBeNull();
        });

        it('should return manifest and etag if found', async () => {
            const mockFileId = 'file-123';
            const mockManifest = { version: 1 };
            const mockVersion = '100';

            mockGapi.client.drive.files.list.mockResolvedValue({
                result: { files: [{ id: mockFileId }] }
            });

            // Content fetch
            mockGapi.client.drive.files.get
                .mockResolvedValueOnce({ result: mockManifest }) // Content
                .mockResolvedValueOnce({ result: { version: mockVersion } }); // Metadata

            const result = await provider.getManifest();

            expect(result).toEqual({
                data: mockManifest,
                etag: mockVersion
            });
            expect(mockGapi.client.drive.files.get).toHaveBeenCalledTimes(2);
        });
    });

    describe('updateManifest', () => {
        beforeEach(async () => {
             // fast-track auth
            const p = provider.authorize();
            mockGoogle.accounts.oauth2.initTokenClient.mock.calls[0][0].callback({ access_token: 't' });
            await p;
        });

        it('should create new file if it does not exist', async () => {
            mockGapi.client.drive.files.list.mockResolvedValue({
                result: { files: [] }
            });

            const data: SyncManifest = { version: 1 } as any;
            await provider.updateManifest(data, '');

            expect(mockGapi.client.drive.files.create).toHaveBeenCalledWith(expect.objectContaining({
                resource: expect.objectContaining({ name: 'versicle_sync_manifest.json' })
            }));
        });

        it('should update existing file', async () => {
            const mockFileId = 'file-123';
            mockGapi.client.drive.files.list.mockResolvedValue({
                result: { files: [{ id: mockFileId }] }
            });

            // Mock get metadata for optimistic check
            mockGapi.client.drive.files.get.mockResolvedValue({
                result: { version: 'old-etag' }
            });

            const data: SyncManifest = { version: 2 } as any;
            await provider.updateManifest(data, 'old-etag');

            expect(mockGapi.client.drive.files.update).toHaveBeenCalledWith(expect.objectContaining({
                fileId: mockFileId
            }));
        });

        it('should throw 412 if etag mismatches (Optimistic Concurrency)', async () => {
             const mockFileId = 'file-123';
             mockGapi.client.drive.files.list.mockResolvedValue({
                result: { files: [{ id: mockFileId }] }
            });

            // Mock get metadata return a NEWER version
            mockGapi.client.drive.files.get.mockResolvedValue({
                result: { version: '200' }
            });

            const data: SyncManifest = { version: 2 } as any;

            await expect(provider.updateManifest(data, '100'))
                .rejects.toThrow('412 Precondition Failed');

            expect(mockGapi.client.drive.files.update).not.toHaveBeenCalled();
        });

         it('should update if etag matches', async () => {
             const mockFileId = 'file-123';
             mockGapi.client.drive.files.list.mockResolvedValue({
                result: { files: [{ id: mockFileId }] }
            });

            // Mock get metadata match
            mockGapi.client.drive.files.get.mockResolvedValue({
                result: { version: '100' }
            });

            const data: SyncManifest = { version: 2 } as any;

            await provider.updateManifest(data, '100');

            expect(mockGapi.client.drive.files.update).toHaveBeenCalledWith(expect.objectContaining({
                fileId: mockFileId
            }));
        });
    });

    describe('signOut', () => {
        it('should revoke token and unauthorized', async () => {
            // fast-track auth
            const p = provider.authorize();
            mockGoogle.accounts.oauth2.initTokenClient.mock.calls[0][0].callback({ access_token: 't' });
            await p;

            await provider.signOut();

            expect(mockGoogle.accounts.oauth2.revoke).toHaveBeenCalled();
            expect(provider.isAuthorized()).toBe(false);
        });
    });
});
