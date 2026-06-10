import { describe, it, expect } from 'vitest';
import * as Y from 'yjs';
import { create } from 'zustand';
import yjs from 'zustand-middleware-yjs';

// Regression coverage for the forked zustand-middleware-yjs: state entries
// containing `undefined` values (e.g. an annotation whose optional note was
// never set) must neither crash the middleware nor drop sibling fields when
// the doc is replicated to another peer.
interface AnnotationState {
  annotations: Record<string, { text: string; note: string | undefined }>;
  add: (id: string, text: string, note: string | undefined) => void;
}

describe('zustand-middleware-yjs undefined values', () => {
  it('should preserve and not crash on undefined', async () => {
    const docA = new Y.Doc();

    const useStoreA = create<AnnotationState>()(
      yjs(docA, 'annotations', (set) => ({
        annotations: {},
        add: (id, text, note) =>
          set((state) => ({
            annotations: { ...state.annotations, [id]: { text, note } },
          })),
      }))
    );

    useStoreA.getState().add('note1', 'hello', undefined);

    await new Promise((r) => setTimeout(r, 0));

    const snapshot = Y.encodeStateAsUpdate(docA);
    const docB = new Y.Doc();
    Y.applyUpdate(docB, snapshot);

    const useStoreB = create<Pick<AnnotationState, 'annotations'>>()(
      yjs(docB, 'annotations', () => ({
        annotations: {},
      }))
    );

    await new Promise((r) => setTimeout(r, 0));

    const stateB = useStoreB.getState();
    expect(stateB.annotations.note1.text).toBe('hello');
  });
});
