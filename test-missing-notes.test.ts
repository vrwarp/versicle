import { describe, it, expect } from 'vitest';
import * as Y from 'yjs';
import { create } from 'zustand';
import yjs from 'zustand-middleware-yjs';

describe('zustand-middleware-yjs undefined values', () => {
  it('should preserve and not crash on undefined', async () => {
    const docA = new Y.Doc();
    
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const useStoreA = create<any>()(yjs(docA, 'annotations', (set: any) => ({
      annotations: {},
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      add: (id: string, text: string, note: string) => set((state: any) => ({
        annotations: { ...state.annotations, [id]: { text, note } }
      }))
    })));

    useStoreA.getState().add('note1', 'hello', undefined);
    
    await new Promise(r => setTimeout(r, 0));
    
    const snapshot = Y.encodeStateAsUpdate(docA);
    const docB = new Y.Doc();
    Y.applyUpdate(docB, snapshot);

    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    const useStoreB = create()(yjs(docB, 'annotations', (set) => ({
      annotations: {}
    })));

    await new Promise(r => setTimeout(r, 0));

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const stateB = useStoreB.getState() as any;
    expect(stateB.annotations.note1.text).toBe('hello');
  });
});
