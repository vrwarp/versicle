import { vi, describe, it, expect, beforeEach, afterEach } from 'vitest';
import { BackupService, BackupManifest } from './BackupService';
import { dbService } from '../db/DBService';
import JSZip from 'jszip';
import { saveAs } from 'file-saver';
import { getDB } from '../db/db';

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
  });

  describe('createLightBackup', () => {
    it('should create a JSON backup of metadata', async () => {
      mockDB.getAll.mockImplementation((store) => {
        if (store === 'books') return Promise.resolve([{ id: 'b1', title: 'Book 1' }]);
        if (store === 'annotations') return Promise.resolve([]);
        if (store === 'lexicon') return Promise.resolve([]);
        if (store === 'locations') return Promise.resolve([]);
        return Promise.resolve([]);
      });

      await service.createLightBackup();

      expect(mockDB.getAll).toHaveBeenCalledWith('books');
      expect(mockDB.getAll).toHaveBeenCalledWith('annotations');
      expect(saveAs).toHaveBeenCalled();

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
        if (store === 'books') return Promise.resolve([{ id: 'b1', title: 'Book 1', isOffloaded: false }]);
        return Promise.resolve([]);
      });

      (dbService.getBookFile as any).mockResolvedValue(new ArrayBuffer(10));

      const onProgress = vi.fn();
      await service.createFullBackup(onProgress);

      expect(dbService.getBookFile).toHaveBeenCalledWith('b1');
      expect(saveAs).toHaveBeenCalled();
      expect(onProgress).toHaveBeenCalled();

      const blob = (saveAs as any).mock.calls[0][0];
      // We can't easily verify zip content without unzipping, but we know saveAs was called.
      expect(blob).toBeInstanceOf(Blob);
    });

    it('should skip offloaded books', async () => {
      mockDB.getAll.mockResolvedValueOnce([{ id: 'b1', isOffloaded: true }]); // books
      mockDB.getAll.mockResolvedValue([]); // others

      await service.createFullBackup();

      expect(dbService.getBookFile).not.toHaveBeenCalled();
    });
  });

  describe('restoreBackup', () => {
    it('should restore from light backup (JSON)', async () => {
      const manifest = {
        version: 1,
        timestamp: '2023-01-01',
        books: [{ id: 'b1', title: 'Restored Book', lastRead: 100 }],
        annotations: [],
        lexicon: [],
        locations: []
      };

      const file = new File([JSON.stringify(manifest)], 'backup.json', { type: 'application/json' });

      const mockTx = {
        objectStore: vi.fn().mockReturnValue({
          get: vi.fn().mockResolvedValue(undefined), // Book not found
          put: vi.fn().mockResolvedValue(undefined),
        }),
        done: Promise.resolve(),
      };
      mockDB.transaction.mockReturnValue(mockTx);

      await service.restoreBackup(file);

      expect(mockTx.objectStore).toHaveBeenCalledWith('books');
      expect(mockTx.objectStore('books').put).toHaveBeenCalledWith(expect.objectContaining({ title: 'Restored Book', isOffloaded: true }));
    });

    it('should smart merge existing books', async () => {
        const manifest = {
          version: 1,
          timestamp: '2023-01-01',
          books: [{ id: 'b1', title: 'New Title', lastRead: 200, progress: 0.5 }],
          annotations: [],
          lexicon: [],
          locations: []
        };

        const file = new File([JSON.stringify(manifest)], 'backup.json', { type: 'application/json' });

        const existingBook = { id: 'b1', title: 'Old Title', lastRead: 100, progress: 0.1 };

        const mockTx = {
          objectStore: vi.fn().mockReturnValue({
            get: vi.fn().mockResolvedValue(existingBook),
            put: vi.fn().mockResolvedValue(undefined),
          }),
          done: Promise.resolve(),
        };
        mockDB.transaction.mockReturnValue(mockTx);

        await service.restoreBackup(file);

        expect(mockTx.objectStore('books').put).toHaveBeenCalledWith(expect.objectContaining({
            id: 'b1',
            lastRead: 200, // Updated
            progress: 0.5
        }));
      });
  });
});
