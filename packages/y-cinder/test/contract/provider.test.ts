/**
 * y-cinder fork contract suite (F.1–F.6) — written against the UNMODIFIED
 * vendored source FIRST (plan/overhaul/README.md §Program rules 7;
 * phase4-sync-strangler.md §D6: "each delta lands behind a contract test
 * written first").
 *
 * Pins the provider semantics Versicle's sync domain actually depends on
 * (src/domains/sync/backend/FirestoreBackend.ts is the only consumer):
 * constructor validation, echo-origin filtering, debounced update batching,
 * the save failure event surface, and destroy() teardown. The Firestore SDK
 * is replaced by inert module mocks — these cases pin the provider's OWN
 * logic; live transport behavior is pinned by the emulator-gated C3 runner
 * (src/lib/sync/syncBackendContract.emulator.test.ts) driving the real
 * provider against the firestore+auth+storage emulator trio.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import * as Y from 'yjs';

const { addDocMock, MockBytes } = vi.hoisted(() => {
  class MockBytes {
    constructor(readonly _u8: Uint8Array) {}
    static fromUint8Array(u8: Uint8Array): MockBytes {
      return new MockBytes(u8);
    }
    toUint8Array(): Uint8Array {
      return this._u8;
    }
  }
  return { addDocMock: vi.fn(), MockBytes };
});

vi.mock('@firebase/firestore', () => ({
  getFirestore: vi.fn(() => ({ __db: true })),
  initializeFirestore: vi.fn(() => ({ __db: true })),
  persistentLocalCache: vi.fn(() => ({})),
  collection: vi.fn((_db: unknown, path: string, sub?: string) => ({
    __collection: sub ? `${path}/${sub}` : path,
  })),
  doc: vi.fn((parent: unknown, ...segments: string[]) => ({
    __doc: segments.join('/'),
    parent,
  })),
  addDoc: addDocMock,
  Bytes: MockBytes,
  serverTimestamp: vi.fn(() => ({ __serverTimestamp: true })),
  // Initial-sync surface: STALL the constructor's background sync() at its
  // first fetch (a never-resolving getDocs). The initial sync has its own
  // local-state push (sync.ts:353/:363) that would pollute the addDoc
  // counts; the debounced save path under test here is fully independent of
  // sync completion. Live initial-sync behavior is the emulator runner's
  // job, not this suite's.
  onSnapshot: vi.fn(() => () => {}),
  query: vi.fn((target: unknown) => target),
  orderBy: vi.fn(),
  limit: vi.fn(),
  limitToLast: vi.fn(),
  startAfter: vi.fn(),
  getDocs: vi.fn(() => new Promise(() => {})),
  getDoc: vi.fn(async () => ({
    exists: () => false,
    data: () => undefined,
    metadata: { hasPendingWrites: false },
  })),
  setDoc: vi.fn(async () => undefined),
  deleteDoc: vi.fn(async () => undefined),
  runTransaction: vi.fn(async () => undefined),
}));

vi.mock('@firebase/storage', () => ({
  getStorage: vi.fn(() => ({ __storage: true })),
  ref: vi.fn(),
  uploadBytes: vi.fn(),
  deleteObject: vi.fn(),
  getBytes: vi.fn(),
}));

import { FireProvider } from '../../src/provider';
import { FIREBASE_ORIGINS, DEFAULTS } from '../../src/types';

const mockApp = { name: 'contract-app' } as never;

/** Short debounce so timer advancement stays readable. */
const MAX_WAIT = 5;

function makeProvider(ydoc: Y.Doc): FireProvider {
  return new FireProvider({
    firebaseApp: mockApp,
    ydoc,
    path: 'users/u1/versicle/ws1',
    maxWaitTime: MAX_WAIT,
  });
}

/** The update blob of the n-th addDoc call, decoded back to bytes. */
function savedUpdate(call: number): Uint8Array {
  const docData = addDocMock.mock.calls[call][1] as {
    update: InstanceType<typeof MockBytes>;
  };
  return docData.update.toUint8Array();
}

