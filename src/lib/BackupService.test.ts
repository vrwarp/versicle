import { vi, describe, it, expect, beforeEach } from 'vitest';
import { BackupService, BackupManifest } from './BackupService';
import { dbService } from '../db/DBService';
import { saveAs } from 'file-saver';

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

// Mock file-saver
vi.mock('file-saver', () => ({
  saveAs: vi.fn(),
}));

describe('BackupService', () => {
  let service: BackupService;

  beforeEach(() => {
    service = new BackupService();
    vi.clearAllMocks();
    vi.spyOn(window, 'confirm').mockImplementation(() => true);
    vi.spyOn(console, 'log').mockImplementation(() => {});
    vi.spyOn(console, 'warn').mockImplementation(() => {});
  });

  describe('createLightBackup', () => {
    it('should create a JSON backup of metadata', async () => {
      mockDB.getAll.mockImplementation((store) => {
        if (store === 'static_books') return Promise.resolve([{ id: 'b1', title: 'Book 1' }]);
        if (store === 'static_book_sources') return Promise.resolve([{ bookId: 'b1' }]);
        if (store === 'user_book_states') return Promise.resolve([{ bookId: 'b1' }]);
        if (store === 'user_annotations') return Promise.resolve([]);
        if (store === 'user_lexicon') return Promise.resolve([]);
        if (store === 'cache_book_locations') return Promise.resolve([]);
        return Promise.resolve([]);
      });

      await service.createLightBackup();

      expect(mockDB.getAll).toHaveBeenCalledWith('static_books');
      expect(mockDB.getAll).toHaveBeenCalledWith('user_annotations');
      expect(saveAs).toHaveBeenCalled();

      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const blob = (saveAs as any).mock.calls[0][0];
      expect(blob).toBeInstanceOf(Blob);

      const text = await blob.text();
      const manifest: BackupManifest = JSON.parse(text);
      expect(manifest.books).toHaveLength(1);
      expect(manifest.books[0].title).toBe('Book 1');
      expect(manifest.version).toBe(1);
    });
  });

  describe('createFullBackup', () => {
    it('should create a ZIP backup with files', async () => {
      mockDB.getAll.mockImplementation((store) => {
        if (store === 'static_books') return Promise.resolve([{ id: 'b1', title: 'Book 1' }]);
        if (store === 'user_book_states') return Promise.resolve([{ bookId: 'b1', isOffloaded: false }]);
        return Promise.resolve([]);
      });

      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      (dbService.getBookFile as any).mockResolvedValue(new ArrayBuffer(10));

      const onProgress = vi.fn();
      await service.createFullBackup(onProgress);

      expect(dbService.getBookFile).toHaveBeenCalledWith('b1');
      expect(saveAs).toHaveBeenCalled();
      expect(onProgress).toHaveBeenCalled();

      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const blob = (saveAs as any).mock.calls[0][0];
      // We can't easily verify zip content without unzipping, but we know saveAs was called.
      expect(blob).toBeInstanceOf(Blob);
    });

    it('should skip offloaded books', async () => {
      mockDB.getAll.mockImplementation((store) => {
          if (store === 'static_books') return Promise.resolve([{ id: 'b1', title: 'Book 1' }]);
          if (store === 'user_book_states') return Promise.resolve([{ bookId: 'b1', isOffloaded: true }]);
          return Promise.resolve([]);
      });

      await service.createFullBackup();

      expect(dbService.getBookFile).not.toHaveBeenCalled();
    });
  });

  describe('restoreBackup', () => {
    it('should restore from light backup (JSON)', async () => {
      const manifest = {
        version: 1,
        timestamp: '2023-01-01',
        books: [{ id: 'b1', title: 'Restored Book', author: 'Author', addedAt: 1234567890, lastRead: 100 }],
        annotations: [],
        lexicon: [],
        locations: []
      };

      const file = new File([JSON.stringify(manifest)], 'backup.json', { type: 'application/json' });

      // Stable mocks
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

      // Verify splitting
      expect(mockTx.objectStore).toHaveBeenCalledWith('static_books');
      expect(putMock).toHaveBeenCalledWith(expect.objectContaining({ title: 'Restored Book' }));

      expect(mockTx.objectStore).toHaveBeenCalledWith('user_book_states');
      expect(putMock).toHaveBeenCalledWith(expect.objectContaining({ isOffloaded: true }));
    });

    it('should smart merge existing books', async () => {
        const manifest = {
          version: 1,
          timestamp: '2023-01-01',
          books: [{ id: 'b1', title: 'New Title', author: 'Author', addedAt: 1234567890, lastRead: 200, progress: 0.5 }],
          annotations: [],
          lexicon: [],
          locations: []
        };

        const file = new File([JSON.stringify(manifest)], 'backup.json', { type: 'application/json' });

        const existingBook = { id: 'b1', title: 'Old Title' };
        const existingState = { bookId: 'b1', lastRead: 100, progress: 0.1 };

        // We need to handle different return values based on the store name.
        // Since objectStore returns a NEW object each time if we just use a simple mock,
        // we need a way to correlate.

        const booksStoreMock = {
            get: vi.fn().mockResolvedValue(existingBook),
            put: vi.fn().mockResolvedValue(undefined)
        };
        const statesStoreMock = {
            get: vi.fn().mockResolvedValue(existingState),
            put: vi.fn().mockResolvedValue(undefined)
        };
        const genericStoreMock = {
            get: vi.fn().mockResolvedValue(undefined),
            put: vi.fn().mockResolvedValue(undefined)
        };

        const mockTx = {
          objectStore: vi.fn((store) => {
              if (store === 'static_books') return booksStoreMock;
              if (store === 'user_book_states') return statesStoreMock;
              return genericStoreMock;
          }),
          done: Promise.resolve(),
        };
        mockDB.transaction.mockReturnValue(mockTx);

        await service.restoreBackup(file);

        // Should update user_book_states with newer progress
        expect(mockTx.objectStore).toHaveBeenCalledWith('user_book_states');
        expect(statesStoreMock.put).toHaveBeenCalledWith(expect.objectContaining({
            bookId: 'b1',
            lastRead: 200,
            progress: 0.5
        }));
      });

    it('should reject backup with invalid book metadata (missing id)', async () => {
      const manifest = {
        version: 1,
        timestamp: '2023-01-01',
        books: [{ title: 'No ID', author: 'Author' }], // Missing id
        annotations: [],
        lexicon: [],
        locations: []
      };

      const file = new File([JSON.stringify(manifest)], 'backup.json', { type: 'application/json' });

      const putMock = vi.fn();
      const mockTx = {
        objectStore: vi.fn().mockReturnValue({
          get: vi.fn().mockResolvedValue(undefined),
          put: putMock,
        }),
        done: Promise.resolve(),
      };
      mockDB.transaction.mockReturnValue(mockTx);

      await service.restoreBackup(file);

      expect(putMock).not.toHaveBeenCalled();
    });

    it('should sanitize and restore book with missing title', async () => {
      const manifest = {
        version: 1,
        timestamp: '2023-01-01',
        // Missing title, addedAt. Should be defaulted.
        books: [{ id: 'b1', author: 'Author' }],
        annotations: [],
        lexicon: [],
        locations: []
      };

      const file = new File([JSON.stringify(manifest)], 'backup.json', { type: 'application/json' });

      const putMock = vi.fn();
      const mockTx = {
        objectStore: vi.fn().mockReturnValue({
          get: vi.fn().mockResolvedValue(undefined),
          put: putMock,
        }),
        done: Promise.resolve(),
      };
      mockDB.transaction.mockReturnValue(mockTx);

      await service.restoreBackup(file);

      expect(putMock).toHaveBeenCalledWith(expect.objectContaining({
        id: 'b1',
        title: 'Untitled',
        author: 'Author'
      }));
    });

    it('should always sanitize metadata', async () => {
        const confirmSpy = vi.spyOn(window, 'confirm');
        const longTitle = 'a'.repeat(3000);
        const manifest = {
          version: 1,
          timestamp: '2023-01-01',
          books: [{ id: 'b1', title: longTitle, author: 'Author', addedAt: 1234567890 }],
          annotations: [],
          lexicon: [],
          locations: []
        };

        const file = new File([JSON.stringify(manifest)], 'backup.json', { type: 'application/json' });

        const putMock = vi.fn();
        const mockTx = {
          objectStore: vi.fn().mockReturnValue({
            get: vi.fn().mockResolvedValue(undefined),
            put: putMock,
          }),
          done: Promise.resolve(),
        };
        mockDB.transaction.mockReturnValue(mockTx);

        await service.restoreBackup(file);

        expect(confirmSpy).not.toHaveBeenCalled();
        expect(putMock).toHaveBeenCalledWith(expect.objectContaining({
          title: 'a'.repeat(500)
        }));
    });
  });
});
