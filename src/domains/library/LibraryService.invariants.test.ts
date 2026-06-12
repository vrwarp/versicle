/**
 * The library invariant suite (Phase 7 entry gate, PR-0a in
 * plan/overhaul/prep/phase7-library-google.md §C).
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
 * The suite runs against the `LibraryWorkflows` harness seam. At entry-gate
 * time the harness adapts the CURRENT `useLibraryStore`; the PR-L4 cutover
 * swaps the adapter for the real `LibraryService` WITHOUT changing a single
 * assertion (program rule 7: characterization before change). The five
 * per-bug files are deleted only in the cutover PR that absorbs them here
 * (program rule 8; see plan/overhaul/prep/phase7-absorption-ledger.md).
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { createLibraryStore, useBookStore } from '@store/useLibraryStore';
import type { IDBService } from '@store/useLibraryStore';
import {
  autoResetStores,
  makeLibraryDbDouble,
  makeBookMetadata,
  makeInventoryItem,
} from '@test/harness';
import type { BookMetadata, StaticBookManifest } from '~types/db';

vi.mock('@lib/ingestion', () => ({
  extractBookMetadata: vi.fn().mockResolvedValue({
    title: 'Unmatched Title',
    author: 'Unmatched Author',
    description: '',
    fileHash: 'hash',
  }),
}));

/**
 * The workflow surface the invariants run against. The current adapter wraps
 * `useLibraryStore`; the real `LibraryService` satisfies this shape at the
 * PR-L4 cutover.
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

function makeWorkflows(db: Partial<IDBService>): LibraryWorkflows {
  const store = createLibraryStore(makeLibraryDbDouble(db));
  return {
    hydrate: (forceBookIds) => store.getState().hydrateStaticMetadata(forceBookIds),
    restore: (id, file) => store.getState().restoreBook(id, file),
    offload: (id) => store.getState().offloadBook(id),
    remove: (id) => store.getState().removeBook(id),
    staticMetadata: () => store.getState().staticMetadata,
    offloaded: () => store.getState().offloadedBookIds,
    writeStatic: (entries) =>
      store.setState((state) => ({ staticMetadata: { ...state.staticMetadata, ...entries } })),
    dropStatic: (id) =>
      store.setState((state) => {
        const next = { ...state.staticMetadata };
        delete next[id];
        return { staticMetadata: next };
      }),
    setOffloadedSet: (ids) => store.setState({ offloadedBookIds: new Set(ids) }),
  };
}

const tick = (ms = 0) => new Promise((resolve) => setTimeout(resolve, ms));

describe('LibraryService invariants (I-1..I-5)', () => {
  autoResetStores(useBookStore);

  beforeEach(() => {
    vi.spyOn(console, 'error').mockImplementation(() => {});
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
        getBookMetadata: vi.fn(async () => undefined),
        importBookWithId: vi.fn(async (id: string): Promise<StaticBookManifest> => {
          await tick(50); // slow import
          return {
            bookId: id,
            schemaVersion: 1,
            title: `Book ${id} from DB`,
            author: 'Test Author',
            fileHash: 'hash',
            fileSize: 1,
            totalChars: 1,
          };
        }),
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

    const makeDb = (latency: () => number): Partial<IDBService> => ({
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
      restoreBook: vi.fn(async () => {
        await tick(latency());
      }),
      importBookWithId: vi.fn(),
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
