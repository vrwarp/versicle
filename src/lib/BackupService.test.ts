import { vi, describe, it, expect, beforeEach } from 'vitest';
import * as Y from 'yjs';
import JSZip from 'jszip';
import { BackupService, type BackupManifestV2, type BackupManifestV3 } from './BackupService';
import { bookContent } from '@data/repos/bookContent';
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
vi.mock('@domains/sync/checkpoints/CheckpointService', () => ({
  CheckpointService: {
    createCheckpoint: (trigger: string) => mocks.checkpointMock.createCheckpoint(trigger),
  },
}));

// Mock y-idb's IndexeddbPersistence to avoid side effects in yjs-provider,
// but keep the REAL writeSnapshot: it is the restore path's durable write
// (via YjsSnapshotService.applySnapshot) and the v2-restore test below
// asserts its effect on the raw fake-indexeddb 'updates' store.
vi.mock('y-idb', async (importOriginal) => ({
  ...(await importOriginal<typeof import('y-idb')>()),
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
      clearData: mocks.persistenceMock.clearData,
      // generateManifest drains the debounce queue before capturing
      flush: vi.fn(() => Promise.resolve())
    })
  };
});

// Mock the bookContent repo (the static/locations read+write surface the
// backup path uses since the P3-8 carve)
vi.mock('@data/repos/bookContent', () => ({
  bookContent: {
    listManifests: vi.fn(),
    listLocations: vi.fn(),
    putManifests: vi.fn(),
    putLocations: vi.fn(),
    getBookFile: vi.fn(),
    restoreResource: vi.fn(),
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

/**
 * uint8ArrayToBase64 built its output with a per-byte `binary +=
 * String.fromCharCode(b)` — measured ~74 ms/MB, so a library with a few
 * hundred covers spent well over a second blocking the main thread inside
 * generateManifest. The chunked helpers must produce byte-identical output.
 */
describe('regression: base64 helpers are chunked', () => {
  const service = new BackupService();
  /** The pre-fix implementation, verbatim, as the oracle. */
  const referenceEncode = (bytes: Uint8Array): string => {
    let binary = '';
    for (let i = 0; i < bytes.byteLength; i++) binary += String.fromCharCode(bytes[i]);
    return btoa(binary);
  };
  const referenceDecode = (base64: string): Uint8Array => {
    const binary = atob(base64);
    const bytes = new Uint8Array(binary.length);
    for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
    return bytes;
  };
  const encode = (bytes: Uint8Array): string => service['uint8ArrayToBase64'](bytes);
  const decode = (base64: string): Uint8Array => service['base64ToUint8Array'](base64);

  const randomBytes = (length: number): Uint8Array => {
    const bytes = new Uint8Array(length);
    // Deterministic LCG: every byte value appears, including >0x7F.
    let seed = 0x2f6e2b1;
    for (let i = 0; i < length; i++) {
      seed = (seed * 1103515245 + 12345) & 0x7fffffff;
      bytes[i] = (seed >>> 16) & 0xff;
    }
    return bytes;
  };

  it('encodes ≥1 MB byte-identically to the reference implementation', () => {
    const bytes = randomBytes(1024 * 1024 + 7); // not a multiple of the window
    expect(encode(bytes)).toBe(referenceEncode(bytes));
  });

  it('round-trips ≥1 MB of binary through both helpers', () => {
    const bytes = randomBytes(1024 * 1024 + 7);
    expect(Array.from(decode(encode(bytes)))).toEqual(Array.from(bytes));
  });

  it('decodes byte-identically to the reference implementation', () => {
    const base64 = referenceEncode(randomBytes(300_000));
    expect(Array.from(decode(base64))).toEqual(Array.from(referenceDecode(base64)));
  });

  it('agrees on window boundaries, padding and the empty input', () => {
    for (const length of [0, 1, 2, 3, 0x7fff, 0x8000, 0x8001, 0x18000 - 1]) {
      const bytes = randomBytes(length);
      const encoded = encode(bytes);
      expect(encoded).toBe(referenceEncode(bytes));
      expect(Array.from(decode(encoded))).toEqual(Array.from(bytes));
    }
  });

  it('still decodes whitespace-wrapped base64 (single-shot fallback)', () => {
    const bytes = randomBytes(200_000);
    const wrapped = referenceEncode(bytes).replace(/(.{76})/g, '$1\n');
    expect(Array.from(decode(wrapped))).toEqual(Array.from(bytes));
  });

  it('stays far under a generous wall-clock budget, and beats the per-byte build', () => {
    const bytes = randomBytes(4 * 1024 * 1024);

    const chunkedStart = performance.now();
    const encoded = encode(bytes);
    decode(encoded);
    const chunkedMs = performance.now() - chunkedStart;

    const referenceStart = performance.now();
    referenceDecode(referenceEncode(bytes));
    const referenceMs = performance.now() - referenceStart;

    // Absolute guard rail first (machine-independent sanity)…
    expect(chunkedMs).toBeLessThan(2000);
    // …then the point of the change: the per-byte string build is quadratic
    // in practice (~450 ms for this input vs ~65 ms chunked). Asserting a
    // RATIO keeps the test honest on slow CI without being flaky — the real
    // gap is ~8×, the floor here is 2×.
    expect(chunkedMs * 2).toBeLessThan(referenceMs);
  });
});

/**
 * createFullBackup used to call `zip.generateAsync({ type: 'blob' })`, which
 * accumulates every chunk, concatenates them into one Uint8Array, converts
 * that to an ArrayBuffer and only then builds the Blob — three copies of the
 * whole library in memory at once (five on native, where export base64s it).
 */
describe('regression: full backup streams instead of accumulating', () => {
  let service: BackupService;

  beforeEach(async () => {
    service = new BackupService();
    vi.clearAllMocks();
    vi.mocked(bookContent.listManifests).mockResolvedValue([]);
    vi.mocked(bookContent.listLocations).mockResolvedValue([]);
    const yjsProvider = await import('@store/yjs-provider');
    const library = yjsProvider.getYDoc().getMap('library');
    library.clear();
    library.set('books', new Y.Map());
    const books = library.get('books') as Y.Map<unknown>;
    books.set('b1', { bookId: 'b1', title: 'Book 1' });
    books.set('b2', { bookId: 'b2', title: 'Book 2' });
    vi.spyOn(console, 'warn').mockImplementation(() => { });
    vi.spyOn(console, 'error').mockImplementation(() => { });
  });

  /** Records the chunk list handed to the zip Blob constructor. */
  function recordZipBlob(): { parts: () => BlobPart[]; restore: () => void } {
    const Original = globalThis.Blob;
    let captured: BlobPart[] = [];
    class RecordingBlob extends Original {
      constructor(parts?: BlobPart[], options?: BlobPropertyBag) {
        super(parts, options);
        if (options?.type === 'application/zip') captured = parts ?? [];
      }
    }
    globalThis.Blob = RecordingBlob as unknown as typeof Blob;
    return {
      parts: () => captured,
      restore: () => {
        globalThis.Blob = Original;
      },
    };
  }

  it('never calls generateAsync and builds the Blob from ≥2 stream chunks', async () => {
    const generateAsync = vi.spyOn(JSZip.prototype, 'generateAsync');
    // A book big enough that the archive arrives in several chunks.
    vi.mocked(bookContent.getBookFile).mockResolvedValue(new Uint8Array(400_000).buffer);
    const recorder = recordZipBlob();

    try {
      await service.createFullBackup();
    } finally {
      recorder.restore();
      generateAsync.mockRestore();
    }

    expect(generateAsync).not.toHaveBeenCalled();
    const parts = recorder.parts();
    expect(parts.length).toBeGreaterThanOrEqual(2);
    expect(parts.every((part) => part instanceof Uint8Array)).toBe(true);
  });

  it('reports compression progress the whole way to 100', async () => {
    vi.mocked(bookContent.getBookFile).mockResolvedValue(new Uint8Array(200_000).buffer);
    const onProgress = vi.fn();

    await service.createFullBackup(onProgress);

    const percents = onProgress.mock.calls.map(([percent]) => percent as number);
    expect(percents.some((p) => p > 90 && p <= 100)).toBe(true);
    expect(percents[percents.length - 1]).toBe(100);
    expect(onProgress).toHaveBeenLastCalledWith(100, 'Done!');
  });

  it('produces an archive the restore path reads back', async () => {
    const bytes = new Uint8Array([80, 75, 3, 4, 42, 7, 9]);
    vi.mocked(bookContent.getBookFile).mockResolvedValue(bytes.buffer);

    await service.createFullBackup();
    const { data } = vi.mocked(exportFile).mock.calls[0][0];
    expect(data).toBeInstanceOf(Blob);

    await service.restoreBackup(new File([data as Blob], 'versicle_backup_full.zip'));

    const restored = vi.mocked(bookContent.restoreResource).mock.calls;
    expect(restored.map(([bookId]) => bookId).sort()).toEqual(['b1', 'b2']);
    expect(Array.from(new Uint8Array(restored[0][1]))).toEqual(Array.from(bytes));
  });

  it('inflates at most two entries at a time during a restore', async () => {
    vi.mocked(bookContent.getBookFile).mockResolvedValue(new Uint8Array([1, 2, 3]).buffer);
    const doc = (await import('@store/yjs-provider')).getYDoc();
    const books = doc.getMap('library').get('books') as Y.Map<unknown>;
    for (const id of ['b3', 'b4', 'b5', 'b6']) books.set(id, { bookId: id, title: id });

    await service.createFullBackup();
    const { data } = vi.mocked(exportFile).mock.calls[0][0];

    const zip = await JSZip.loadAsync(data as Blob);
    let inFlight = 0;
    let peak = 0;
    zip.folder('files')!.forEach((_path, entry) => {
      const original = entry.async.bind(entry);
      const counting = (async (type: Parameters<typeof original>[0]) => {
        inFlight += 1;
        peak = Math.max(peak, inFlight);
        try {
          await new Promise((resolve) => setTimeout(resolve, 5));
          return await original(type);
        } finally {
          inFlight -= 1;
        }
      }) as typeof original;
      (entry as unknown as { async: typeof original }).async = counting;
    });

    const manifestText = await zip.file('manifest.json')!.async('string');
    await service.processManifest(JSON.parse(manifestText) as BackupManifestV3, zip);

    expect(vi.mocked(bookContent.restoreResource).mock.calls).toHaveLength(6);
    expect(peak).toBeGreaterThan(0);
    expect(peak).toBeLessThanOrEqual(2);
  });
});

describe('BackupService (v2 - Yjs Snapshots)', () => {
  let service: BackupService;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let mockYDoc: any;

  beforeEach(async () => {
    service = new BackupService();
    vi.clearAllMocks();
    mocks.capturedDocs.length = 0; // Clear captured docs

    // Default: no existing rows in IDB (restore merges against existing manifests)
    vi.mocked(bookContent.listManifests).mockResolvedValue([]);
    vi.mocked(bookContent.listLocations).mockResolvedValue([]);

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

      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      vi.mocked(bookContent.listManifests).mockResolvedValue([{ bookId: 'b1', title: 'Test Book' } as any]);

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
      vi.mocked(bookContent.listManifests).mockResolvedValue([
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        { bookId: 'b1', title: 'Book 1', fileHash: 'abc123' } as any
      ]);

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

      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      vi.mocked(bookContent.listManifests).mockResolvedValue([{ bookId: 'b1', title: 'Book 1' } as any]);

      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      (bookContent.getBookFile as any).mockResolvedValue(new ArrayBuffer(10));

      const onProgress = vi.fn();
      await service.createFullBackup(onProgress);

      expect(bookContent.getBookFile).toHaveBeenCalledWith('b1');
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

  /** Rows handed to the repo's bulk manifest writer across all calls. */
  function manifestPutRows() {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    return vi.mocked(bookContent.putManifests).mock.calls.flatMap(c => c[0] as any[]);
  }

  describe('regression: restore validates before destroying local data', () => {
    function expectLocalDataUntouched() {
      expect(mocks.persistenceMock.clearData).not.toHaveBeenCalled();
      expect(bookContent.putManifests).not.toHaveBeenCalled();
      expect(bookContent.putLocations).not.toHaveBeenCalled();
      expect(bookContent.restoreResource).not.toHaveBeenCalled();
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
      vi.mocked(bookContent.listManifests).mockResolvedValue([
        {
          bookId: 'b1', title: 'Covered Book', author: 'A', fileHash: 'h',
          fileSize: 1, totalChars: 1, schemaVersion: 1, coverBlob: coverBytes.buffer
        }
      ]);

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
      vi.mocked(bookContent.listManifests).mockResolvedValue([]);
      await service.restoreBackup(new File([data as string], 'backup.json'));

      const putRows = manifestPutRows();
      const restored = putRows.find(r => r.bookId === 'b1' && 'coverBlob' in r);
      expect(restored).toBeDefined();
      expect(restored.coverBlob).toBeInstanceOf(ArrayBuffer);
      expect(Array.from(new Uint8Array(restored.coverBlob))).toEqual([1, 2, 3, 250, 255]);
      expect(restored.coverBlobBase64).toBeUndefined();
    });

    it('sanitizes corrupt {} covers from v2 backups and never clobbers healthy local covers', async () => {
      const localCover = new Uint8Array([9, 9, 9]).buffer;
      vi.mocked(bookContent.listManifests).mockResolvedValue([
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        { bookId: 'b1', title: 'Healthy Local', coverBlob: localCover } as any
      ]);

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

      const putRows = manifestPutRows();

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
