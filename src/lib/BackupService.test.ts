import { vi, describe, it, expect, beforeEach } from 'vitest';
import * as Y from 'yjs';
import { BackupService, BackupManifestV2 } from './BackupService';
import { dbService } from '../db/DBService';
import { exportFile } from './export';

// Create the mock Y.Doc at module level BEFORE vi.mock calls
const testYDoc = new Y.Doc();

// Mock yjs-provider - must use inline factory to avoid hoisting issues
vi.mock('../store/yjs-provider', () => {
  const Y = require('yjs');
  const doc = new Y.Doc();
  return {
    yDoc: doc,
    waitForYjsSync: vi.fn(() => Promise.resolve()),
    // Export for test access
    __testDoc: doc,
  };
});

// Mock DB
const mockDB = {
  getAll: vi.fn(),
  transaction: vi.fn(),
};

vi.mock('../db/db', () => ({
  getDB: vi.fn(() => Promise.resolve(mockDB)),
}));

// Mock dbService
vi.mock('../db/DBService', () => ({
  dbService: {
    getBookFile: vi.fn(),
  },
}));

// Mock export
vi.mock('./export', () => ({
  exportFile: vi.fn(),
}));

// Mock stores
vi.mock('../store/useLibraryStore', () => ({
  useLibraryStore: {
    getState: vi.fn(() => ({
      books: {},
      offloadedBookIds: new Set(),
    })),
    setState: vi.fn(),
  },
}));

vi.mock('../store/useReadingStateStore', () => ({
  useReadingStateStore: {
    getState: vi.fn(() => ({
      progress: {},
    })),
    setState: vi.fn(),
  },
}));

vi.mock('../store/useAnnotationStore', () => ({
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

    // Get the mocked yDoc
    const yjsProvider = await import('../store/yjs-provider');
    mockYDoc = yjsProvider.yDoc;

    // Clear Y.Doc maps
    mockYDoc.getMap('library').clear();
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
        if (store === 'user_overrides') return Promise.resolve([]);
        if (store === 'cache_render_metrics') return Promise.resolve([]);
        return Promise.resolve([]);
      });

      await service.createLightBackup();

      expect(exportFile).toHaveBeenCalled();

      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const { data, filename, mimeType } = (exportFile as any).mock.calls[0][0];
      expect(filename).toContain('.json');
      expect(mimeType).toBe('application/json');

      const manifest: BackupManifestV2 = JSON.parse(data as string);
      expect(manifest.version).toBe(2);
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
      mockYDoc.getMap('library').set('b1', {
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
      // The service will apply this to its internal yDoc
      const testDoc = new Y.Doc();
      testDoc.getMap('library').set('b1', {
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
        lexicon: [],
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

      // After restore, the mock Y.Doc should have the book merged in
      // Y.applyUpdate merges the snapshot into the existing doc
      // Note: The book may have its properties as a Map-like object
      const restored = mockYDoc.getMap('library').get('b1');
      expect(restored).toBeDefined();
      // The restored object should have the expected properties
      if (restored) {
        expect(restored.bookId || restored.get?.('bookId')).toBe('b1');
      }
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

      await expect(service.restoreBackup(file)).rejects.toThrow('v1 is no longer supported');
    });

    it('should restore lexicon rules to IDB', async () => {
      const testDoc = new Y.Doc();
      const snapshot = Y.encodeStateAsUpdate(testDoc);
      const snapshotBase64 = btoa(String.fromCharCode(...snapshot));

      const manifest: BackupManifestV2 = {
        version: 2,
        timestamp: '2023-01-01',
        yjsSnapshot: snapshotBase64,
        staticManifests: [],
        lexicon: [
          { id: 'r1', original: 'foo', replacement: 'bar', isRegex: false, created: 123 }
        ],
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

      // Should have written lexicon to user_overrides
      expect(mockTx.objectStore).toHaveBeenCalledWith('user_overrides');
      expect(putMock).toHaveBeenCalled();
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
});
