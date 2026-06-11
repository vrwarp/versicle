import { vi, describe, it, expect, beforeEach } from 'vitest';
import * as Y from 'yjs';
import { BackupService, type BackupManifestV2, type BackupManifestV3 } from './BackupService';
import { dbService } from '@db/DBService';
import { exportFile } from './export';

// Hoist variables to capture mock interactions
const mocks = vi.hoisted(() => ({
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  capturedDocs: [] as any[],
  persistenceMock: {
    clearData: vi.fn(() => Promise.resolve()),
  },
  checkpointMock: {
    createCheckpoint: vi.fn<(trigger: string) => Promise<number>>(async () => 1),
  }
}));

// Mock CheckpointService (dynamically imported by processManifest)
vi.mock('./sync/CheckpointService', () => ({
  CheckpointService: {
    createCheckpoint: (trigger: string) => mocks.checkpointMock.createCheckpoint(trigger),
  },
}));

// Mock y-indexeddb to avoid side effects in yjs-provider
vi.mock('y-idb', () => ({
  IndexeddbPersistence: class {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    constructor(_name: string, doc: any) {
      mocks.capturedDocs.push(doc);
    }
    on() { }
    destroy() { }
    clearData() { return mocks.persistenceMock.clearData(); }
    get synced() { return true; }
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    once(_event: string, cb: any) { cb(); }
  }
}));

// Mock yjs-provider using importOriginal to preserve yDoc identity
vi.mock('@store/yjs-provider', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@store/yjs-provider')>();
  return {
    ...actual,
    waitForYjsSync: vi.fn(() => Promise.resolve()),
    // Ensure we expose a mock persistence if the real one isn't initialized
    getYjsPersistence: () => ({
      clearData: mocks.persistenceMock.clearData
    })
  };
});

// Mock DB
const mockDB = {
  getAll: vi.fn(),
  transaction: vi.fn(),
};

vi.mock('@db/db', () => ({
  getDB: vi.fn(() => Promise.resolve(mockDB)),
}));

// Mock dbService
vi.mock('@db/DBService', () => ({
  dbService: {
    getBookFile: vi.fn(),
  },
}));

// Mock export
vi.mock('./export', () => ({
  exportFile: vi.fn(),
}));

// Mock stores
vi.mock('@store/useLibraryStore', () => ({
  useLibraryStore: {
    getState: vi.fn(() => ({
      books: {},
      offloadedBookIds: new Set(),
    })),
    setState: vi.fn(),
  },
}));

vi.mock('@store/useReadingStateStore', () => ({
  useReadingStateStore: {
    getState: vi.fn(() => ({
      progress: {},
    })),
    setState: vi.fn(),
  },
}));

vi.mock('@store/useAnnotationStore', () => ({
  useAnnotationStore: {
    getState: vi.fn(() => ({
      annotations: {},
    })),
    setState: vi.fn(),
  },
}));