describe('y-cinder fork contract (F.1–F.6)', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    addDocMock.mockReset();
    addDocMock.mockResolvedValue({ id: 'doc-id' });
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  describe('F.1 constructor validation (before any SDK call — P1.8/P2.20)', () => {
    const ydoc = new Y.Doc();

    it.each([
      ['empty path', ''],
      ['double slash', 'docs//my-doc'],
      ['leading slash', '/docs/my-doc'],
      ['trailing slash', 'docs/my-doc/'],
    ])('rejects %s', (_label, path) => {
      expect(
        () => new FireProvider({ firebaseApp: mockApp, ydoc, path })
      ).toThrow(/Invalid Firestore path/);
    });

    it('rejects a non-positive maxUpdatesThreshold', () => {
      expect(
        () =>
          new FireProvider({
            firebaseApp: mockApp,
            ydoc,
            path: 'docs/d1',
            maxUpdatesThreshold: 0,
          })
      ).toThrow(/Invalid maxUpdatesThreshold/);
    });

    it('rejects an out-of-range subdocument depth', () => {
      expect(
        () =>
          new FireProvider({ firebaseApp: mockApp, ydoc, path: 'docs/d1', depth: 101 })
      ).toThrow(/Invalid depth/);
    });
  });

  describe('F.2 echo-origin filtering (no Firebase→Firebase loops)', () => {
    it.each([
      ['snapshot', FIREBASE_ORIGINS.SNAPSHOT],
      ['history', FIREBASE_ORIGINS.HISTORY],
      ['update', FIREBASE_ORIGINS.UPDATE],
    ])('an inbound %s-origin update never schedules a save', async (_label, origin) => {
      const ydoc = new Y.Doc();
      const provider = makeProvider(ydoc);

      const remote = new Y.Doc();
      remote.getMap('library').set('book-1', 'Moby Dick');
      Y.applyUpdate(ydoc, Y.encodeStateAsUpdate(remote), origin);

      await vi.advanceTimersByTimeAsync(MAX_WAIT * 10);
      expect(addDocMock).not.toHaveBeenCalled();
      await provider.destroy();
    });

    it('a local update IS saved', async () => {
      const ydoc = new Y.Doc();
      const provider = makeProvider(ydoc);

      ydoc.getMap('library').set('book-1', 'Moby Dick');
      await vi.advanceTimersByTimeAsync(MAX_WAIT * 10);

      expect(addDocMock).toHaveBeenCalledTimes(1);
      // The write targets the updates subcollection with the provider's
      // session id stamped on it.
      const docData = addDocMock.mock.calls[0][1] as Record<string, unknown>;
      expect(docData.createdBy).toBe(provider.uid);
      await provider.destroy();
    });
  });

  describe('F.3 debounced batching (one transaction per quiet window)', () => {
    it('updates inside one debounce window coalesce into a single merged write', async () => {
      const ydoc = new Y.Doc();
      const provider = makeProvider(ydoc);

      ydoc.getMap('library').set('book-1', 'Moby Dick');
      ydoc.getMap('readingState').set('book-1', 0.5);
      await vi.advanceTimersByTimeAsync(MAX_WAIT * 10);

      expect(addDocMock).toHaveBeenCalledTimes(1);
      const replay = new Y.Doc();
      Y.applyUpdate(replay, savedUpdate(0));
      expect(replay.getMap('library').get('book-1')).toBe('Moby Dick');
      expect(replay.getMap('readingState').get('book-1')).toBe(0.5);
      await provider.destroy();
    });

    it('updates arriving DURING a save are saved by a follow-up write, not lost', async () => {
      const ydoc = new Y.Doc();
      const provider = makeProvider(ydoc);

      let resolveSave: (() => void) | undefined;
      addDocMock.mockImplementationOnce(
        () =>
          new Promise<{ id: string }>((resolve) => {
            resolveSave = () => resolve({ id: 'slow' });
          })
      );

      ydoc.getMap('library').set('book-1', 'first');
      await vi.advanceTimersByTimeAsync(MAX_WAIT * 2);
      expect(addDocMock).toHaveBeenCalledTimes(1);

      // Lands while save #1 is in flight (P0.5).
      ydoc.getMap('library').set('book-2', 'second');
      resolveSave!();
      await vi.advanceTimersByTimeAsync(MAX_WAIT * 10);

      expect(addDocMock).toHaveBeenCalledTimes(2);
      const replay = new Y.Doc();
      Y.applyUpdate(replay, savedUpdate(0));
      Y.applyUpdate(replay, savedUpdate(1));
      expect(replay.getMap('library').get('book-1')).toBe('first');
      expect(replay.getMap('library').get('book-2')).toBe('second');
      await provider.destroy();
    });
  });

  describe('F.4 save failure surface (the events FirestoreBackend forwards)', () => {
    it('an oversized update is rejected proactively: save-rejected(document-too-large), no write attempted', async () => {
      const ydoc = new Y.Doc();
      const provider = makeProvider(ydoc);
      const rejections: Array<Record<string, unknown>> = [];
      provider.on('save-rejected', (event: Record<string, unknown>) => {
        rejections.push(event);
      });

      ydoc
        .getText('content')
        .insert(0, 'x'.repeat(DEFAULTS.FIRESTORE_DOC_LIMIT + 1024));
      await vi.advanceTimersByTimeAsync(MAX_WAIT * 10);

      expect(addDocMock).not.toHaveBeenCalled();
      expect(rejections).toHaveLength(1);
      expect(rejections[0].code).toBe('document-too-large');
      expect(rejections[0].sizeBytes).toBeGreaterThan(DEFAULTS.FIRESTORE_DOC_LIMIT);
      await provider.destroy();
    });

    it('a server-side size rejection is terminal: save-rejected(document-too-large), no retry', async () => {
      const ydoc = new Y.Doc();
      const provider = makeProvider(ydoc);
      const rejections: Array<Record<string, unknown>> = [];
      provider.on('save-rejected', (event: Record<string, unknown>) => {
        rejections.push(event);
      });

      addDocMock.mockRejectedValue(
        Object.assign(new Error('Document exceeds the maximum allowed size'), {
          code: 'invalid-argument',
        })
      );
      ydoc.getMap('library').set('book-1', 'Moby Dick');
      await vi.advanceTimersByTimeAsync(MAX_WAIT * 20);

      expect(addDocMock).toHaveBeenCalledTimes(1);
      expect(rejections).toHaveLength(1);
      expect(rejections[0].code).toBe('document-too-large');
      await provider.destroy();
    });

    it('persistent generic failures trip the circuit breaker: save-rejected(max-retries-exceeded) after MAX_SAVE_RETRIES attempts', async () => {
      const ydoc = new Y.Doc();
      const provider = makeProvider(ydoc);
      const rejections: Array<Record<string, unknown>> = [];
      provider.on('save-rejected', (event: Record<string, unknown>) => {
        rejections.push(event);
      });

      addDocMock.mockRejectedValue(new Error('transient network failure'));
      ydoc.getMap('library').set('book-1', 'Moby Dick');
      await vi.advanceTimersByTimeAsync(MAX_WAIT * 50);

      expect(addDocMock).toHaveBeenCalledTimes(DEFAULTS.MAX_SAVE_RETRIES);
      expect(rejections).toHaveLength(1);
      expect(rejections[0].code).toBe('max-retries-exceeded');
      expect(rejections[0].retries).toBe(DEFAULTS.MAX_SAVE_RETRIES);
      await provider.destroy();
    });
  });

  describe('F.5 destroy() teardown', () => {
    it('flushes the pending update cache before closing', async () => {
      const ydoc = new Y.Doc();
      const provider = makeProvider(ydoc);

      ydoc.getMap('library').set('book-1', 'Moby Dick');
      // Destroy INSIDE the debounce window: the write must still happen.
      await provider.destroy();

      expect(addDocMock).toHaveBeenCalledTimes(1);
      const replay = new Y.Doc();
      Y.applyUpdate(replay, savedUpdate(0));
      expect(replay.getMap('library').get('book-1')).toBe('Moby Dick');
    });

    it('detaches the doc handlers: post-destroy updates schedule nothing', async () => {
      const ydoc = new Y.Doc();
      const provider = makeProvider(ydoc);
      await provider.destroy();
      addDocMock.mockClear();

      ydoc.getMap('library').set('book-after', 'too late');
      await vi.advanceTimersByTimeAsync(MAX_WAIT * 10);
      expect(addDocMock).not.toHaveBeenCalled();
    });
  });

  describe('F.6 save-success signal (CURRENT gap — flips with the §D6.1 fork delta)', () => {
    it("a committed save announces NOTHING today: no 'saved' after addDoc resolves (the lastSyncTime-from-flush gap)", async () => {
      const ydoc = new Y.Doc();
      const provider = makeProvider(ydoc);
      const savedAts: number[] = [];
      provider.on('saved', (at: number) => savedAts.push(at));

      ydoc.getMap('library').set('book-1', 'Moby Dick');
      await vi.advanceTimersByTimeAsync(MAX_WAIT * 10);

      expect(addDocMock).toHaveBeenCalledTimes(1);
      // Pin of the vendored-SHA behavior: success is silent. This case is
      // REPLACED by the F.7 'saved' semantics when the fork delta lands.
      expect(savedAts).toHaveLength(0);
      await provider.destroy();
    });
  });
});
