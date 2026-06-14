import { describe, it, expect } from 'vitest';
import * as Y from 'yjs';
import { createStore } from 'zustand/vanilla';
import yjs from 'zustand-middleware-yjs';
import { patchSharedType } from '../../src/patching';
import { drain, replicate, countUpdates } from './helpers';

/**
 * Fork contract suite — outbound replication (phase2-fork-surgery.md §3
 * cases A.1, A.2, A.3, A.10).
 *
 * A.3 is the judges' `previousState` delete-protection graft
 * (src/patching.ts DELETE branch): strangler risk row 2 requires it to be
 * kept VERBATIM through all Phase 2 surgery.
 */

interface State {
  count: number;
  items: Record<string, { label: string }>;
  increment: () => void;
  setItem: (id: string, label: string) => void;
}

const creator = (set: (fn: (s: State) => Partial<State>) => void): State => ({
  count: 0,
  items: {},
  increment: () => set((s) => ({ count: s.count + 1 })),
  setItem: (id, label) =>
    set((s) => ({ items: { ...s.items, [id]: { label } } })),
});

describe('contract A.1 — outbound mirrors every non-function top-level key', () => {
  it('after the first flush the map holds all data keys and no function keys', async () => {
    const doc = new Y.Doc();
    const store = createStore<State>()(yjs(doc, 'shared', creator));

    // No eager write at creation (late-join safety, pinned in hydration.test.ts).
    expect(doc.getMap('shared').size).toBe(0);

    store.getState().increment();
    await drain();

    const json = doc.getMap('shared').toJSON();
    expect(json).toEqual({ count: 1, items: {} });
    expect(Object.keys(json)).not.toContain('increment');
    expect(Object.keys(json)).not.toContain('setItem');
  });
});

describe('contract A.2 — outbound microtask batching', () => {
  it('N set() calls in one tick produce exactly ONE Yjs transaction', async () => {
    const doc = new Y.Doc();
    const store = createStore<State>()(yjs(doc, 'shared', creator));
    const updates = countUpdates(doc);

    store.getState().increment();
    store.getState().increment();
    store.getState().setItem('a', 'A');
    store.getState().increment();
    await drain();

    expect(updates.count()).toBe(1);
    expect(doc.getMap('shared').toJSON()).toEqual({
      count: 3,
      items: { a: { label: 'A' } },
    });
  });
});

describe('contract A.3 — previousState delete-protection on outbound', () => {
  it('a key inserted by a remote peer between batch capture and flush survives the flush', async () => {
    const docA = new Y.Doc();
    const storeA = createStore<State>()(yjs(docA, 'shared', creator));
    storeA.getState().increment();
    await drain();

    // Remote peer B (sharing A's history) inserts a top-level key.
    const docB = new Y.Doc();
    replicate(docA, docB);
    docB.transact(() => {
      docB.getMap('shared').set('remoteKey', 'from-b');
    });

    // SAME tick on A: first a local set() (captures previousState without
    // remoteKey), then the remote update lands at the Y level (so the map
    // has remoteKey while A's zustand state does not yet).
    storeA.getState().increment();
    replicate(docB, docA);
    await drain();

    // Without the previousState guard the outbound flush would emit
    // DELETE remoteKey (in state-vs-map diff terms it "looks deleted").
    expect(docA.getMap('shared').get('remoteKey')).toBe('from-b');
    // The inbound batch then delivers it to the store.
    expect((storeA.getState() as unknown as Record<string, unknown>)['remoteKey']).toBe('from-b');
    expect(storeA.getState().count).toBe(2);
  });

  it('recursive variant: a NESTED key inserted remotely survives a local flush touching the same subtree', async () => {
    const docA = new Y.Doc();
    const storeA = createStore<State>()(yjs(docA, 'shared', creator));
    storeA.getState().setItem('mine', 'local');
    await drain();

    const docB = new Y.Doc();
    replicate(docA, docB);
    docB.transact(() => {
      const items = docB.getMap('shared').get('items') as Y.Map<unknown>;
      const child = new Y.Map();
      child.set('label', 'remote');
      items.set('theirs', child);
    });

    storeA.getState().setItem('mine', 'local-updated'); // same-subtree local write
    replicate(docB, docA);
    await drain();

    const items = (docA.getMap('shared').get('items') as Y.Map<unknown>).toJSON();
    expect(items).toEqual({
      mine: { label: 'local-updated' },
      theirs: { label: 'remote' },
    });
    expect(storeA.getState().items['theirs']).toEqual({ label: 'remote' });
  });

  it('unit pin (src/patching.ts DELETE branch): delete skipped iff key absent from previousState', () => {
    const doc = new Y.Doc();
    const map = doc.getMap('unit');
    doc.transact(() => {
      map.set('keep', 1);
      map.set('drop', 2);
    });

    doc.transact(() => {
      patchSharedType(
        map,
        {}, // new state: both keys absent
        // previousState: 'drop' was visible to this client before the batch,
        // 'keep' was not (concurrent remote insert) — so only 'drop' deletes.
        { previousState: { drop: 2 } },
      );
    });

    expect(map.has('keep')).toBe(true);
    expect(map.has('drop')).toBe(false);
  });

  it('unit pin (src/patching.ts DELETE branch): the guard is Y.Map-only — an array-shrink delete past the previous length still applies', () => {
    // Regression (the scoped-diff.test.ts flake): the previousState DELETE
    // guard protects Y.Map STRING keys (a concurrent remote insert must not be
    // deleted). For a Y.Array `property` is a numeric INDEX, and a shrink can
    // emit a delete at an index >= the previous array length — e.g.
    // getChanges(['', ''], [' ', '']) => INSERT ' ' at 0, then DELETE at 2.
    // Misapplying the guard as `index in prevArray` skips that delete, leaving
    // a stale trailing element ([' ', '', '']) and silently drifting the doc
    // from state. The guard must NOT touch arrays.
    const doc = new Y.Doc();
    const map = doc.getMap('unit');
    doc.transact(() => {
      const tags = new Y.Array<string>();
      tags.push(['', '']);
      map.set('tags', tags);
    });

    doc.transact(() => {
      patchSharedType(
        map,
        { tags: [' ', ''] },
        { disableYText: true, previousState: { tags: ['', ''] } },
      );
    });

    expect((map.get('tags') as Y.Array<string>).toJSON()).toEqual([' ', '']);
  });
});

describe('contract A.10 — regression: undefined values are preserved (absorbed from src/store/zustand-middleware-yjs-undefined.test.ts)', () => {
  interface AnnotationState {
    annotations: Record<string, { text: string; note: string | undefined }>;
    add: (id: string, text: string, note: string | undefined) => void;
  }

  it('entries containing undefined neither crash the middleware nor drop sibling fields on replication', async () => {
    const docA = new Y.Doc();
    const useStoreA = createStore<AnnotationState>()(
      yjs(docA, 'annotations', (set) => ({
        annotations: {},
        add: (id, text, note) =>
          set((state) => ({
            annotations: { ...state.annotations, [id]: { text, note } },
          })),
      })),
    );

    useStoreA.getState().add('note1', 'hello', undefined);
    await drain();

    const docB = new Y.Doc();
    replicate(docA, docB);
    const useStoreB = createStore<Pick<AnnotationState, 'annotations'>>()(
      yjs(docB, 'annotations', () => ({ annotations: {} })),
    );
    await drain();

    expect(useStoreB.getState().annotations['note1'].text).toBe('hello');
  });
});
