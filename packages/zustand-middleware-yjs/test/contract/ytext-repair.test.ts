import { describe, it, expect } from 'vitest';
import * as Y from 'yjs';
import { createStore } from 'zustand/vanilla';
import yjs from 'zustand-middleware-yjs';
import { drain } from './helpers';

/**
 * Fork contract suite — Y.Text↔string mismatch repair
 * (phase2-fork-surgery.md §3 case A.9; src/patching.ts PENDING branch).
 *
 * This is the in-band migration path for pre-v4 docs: schema v4 made
 * `disableYText: true` the app-wide default, so v4+ writes plain strings
 * while v1/v2-era docs still carry Y.Text values. The middleware repairs a
 * mismatched key LAZILY — only when that key is next written. The committed
 * v1/v2 fixtures (src/test/fixtures/ydoc/) exercise this same path against
 * real era-shaped docs in src/store/__tests__/crdt-contract/.
 */

interface State {
  title: string;
  other: string;
  setTitle: (t: string) => void;
  setOther: (o: string) => void;
}

const creator = (set: (fn: (s: State) => Partial<State>) => void): State => ({
  title: '',
  other: '',
  setTitle: (title) => set(() => ({ title })),
  setOther: (other) => set(() => ({ other })),
});

describe('contract A.9 — Y.Text↔string mismatch repair', () => {
  it('default options (the pre-v4 era): strings are WRITTEN as Y.Text', async () => {
    const doc = new Y.Doc();
    const store = createStore<State>()(yjs(doc, 'shared', creator));

    store.getState().setTitle('hello');
    await drain();

    expect(doc.getMap('shared').get('title')).toBeInstanceOf(Y.Text);
    expect((doc.getMap('shared').get('title') as Y.Text).toString()).toBe('hello');
  });

  it('repairs Y.Text → plain string under disableYText, lazily on write to that key', async () => {
    // A pre-v4-era doc: Y.Text values.
    const doc = new Y.Doc();
    doc.transact(() => {
      doc.getMap('shared').set('title', new Y.Text('old-title'));
      doc.getMap('shared').set('other', new Y.Text('old-other'));
    });

    const store = createStore<State>()(
      yjs(doc, 'shared', creator, { disableYText: true }),
    );
    // Hydration reads through toJSON(): plain strings in state.
    expect(store.getState().title).toBe('old-title');

    // Writing a DIFFERENT key does not repair 'title' (repair is per-key lazy).
    store.getState().setOther('new-other');
    await drain();
    expect(doc.getMap('shared').get('title')).toBeInstanceOf(Y.Text);
    expect(doc.getMap('shared').get('other')).toBe('new-other');

    // Writing 'title' repairs it to a plain string.
    store.getState().setTitle('new-title');
    await drain();
    expect(doc.getMap('shared').get('title')).toBe('new-title');
    expect(typeof doc.getMap('shared').get('title')).toBe('string');
  });

  it('repairs plain string → Y.Text for keys opted in via yTextKeys', async () => {
    // A v4+-era doc: plain strings.
    const doc = new Y.Doc();
    doc.getMap('shared').set('title', 'old-title');

    const store = createStore<State>()(
      yjs(doc, 'shared', creator, { disableYText: true, yTextKeys: ['title'] }),
    );
    expect(store.getState().title).toBe('old-title');

    store.getState().setTitle('new-title');
    await drain();

    const repaired = doc.getMap('shared').get('title');
    expect(repaired).toBeInstanceOf(Y.Text);
    expect((repaired as Y.Text).toString()).toBe('new-title');
  });
});