describe('BackupService (v2 - Yjs Snapshots)', () => {
  let service: BackupService;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let mockYDoc: any;

  beforeEach(async () => {
    service = new BackupService();
    vi.clearAllMocks();
    mocks.capturedDocs.length = 0; // Clear captured docs

    // Default: no existing rows in IDB (restore merges against existing manifests)
    mockDB.getAll.mockResolvedValue([]);

    // Get the mocked yDoc
    const yjsProvider = await import('@store/yjs-provider');
    mockYDoc = yjsProvider.getYDoc();

    // Clear Y.Doc maps
    mockYDoc.getMap('library').clear();
    // Initialize books submap
    mockYDoc.getMap('library').set('books', new Y.Map());
    mockYDoc.getMap('progress').clear();
    mockYDoc.getMap('annotations').clear();

    vi.spyOn(console, 'log').mockImplementation(() => { });
    vi.spyOn(console, 'warn').mockImplementation(() => { });
    vi.spyOn(console, 'error').mockImplementation(() => { });
  });

  describe('createLightBackup', () => {
    it('should create a JSON backup with Yjs snapshot', async () => {
      // Add a book to the mock Y.Doc
      mockYDoc.getMap('library').set('b1', {
        bookId: 'b1',
        title: 'Test Book',
        author: 'Test Author',
        addedAt: Date.now(),
      });

      mockDB.getAll.mockImplementation((store: string) => {
        if (store === 'static_manifests') return Promise.resolve([{ bookId: 'b1', title: 'Test Book' }]);
        if (store === 'cache_render_metrics') return Promise.resolve([]);
        return Promise.resolve([]);
      });

      await service.createLightBackup();

      expect(exportFile).toHaveBeenCalled();

      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const { data, filename, mimeType } = (exportFile as any).mock.calls[0][0];
      expect(filename).toContain('.json');
      expect(mimeType).toBe('application/json');

      const manifest: BackupManifestV3 = JSON.parse(data as string);
      expect(manifest.version).toBe(3);
      expect(manifest.yjsSnapshot).toBeDefined();
      expect(typeof manifest.yjsSnapshot).toBe('string');
      expect(manifest.yjsSnapshot.length).toBeGreaterThan(0);
    });

    it('should include static manifests in backup', async () => {
      mockDB.getAll.mockImplementation((store: string) => {
        if (store === 'static_manifests') return Promise.resolve([
          { bookId: 'b1', title: 'Book 1', fileHash: 'abc123' }
        ]);
        return Promise.resolve([]);
      });

      await service.createLightBackup();

      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const { data } = (exportFile as any).mock.calls[0][0];
      const manifest: BackupManifestV2 = JSON.parse(data as string);

      expect(manifest.staticManifests).toHaveLength(1);
      expect(manifest.staticManifests[0].bookId).toBe('b1');
    });
  });

  describe('createFullBackup', () => {
    it('should create a ZIP backup with files', async () => {
      // Add a book to Y.Doc
      const booksMap = mockYDoc.getMap('library').get('books');
      booksMap.set('b1', {
        bookId: 'b1',
        title: 'Book 1',
        author: 'Author 1',
      });

      mockDB.getAll.mockImplementation((store: string) => {
        if (store === 'static_manifests') return Promise.resolve([{ bookId: 'b1', title: 'Book 1' }]);
        return Promise.resolve([]);
      });

      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      (dbService.getBookFile as any).mockResolvedValue(new ArrayBuffer(10));

      const onProgress = vi.fn();
      await service.createFullBackup(onProgress);

      expect(dbService.getBookFile).toHaveBeenCalledWith('b1');
      expect(exportFile).toHaveBeenCalled();
      expect(onProgress).toHaveBeenCalled();

      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const { data, filename, mimeType } = (exportFile as any).mock.calls[0][0];
      expect(data).toBeInstanceOf(Blob);
      expect(filename).toContain('.zip');
      expect(mimeType).toBe('application/zip');
    });
  });

  describe('restoreBackup', () => {
    it('should restore from v2 light backup with Yjs snapshot', async () => {
      // Create a snapshot from test data using a separate doc
      const testDoc = new Y.Doc();
      testDoc.getMap('library').set('books', new Y.Map());
      const booksMap = testDoc.getMap('library').get('books') as Y.Map<unknown>;
      booksMap.set('b1', {
        bookId: 'b1',
        title: 'Restored Book',
        author: 'Author',
      });
      const snapshot = Y.encodeStateAsUpdate(testDoc);
      const snapshotBase64 = btoa(String.fromCharCode(...snapshot));

      const manifest: BackupManifestV2 = {
        version: 2,
        timestamp: '2023-01-01',
        yjsSnapshot: snapshotBase64,
        staticManifests: [{ bookId: 'b1', title: 'Restored Book', author: 'Author', fileHash: 'abc', fileSize: 100, totalChars: 1000, schemaVersion: 1 }],
        locations: []
      };

      const file = new File([JSON.stringify(manifest)], 'backup.json', { type: 'application/json' });

      const putMock = vi.fn().mockResolvedValue(undefined);
      const getMock = vi.fn().mockResolvedValue(undefined);

      const mockTx = {
        objectStore: vi.fn().mockReturnValue({
          get: getMock,
          put: putMock,
        }),
        done: Promise.resolve(),
      };
      mockDB.transaction.mockReturnValue(mockTx);

      await service.restoreBackup(file);

      // Verify that clearData was called on the existing persistence
      expect(mocks.persistenceMock.clearData).toHaveBeenCalled();

      // Wait for test to settle
      await new Promise(resolve => setTimeout(resolve, 0));

      // Verify that the snapshot was written directly to IndexedDB 'updates' store
      const db = await new Promise<IDBDatabase>((resolve, reject) => {
        const req = indexedDB.open('versicle-yjs');
        req.onsuccess = () => resolve(req.result);
        req.onerror = () => reject(req.error);
      });

      const tx = db.transaction(['updates'], 'readonly');
      const store = tx.objectStore('updates');
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const allUpdates = await new Promise<any[]>((resolve, reject) => {
        const req = store.getAll();
        req.onsuccess = () => resolve(req.result);
        req.onerror = () => reject(req.error);
      });

      expect(allUpdates.length).toBeGreaterThan(0);
      
      // We can apply the update to a fresh doc to verify its contents
      const restoredDoc = new Y.Doc();
      Y.applyUpdate(restoredDoc, allUpdates[allUpdates.length - 1]);

      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const restoredBooks = restoredDoc.getMap('library').get('books') as Y.Map<any>;
      expect(restoredBooks).toBeDefined();
      const b1 = restoredBooks.get('b1');
      expect(b1).toBeDefined();
      expect(b1.title).toBe('Restored Book');
      
      db.close();
    });

    it('should reject v1 backup format', async () => {
      const v1Manifest = {
        version: 1,
        timestamp: '2023-01-01',
        books: [{ id: 'b1', title: 'Old Book' }],
        annotations: [],
        lexicon: [],
        locations: []
      };

      const file = new File([JSON.stringify(v1Manifest)], 'backup.json', { type: 'application/json' });

      await expect(service.restoreBackup(file)).rejects.toThrow('Fatal: yjsSnapshot is missing');
    });

  });

  describe('Yjs snapshot encoding/decoding', () => {
    it('should round-trip Yjs state correctly', async () => {
      // Add data to Y.Doc
      mockYDoc.getMap('library').set('book1', {
        bookId: 'book1',
        title: 'Round Trip Test',
        author: 'Test Author',
      });
      mockYDoc.getMap('progress').set('book1', {
        bookId: 'book1',
        percentage: 0.5,
      });

      mockDB.getAll.mockResolvedValue([]);

      await service.createLightBackup();

      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const { data } = (exportFile as any).mock.calls[0][0];
      const manifest: BackupManifestV2 = JSON.parse(data as string);

      // Decode the snapshot and apply to a fresh doc
      const binary = atob(manifest.yjsSnapshot);
      const snapshot = new Uint8Array(binary.length);
      for (let i = 0; i < binary.length; i++) {
        snapshot[i] = binary.charCodeAt(i);
      }

      const freshDoc = new Y.Doc();
      Y.applyUpdate(freshDoc, snapshot);

      // Verify the data was preserved
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const restoredBook = freshDoc.getMap('library').get('book1') as any;
      expect(restoredBook).toBeDefined();
      expect(restoredBook.title).toBe('Round Trip Test');

      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const restoredProgress = freshDoc.getMap('progress').get('book1') as any;
      expect(restoredProgress).toBeDefined();
      expect(restoredProgress.percentage).toBe(0.5);
    });
  });

  // Helpers for restore regression tests
  function makeSnapshotBase64(): string {
    const doc = new Y.Doc();
    doc.getMap('library').set('books', new Y.Map());
    const snapshot = Y.encodeStateAsUpdate(doc);
    return btoa(String.fromCharCode(...snapshot));
  }

  function setupRestoreTx() {
    const putMock = vi.fn().mockResolvedValue(undefined);
    const mockTx = {
      objectStore: vi.fn().mockReturnValue({
        get: vi.fn().mockResolvedValue(undefined),
        put: putMock,
      }),
      done: Promise.resolve(),
    };
    mockDB.transaction.mockReturnValue(mockTx);
    return putMock;
  }

  describe('regression: restore validates before destroying local data', () => {
    function expectLocalDataUntouched() {
      expect(mocks.persistenceMock.clearData).not.toHaveBeenCalled();
      expect(mockDB.transaction).not.toHaveBeenCalled();
    }

    it('rejects a structurally invalid manifest and leaves local data untouched', async () => {
      // Missing required `timestamp`
      const file = new File(
        [JSON.stringify({ version: 2, yjsSnapshot: makeSnapshotBase64() })],
        'backup.json'
      );

      await expect(service.restoreBackup(file)).rejects.toThrow(/Invalid backup manifest/);
      expectLocalDataUntouched();
      expect(mocks.checkpointMock.createCheckpoint).not.toHaveBeenCalled();
    });

    it('rejects an unknown manifest version and leaves local data untouched', async () => {
      const file = new File(
        [JSON.stringify({ version: 4, timestamp: '2023-01-01', yjsSnapshot: makeSnapshotBase64() })],
        'backup.json'
      );

      await expect(service.restoreBackup(file)).rejects.toThrow(/Invalid backup manifest/);
      expectLocalDataUntouched();
    });

    it('rejects a snapshot that is not valid base64 and leaves local data untouched', async () => {
      const file = new File(
        [JSON.stringify({ version: 2, timestamp: '2023-01-01', yjsSnapshot: '%%%not-base64%%%', staticManifests: [], locations: [] })],
        'backup.json'
      );

      await expect(service.restoreBackup(file)).rejects.toThrow(/not valid base64/);
      expectLocalDataUntouched();
      expect(mocks.checkpointMock.createCheckpoint).not.toHaveBeenCalled();
    });

    it('dry-runs the snapshot on a scratch doc and rejects garbage bytes, leaving local data untouched', async () => {
      const file = new File(
        [JSON.stringify({
          version: 2,
          timestamp: '2023-01-01',
          yjsSnapshot: btoa('definitely not a yjs update'),
          staticManifests: [],
          locations: []
        })],
        'backup.json'
      );

      await expect(service.restoreBackup(file)).rejects.toThrow(/not a decodable Yjs update/);
      expectLocalDataUntouched();
      expect(mocks.checkpointMock.createCheckpoint).not.toHaveBeenCalled();
    });

    it('creates a pre-restore checkpoint before clearing local persistence', async () => {
      setupRestoreTx();
      const file = new File(
        [JSON.stringify({ version: 2, timestamp: '2023-01-01', yjsSnapshot: makeSnapshotBase64(), staticManifests: [], locations: [] })],
        'backup.json'
      );

      await service.restoreBackup(file);

      expect(mocks.checkpointMock.createCheckpoint).toHaveBeenCalledWith('pre-restore');
      expect(mocks.persistenceMock.clearData).toHaveBeenCalled();

      const checkpointOrder = mocks.checkpointMock.createCheckpoint.mock.invocationCallOrder[0];
      const clearOrder = mocks.persistenceMock.clearData.mock.invocationCallOrder[0];
      expect(checkpointOrder).toBeLessThan(clearOrder);
    });

    it('aborts the restore (data untouched) when the pre-restore checkpoint cannot be created', async () => {
      mocks.checkpointMock.createCheckpoint.mockRejectedValueOnce(new Error('disk full'));
      const file = new File(
        [JSON.stringify({ version: 2, timestamp: '2023-01-01', yjsSnapshot: makeSnapshotBase64(), staticManifests: [], locations: [] })],
        'backup.json'
      );

      await expect(service.restoreBackup(file)).rejects.toThrow(/pre-restore checkpoint/);
      expectLocalDataUntouched();
    });
  });

  describe('regression: cover blob corruption (backup manifest v3)', () => {
    it('exports v3 with covers base64-encoded so JSON round-trips are lossless', async () => {
      const coverBytes = new Uint8Array([1, 2, 3, 250, 255]);
      mockDB.getAll.mockImplementation((store: string) => {
        if (store === 'static_manifests') return Promise.resolve([
          {
            bookId: 'b1', title: 'Covered Book', author: 'A', fileHash: 'h',
            fileSize: 1, totalChars: 1, schemaVersion: 1, coverBlob: coverBytes.buffer
          }
        ]);
        return Promise.resolve([]);
      });

      await service.createLightBackup();

      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const { data } = (exportFile as any).mock.calls[0][0];
      const manifest: BackupManifestV3 = JSON.parse(data as string);

      expect(manifest.version).toBe(3);
      // Raw binary never enters the JSON (v2 corrupted it to `{}`)
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      expect((manifest.staticManifests[0] as any).coverBlob).toBeUndefined();
      expect(typeof manifest.staticManifests[0].coverBlobBase64).toBe('string');

      // Restore the exported JSON and verify the cover bytes survive intact
      mockDB.getAll.mockResolvedValue([]);
      const putMock = setupRestoreTx();
      await service.restoreBackup(new File([data as string], 'backup.json'));

      const putRows = putMock.mock.calls.map(c => c[0]);
      const restored = putRows.find(r => r.bookId === 'b1' && 'coverBlob' in r);
      expect(restored).toBeDefined();
      expect(restored.coverBlob).toBeInstanceOf(ArrayBuffer);
      expect(Array.from(new Uint8Array(restored.coverBlob))).toEqual([1, 2, 3, 250, 255]);
      expect(restored.coverBlobBase64).toBeUndefined();
    });

    it('sanitizes corrupt {} covers from v2 backups and never clobbers healthy local covers', async () => {
      const localCover = new Uint8Array([9, 9, 9]).buffer;
      mockDB.getAll.mockImplementation((store: string) => {
        if (store === 'static_manifests') return Promise.resolve([
          { bookId: 'b1', title: 'Healthy Local', coverBlob: localCover }
        ]);
        return Promise.resolve([]);
      });
      const putMock = setupRestoreTx();

      // A v2 backup that went through JSON.stringify: covers degraded to `{}`
      const manifest = {
        version: 2,
        timestamp: '2023-01-01',
        yjsSnapshot: makeSnapshotBase64(),
        staticManifests: [
          { bookId: 'b1', title: 'Healthy Local', coverBlob: {} },
          { bookId: 'b2', title: 'New Book', coverBlob: {} }
        ],
        locations: []
      };

      await service.restoreBackup(new File([JSON.stringify(manifest)], 'backup.json'));

      const putRows = putMock.mock.calls.map(c => c[0]);

      // b1: the healthy local cover is preserved (not overwritten with `{}`)
      const b1 = putRows.find(r => r.bookId === 'b1');
      expect(b1).toBeDefined();
      expect(b1.coverBlob).toBe(localCover);

      // b2: the corrupt `{}` cover is stripped, never written to IDB
      const b2 = putRows.find(r => r.bookId === 'b2');
      expect(b2).toBeDefined();
      expect('coverBlob' in b2).toBe(false);
    });
  });
});
