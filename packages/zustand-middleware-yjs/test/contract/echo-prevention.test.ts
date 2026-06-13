import { describe, it, expect, vi } from 'vitest';
import * as Y from 'yjs';
import { createStore } from 'zustand/vanilla';
import yjs from 'zustand-middleware-yjs';
import { drain, replicate, countUpdates } from './helpers';

/**
 * Fork contract suite — echo-loop prevention, both halves
 * (phase2-fork-surgery.md §3 case A.4):
 *
 *   #1 own-origin Yjs transactions are skipped by the observer
 *      (index.ts: transaction.origin === api → return), so a local set()
 *      never round-trips back into the store;
 *   #2 inbound patches go through the ORIGINAL setState
 *      (processBatch passes {...api, setState: originalSetState}), so an
 *      applied remote update never schedules an outbound flush.
 */

interface State {
  count: number;
  increment: () => void;
}

const creator = (set: (fn: (s: State) => Partial<State>) => void): State => ({
  count: 0,
  increment: () => set((s) => ({ count: s.count + 1 })),
});

describe('contract A.4 — echo-loop prevention', () => {
  it('half #1: a local set() notifies subscribers exactly once (no echo re-patch)', async () => {
    const doc = new Y.Doc();
    const store = createStore<State>()(yjs(doc, 'shared', creator));
    const subscriber = vi.fn();
    store.subscribe(subscriber);
    const updates = countUpdates(doc);

    store.getState().increment();
    await drain();

    // One optimistic local notification; the outbound transaction's
    // observeDeep callback saw origin === api and did nothing.
    expect(subscriber).toHaveBeenCalledTimes(1);
    expect(updates.count()).toBe(1);
    expect(store.getState().count).toBe(1);
    expect(doc.getMap('shared').get('count')).toBe(1);
  });

  it('half #2: an inbound remote update patches the store WITHOUT scheduling an outbound write', async () => {
    const docA = new Y.Doc();
    const storeA = createStore<State>()(yjs(docA, 'shared', creator));
    storeA.getState().increment();
    await drain();

    const docB = new Y.Doc();
    replicate(docA, docB);
    docB.transact(() => {
      docB.getMap('shared').set('count', 41);
    });

    const updates = countUpdates(docA);
    const subscriber = vi.fn();
    storeA.subscribe(subscriber);

    replicate(docB, docA); // update event #1 (the applied remote transaction)
    expect(updates.count()).toBe(1);
    await drain(); // inbound processBatch runs

    // The store was patched once…
    expect(subscriber).toHaveBeenCalledTimes(1);
    expect(storeA.getState().count).toBe(41);
    // …and the doc saw NO further transaction: the inbound apply did not
    // echo back outbound.
    expect(updates.count()).toBe(1);
  });
});
