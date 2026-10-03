import { describe, it, expect, vi } from 'vitest';
import * as Y from 'yjs';
import { createStore } from 'zustand/vanilla';
import yjs from 'zustand-middleware-yjs';
import { drain, replicate, countUpdates } from './helpers';

/**
 * Fork contract suite — lifecycle callbacks and the schema-version poison
 * pill (phase2-fork-surgery.md §3 cases A.7, A.8).
 *
 * A.8 also pins two known gaps as current behavior (both covered at the app
 * level by Phase 4's synchronous pre-merge `meta` check, finding D5):
 *   - a map that never carries __schemaVersion never quarantines;
 *   - quarantine happens AFTER the Y-level merge — the doc itself has
 *     already absorbed the too-new data.
 * A third gap — creation-time hydration was not version-guarded — is fixed
 * in the fork (vrwarp/zustand-middleware-yjs#40) and pinned as fixed below.
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

  it('creation-time hydration is version-guarded (D5 gap fixed in the fork)', async () => {
    // A doc that is ALREADY at v6 when the v5-configured store is created
    // (the cold start where IDB loaded the doc before the store existed):
    // the store must not hydrate the v6 data or report it loaded, and goes
    // obsolete without waiting for another transaction.
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

    expect(onLoaded).not.toHaveBeenCalled();
    expect(store.getState().count).toBe(0); // v6 data NOT hydrated

    await drain();
    expect(onObsolete).toHaveBeenCalledTimes(1);
    expect(onObsolete).toHaveBeenCalledWith(6);
    expect(onLoaded).not.toHaveBeenCalled();
  });
});
