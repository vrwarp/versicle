// @ts-nocheck
import { vi, describe, it, expect } from 'vitest';
import * as Y from 'yjs';
import { create } from 'zustand';
import yjs from 'zustand-middleware-yjs';

describe('zustand-middleware-yjs undefined values', () => {
  it('should preserve and not crash on undefined', async () => {
    const docA = new Y.Doc();
    
    const useStoreA = create()(yjs(docA, 'annotations', (set) => ({
      annotations: {},
      add: (id, text, note) => set(state => ({
        annotations: { ...state.annotations, [id]: { text, note } }
      }))
    })));

    useStoreA.getState().add('note1', 'hello', undefined);
    
    await new Promise(r => setTimeout(r, 0));
    
    const snapshot = Y.encodeStateAsUpdate(docA);
    const docB = new Y.Doc();
    Y.applyUpdate(docB, snapshot);

    const useStoreB = create()(yjs(docB, 'annotations', (set) => ({
      annotations: {}
    })));

    await new Promise(r => setTimeout(r, 0));

    const stateB = useStoreB.getState() as any;
    expect(stateB.annotations.note1.text).toBe('hello');
  });
});
