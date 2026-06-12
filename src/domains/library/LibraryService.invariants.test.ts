/**
 * The library invariant suite (Phase 7 §C; entry gate PR-0a → cutover
 * PR-L4).
 *
 * Five historical race-regression files pinned exactly one interleaving
 * each; this suite lifts them into named SERVICE invariants:
 *
 *   I-1  hydrate() is a per-key merge — a book written after hydrate's read
 *        snapshot is never clobbered.
 *   I-2  hydration never resurrects — a key absent from inventory at write
 *        time is dropped, not written.
 *   I-3  restore re-validates existence inside the registration step;
 *        delete(X) and restore(X) serialize on X.
 *   I-4  failure paths restore the captured prior state, never an assumed
 *        default (offloaded stays offloaded).
 *   I-5  the offloaded set is updated per-key (add/remove deltas), never
 *        replaced wholesale from a stale snapshot.
 *
 * CUTOVER NOTE (PR-L4): the suite was written at the phase entry gate
 * against the legacy `useLibraryStore` workflows through the
 * `LibraryWorkflows` adapter below; the adapter NOW constructs the real
 * `LibraryService`/`ImportOrchestrator` over the real stores — the
 * assertions are unchanged. The five per-bug files were deleted in the same
 * PR (rule 8; plan/overhaul/prep/phase7-absorption-ledger.md rows 5–9):
 *
 *   useLibraryStore.race.test.ts          → I-1
 *   useLibraryStore.removeRace.test.ts    → I-2
 *   useLibraryStore.restoreRace.test.ts   → I-3
 *   useLibraryStore.offloadRevert.test.ts → I-4
 *   useLibraryStore.offloadedRace.test.ts → I-5
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { useBookStore } from '@store/useBookStore';
import { useLibraryStore } from '@store/useLibraryStore';
import {
  autoResetStores,
  makeLibraryPersistenceDouble,
  makeTestLibrary,
  makeFullExtraction,
  makeBookMetadata,
  makeInventoryItem,
} from '@test/harness';
import type { LibraryPersistence } from '@domains/library';
import type { BookMetadata } from '~types/db';

/**
 * The workflow surface the invariants run against — satisfied by the real
 * LibraryService since the PR-L4 cutover.
 */
interface LibraryWorkflows {
  hydrate(forceBookIds?: string[]): Promise<void>;
  restore(id: string, file: File): Promise<void>;
  offload(id: string): Promise<void>;
  remove(id: string): Promise<void>;
  staticMetadata(): Record<string, BookMetadata>;
  offloaded(): ReadonlySet<string>;
  /** Direct projection writes — model concurrent actors (imports, other tabs). */
  writeStatic(entries: Record<string, BookMetadata>): void;
  dropStatic(id: string): void;
  setOffloadedSet(ids: string[]): void;
}

const tick = (ms = 0) => new Promise((resolve) => setTimeout(resolve, ms));

function makeWorkflows(db: Partial<LibraryPersistence>): LibraryWorkflows {
  const persistence = makeLibraryPersistenceDouble(db);
  const { service } = makeTestLibrary({
    persistence,
    // Restore's synced-download path runs a full extraction; the fake keeps
    // the legacy 50ms "slow import" latency the I-3 pin was written with.
    extract: vi.fn(async (file: File) => {
      await tick(50);
      return makeFullExtraction({ bookId: 'zombie-book', title: `Book from ${file.name}` });
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
    }) as any,
  });

  return {
    hydrate: (forceBookIds) => service.hydrate(forceBookIds),
    restore: (id, file) => service.restore(id, file).catch(() => undefined),
    offload: (id) => service.offload(id),
    remove: (id) => service.remove(id),
    staticMetadata: () => useLibraryStore.getState().staticMetadata,
    offloaded: () => useLibraryStore.getState().offloadedBookIds,
    writeStatic: (entries) =>
      useLibraryStore.setState((state) => ({ staticMetadata: { ...state.staticMetadata, ...entries } })),
    dropStatic: (id) =>
      useLibraryStore.setState((state) => {
        const next = { ...state.staticMetadata };
        delete next[id];
        return { staticMetadata: next };
      }),
    setOffloadedSet: (ids) => useLibraryStore.setState({ offloadedBookIds: new Set(ids) }),
  };
}

function resetProjection(): void {
  useLibraryStore.setState({
    staticMetadata: {},
    offloadedBookIds: new Set<string>(),
    isHydrating: false,
    hasHydrated: false,
    error: null,
  });
}

