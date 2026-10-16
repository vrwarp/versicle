import { describe, it, expect } from 'vitest';
import * as Y from 'yjs';
import { createStore } from 'zustand/vanilla';
import yjs from 'zustand-middleware-yjs';
import { drain } from './helpers';

/**
 * Fork contract — `atomicKeys` is DEAD CODE under `disableYText: true`
 * (phase2-fork-surgery.md correction ▲3): the mapping/patch branches only
 * consult atomicKeys when disableYText is falsy, so passing it alongside
 * `disableYText: true` (the encoding defineSyncedStore applies to every
 * synced store) is a no-op.
 *
 * The package keeps the option in its YjsOptions ("existing, unchanged
 * semantics" — §2's options surface); the app does not pass it. This test
 * pins that with disableYText: true, configuring atomicKeys produces a
 * byte-identical doc.
 */

interface State {
  __schemaVersion: number;
  title: string;
  books: Record<string, { name: string }>;
  init: () => void;
}

const creator = (set: (fn: (s: State) => Partial<State>) => void): State => ({
  __schemaVersion: 5,
  title: '',
  books: {},
  init: () =>
    set(() => ({
      title: 'plain string',
      books: { b1: { name: 'nested string' } },
    })),
});

describe('contract — atomicKeys under disableYText: true is a no-op (correction ▲3)', () => {
  it('with and without atomicKeys the docs are byte-identical and strings stay plain', async () => {
    const run = async (withAtomicKeys: boolean): Promise<Y.Doc> => {
      const doc = new Y.Doc({ guid: 'pinned' });
      doc.clientID = 7; // identical encodings, not just identical JSON
      const store = createStore<State>()(
        yjs(doc, 'lib', creator, {
          disableYText: true,
          ...(withAtomicKeys ? { atomicKeys: ['__schemaVersion', 'title'] } : {}),
        }),
      );
      store.getState().init();
      await drain();
      return doc;
    };

    const withOption = await run(true);
    const withoutOption = await run(false);

    expect(withOption.getMap('lib').toJSON()).toEqual(withoutOption.getMap('lib').toJSON());
    expect(Y.encodeStateAsUpdate(withOption))
      .toEqual(Y.encodeStateAsUpdate(withoutOption));

    // disableYText alone is what keeps strings plain — not atomicKeys.
    expect(typeof withoutOption.getMap('lib').get('title')).toBe('string');
    expect(typeof withOption.getMap('lib').get('title')).toBe('string');
  });

  it('contrast pin: with disableYText falsy, atomicKeys IS live (why the option stays in the package)', async () => {
    const doc = new Y.Doc();
    const store = createStore<State>()(
      yjs(doc, 'lib', creator, { atomicKeys: ['title'] }),
    );
    store.getState().init();
    await drain();

    // The atomic key is a plain string; non-atomic strings become Y.Text.
    expect(typeof doc.getMap('lib').get('title')).toBe('string');
    const books = doc.getMap('lib').get('books') as Y.Map<unknown>;
    const entry = (books.get('b1') as Y.Map<unknown>).get('name');
    expect(entry).toBeInstanceOf(Y.Text);
  });
});
