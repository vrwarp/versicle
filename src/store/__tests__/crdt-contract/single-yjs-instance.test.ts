import { describe, it, expect } from 'vitest';
import * as Y from 'yjs';
import { createStore } from 'zustand/vanilla';
import yjsMiddleware from 'zustand-middleware-yjs';

/**
 * Single-yjs-instance runtime assertion (Phase 2 vendoring,
 * plan/overhaul/prep/phase2-fork-surgery.md §6.6d).
 *
 * The vendored middleware's mapping/patching code branches on
 * `instanceof Y.Map` / `Y.Array` / `Y.Text` (packages/zustand-middleware-yjs/
 * src/patching.ts). If npm ever resolved a SECOND physical copy of yjs for
 * the middleware (they were regular deps of the fork before vendoring made
 * them peers), every one of those branches would fail against objects created
 * by the app's yjs — and sync would corrupt silently instead of erroring.
 *
 * This test drives the app's own yjs import through the middleware and
 * asserts the structures the middleware created ARE instances of the app's
 * Y classes — which is only true when both modules share one yjs instance.
 * Static complements: scripts/assert-single-instance.cjs (§6.6b, npm-tree
 * level) and resolve.dedupe in vite/vitest configs (§6.6c, bundler level).
 */
interface TestState {
  items: Record<string, { label: string; tags: string[] }>;
  setItem: (id: string, label: string) => void;
}

describe('single yjs module instance across app and middleware', () => {
  it('middleware-written shared types are instanceof the app yjs classes', async () => {
    const doc = new Y.Doc();
    const store = createStore<TestState>()(
      yjsMiddleware(doc, 'instance-check', (set) => ({
        items: {},
        setItem: (id, label) =>
          set((state) => ({
            items: { ...state.items, [id]: { label, tags: ['a', 'b'] } },
          })),
      })),
    );

    store.getState().setItem('x', 'hello');
    await Promise.resolve(); // drain the middleware's outbound microtask

    const map = doc.getMap('instance-check');
    // Nested object/array written by the MIDDLEWARE, tested against the
    // APP's Y constructors. Cross-instance yjs would fail both assertions
    // (and the write itself would have been mangled long before).
    expect(map.get('items')).toBeInstanceOf(Y.Map);
    expect((map.get('items') as Y.Map<unknown>).get('x')).toBeInstanceOf(Y.Map);
    expect(map.toJSON()).toEqual({
      items: { x: { label: 'hello', tags: ['a', 'b'] } },
    });
  });

  it('app-created Y types flow through the middleware instanceof branches inbound', async () => {
    // Build a doc with the APP's yjs, replicate it into a middleware-backed
    // store: hydration exercises patchState/patchStore over toJSON() output,
    // and a remote nested Y.Map update only patches (rather than crashes or
    // no-ops) when instanceof agrees.
    const remote = new Y.Doc();
    const remoteMap = remote.getMap('instance-check');
    const nested = new Y.Map();
    nested.set('x', new Y.Map(Object.entries({ label: 'remote', tags: null })));
    remote.transact(() => {
      remoteMap.set('items', nested);
    });

    const doc = new Y.Doc();
    Y.applyUpdate(doc, Y.encodeStateAsUpdate(remote));
    const store = createStore<Pick<TestState, 'items'>>()(
      yjsMiddleware(doc, 'instance-check', () => ({ items: {} })),
    );

    await Promise.resolve();
    expect(store.getState().items['x']).toMatchObject({ label: 'remote' });
  });
});
