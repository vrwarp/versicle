import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import * as Y from 'yjs';
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
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        mockGoogle.accounts.oauth2.initTokenClient.mockImplementation((config: any) => {
            const clientMock = {
                callback: config.callback,
                requestAccessToken: vi.fn(() => {
                    setTimeout(() => clientMock.callback({ access_token: 'new_token' }), 0);
                })
            };
            return clientMock;
        });

        await provider.initialize({ clientId: 'cid', apiKey: 'key' });
        await provider.signIn();

        expect(await provider.isAuthenticated()).toBe(true);
    });

    it('should search for snapshot file', async () => {
        await provider.initialize({ clientId: 'cid', apiKey: 'key' });
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        (provider as any).accessToken = 'token';

        mockGapi.client.drive.files.list.mockResolvedValue({
            result: { files: [{ id: 'file_123' }] }
        });

        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const id = await (provider as any).findSnapshotFileId();
        expect(id).toBe('file_123');
    });

    it('should upload Yjs snapshot', async () => {
        await provider.initialize({ clientId: 'cid', apiKey: 'key' });
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        (provider as any).accessToken = 'token';

        // Mock find returning null (new file)
        mockGapi.client.drive.files.list.mockResolvedValue({ result: { files: [] } });

        // Mock successful upload
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        (global.fetch as any).mockResolvedValue({
            ok: true,
            json: () => Promise.resolve({ id: 'new_file_id' })
        });

        // Create test snapshot
        const testDoc = new Y.Doc();
        testDoc.getMap('library').set('book1', { title: 'Test' });
        const snapshot = Y.encodeStateAsUpdate(testDoc);

        await provider.uploadSnapshot(snapshot);

        expect(fetch).toHaveBeenCalledWith(
            expect.stringContaining('upload/drive/v3/files?uploadType=multipart'),
            expect.objectContaining({ method: 'POST' })
        );
    });

    it('should download Yjs snapshot', async () => {
        await provider.initialize({ clientId: 'cid', apiKey: 'key' });
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        (provider as any).accessToken = 'token';
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        (provider as any).snapshotFileId = 'file_123';

        // Create test data
        const testDoc = new Y.Doc();
        testDoc.getMap('library').set('book1', { title: 'Downloaded' });
        const snapshot = Y.encodeStateAsUpdate(testDoc);

        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        (global.fetch as any).mockResolvedValue({
            ok: true,
            arrayBuffer: () => Promise.resolve(snapshot.buffer)
        });

        const result = await provider.downloadSnapshot();

        expect(result).not.toBeNull();
        expect(result!.byteLength).toBeGreaterThan(0);

        // Verify we can apply the snapshot
        const freshDoc = new Y.Doc();
        Y.applyUpdate(freshDoc, result!);
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        expect((freshDoc.getMap('library').get('book1') as any).title).toBe('Downloaded');
    });
});
