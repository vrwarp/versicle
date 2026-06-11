import { describe, it, expect } from 'vitest';
import * as Y from 'yjs';
import { createStore } from 'zustand/vanilla';
import yjs from 'zustand-middleware-yjs';
import { drain, replicate } from './helpers';

/**
 * Fork contract suite — inbound hydration (phase2-fork-surgery.md §3 cases
 * A.5, A.6, plus the hermetic late-join pin that replaced the upstream
 * y-websocket test; see PROVENANCE.md).
 *
 * A.5 pins the CURRENT replace-with-delete hydration — finding D2, the bug
 * Phase 2's `hydration: 'merge-defaults'` exists to fix: any field added to
 * a synced store's initial state is WIPED on first hydration from an older
 * doc (the v4→v5 fontProfiles migration exists solely because of this).
 * These tests are rewritten per store in the same PR that flips that store
 * to merge-defaults (the canary mechanism, §2.6); they are never silently
 * dropped.
 */

interface LibState {
  books: Record<string, { title: string }>;
  newField: string;
  addBook: (id: string, title: string) => void;
}

const creator =
  (set: (fn: (s: LibState) => Partial<LibState>) => void): LibState => ({
    books: {},
    newField: 'default-value',
    addBook: (id, title) =>
      set((state) => ({ books: { ...state.books, [id]: { title } } })),
  });

/** Build a doc whose 'lib' map contains `books` but NOT `newField`. */
const oldFormatDoc = async (): Promise<Y.Doc> => {
  const writer = new Y.Doc();
  const writerStore = createStore<Pick<LibState, 'books'> & { addBook: LibState['addBook'] }>()(
    yjs(writer, 'lib', (set) => ({
      books: {},
      addBook: (id, title) =>
        set((state) => ({ books: { ...state.books, [id]: { title } } })),
    })),
  );
  writerStore.getState().addBook('b1', 'Moby Dick');
  await drain(); // let the writer's outbound microtask flush into the doc
  return writer;
};

describe('contract A.5 — replace-with-delete hydration (CURRENT bug, pinned)', () => {
  it('initial hydration from a pre-populated map DELETES state keys absent from the map', async () => {
    const doc = await oldFormatDoc();

    const store = createStore<LibState>()(yjs(doc, 'lib', creator));

    // The doc's data hydrated…
    expect(store.getState().books).toEqual({ b1: { title: 'Moby Dick' } });
    // …but the newly-declared default was DELETED, not retained. This is
    // finding D2 (diff.ts getRecordChanges emits DELETE for every state key
    // absent from map JSON; patchStore applies with replace=true). Phase 2
    // changes this per store via hydration: 'merge-defaults' — when a store
    // flips, this expectation flips with it in the same PR.
    expect('newField' in store.getState()).toBe(false);
    expect(store.getState().newField).toBeUndefined();
    // Functions are exempt from the delete emission: actions survive.
    expect(typeof store.getState().addBook).toBe('function');
  });

  it('late inbound hydration (empty map at creation) also deletes absent defaults', async () => {
    const doc = new Y.Doc();
    const store = createStore<LibState>()(yjs(doc, 'lib', creator));
    expect(store.getState().newField).toBe('default-value'); // pre-hydration

    replicate(await oldFormatDoc(), doc);
    await drain(); // inbound processBatch

    expect(store.getState().books).toEqual({ b1: { title: 'Moby Dick' } });
    expect('newField' in store.getState()).toBe(false);
  });
});

describe('contract A.6 — initial hydration from a pre-populated map', () => {
  it('hydrates synchronously at store creation (no microtask needed)', async () => {
    const doc = await oldFormatDoc();
    doc.getMap('lib').set('extra', 42);

    const store = createStore<LibState>()(yjs(doc, 'lib', creator));
    // The synchronous patch path (index.ts: map.size > 0 at creation).
    expect((store.getState() as unknown as Record<string, unknown>)['extra']).toBe(42);
  });
});

describe('contract — late join does not reset remote state (hermetic port of the upstream network test)', () => {
  it('a second client joining with identical defaults does not clobber the first client\'s data', async () => {
    const docA = new Y.Doc();
    const storeA = createStore<LibState>()(yjs(docA, 'lib', creator));
    storeA.getState().addBook('b1', 'Moby Dick');
    await drain();

    // Late joiner: creating the store does NOT eagerly write defaults into
    // its (empty) doc — that is the design that makes late join safe
    // (index.ts deliberately skips initializing the map from initial state).
    const docB = new Y.Doc();
    const storeB = createStore<LibState>()(yjs(docB, 'lib', creator));
    expect(docB.getMap('lib').size).toBe(0);

    replicate(docA, docB);
    await drain();

    expect(storeB.getState().books).toEqual({ b1: { title: 'Moby Dick' } });
    // And replicating back does not reset A.
    replicate(docB, docA);
    await drain();
    expect(storeA.getState().books).toEqual({ b1: { title: 'Moby Dick' } });
  });
});
