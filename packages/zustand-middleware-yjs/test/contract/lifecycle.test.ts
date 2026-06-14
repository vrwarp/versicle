import { describe, it, expect, vi } from 'vitest';
import * as Y from 'yjs';
import { createStore } from 'zustand/vanilla';
import yjs from 'zustand-middleware-yjs';
import { drain, replicate, countUpdates } from './helpers';

/**
 * Fork contract suite — lifecycle callbacks and the schema-version poison
 * pill (phase2-fork-surgery.md §3 cases A.7, A.8).
 *
 * A.8 also pins TWO known gaps as current behavior (both fixed by Phase 4's
 * synchronous pre-merge `meta` check, finding D5):
 *   - a map that never carries __schemaVersion never quarantines;
 *   - creation-time hydration is not version-guarded at all (the eager
 *     map.size > 0 path patches state before any observer runs);
 *   - quarantine happens AFTER the Y-level merge — the doc itself has
 *     already absorbed the too-new data.
 */

interface State {
  count: number;
  increment: () => void;
}

const creator = (set: (fn: (s: State) => Partial<State>) => void): State => ({
  count: 0,
  increment: () => set((s) => ({ count: s.count + 1 })),
});

describe('contract A.7 — onLoaded timing matrix', () => {
  it('fires synchronously at creation when the map is pre-populated', () => {
    const doc = new Y.Doc();
    doc.getMap('shared').set('count', 5);

    const onLoaded = vi.fn();
    createStore<State>()(yjs(doc, 'shared', creator, { onLoaded }));

    expect(onLoaded).toHaveBeenCalledTimes(1);
  });

  it('never fires on the store\'s own outbound transactions', async () => {
    const doc = new Y.Doc();
    const onLoaded = vi.fn();
    const store = createStore<State>()(yjs(doc, 'shared', creator, { onLoaded }));

    store.getState().increment();
    await drain();
    expect(onLoaded).not.toHaveBeenCalled();
  });

  it('fires on the first FOREIGN transaction (and only once)', async () => {
    const docA = new Y.Doc();
    const onLoaded = vi.fn();
    createStore<State>()(yjs(docA, 'shared', creator, { onLoaded }));

    const docB = new Y.Doc();
    docB.getMap('shared').set('count', 7);
    replicate(docB, docA); // synchronous observer → loaded
    expect(onLoaded).toHaveBeenCalledTimes(1);

    docB.getMap('shared').set('count', 8);
    replicate(docB, docA);
    await drain();
    expect(onLoaded).toHaveBeenCalledTimes(1); // still once
  });
});

describe('contract A.8 — __schemaVersion poison pill', () => {
  /** A peer doc one schema version ahead, sharing history with `base`. */
  const newerPeer = (base: Y.Doc): Y.Doc => {
    const docB = new Y.Doc();
    replicate(base, docB);
    docB.transact(() => {
      docB.getMap('shared').set('__schemaVersion', 6);
      docB.getMap('shared').set('newSchemaData', 'v6-shape');
    });
    return docB;
  };

  it('quarantines on an incoming higher version: onObsolete fires once, state is not patched, sync halts both ways', async () => {
    const docA = new Y.Doc();
    const onObsolete = vi.fn();
    const onLoaded = vi.fn();
    const storeA = createStore<State>()(
      yjs(docA, 'shared', creator, { schemaVersion: 5, onObsolete, onLoaded }),
    );
    storeA.getState().increment();
    await drain();

    const docB = newerPeer(docA);
    replicate(docB, docA);
    await drain();

    // Quarantine fired with the incoming version, BEFORE any store patch —
    // and it preempts onLoaded.
    expect(onObsolete).toHaveBeenCalledTimes(1);
    expect(onObsolete).toHaveBeenCalledWith(6);
    expect(onLoaded).not.toHaveBeenCalled();
    expect(
      (storeA.getState() as unknown as Record<string, unknown>)['newSchemaData'],
    ).toBeUndefined();
    // Pinned residual (D5): the Y-LEVEL merge already happened — the local
    // doc has absorbed the v6 data even though the store never saw it.
    expect(docA.getMap('shared').get('newSchemaData')).toBe('v6-shape');

    // Outbound permanently halted: local sets stay local.
    const updates = countUpdates(docA);
    storeA.getState().increment();
    await drain();
    expect(updates.count()).toBe(0);
    expect(docA.getMap('shared').get('count')).toBe(1); // doc unchanged
    expect(storeA.getState().count).toBe(2); // optimistic local state only

    // Inbound permanently halted: further foreign updates merge at the Y
    // level but never reach the store, and onObsolete does not re-fire.
    docB.getMap('shared').set('count', 99);
    replicate(docB, docA);
    await drain();
    expect(storeA.getState().count).toBe(2);
    expect(onObsolete).toHaveBeenCalledTimes(1);
  });

  it('known gap (D5): a map that never carries __schemaVersion NEVER quarantines', async () => {
    const docA = new Y.Doc();
    const onObsolete = vi.fn();
    const storeA = createStore<State>()(
      yjs(docA, 'shared', creator, { schemaVersion: 5, onObsolete }),
    );

    // Foreign v6-era data WITHOUT the version key (only the 'library' map
    // carries it in the app — the eight unguarded maps of finding D5).
    const docB = new Y.Doc();
    docB.getMap('shared').set('count', 600);
    replicate(docB, docA);
    await drain();

    expect(onObsolete).not.toHaveBeenCalled();
    expect(storeA.getState().count).toBe(600); // patched normally
  });

  it('known gap (D5): creation-time hydration is not version-guarded', () => {
    // A doc that is ALREADY at v6 when the v5-configured store is created:
    // the eager pre-populated path hydrates and fires onLoaded without any
    // version check; quarantine only arrives with the NEXT transaction.
    const doc = new Y.Doc();
    doc.transact(() => {
      doc.getMap('shared').set('__schemaVersion', 6);
      doc.getMap('shared').set('count', 42);
    });

    const onObsolete = vi.fn();
    const onLoaded = vi.fn();
    const store = createStore<State>()(
      yjs(doc, 'shared', creator, { schemaVersion: 5, onObsolete, onLoaded }),
    );

    expect(onLoaded).toHaveBeenCalledTimes(1);
    expect(onObsolete).not.toHaveBeenCalled();
    expect(store.getState().count).toBe(42); // v6 data hydrated unguarded
  });
});