describe('LibraryService invariants (I-1..I-5)', () => {
  autoResetStores(useBookStore);

  beforeEach(() => {
    resetProjection();
    vi.spyOn(console, 'error').mockImplementation(() => {});
    vi.spyOn(console, 'warn').mockImplementation(() => {});
  });

  describe('regression: I-1 hydrate is a per-key merge (useLibraryStore.race.test.ts)', () => {
    it('does not overwrite concurrent additions or updates when hydrating static metadata', async () => {
      const wf = makeWorkflows({
        getBookMetadata: vi.fn(async (id: string) => {
          await tick(50); // slow DB read
          return makeBookMetadata({ id, title: `Book ${id} from DB` });
        }),
        getOffloadedStatus: vi.fn(async () => new Map<string, boolean>()),
      });

      useBookStore.setState({
        books: {
          'old-book': makeInventoryItem({ bookId: 'old-book', title: 'Old Book' }),
          'existing-book': makeInventoryItem({ bookId: 'existing-book', title: 'Existing Book' }),
        },
      });

      const hydratePromise = wf.hydrate();
      // Concurrently, another actor adds a new book AND updates an existing one.
      wf.writeStatic({
        'new-book': makeBookMetadata({ id: 'new-book', title: 'New Book' }),
        'existing-book': makeBookMetadata({
          id: 'existing-book',
          title: 'Existing Book Updated Concurrently',
        }),
      });
      await hydratePromise;

      expect(wf.staticMetadata()['new-book']).toBeDefined();
      expect(wf.staticMetadata()['existing-book']?.title).toBe(
        'Existing Book Updated Concurrently',
      );
      expect(wf.staticMetadata()['old-book']?.title).toBe('Book old-book from DB');
    });
  });

  describe('regression: I-2 hydration never resurrects (useLibraryStore.removeRace.test.ts)', () => {
    it('does not restore concurrently removed books when hydrating', async () => {
      const wf = makeWorkflows({
        getBookMetadata: vi.fn(async (id: string) => {
          await tick(50);
          return makeBookMetadata({ id, title: `Book ${id} from DB` });
        }),
        getOffloadedStatus: vi.fn(async () => new Map<string, boolean>()),
      });

      useBookStore.setState({
        books: {
          'book-to-remove': makeInventoryItem({ bookId: 'book-to-remove', title: 'Book To Remove' }),
          'existing-book': makeInventoryItem({ bookId: 'existing-book', title: 'Existing Book' }),
        },
      });
      wf.writeStatic({
        'book-to-remove': makeBookMetadata({ id: 'book-to-remove', title: 'Book To Remove' }),
        'existing-book': makeBookMetadata({ id: 'existing-book', title: 'Existing Book' }),
      });

      const hydratePromise = wf.hydrate();
      // Concurrently, the book is removed from BOTH the inventory and the projection.
      useBookStore.setState((state) => {
        const { ['book-to-remove']: _removed, ...remaining } = state.books;
        void _removed;
        return { books: remaining };
      });
      wf.dropStatic('book-to-remove');
      await hydratePromise;

      expect(wf.staticMetadata()['book-to-remove']).toBeUndefined();
      expect(wf.staticMetadata()['existing-book']).toBeDefined();
    });
  });

  describe('regression: I-3 restore re-validates existence (useLibraryStore.restoreRace.test.ts)', () => {
    it('does not resurrect concurrently removed books during restore', async () => {
      const wf = makeWorkflows({
        getManifest: vi.fn(async () => undefined), // synced-book download path
        ingest: vi.fn(async () => undefined),
        getBookMetadata: vi.fn(async () => undefined),
        getBookIdByFilename: vi.fn(() => undefined),
        deleteBook: vi.fn(async () => undefined),
        getOffloadedStatus: vi.fn(async () => new Map<string, boolean>()),
      });

      useBookStore.setState({
        books: { 'zombie-book': makeInventoryItem({ bookId: 'zombie-book', title: 'Zombie Book' }) },
      });
      wf.setOffloadedSet(['zombie-book']);
      wf.writeStatic({ 'zombie-book': makeBookMetadata({ id: 'zombie-book', title: 'Zombie Book' }) });

      const file = new File([''], 'test.epub', { type: 'application/epub+zip' });
      const restorePromise = wf.restore('zombie-book', file);
      // Concurrently, the book is removed.
      await wf.remove('zombie-book');
      await restorePromise;

      expect(wf.staticMetadata()['zombie-book']).toBeUndefined();
    });
  });

  describe('regression: I-4 failure restores captured prior state (useLibraryStore.offloadRevert.test.ts)', () => {
    it('does not remove offloaded state if offload fails but book was already offloaded', async () => {
      const wf = makeWorkflows({
        offloadBook: vi.fn(async () => {
          throw new Error('DB Error');
        }),
      });
      wf.setOffloadedSet(['book1']);

      await wf.offload('book1');

      // It must remain offloaded even though the redundant call failed.
      expect(wf.offloaded().has('book1')).toBe(true);
    });

    it('reverts the optimistic flag when offload fails on a non-offloaded book', async () => {
      const wf = makeWorkflows({
        offloadBook: vi.fn(async () => {
          throw new Error('DB Error');
        }),
      });

      await wf.offload('book2');

      expect(wf.offloaded().has('book2')).toBe(false);
    });
  });

  describe('regression: I-5 offloaded set is updated per-key (useLibraryStore.offloadedRace.test.ts)', () => {
    it('does not overwrite concurrent removals from the offloaded set during hydration', async () => {
      const wf = makeWorkflows({
        getBookMetadata: vi.fn(async (id: string) => makeBookMetadata({ id, title: `Book ${id} from DB` })),
        getOffloadedStatus: vi.fn(async () => {
          await tick(50); // slow DB read
          return new Map<string, boolean>([['book1', true]]);
        }),
      });

      useBookStore.setState({
        books: { book1: makeInventoryItem({ bookId: 'book1', title: 'Book 1' }) },
      });
      wf.setOffloadedSet(['book1']);

      const hydratePromise = wf.hydrate();
      // Concurrently, something else (e.g. restore) clears the offloaded flag.
      wf.setOffloadedSet([]);
      await hydratePromise;

      expect(wf.offloaded().has('book1')).toBe(false);
    });
  });

  describe('property: seeded hydrate-vs-mutation interleavings reach a sequentially-reachable state', () => {
    /**
     * The generalization the five point fixes approximate: interleaving
     * hydrate(X) with another workflow on X must end in a state reachable by
     * SOME sequential order of the two operations. Latencies are seeded so
     * failures replay deterministically.
     */
    const mulberry32 = (seed: number) => () => {
      let t = (seed += 0x6d2b79f5);
      t = Math.imul(t ^ (t >>> 15), t | 1);
      t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };

    type Terminal = { hasStatic: boolean; isOffloaded: boolean; inInventory: boolean };

    const terminal = (wf: LibraryWorkflows, id: string): Terminal => ({
      hasStatic: wf.staticMetadata()[id] !== undefined,
      isOffloaded: wf.offloaded().has(id),
      inInventory: useBookStore.getState().books[id] !== undefined,
    });

    const seedBook = (wf: LibraryWorkflows, id: string) => {
      useBookStore.setState({ books: { [id]: makeInventoryItem({ bookId: id }) } });
      wf.writeStatic({ [id]: makeBookMetadata({ id }) });
      wf.setOffloadedSet([]);
    };

    const makeDb = (latency: () => number): Partial<LibraryPersistence> => ({
      getBookMetadata: vi.fn(async (id: string) => {
        await tick(latency());
        return makeBookMetadata({ id, title: `${id} from DB` });
      }),
      getOffloadedStatus: vi.fn(async () => {
        await tick(latency());
        return new Map<string, boolean>();
      }),
      offloadBook: vi.fn(async () => {
        await tick(latency());
      }),
      deleteBook: vi.fn(async () => {
        await tick(latency());
      }),
      restoreResource: vi.fn(async () => {
        await tick(latency());
      }),
      getManifest: vi.fn(async () => undefined),
      ingest: vi.fn(async () => undefined),
      getBookIdByFilename: vi.fn(() => undefined),
    });

    const OPS: Record<string, (wf: LibraryWorkflows, id: string) => Promise<void>> = {
      remove: (wf, id) => wf.remove(id),
      offload: (wf, id) => wf.offload(id),
    };

    for (const opName of Object.keys(OPS)) {
      it(`hydrate ∥ ${opName} terminates in a sequentially-reachable state (16 seeds)`, async () => {
        const id = 'prop-book';

        // Enumerate the sequentially-reachable terminal states.
        const reachable: Terminal[] = [];
        for (const order of [0, 1]) {
          resetProjection();
          const wf = makeWorkflows(makeDb(() => 0));
          seedBook(wf, id);
          if (order === 0) {
            await wf.hydrate();
            await OPS[opName](wf, id);
          } else {
            await OPS[opName](wf, id);
            await wf.hydrate();
          }
          reachable.push(terminal(wf, id));
        }

        for (let seed = 1; seed <= 16; seed++) {
          resetProjection();
          const rand = mulberry32(seed);
          const latency = () => Math.floor(rand() * 4) * 10;
          const wf = makeWorkflows(makeDb(latency));
          seedBook(wf, id);

          const a = wf.hydrate();
          if (rand() < 0.5) await tick(Math.floor(rand() * 3) * 10);
          const b = OPS[opName](wf, id);
          await Promise.all([a, b]);

          const got = terminal(wf, id);
          const ok = reachable.some(
            (r) =>
              r.hasStatic === got.hasStatic &&
              r.isOffloaded === got.isOffloaded &&
              r.inInventory === got.inInventory,
          );
          expect(
            ok,
            `seed ${seed}: terminal ${JSON.stringify(got)} not in reachable set ${JSON.stringify(reachable)}`,
          ).toBe(true);
        }
      });
    }
  });
});
