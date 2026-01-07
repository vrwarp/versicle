import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { GoogleDriveProvider } from './GoogleDriveProvider';


describe('GoogleDriveProvider', () => {
    let provider: GoogleDriveProvider;
    let mockGapi: any; // eslint-disable-line @typescript-eslint/no-explicit-any
    let mockGoogle: any; // eslint-disable-line @typescript-eslint/no-explicit-any

    beforeEach(() => {
        provider = new GoogleDriveProvider();

        // Mock Globals
        mockGapi = {
            load: vi.fn((lib, cb) => cb()),
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
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        (window as any).gapi = mockGapi;

        mockGoogle = {
            accounts: {
                oauth2: {
                    initTokenClient: vi.fn().mockReturnValue({
                        requestAccessToken: vi.fn()
                    })
                }
            }
        };
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        (window as any).google = mockGoogle;

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
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        mockGoogle.accounts.oauth2.initTokenClient.mockImplementation((config: any) => {
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
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        (provider as any).accessToken = 'token'; // Bypass auth check

        mockGapi.client.drive.files.list.mockResolvedValue({
            result: { files: [{ id: 'file_123' }] }
        });

        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const id = await (provider as any).findManifestFileId();
        expect(id).toBe('file_123');
    });

    it('should get manifest', async () => {
        await provider.initialize({ clientId: 'cid', apiKey: 'key' });
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        (provider as any).accessToken = 'token';
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        (provider as any).manifestFileId = 'file_123';

        const mockManifest = { version: 1 };
        mockGapi.client.drive.files.get.mockResolvedValue({
            result: mockManifest
        });

        const result = await provider.getManifest();
        expect(result).toEqual(mockManifest);
    });

    it('should upload manifest (create new)', async () => {
        await provider.initialize({ clientId: 'cid', apiKey: 'key' });
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        (provider as any).accessToken = 'token';

        // Mock find returning null
        mockGapi.client.drive.files.list.mockResolvedValue({ result: { files: [] } });

        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        await provider.uploadManifest({ version: 1 } as any);

        expect(fetch).toHaveBeenCalledWith(
            expect.stringContaining('upload/drive/v3/files?uploadType=multipart'),
            expect.objectContaining({ method: 'POST' })
        );
    });
});
