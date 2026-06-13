/**
 * DriveLibrarySync suite (Phase 7 §G) — injected-port version of the deleted
 * src/lib/drive/DriveScannerService.test.ts (absorption ledger): scan/index,
 * diff, no-linked-folder no-ops, error propagation — plus the NEW typed-
 * error semantics (GoogleAuthRequiredError ⇒ warn + rethrow; shouldAutoSync
 * silent-deny instead of popup/disconnect).
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { DriveLibrarySync, type DriveLibrarySyncPorts } from './DriveLibrarySync';
import { GoogleAuthRequiredError } from '../auth/errors';
import type { DriveFileIndex } from './types';

function makeHarness(overrides: {
  linkedFolderId?: string | null;
  lastScanTime?: number | null;
  index?: DriveFileIndex[];
  hasConnectedBefore?: boolean;
} = {}) {
  const state = {
    linkedFolderId: overrides.linkedFolderId === undefined ? 'folder-123' : overrides.linkedFolderId,
    lastScanTime: overrides.lastScanTime ?? null,
    index: overrides.index ?? [],
    isScanning: false,
  };
  const client = {
    listFilesRecursive: vi.fn().mockResolvedValue([]),
    getFolderMetadata: vi.fn().mockResolvedValue({ id: 'folder-123', name: 'F', mimeType: 'folder' }),
    downloadFile: vi.fn().mockResolvedValue(new Blob(['content'])),
  };
  const addBook = vi.fn().mockResolvedValue(undefined);
  const setScanning = vi.fn((v: boolean) => {
    state.isScanning = v;
  });
  const setScannedFiles = vi.fn((files: DriveFileIndex[]) => {
    state.index = files;
  });
  const ports: DriveLibrarySyncPorts = {
    client,
    driveIndex: {
      getLinkedFolderId: () => state.linkedFolderId,
      getLastScanTime: () => state.lastScanTime,
      getIndex: () => state.index,
      setScanning,
      setScannedFiles,
    },
    library: {
      addBook,
      getLibraryFilenames: () => new Set(['Book 1.epub']),
    },
    hasConnectedBefore: () => overrides.hasConnectedBefore ?? true,
  };
  return { sync: new DriveLibrarySync(ports), client, addBook, setScanning, setScannedFiles, state };
}

describe('DriveLibrarySync', () => {
  beforeEach(() => {
    vi.spyOn(console, 'warn').mockImplementation(() => {});
  });

  describe('scanAndIndex', () => {
    it('regression: fetches EPUBs recursively and updates the index', async () => {
      const { sync, client, setScannedFiles, setScanning } = makeHarness();
      client.listFilesRecursive.mockResolvedValue([
        { id: '1', name: 'Book 1.epub', size: '1000', modifiedTime: '2023-01-01', mimeType: 'application/epub+zip' },
        { id: '2', name: 'Book 2.epub', size: '2000', modifiedTime: '2023-01-02', mimeType: 'application/epub+zip' },
      ]);
      await sync.scanAndIndex();
      expect(client.listFilesRecursive).toHaveBeenCalledWith(
        'folder-123',
        'application/epub+zip',
        expect.anything(),
      );
      expect(setScanning).toHaveBeenNthCalledWith(1, true);
      expect(setScannedFiles).toHaveBeenCalledWith([
        { id: '1', name: 'Book 1.epub', size: 1000, modifiedTime: '2023-01-01', mimeType: 'application/epub+zip' },
        { id: '2', name: 'Book 2.epub', size: 2000, modifiedTime: '2023-01-02', mimeType: 'application/epub+zip' },
      ]);
      expect(setScanning).toHaveBeenLastCalledWith(false);
    });

    it('regression: rethrows API errors and always clears isScanning', async () => {
      const { sync, client, setScanning } = makeHarness();
      client.listFilesRecursive.mockRejectedValue(new Error('API Error'));
      await expect(sync.scanAndIndex()).rejects.toThrow('API Error');
      expect(setScanning).toHaveBeenLastCalledWith(false);
    });

    it('regression: does nothing without a linked folder', async () => {
      const { sync, client } = makeHarness({ linkedFolderId: null });
      await sync.scanAndIndex();
      expect(client.listFilesRecursive).not.toHaveBeenCalled();
    });

    it('typed auth errors are warn-logged and rethrown (no string sniffing)', async () => {
      const { sync, client } = makeHarness();
      client.listFilesRecursive.mockRejectedValue(
        new GoogleAuthRequiredError('drive', 'no-credential'),
      );
      await expect(sync.scanAndIndex()).rejects.toBeInstanceOf(GoogleAuthRequiredError);
    });
  });

  describe('checkForNewFiles', () => {
    it('regression: returns index entries missing from the library', async () => {
      const index: DriveFileIndex[] = [
        { id: '1', name: 'Book 1.epub', size: 1000, modifiedTime: '', mimeType: '' },
        { id: '2', name: 'Book 2.epub', size: 2000, modifiedTime: '', mimeType: '' },
        { id: '3', name: 'Book 3.epub', size: 3000, modifiedTime: '', mimeType: '' },
      ];
      const { sync, client } = makeHarness({ index });
      const newFiles = await sync.checkForNewFiles();
      expect(newFiles.map((f) => f.name)).toEqual(['Book 2.epub', 'Book 3.epub']);
      expect(client.listFilesRecursive).not.toHaveBeenCalled();
    });

    it('regression: triggers a scan when the index is empty', async () => {
      const { sync, client } = makeHarness({ index: [] });
      client.listFilesRecursive.mockResolvedValue([
        { id: '9', name: 'Fresh.epub', size: '1', modifiedTime: '', mimeType: 'application/epub+zip' },
      ]);
      const newFiles = await sync.checkForNewFiles();
      expect(client.listFilesRecursive).toHaveBeenCalled();
      expect(newFiles.map((f) => f.name)).toEqual(['Fresh.epub']);
    });
  });

  describe('importFile', () => {
    it('downloads and hands a File to the library port', async () => {
      const { sync, client, addBook } = makeHarness();
      await sync.importFile('file-1', 'New.epub', { overwrite: true });
      expect(client.downloadFile).toHaveBeenCalledWith('file-1', expect.anything());
      const [file, options] = addBook.mock.calls[0];
      expect(file).toBeInstanceOf(File);
      expect((file as File).name).toBe('New.epub');
      expect(options).toEqual({ overwrite: true });
    });

    it('rethrows download errors', async () => {
      const { sync, client } = makeHarness();
      client.downloadFile.mockRejectedValue(new Error('File content not found'));
      await expect(sync.importFile('x', 'X.epub')).rejects.toThrow('File content not found');
    });
  });

  describe('shouldAutoSync (always silent — the GG-2 reversal)', () => {
    it('false without a linked folder; false without the connected-before hint', async () => {
      await expect(makeHarness({ linkedFolderId: null }).sync.shouldAutoSync()).resolves.toBe(false);
      await expect(
        makeHarness({ hasConnectedBefore: false }).sync.shouldAutoSync(),
      ).resolves.toBe(false);
    });

    it('true when never scanned', async () => {
      await expect(makeHarness({ lastScanTime: null }).sync.shouldAutoSync()).resolves.toBe(true);
    });

    it('compares viewedByMeTime against lastScanTime', async () => {
      const { sync, client } = makeHarness({ lastScanTime: Date.parse('2024-01-02') });
      client.getFolderMetadata.mockResolvedValue({
        id: 'f',
        name: 'F',
        mimeType: 'folder',
        viewedByMeTime: '2024-01-03T00:00:00Z',
      });
      await expect(sync.shouldAutoSync()).resolves.toBe(true);
      client.getFolderMetadata.mockResolvedValue({
        id: 'f',
        name: 'F',
        mimeType: 'folder',
        viewedByMeTime: '2024-01-01T00:00:00Z',
      });
      await expect(sync.shouldAutoSync()).resolves.toBe(false);
    });

    it('token-unavailable ⇒ false (no popup, no disconnect); unknown errors ⇒ true (legacy default)', async () => {
      const { sync, client } = makeHarness({ lastScanTime: 1 });
      client.getFolderMetadata.mockRejectedValueOnce(
        new GoogleAuthRequiredError('drive', 'no-credential'),
      );
      await expect(sync.shouldAutoSync()).resolves.toBe(false);
      client.getFolderMetadata.mockRejectedValueOnce(new Error('flaky'));
      await expect(sync.shouldAutoSync()).resolves.toBe(true);
    });

    it('uses the silent path for the metadata probe', async () => {
      const { sync, client } = makeHarness({ lastScanTime: 1 });
      await sync.shouldAutoSync();
      expect(client.getFolderMetadata).toHaveBeenCalledWith('folder-123', { interactive: false });
    });
  });
});
