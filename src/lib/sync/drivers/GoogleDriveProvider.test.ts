import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { GoogleDriveProvider } from './GoogleDriveProvider';

describe('GoogleDriveProvider', () => {
    let provider: GoogleDriveProvider;
    let mockGapi: {
        load: (lib: string, cb: () => void) => void;
        client: {
            init: ReturnType<typeof vi.fn>;
            getToken: ReturnType<typeof vi.fn>;
            drive: {
                files: {
                    list: ReturnType<typeof vi.fn>;
                    get: ReturnType<typeof vi.fn>;
                    create: ReturnType<typeof vi.fn>;
                }
            }
        };
    };
    let mockGoogle: {
        accounts: {
            oauth2: {
                initTokenClient: ReturnType<typeof vi.fn>;
            }
        };
    };

    beforeEach(() => {
        provider = new GoogleDriveProvider();

        // Mock Globals
        mockGapi = {
            load: vi.fn((_lib, cb) => cb()),
            client: {
                init: vi.fn().mockResolvedValue(undefined),
                getToken: vi.fn().mockReturnValue({ access_token: 'mock_token' }),
                drive: {
                    files: {
                        list: vi.fn(),
                        get: vi.fn(),
                        create: vi.fn(), // If used via gapi, but we used fetch for upload usually?
                        // Provider uses fetch for upload/patch
                    }
                }
            }
        };
        // @ts-expect-error - mock global
        window.gapi = mockGapi;

        mockGoogle = {
            accounts: {
                oauth2: {
                    initTokenClient: vi.fn().mockReturnValue({
                        requestAccessToken: vi.fn()
                    })
                }
            }
        };
        // @ts-expect-error - mock global
        window.google = mockGoogle;

        // Mock Fetch
        global.fetch = vi.fn();
    });

    afterEach(() => {
        vi.restoreAllMocks();
    });

    it('should initialize correctly', async () => {
        await provider.initialize({ clientId: 'cid', apiKey: 'key' });
        expect(mockGapi.client.init).toHaveBeenCalledWith(expect.objectContaining({ apiKey: 'key' }));
        expect(mockGoogle.accounts.oauth2.initTokenClient).toHaveBeenCalled();
    });

    it('should authenticate on demand', async () => {
        // Prepare mock that triggers callback automatically
        // We need a mutable object because Provider overwrites .callback
        mockGoogle.accounts.oauth2.initTokenClient.mockImplementation((config: { callback: (token: { access_token: string }) => void }) => {
            const clientMock = {
                callback: config.callback,
                requestAccessToken: vi.fn(() => {
                    // Call the current callback property
                    setTimeout(() => clientMock.callback({ access_token: 'new_token' }), 0);
                })
            };
            return clientMock;
        });

        await provider.initialize({ clientId: 'cid', apiKey: 'key' });

        await provider.signIn();

        expect(await provider.isAuthenticated()).toBe(true);
    });

    it('should search for manifest file', async () => {
        await provider.initialize({ clientId: 'cid', apiKey: 'key' });
        // @ts-expect-error - access private
        provider.accessToken = 'token'; // Bypass auth check

        mockGapi.client.drive.files.list.mockResolvedValue({
            result: { files: [{ id: 'file_123' }] }
        });

        // @ts-expect-error - access private
        const id = await provider.findManifestFileId();
        expect(id).toBe('file_123');
    });

    it('should get manifest', async () => {
        await provider.initialize({ clientId: 'cid', apiKey: 'key' });
        // @ts-expect-error - access private
        provider.accessToken = 'token';
        // @ts-expect-error - access private
        provider.manifestFileId = 'file_123';

        const mockManifest = { version: 1 };
        mockGapi.client.drive.files.get.mockResolvedValue({
            result: mockManifest
        });

        const result = await provider.getManifest();
        expect(result).toEqual(mockManifest);
    });

    it('should upload manifest (create new)', async () => {
        await provider.initialize({ clientId: 'cid', apiKey: 'key' });
        // @ts-expect-error - access private
        provider.accessToken = 'token';

        // Mock find returning null
        mockGapi.client.drive.files.list.mockResolvedValue({ result: { files: [] } });

        await provider.uploadManifest({ version: 1 } as unknown as import('../../../types/db').SyncManifest);

        expect(fetch).toHaveBeenCalledWith(
            expect.stringContaining('upload/drive/v3/files?uploadType=multipart'),
            expect.objectContaining({ method: 'POST' })
        );
    });
});
